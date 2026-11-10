// "View as": a steward previews one family as someone else (docs/roles-and-privacy.md, "View as"). Three kinds of reader:
//   role    a member with that role (viewer, contributor or editor) and no person in the tree;
//   member  one of the family's accounts: their role, the person they are linked to, and so everything keyed to that person;
//   guest   a guest of the family's share link, with that link's settings, or a plain guest with living people protected.
//
// The preview lives behind a random token in its own HttpOnly cookie (only the hash is stored, migrations/accounts/0028), so it
// works under both sign-in methods: a passkey session has a row to belong to, a Cloudflare Access sign-in has none. It belongs
// to the steward's account and, under Kindred's own sign-in, to the session that started it.
//
// The guard (guard.server.ts) resolves it with the session, once per request, and from then on:
//   - the previewed reader replaces the steward for that family in every check (`requireMember`, `requireReader`, `requireCan`
//     and the memberships the browser is told about), reads included;
//   - the request writes nothing anywhere (src/lib/read-only.ts asks the guard), so the store, `once`, the media store and the AI
//     adapters refuse with this module's sentence;
//   - personal state keyed to an account is never the member's: the previewed reader's account id is VIEW_AS_USER_ID, which no
//     row has, so what is "mine" (quiz answers, reactions, unread marks, assistant chats, private notes) is a new reader's: none.
// The account itself (passkeys, sessions, the account page, the families page, sign-in) stays the steward's own.
import type { Role } from '../roles';
import { translate } from '../i18n/dictionary.ts';
import { AuthError } from './errors.ts';
import { siteOrigin } from './origin.ts';
import { linkOpen, shareLinkOf } from './share.server.ts';
import { accounts, now, q, type MembershipRow, type UserRow } from './store.server.ts';
import { hashToken, randomToken } from './tokens.server.ts';

/** A preview not used for this long ends by itself. */
export const VIEW_AS_IDLE_MS = 3_600_000;
/** And none lasts longer than this, however much it is used. */
export const VIEW_AS_MAX_MS = 24 * 3_600_000;
/** Using a preview within this long of the last use writes nothing. */
const TOUCH_MS = 60_000;

/**
 * The previewed reader's account id while a steward views a family as a member or a role. No account has it (account ids are
 * UUIDs), so nothing keyed to an account matches it: the steward sees what a new reader with that role and person sees, never
 * the member's own quiz answers, reactions, unread marks, assistant chats or private notes.
 */
export const VIEW_AS_USER_ID = 'view-as';

export type ViewAsKind = 'role' | 'member' | 'guest';
export const PREVIEW_ROLES = ['viewer', 'contributor', 'editor'] as const satisfies readonly Role[];
export type PreviewRole = (typeof PREVIEW_ROLES)[number];

/** What a steward asks to see. A guest is the family's share link when it has an open one, else a plain guest. */
export type ViewAsChoice = { kind: 'role'; role: PreviewRole } | { kind: 'member'; member: string } | { kind: 'guest' };

export interface ViewAsRow {
  hash: string; user: string; session: string | null; tree: string; kind: ViewAsKind; role: PreviewRole | null; member: string | null; link: string | null;
  created: number; last_used: number;
}

/** The previewed reader, as one request resolved it. */
export interface ViewAs {
  tree: string;
  kind: ViewAsKind;
  /** The role every check uses: a guest's is a viewer's. */
  role: Role;
  /** Who the reader is in the tree: the member's linked person, or none. */
  person: string | null;
  personConfirmed: boolean;
  /** Kind `member`: the account previewed, by its id and name. */
  member?: { id: string; name: string };
  /** Kind `guest`: the share link (null for a plain guest) and its settings as they are now. */
  guest?: { link: string | null; protectLiving: boolean; askToJoin: boolean };
  /** When the preview ends by itself unless it is used again. */
  expires: number;
}

/** The sentence a refused change gets during a preview, in English (the browser translates it, translateMessage). */
export function viewAsRefused(v: Pick<ViewAs, 'kind' | 'role' | 'member'>): AuthError {
  const message = v.kind === 'member' ? translate('en', 'viewas.err_member', { name: v.member?.name ?? '' })
    : v.kind === 'guest' ? translate('en', 'viewas.err_guest')
    : translate('en', v.role === 'editor' ? 'viewas.err_editor' : v.role === 'contributor' ? 'viewas.err_contributor' : 'viewas.err_viewer');
  return new AuthError('forbidden', message);
}


// ---------- the cookie ----------

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const secure = (request: Request) => siteOrigin(request).protocol === 'https:';
const cookieName = (request: Request) => (secure(request) ? '__Host-kindred_view_as' : 'kindred_view_as');

function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

/** The token of this browser's preview, if it holds one. */
export function viewAsToken(request: Request): string | undefined {
  const t = readCookie(request, cookieName(request));
  return t && TOKEN.test(t) ? t : undefined;
}

const cookie = (request: Request, value: string, maxAgeSeconds: number) =>
  [`${cookieName(request)}=${value}`, 'Path=/', `Max-Age=${maxAgeSeconds}`, 'HttpOnly', 'SameSite=Lax', ...(secure(request) ? ['Secure'] : [])].join('; ');

/** The Set-Cookie value that forgets the preview in this browser. */
export const clearViewAsCookie = (request: Request) => cookie(request, '', 0);

// ---------- starting and stopping ----------

/** Why a preview cannot start, as a dictionary key the browser shows. */
export const refuseStart = (key: 'viewas.err_not_steward' | 'viewas.err_no_member' | 'viewas.err_self' | 'viewas.err_demo') => new AuthError(key === 'viewas.err_not_steward' ? 'forbidden' : 'invalid', key);

/**
 * Starts a preview for a steward (whom the caller has checked against their real session) and returns the Set-Cookie value.
 * A preview this browser already had is replaced. `session` is the passkey session's hash, or null behind Cloudflare Access.
 */
export async function startViewAs(request: Request, steward: { user: string; session: string | null }, tree: string, choice: ViewAsChoice): Promise<string> {
  let row: Pick<ViewAsRow, 'kind' | 'role' | 'member' | 'link'>;
  if (choice.kind === 'role') row = { kind: 'role', role: choice.role, member: null, link: null };
  else if (choice.kind === 'member') {
    if (choice.member === steward.user) throw refuseStart('viewas.err_self');
    const m = await accounts().get<{ user: string }>('SELECT user FROM membership WHERE user = ? AND tree = ?', choice.member, tree);
    if (!m) throw refuseStart('viewas.err_no_member');
    row = { kind: 'member', role: null, member: choice.member, link: null };
  } else {
    const link = await shareLinkOf(tree);
    row = { kind: 'guest', role: null, member: null, link: link && linkOpen(link) ? link.id : null };
  }
  const token = randomToken(32);
  const t = now();
  const old = viewAsToken(request);
  await accounts().batch([
    q('DELETE FROM view_as WHERE last_used <= ? OR created <= ?', t - VIEW_AS_IDLE_MS, t - VIEW_AS_MAX_MS),
    ...(old ? [q('DELETE FROM view_as WHERE hash = ?', await hashToken('view-as', old))] : []),
    q('INSERT INTO view_as (hash, user, session, tree, kind, role, member, link, created, last_used) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      await hashToken('view-as', token), steward.user, steward.session, tree, row.kind, row.role, row.member, row.link, t, t),
  ]);
  return cookie(request, token, Math.floor(VIEW_AS_MAX_MS / 1000));
}

/** Ends this browser's preview, if it has one. Returns the Set-Cookie value that forgets it. */
export async function endViewAs(request: Request): Promise<string> {
  const t = viewAsToken(request);
  if (t) await accounts().run('DELETE FROM view_as WHERE hash = ?', await hashToken('view-as', t));
  return clearViewAsCookie(request);
}

// ---------- resolving ----------

/** The account a request is signed in as, as the session resolved it; `session` is its passkey session's hash, if any. */
export interface Signed { user: UserRow; via: 'passkey' | 'access'; session: string | null; memberships: MembershipRow[] }

/**
 * This browser's preview, if it still holds: the steward is still signed in with the session that started it and still a
 * steward of that family (by their real memberships), the member is still in it, the link still open, and it has been used
 * within the hour. A preview that no longer holds is deleted, and `clear` says to forget the cookie. A live one is marked
 * used (at most once a minute): that is the preview's own row, not anything a reader's visit writes.
 */
export async function resolveViewAs(request: Request, signed: Signed): Promise<{ viewAs?: ViewAs; clear?: string }> {
  const token = viewAsToken(request);
  if (!token) return {};
  const hash = await hashToken('view-as', token);
  const row = await accounts().get<ViewAsRow>('SELECT * FROM view_as WHERE hash = ?', hash);
  const t = now();
  const end = async () => {
    if (row) await accounts().run('DELETE FROM view_as WHERE hash = ?', hash);
    return { clear: clearViewAsCookie(request) };
  };
  if (!row || row.user !== signed.user.id) return end();
  // Under Kindred's own sign-in the preview is the session's: another session of the same account does not inherit it.
  if (signed.via === 'passkey' ? row.session !== signed.session : row.session !== null) return end();
  if (t - row.last_used > VIEW_AS_IDLE_MS || t - row.created > VIEW_AS_MAX_MS) return end();
  if (signed.memberships.find((m) => m.tree === row.tree)?.role !== 'steward') return end();

  let viewAs: ViewAs;
  const expires = Math.min(t + VIEW_AS_IDLE_MS, row.created + VIEW_AS_MAX_MS);
  if (row.kind === 'role') {
    if (!row.role || !(PREVIEW_ROLES as readonly string[]).includes(row.role)) return end();
    viewAs = { tree: row.tree, kind: 'role', role: row.role, person: null, personConfirmed: false, expires };
  } else if (row.kind === 'member') {
    const m = row.member
      ? await accounts().get<{ role: Role; person: string | null; person_confirmed: number; name: string }>(
        'SELECT m.role AS role, m.person AS person, m.person_confirmed AS person_confirmed, u.name AS name FROM membership m JOIN user u ON u.id = m.user WHERE m.user = ? AND m.tree = ?',
        row.member, row.tree,
      )
      : undefined;
    // A member who left (or was removed) ends the previews of them.
    if (!m) return end();
    viewAs = { tree: row.tree, kind: 'member', role: m.role, person: m.person, personConfirmed: !!m.person_confirmed, member: { id: row.member!, name: m.name }, expires };
  } else {
    let guest: NonNullable<ViewAs['guest']> = { link: null, protectLiving: true, askToJoin: false };
    if (row.link) {
      const link = await shareLinkOf(row.tree);
      // A link turned off, replaced by another family's or run out ends the previews of it.
      if (!link || link.id !== row.link || !linkOpen(link)) return end();
      guest = { link: link.id, protectLiving: link.protect_living === 1, askToJoin: link.ask_to_join === 1 };
    }
    viewAs = { tree: row.tree, kind: 'guest', role: 'viewer', person: null, personConfirmed: false, guest, expires };
  }
  if (t - row.last_used >= TOUCH_MS) await accounts().run('UPDATE view_as SET last_used = ? WHERE hash = ?', t, hash);
  return { viewAs };
}

/** The account the previewed reader is, for a member's or a role's preview: it matches no row anywhere. */
export function viewAsUser(v: ViewAs, steward: UserRow): UserRow {
  return { id: VIEW_AS_USER_ID, name: v.member?.name ?? steward.name, email: null, handle: VIEW_AS_USER_ID, created: 0, last_seen: null, locale: steward.locale };
}

/** The memberships every check uses during a preview: the family's own is the previewed reader's, or gone for a guest. */
export function previewMemberships(real: MembershipRow[], v: ViewAs): MembershipRow[] {
  return real.flatMap((m) => (m.tree !== v.tree ? [m] : v.kind === 'guest' ? [] : [{ ...m, user: VIEW_AS_USER_ID, role: v.role, person: v.person, person_confirmed: v.personConfirmed ? 1 : 0 }]));
}
