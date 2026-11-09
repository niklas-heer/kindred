// Accounts and access, for the browser: who is signed in, their families, invitations, and the
// steward's /access page. Server-only code is imported inside each handler, so it never ships to
// the browser. Passkey ceremonies themselves are server routes (src/routes/api/auth/$action.ts).
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { WaitingLink } from '../ai/background';
import type { Role } from '../roles';
import type { TreeMeta } from '../types';
import { LOCALES } from '../i18n/types';

const tree = z.string().regex(/^[a-z0-9-]+$/).max(64);
const role = z.enum(['viewer', 'contributor', 'editor', 'steward']);
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

const guard = () => import('./guard.server');
const store = () => import('./store.server');

export interface SessionInfo {
  /** The installation's one sign-in method (KINDRED_AUTH). Decides which sign-in screens exist at all. */
  auth: 'kindred' | 'cloudflare-access';
  user: { id: string; name: string; email: string | null; via: 'passkey' | 'access'; locale: (typeof LOCALES)[number] | null } | null;
  memberships: { tree: string; role: Role; person: string | null; personConfirmed: boolean }[];
  /** Nobody has an account yet: /setup creates the first steward. */
  needsSetup: boolean;
  /** Setup will make the server's first family, so it asks for that family's name. */
  needsFamily?: boolean;
  setupCodeRequired: boolean;
  /** Setup is open (no code) on a public address: /setup warns that the first visitor becomes the steward. */
  setupOpenToPublic?: boolean;
  defaultTree?: string;
  /** A verified Cloudflare Access identity with no account here: not invited, or setup still needs its code. */
  uninvitedEmail?: string;
  /** Cloudflare Access's own sign-out, when that is the method. */
  accessLogout?: string;
  /** A guest's visit through a family share link. `memberships` then holds that family, as a viewer. */
  guest?: { tree: string; expires: number };
  /** No session, and a guest's visit has ended: they get that page, not the passkey sign-in. */
  guestEnded?: boolean;
  /** This request came in on the guest host (docs/deploy-cloudflare.md). */
  guestHost?: boolean;
}

/** Who is signed in, and their role and "who you are" in each family. Never cached across readers. */
export const fetchSession = createServerFn({ method: 'GET' }).handler(async (): Promise<SessionInfo> => {
  const [{ currentSession }, s, setup, { accessLogoutUrl, authMethod }, { siteOrigin, guestEnded }, { getRequest }, { onGuestHost }, { defaultTreeFor }] = await Promise.all([
    guard(), store(), import('./setup.server'), import('./method.server'), import('./session.server'), import('@tanstack/react-start/server'), import('./origin'), import('./guest-host'),
  ]);
  // The refused setting never reaches here off the guest host (src/start.ts), and the guest host has no sign-in to choose.
  const auth = authMethod() ?? 'kindred';
  const { user, via, uninvitedEmail, guest } = await currentSession();
  const guestHost = onGuestHost(getRequest());
  // First-time setup is no business of the guest host, which is open to the internet.
  const needs = guestHost ? false : await setup.needsSetup();
  const needsFamily = needs && !(await (await import('./trees.server')).families()).length;
  const memberships = user ? (await s.membershipsOf(user.id)).map((m) => ({ tree: m.tree, role: m.role, person: m.person, personConfirmed: !!m.person_confirmed })) : [];
  // A member of that family is simply a member: only someone who isn't gets the guest's view of it.
  const guestHere = guest && !memberships.some((m) => m.tree === guest.tree) ? guest : undefined;
  if (guestHere) memberships.push({ tree: guestHere.tree, role: 'viewer', person: null, personConfirmed: false });
  return {
    auth,
    user: user && via ? { id: user.id, name: user.name, email: user.email, via, locale: user.locale } : null,
    memberships,
    needsSetup: needs,
    needsFamily,
    setupCodeRequired: setup.setupCodeRequired(),
    // Behind Access, only someone Access let through can reach setup at all, and the Access policy says who that is.
    setupOpenToPublic: auth === 'kindred' && needs && setup.setupOpenToPublic(siteOrigin(getRequest()), new URL(getRequest().url)),
    defaultTree: defaultTreeFor(!!user || !!guestHere),
    uninvitedEmail,
    accessLogout: accessLogoutUrl(),
    guest: guestHere && { tree: guestHere.tree, expires: guestHere.expires },
    guestEnded: !user && !guestHere && guestEnded(getRequest()),
    guestHost,
  };
});
export const sessionQuery = queryOptions({ queryKey: ['session'], queryFn: () => fetchSession(), staleTime: 60_000 });

/** The families the signed-in reader belongs to, with their role in each. Empty when signed out. */
export const fetchMyFamilies = createServerFn({ method: 'GET' }).handler(async (): Promise<(TreeMeta & { role: Role; today: import('./today').TodayEvent[] })[]> => {
  const [{ currentSession }, s, { families }] = await Promise.all([guard(), store(), import('./trees.server')]);
  const { user, guest } = await currentSession();
  if (!user && !guest) return [];
  const mine = new Map(user ? (await s.membershipsOf(user.id)).map((m) => [m.tree, m.role]) : []);
  if (guest && !mine.has(guest.tree)) mine.set(guest.tree, 'viewer');
  // Only the reader's families are opened, and "today" is a narrow read, not the whole family: this runs on every page.
  const { todayIn } = await import('../db.server');
  return Promise.all((await families(mine.keys())).map(async (t) => ({ ...t, role: mine.get(t.id)!, today: await todayIn(t.id) })));
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
    const [{ currentSession }, s, { family }, { allow, clientIP }] = await Promise.all([
      guard(), store(), import('./trees.server'), import('./throttle.server'),
    ]);
    if (!allow(`invite-check:${clientIP()}`, 30, 10 * 60_000)) return { status: 'unknown' };
    if (!token.safeParse(data.token).success) return { status: 'unknown' };
    const row = await s.inviteByToken(data.token);
    if (!row) return { status: 'unknown' };
    const status = row.revoked_at ? 'revoked' : row.used_at ? 'used' : row.expires <= Date.now() ? 'expired' : 'open';
    const f = await family(row.tree);
    if (!f) return { status: 'unknown' };
    const { user } = await currentSession();
    return {
      status,
      family: { id: f.id, name: f.name, tagline: f.tagline, theme: f.theme, crest: f.crest, focus: f.focus },
      role: row.role,
      inviter: row.created_by ? (await s.userById(row.created_by))?.name : undefined,
      expires: row.expires,
      signedInAs: user?.name,
      alreadyMember: user ? !!(await s.membership(user.id, row.tree)) : undefined,
    };
  });

/** A signed-in reader accepts an invitation into another family with their existing account. */
export const acceptInvite = createServerFn({ method: 'POST' })
  .validator(z.object({ token }))
  .handler(async ({ data }) => {
    const [{ requireUser, fail }, s, { AuthError }] = await Promise.all([guard(), store(), import('./errors')]);
    const user = await requireUser();
    const invite = await s.openInvite(data.token);
    if (!invite) throw fail(new AuthError('invalid', 'This invitation has expired, was already used, or was withdrawn. Ask for a new one.'));
    await s.commit(async () => {
      const fresh = await s.inviteById(invite.id);
      if (!fresh || !s.usable(fresh)) throw s.inviteUsed();
      return { writes: s.useInvite(fresh, user.id), result: undefined, refused: s.inviteUsed };
    });
    return { tree: invite.tree };
  });

const verifiedNewcomer = async () => {
  const [{ currentSession, fail }, { signedOut }, { guestChoice }, { getRequest }] = await Promise.all([guard(), import('./errors'), import('./session.server'), import('@tanstack/react-start/server')]);
  const { uninvitedEmail } = await currentSession();
  if (!uninvitedEmail) throw fail(signedOut());
  return { email: uninvitedEmail, locale: guestChoice(getRequest()), fail };
};

/** Cloudflare Access only: a verified identity with no account takes an invitation link. */
export const joinWithAccess = createServerFn({ method: 'POST' })
  .validator(z.object({ token, name: z.string().max(200) }))
  .handler(async ({ data }) => {
    const [{ email, locale, fail }, { joinWithInvite }, { AuthError }, { allow, clientIP }] = await Promise.all([verifiedNewcomer(), import('./access-join.server'), import('./errors'), import('./throttle.server')]);
    if (!allow(`invite:${clientIP()}`, 20, 10 * 60_000)) throw fail(new AuthError('invalid', 'Too many attempts. Please wait a minute and try again.'));
    await joinWithInvite(email, data.token, data.name, locale).catch((e) => { throw e instanceof AuthError ? fail(e) : e; });
  });

/** Cloudflare Access only: a verified identity enters the setup code and becomes the first steward. */
export const setupWithAccess = createServerFn({ method: 'POST' })
  .validator(z.object({ code: z.string().max(200), name: z.string().max(200), familyName: z.string().max(200).optional() }))
  .handler(async ({ data }): Promise<{ tree: string | null }> => {
    const [{ email, locale, fail }, { claimFirstSteward }, { AuthError }, { allow, clientIP }] = await Promise.all([verifiedNewcomer(), import('./access-join.server'), import('./errors'), import('./throttle.server')]);
    const ip = clientIP();
    if (!allow(`setup:${ip}`, 5, 60_000) || !allow('setup:all', 20, 10 * 60_000)) throw fail(new AuthError('invalid', 'Too many attempts. Please wait a minute and try again.'));
    const { tree } = await claimFirstSteward(email, data.code, data.name, data.familyName, locale).catch((e) => { throw e instanceof AuthError ? fail(e) : e; });
    return { tree };
  });

// ---------- "who you are" ----------

/**
 * Saves who the reader is in a family (a person id, or '-' for just browsing). It takes effect at once for what it only
 * labels; painting through it waits for a steward's confirmation, unless the reader can paint anyway.
 */
export const setMyPerson = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, person: z.string().min(1).max(120).nullable() }))
  .handler(async ({ data }) => {
    const [{ requireMember, fail }, s, { AuthError }, { can }] = await Promise.all([guard(), store(), import('./errors'), import('../roles')]);
    const { user, role } = await requireMember(data.tree);
    const named = !!data.person && data.person !== '-';
    if (named) {
      const { db } = await import('../db.server');
      if (!(await db(data.tree).get('SELECT id FROM person WHERE id = ?', data.person))) throw fail(new AuthError('invalid', 'That person isn’t in this family.'));
    }
    await s.setPerson(user.id, data.tree, data.person, named && can(role, 'edit-person'));
  });

/** A steward answers who a member says they are: confirming lets them paint through the link, declining unlinks them. */
export const answerPersonLink = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, user: z.string().uuid(), person: z.string().min(1).max(120), confirm: z.boolean() }))
  .handler(async ({ data }) => {
    const [{ requireCan, fail }, s, { AuthError }] = await Promise.all([guard(), store(), import('./errors')]);
    await requireCan(data.tree, 'manage-access');
    const done = await (data.confirm ? s.confirmPerson : s.declinePerson)(data.user, data.tree, data.person);
    if (!done) throw fail(new AuthError('invalid', 'That member has changed who they say they are. Look at the list again.'));
  });

// ---------- the reader's own account ----------

export interface Passkey { id: string; device: string | null; synced: boolean; created: number; lastUsed: number | null }

export const fetchMyPasskeys = createServerFn({ method: 'GET' }).handler(async (): Promise<Passkey[]> => {
  const [{ requireUser }, s] = await Promise.all([guard(), store()]);
  const user = await requireUser();
  return (await s.credentialsOf(user.id)).map((c) => ({ id: c.id, device: c.device, synced: !!c.synced, created: c.created, lastUsed: c.last_used }));
});
export const myPasskeysQuery = queryOptions({ queryKey: ['session', 'passkeys'], queryFn: () => fetchMyPasskeys() });

/**
 * Removes one of the reader's passkeys; never the last one (they would be locked out). Every session that passkey started
 * ends with it, so removing a lost device's passkey signs that device out. `signedOut` says the request's own session was
 * one of them (the reader removed the passkey they signed in with here).
 */
export const removeMyPasskey = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().min(1).max(1024) }))
  .handler(async ({ data }): Promise<{ signedOut: boolean }> => {
    const [{ requireUser, fail }, s, { AuthError }, { authMethod }, { sessionStillOpen }, { getRequest }] = await Promise.all([
      guard(), store(), import('./errors'), import('./method.server'), import('./session.server'), import('@tanstack/react-start/server'),
    ]);
    const user = await requireUser();
    if (authMethod() !== 'kindred') throw fail(new AuthError('invalid', 'auth.passkeys_off'));
    const outcome = await s.removeCredential(user.id, data.id);
    if (outcome === 'last') throw fail(new AuthError('invalid', 'This is your only passkey. Add another before removing it, or you won’t be able to sign in.'));
    if (outcome === 'already-removed') throw fail(new AuthError('invalid', 'That passkey was already removed.'));
    return { signedOut: !(await sessionStillOpen(getRequest())) };
  });

/** "Sign out everywhere else": ends every session of the reader except this one. Returns how many ended. */
export const signOutElsewhere = createServerFn({ method: 'POST' }).handler(async (): Promise<{ ended: number }> => {
  const [{ requireUser, fail }, { AuthError }, { authMethod }, { endOtherSessionsOf }, { getRequest }] = await Promise.all([
    guard(), import('./errors'), import('./method.server'), import('./session.server'), import('@tanstack/react-start/server'),
  ]);
  const user = await requireUser();
  if (authMethod() !== 'kindred') throw fail(new AuthError('invalid', 'auth.passkeys_off'));
  return { ended: await endOtherSessionsOf(getRequest(), user.id) };
});

export const renameMe = createServerFn({ method: 'POST' })
  .validator(z.object({ name: z.string().max(200) }))
  .handler(async ({ data }) => {
    const [{ requireUser }, s, { cleanName }] = await Promise.all([guard(), store(), import('./passkeys.server')]);
    const user = await requireUser();
    await s.renameUser(user.id, cleanName(data.name));
  });

/** The reader's own language. Saved on the account, so the next visit renders in it before any cookie. */
export const setMyLocale = createServerFn({ method: 'POST' })
  .validator(z.object({ locale: z.enum(LOCALES) }))
  .handler(async ({ data }) => {
    const [{ requireUser }, s] = await Promise.all([guard(), store()]);
    const user = await requireUser();
    await s.setUserLocale(user.id, data.locale);
  });

// ---------- the steward's /access page ----------

export interface AccessMember { id: string; name: string; email: string | null; role: Role; person: string | null; lastSeen: number | null; joined: number; passkeys: number; you: boolean }
export interface AccessInvite { id: string; role: Role; email: string | null; expires: number; created: number; inviter: string | null; status: 'open' | 'expired' | 'used' | 'revoked'; usedBy: string | null; usedAt: number | null }

export const fetchAccess = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }): Promise<{ members: AccessMember[]; invites: AccessInvite[]; waitingLinks: WaitingLink[] }> => {
    const [{ requireCan }, s, { linksWaiting }] = await Promise.all([guard(), store(), import('./links.server')]);
    const { user } = await requireCan(data.tree, 'manage-access');
    const names = new Map<string, string>();
    const members = (await s.membersOf(data.tree)).map((m) => {
      names.set(m.id, m.name);
      return { id: m.id, name: m.name, email: m.email, role: m.role, person: m.person, lastSeen: m.last_seen, joined: m.joined, passkeys: m.passkeys, you: m.id === user.id };
    });
    const nameOf = async (id: string | null) => (id ? names.get(id) ?? (await s.userById(id))?.name ?? null : null);
    const t = Date.now();
    const invites = await Promise.all((await s.invitesOf(data.tree)).map(async (i) => ({
      id: i.id, role: i.role, email: i.email, expires: i.expires, created: i.created, inviter: await nameOf(i.created_by),
      status: i.revoked_at ? 'revoked' as const : i.used_at ? 'used' as const : i.expires <= t ? 'expired' as const : 'open' as const,
      usedBy: await nameOf(i.used_by), usedAt: i.used_at,
    })));
    return { members, invites, waitingLinks: await linksWaiting(data.tree) };
  });
export const accessQuery = (t: string) => queryOptions({ queryKey: ['session', 'access', t], queryFn: () => fetchAccess({ data: { tree: t } }) });

/** A new invitation link. The token is shown once; only its hash is kept. */
export const createInvite = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, role, email: z.string().trim().toLowerCase().email().max(254).optional().or(z.literal('')), days: z.number().int().min(1).max(30).optional() }))
  .handler(async ({ data }) => {
    const [{ requireCan, fail }, s, { family }, { AuthError }] = await Promise.all([guard(), store(), import('./trees.server'), import('./errors')]);
    const { user } = await requireCan(data.tree, 'manage-access');
    if (!(await family(data.tree))) throw fail(new AuthError('invalid', 'No such family.'));
    const { invite, token } = await s.createInvite({ tree: data.tree, role: data.role, email: data.email || null, createdBy: user.id, days: data.days });
    return { id: invite.id, token, expires: invite.expires };
  });

/** A fresh link for a pending invitation (the old link stops working). */
export const renewInvite = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const [{ requireCan, fail }, s, { AuthError }] = await Promise.all([guard(), store(), import('./errors')]);
    await requireCan(data.tree, 'manage-access');
    const i = await s.inviteById(data.id);
    if (!i || i.tree !== data.tree || i.used_at || i.revoked_at) throw fail(new AuthError('invalid', 'That invitation can’t be renewed.'));
    const renewed = await s.renewInvite(i.id);
    return { token: renewed, expires: (await s.inviteById(i.id))!.expires };
  });

export const revokeInvite = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const [{ requireCan }, s] = await Promise.all([guard(), store()]);
    await requireCan(data.tree, 'manage-access');
    await s.revokeInvite(data.id, data.tree);
  });

const lastSteward = 'A family always needs at least one steward. Make someone else a steward first.';

export const setMemberRole = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, user: z.string().uuid(), role }))
  .handler(async ({ data }) => {
    const [{ requireCan, fail }, s, { AuthError }] = await Promise.all([guard(), store(), import('./errors')]);
    await requireCan(data.tree, 'manage-access');
    // The guard after the change keeps a steward however many changes race.
    await s.commit(async () => {
      const m = await s.membership(data.user, data.tree);
      if (!m) throw fail(new AuthError('invalid', 'They are no longer a member.'));
      if (m.role === 'steward' && data.role !== 'steward' && (await s.stewardCount(data.tree)) <= 1) throw fail(new AuthError('invalid', lastSteward));
      return {
        writes: [s.changeRole(data.user, data.tree, data.role), s.keepsASteward(data.tree)],
        result: undefined,
        refused: () => fail(new AuthError('invalid', lastSteward)),
      };
    });
  });

export const removeMember = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, user: z.string().uuid() }))
  .handler(async ({ data }) => {
    const [{ requireCan, fail }, s, { AuthError }] = await Promise.all([guard(), store(), import('./errors')]);
    await requireCan(data.tree, 'manage-access');
    await s.commit(async () => {
      const m = await s.membership(data.user, data.tree);
      if (!m) return { writes: [], result: undefined };
      if (m.role === 'steward' && (await s.stewardCount(data.tree)) <= 1) throw fail(new AuthError('invalid', lastSteward));
      return {
        // Their reminder devices for this family go with the membership (migrations/accounts/0005_push.sql), and so do their
        // assistant chats and the pictures kept in them: inviting them back must not bring back what they could read then.
        writes: [
          s.q('DELETE FROM membership WHERE user = ? AND tree = ?', data.user, data.tree), s.keepsASteward(data.tree), s.q('DELETE FROM push_subscription WHERE user = ? AND tree = ?', data.user, data.tree),
          ...['ai_chat_image', 'ai_chat', 'ai_thread', 'ai_conversation'].map((table) => s.q(`DELETE FROM ${table} WHERE user = ? AND tree = ?`, data.user, data.tree)),
        ],
        result: undefined,
        refused: () => fail(new AuthError('invalid', lastSteward)),
      };
    });
    // What they kept for themselves goes with them: nobody else could ever read or remove it. After the commit, and on every
    // call, so a failure here can be finished by removing them again.
    await (await import('../db.server')).db(data.tree).run("DELETE FROM person_field WHERE visibility = 'personal' AND owner = ? AND (created_by = ? OR created_by IS NULL)", data.user, data.user);
  });
