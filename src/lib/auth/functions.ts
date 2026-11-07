// Accounts and access, for the browser: who is signed in, their families, invitations, and the
// steward's /access page. Server-only code is imported inside each handler, so it never ships to
// the browser. Passkey ceremonies themselves are server routes (src/routes/api/auth/$action.ts).
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { Role } from '../roles';
import type { TreeMeta } from '../types';

const tree = z.string().regex(/^[a-z0-9-]+$/).max(64);
const role = z.enum(['viewer', 'contributor', 'editor', 'steward']);
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

const guard = () => import('./guard.server');
const store = () => import('./store.server');

export interface SessionInfo {
  user: { id: string; name: string; email: string | null; via: 'passkey' | 'access' } | null;
  memberships: { tree: string; role: Role; person: string | null }[];
  /** Nobody has an account yet: /setup creates the first steward. */
  needsSetup: boolean;
  /** Signed in through Cloudflare Access as this email, but not invited. */
  uninvitedEmail?: string;
  /** Where "Sign out" must also go when signed in through Access. */
  accessLogout?: string;
}

/** Who is signed in, and their role and "who you are" in each family. Never cached across readers. */
export const fetchSession = createServerFn({ method: 'GET' }).handler(async (): Promise<SessionInfo> => {
  const [{ currentSession }, s, { needsSetup }, { accessLogoutUrl }] = await Promise.all([guard(), store(), import('./setup.server'), import('./access.server')]);
  const { user, via, uninvitedEmail } = await currentSession();
  return {
    user: user && via ? { id: user.id, name: user.name, email: user.email, via } : null,
    memberships: user ? s.membershipsOf(user.id).map((m) => ({ tree: m.tree, role: m.role, person: m.person })) : [],
    needsSetup: needsSetup(),
    uninvitedEmail,
    accessLogout: via === 'access' || uninvitedEmail ? accessLogoutUrl() : undefined,
  };
});
export const sessionQuery = queryOptions({ queryKey: ['session'], queryFn: () => fetchSession(), staleTime: 60_000 });

/** The families the signed-in reader belongs to, with their role in each. Empty when signed out. */
export const fetchMyFamilies = createServerFn({ method: 'GET' }).handler(async (): Promise<(TreeMeta & { role: Role })[]> => {
  const [{ currentSession }, s, { families }] = await Promise.all([guard(), store(), import('./trees.server')]);
  const { user } = await currentSession();
  if (!user) return [];
  const mine = new Map(s.membershipsOf(user.id).map((m) => [m.tree, m.role]));
  return (await families()).filter((t) => mine.has(t.id)).map((t) => ({ ...t, role: mine.get(t.id)! }));
});
export const myFamiliesQuery = queryOptions({ queryKey: ['session', 'families'], queryFn: () => fetchMyFamilies() });

// ---------- invitations (the invitee's side) ----------

export interface InviteInfo {
  status: 'open' | 'expired' | 'used' | 'revoked' | 'unknown';
  family?: { id: string; name: string; tagline: string; theme: TreeMeta['theme']; crest?: TreeMeta['crest']; focus: string };
  role?: Role;
  inviter?: string;
  expires?: number;
  /** The signed-in reader, if any (they can accept with their existing account). */
  signedInAs?: string;
  alreadyMember?: boolean;
}

/** What an invitation link offers. POST, so the token never lands in a URL's query string or a log. */
export const fetchInvite = createServerFn({ method: 'POST' })
  .validator(z.object({ token: z.string().max(100) }))
  .handler(async ({ data }): Promise<InviteInfo> => {
    const [{ currentSession }, s, { family }, { hashToken }, { allow }, { getRequestIP }] = await Promise.all([
      guard(), store(), import('./trees.server'), import('./tokens.server'), import('./throttle.server'), import('@tanstack/react-start/server'),
    ]);
    if (!allow(`invite-check:${getRequestIP() ?? 'unknown'}`, 30, 10 * 60_000)) return { status: 'unknown' };
    if (!token.safeParse(data.token).success) return { status: 'unknown' };
    const row = s.accounts().prepare('SELECT * FROM invite WHERE hash = ?').get(hashToken('invite', data.token)) as import('./store.server').InviteRow | undefined;
    if (!row) return { status: 'unknown' };
    const status = row.revoked_at ? 'revoked' : row.used_at ? 'used' : row.expires <= Date.now() ? 'expired' : 'open';
    const f = await family(row.tree);
    if (!f) return { status: 'unknown' };
    const { user } = await currentSession();
    return {
      status,
      family: { id: f.id, name: f.name, tagline: f.tagline, theme: f.theme, crest: f.crest, focus: f.focus },
      role: row.role,
      inviter: row.created_by ? s.userById(row.created_by)?.name : undefined,
      expires: row.expires,
      signedInAs: user?.name,
      alreadyMember: user ? !!s.membership(user.id, row.tree) : undefined,
    };
  });

/** A signed-in reader accepts an invitation into another family with their existing account. */
export const acceptInvite = createServerFn({ method: 'POST' })
  .validator(z.object({ token }))
  .handler(async ({ data }) => {
    const [{ requireUser, fail }, s, { AuthError }] = await Promise.all([guard(), store(), import('./errors')]);
    const user = await requireUser();
    const invite = s.openInvite(data.token);
    if (!invite) throw fail(new AuthError('invalid', 'This invitation has expired, was already used, or was withdrawn. Ask for a new one.'));
    s.tx((d) => s.useInvite(d, invite, user.id));
    return { tree: invite.tree };
  });

// ---------- "who you are" ----------

/** Saves who the reader is in a family (a person id, or '-' for just browsing). */
export const setMyPerson = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, person: z.string().min(1).max(120).nullable() }))
  .handler(async ({ data }) => {
    const [{ requireMember, fail }, s, { AuthError }] = await Promise.all([guard(), store(), import('./errors')]);
    const { user } = await requireMember(data.tree);
    if (data.person && data.person !== '-') {
      const { db } = await import('../db.server');
      if (!db(data.tree).prepare('SELECT id FROM person WHERE id = ?').get(data.person)) throw fail(new AuthError('invalid', 'That person isn’t in this family.'));
    }
    s.setPerson(user.id, data.tree, data.person);
  });

// ---------- the reader's own account ----------

export interface Passkey { id: string; device: string | null; synced: boolean; created: number; lastUsed: number | null }

export const fetchMyPasskeys = createServerFn({ method: 'GET' }).handler(async (): Promise<Passkey[]> => {
  const [{ requireUser, fail }, s] = await Promise.all([guard(), store()]);
  const user = await requireUser();
  return s.credentialsOf(user.id).map((c) => ({ id: c.id, device: c.device, synced: !!c.synced, created: c.created, lastUsed: c.last_used }));
});
export const myPasskeysQuery = queryOptions({ queryKey: ['session', 'passkeys'], queryFn: () => fetchMyPasskeys() });

/** Removes one of the reader's passkeys; never the last one (they would be locked out). */
export const removeMyPasskey = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().min(1).max(1024) }))
  .handler(async ({ data }) => {
    const [{ requireUser, currentSession, fail }, s, { AuthError }] = await Promise.all([guard(), store(), import('./errors')]);
    const user = await requireUser();
    const { via } = await currentSession();
    s.tx((d) => {
      const n = (d.prepare('SELECT count(*) AS n FROM credential WHERE user = ?').get(user.id) as { n: number }).n;
      if (n <= 1 && via !== 'access') throw fail(new AuthError('invalid', 'This is your only passkey. Add another before removing it, or you won’t be able to sign in.'));
      const r = d.prepare('DELETE FROM credential WHERE id = ? AND user = ?').run(data.id, user.id);
      if (r.changes !== 1) throw fail(new AuthError('invalid', 'That passkey was already removed.'));
    });
  });

export const renameMe = createServerFn({ method: 'POST' })
  .validator(z.object({ name: z.string().max(200) }))
  .handler(async ({ data }) => {
    const [{ requireUser }, s, { cleanName }] = await Promise.all([guard(), store(), import('./passkeys.server')]);
    const user = await requireUser();
    s.renameUser(user.id, cleanName(data.name));
  });

// ---------- the steward's /access page ----------

export interface AccessMember { id: string; name: string; email: string | null; role: Role; person: string | null; lastSeen: number | null; joined: number; passkeys: number; you: boolean }
export interface AccessInvite { id: string; role: Role; email: string | null; expires: number; created: number; inviter: string | null; status: 'open' | 'expired' | 'used' | 'revoked'; usedBy: string | null; usedAt: number | null }

export const fetchAccess = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }): Promise<{ members: AccessMember[]; invites: AccessInvite[] }> => {
    const [{ requireCan }, s] = await Promise.all([guard(), store()]);
    const { user } = await requireCan(data.tree, 'manage-access');
    const names = new Map<string, string>();
    const members = s.membersOf(data.tree).map((m) => {
      names.set(m.id, m.name);
      return { id: m.id, name: m.name, email: m.email, role: m.role, person: m.person, lastSeen: m.last_seen, joined: m.joined, passkeys: m.passkeys, you: m.id === user.id };
    });
    const nameOf = (id: string | null) => (id ? names.get(id) ?? s.userById(id)?.name ?? null : null);
    const t = Date.now();
    const invites = s.invitesOf(data.tree).map((i) => ({
      id: i.id, role: i.role, email: i.email, expires: i.expires, created: i.created, inviter: nameOf(i.created_by),
      status: i.revoked_at ? 'revoked' as const : i.used_at ? 'used' as const : i.expires <= t ? 'expired' as const : 'open' as const,
      usedBy: nameOf(i.used_by), usedAt: i.used_at,
    }));
    return { members, invites };
  });
export const accessQuery = (t: string) => queryOptions({ queryKey: ['session', 'access', t], queryFn: () => fetchAccess({ data: { tree: t } }) });

/** A new invitation link. The token is shown once; only its hash is kept. */
export const createInvite = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, role, email: z.string().trim().toLowerCase().email().max(254).optional().or(z.literal('')), days: z.number().int().min(1).max(30).optional() }))
  .handler(async ({ data }) => {
    const [{ requireCan, fail }, s, { family }, { AuthError }] = await Promise.all([guard(), store(), import('./trees.server'), import('./errors')]);
    const { user } = await requireCan(data.tree, 'manage-access');
    if (!(await family(data.tree))) throw fail(new AuthError('invalid', 'No such family.'));
    const { invite, token } = s.createInvite({ tree: data.tree, role: data.role, email: data.email || null, createdBy: user.id, days: data.days });
    return { id: invite.id, token, expires: invite.expires };
  });

/** A fresh link for a pending invitation (the old link stops working). */
export const renewInvite = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const [{ requireCan, fail }, s, { AuthError }] = await Promise.all([guard(), store(), import('./errors')]);
    await requireCan(data.tree, 'manage-access');
    const i = s.inviteById(data.id);
    if (!i || i.tree !== data.tree || i.used_at || i.revoked_at) throw fail(new AuthError('invalid', 'That invitation can’t be renewed.'));
    return { token: s.renewInvite(i.id), expires: s.inviteById(i.id)!.expires };
  });

export const revokeInvite = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const [{ requireCan }, s] = await Promise.all([guard(), store()]);
    await requireCan(data.tree, 'manage-access');
    s.accounts().prepare('UPDATE invite SET revoked_at = ? WHERE id = ? AND tree = ? AND used_at IS NULL AND revoked_at IS NULL').run(Date.now(), data.id, data.tree);
  });

const lastSteward = 'A family always needs at least one steward. Make someone else a steward first.';

export const setMemberRole = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, user: z.string().uuid(), role }))
  .handler(async ({ data }) => {
    const [{ requireCan, fail }, s, { AuthError }] = await Promise.all([guard(), store(), import('./errors')]);
    await requireCan(data.tree, 'manage-access');
    s.tx((d) => {
      const m = d.prepare('SELECT role FROM membership WHERE user = ? AND tree = ?').get(data.user, data.tree) as { role: Role } | undefined;
      if (!m) throw fail(new AuthError('invalid', 'They are no longer a member.'));
      if (m.role === 'steward' && data.role !== 'steward' && s.stewardCount(d, data.tree) <= 1) throw fail(new AuthError('invalid', lastSteward));
      d.prepare('UPDATE membership SET role = ? WHERE user = ? AND tree = ?').run(data.role, data.user, data.tree);
    });
  });

export const removeMember = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, user: z.string().uuid() }))
  .handler(async ({ data }) => {
    const [{ requireCan, fail }, s, { AuthError }] = await Promise.all([guard(), store(), import('./errors')]);
    await requireCan(data.tree, 'manage-access');
    s.tx((d) => {
      const m = d.prepare('SELECT role FROM membership WHERE user = ? AND tree = ?').get(data.user, data.tree) as { role: Role } | undefined;
      if (!m) return;
      if (m.role === 'steward' && s.stewardCount(d, data.tree) <= 1) throw fail(new AuthError('invalid', lastSteward));
      d.prepare('DELETE FROM membership WHERE user = ? AND tree = ?').run(data.user, data.tree);
    });
  });
