// Who is asking, by the installation's one sign-in method (method.server.ts): a session cookie from a passkey sign-in, or a
// verified Cloudflare Access identity. Never both. The cookie holds a random token; the store keeps only its hash.
import { setupCodeRequired } from './setup.server.ts';
import { families, makeFirstFamily } from './trees.server.ts';
import { accessEmail, authMethod } from './method.server.ts';
import { resolveMethods } from './methods.server.ts';
import type { SignInMethod } from './methods.ts';
import { isLocale, negotiateLocale, translate, type Locale } from '../i18n/dictionary.ts';
import {
  commit, createSession, deleteSession, endOtherSessions, newUser, noUsersYet, now, pendingInvitesFor, sessionByToken, sessionMethod, sessionWithUser, slideSession, touchUser, upsertMembership, useInvite,
  userByEmail, userCount, type MembershipRow, type SessionRow, type UserRow,
} from './store.server.ts';
import { endGuestVisit, guestVisitByToken, type GuestSession } from './share.server.ts';
import { endViewAs } from './view-as.server.ts';
import { store, NOT_TREES, type Query } from '../store/index.ts';
import { DEMO_USER_ID, isDemo } from '../demo.ts';

import { onGuestHost, publicOrigin, siteOrigin } from './origin.ts';
export { siteOrigin };

const secure = (request: Request) => siteOrigin(request).protocol === 'https:';
// `__Host-` makes the browser refuse the cookie unless it is Secure, host-only and for the whole site.
const cookieName = (request: Request) => (secure(request) ? '__Host-kindred_session' : 'kindred_session');

export function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

const sessionToken = (request: Request) => {
  const t = readCookie(request, cookieName(request));
  return t && /^[A-Za-z0-9_-]{43}$/.test(t) ? t : undefined;
};

function cookie(request: Request, value: string, maxAgeSeconds: number) {
  return [`${cookieName(request)}=${value}`, 'Path=/', `Max-Age=${maxAgeSeconds}`, 'HttpOnly', 'SameSite=Lax', ...(secure(request) ? ['Secure'] : [])].join('; ');
}

/**
 * Signs `user` in: always a brand-new session (so a session planted before sign-in is worthless),
 * and the old one, if any, is ended. `credential` is the passkey used, so removing it later signs this session out.
 * `method` is the way in (methods.ts): turning that way off later ends this session; `provider` is the single sign-on provider
 * that started it (oidc.server.ts), whose switching off ends it too. Returns the Set-Cookie value.
 */
export async function startSession(request: Request, user: string, credential: string | null = null, proved = false, method: SignInMethod = 'passkey', provider: string | null = null): Promise<string> {
  const old = sessionToken(request);
  if (old) await deleteSession(old);
  const { token, expires } = await createSession(user, credential, proved, method, provider);
  return cookie(request, token, Math.floor((expires - now()) / 1000));
}

/** Ends every other session of `user`, keeping the request's own. Returns how many ended. */
export async function endOtherSessionsOf(request: Request, user: string): Promise<number> {
  const keep = sessionToken(request);
  // Without a cookie of its own the request is not a passkey session (Access has none to end), so nothing is ended.
  return keep ? endOtherSessions(user, keep) : 0;
}

/** The request's own live session, if its cookie names one. */
export async function sessionOf(request: Request): Promise<SessionRow | undefined> {
  const t = sessionToken(request);
  return t ? sessionByToken(t) : undefined;
}

/** Whether the request's session cookie still names a live session, such as after removing the passkey that started it. */
export async function sessionStillOpen(request: Request): Promise<boolean> {
  const t = sessionToken(request);
  return !!t && !!(await sessionByToken(t));
}

/** Ends the request's session; returns the Set-Cookie value that clears it. */
export async function endSession(request: Request): Promise<string> {
  const t = sessionToken(request);
  if (t) await deleteSession(t);
  return cookie(request, '', 0);
}

// ---------- a guest's visit (a family share link) ----------

const GUEST_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const guestSecure = (request: Request) => publicOrigin(request).protocol === 'https:';
const guestCookieName = (request: Request) => (guestSecure(request) ? '__Host-kindred_guest' : 'kindred_guest');
/** Set once someone has visited as a guest: a visit that ended goes to its own page instead of the passkey sign-in. Holds nothing. */
const WAS_GUEST = 'kindred_was_guest';

function guestCookie(request: Request, name: string, value: string, maxAgeSeconds: number) {
  return [`${name}=${value}`, 'Path=/', `Max-Age=${maxAgeSeconds}`, 'HttpOnly', 'SameSite=Lax', ...(guestSecure(request) ? ['Secure'] : [])].join('; ');
}

/** The Set-Cookie values that start a guest's visit. */
export function guestCookies(request: Request, token: string, expires: number): string[] {
  return [
    guestCookie(request, guestCookieName(request), token, Math.max(1, Math.floor((expires - now()) / 1000))),
    guestCookie(request, WAS_GUEST, '1', 30 * 86_400),
  ];
}

/** The token of this browser's guest visit (the share session's cookie), if it holds one. */
export const guestToken = (request: Request) => {
  const t = readCookie(request, guestCookieName(request));
  return t && GUEST_TOKEN.test(t) ? t : undefined;
};

/** Ends the request's guest visit; returns the Set-Cookie value that clears it. */
export async function endGuestSession(request: Request): Promise<string> {
  const t = guestToken(request);
  if (t) await endGuestVisit(t);
  return guestCookie(request, guestCookieName(request), '', 0);
}

/** Sign-out: ends the account's session, any "View as" preview and any guest visit in this browser, and forgets that it was
 *  ever a guest's. Returns every Set-Cookie value to send. */
export async function endAllSessions(request: Request): Promise<string[]> {
  return [await endViewAs(request), await endSession(request), await endGuestSession(request), guestCookie(request, WAS_GUEST, '', 0)];
}

async function guestOf(request: Request): Promise<GuestSession | undefined> {
  const t = guestToken(request);
  return t ? guestVisitByToken(t) : undefined;
}

/** Whether someone with no session should get "your visit has ended" rather than the passkey sign-in. */
export const guestEnded = (request: Request) => onGuestHost(request) || readCookie(request, WAS_GUEST) === '1';

export interface Session {
  /** A guest's visit through a family share link. Never an account: the guard lets it reach only the reads that allow guests. */
  guest?: GuestSession;
  user: UserRow | null;
  /**
   * How they are signed in. `passkey`: Kindred's own session, whichever way in started it (`method` says which); `access`:
   * Cloudflare Access; `demo`: nobody is, this is a demo's visitor (src/lib/demo.ts).
   */
  via: 'passkey' | 'access' | 'demo' | null;
  /** Kindred's own sign-in: the way in that started this session (a passkey or a password). */
  method?: SignInMethod;
  /** A verified Cloudflare Access email that has no account and no invitation. */
  uninvitedEmail?: string;
  /** A refreshed session cookie to send back (sliding expiry). */
  setCookie?: string;
  /** The account's memberships, when they were read with the session (one round trip); the guard reads them otherwise. */
  memberships?: MembershipRow[];
  /** Kindred's own sign-in: the hash of the session's token, which a "View as" preview belongs to (view-as.server.ts). */
  sessionHash?: string;
  /**
   * A steward's "View as" preview, as the guard resolved it (guard.server.ts). `memberships` and `guest` are then the
   * previewed reader's for that family, and `realMemberships` the steward's own, for what stays theirs.
   */
  viewAs?: import('./view-as.server.ts').ViewAs;
  realMemberships?: MembershipRow[];
}

/** The reader's language before they have an account: the guest cookie the app sets, else the browser's preference. */
export function guestLocale(request: Request): Locale {
  return guestChoice(request) ?? negotiateLocale(request.headers.get('accept-language') ?? '');
}

/** The language a guest picked in this browser, or null when they never picked one (then the browser's preference applies). */
export function guestChoice(request: Request): Locale | null {
  const chosen = readCookie(request, 'kindred_locale_guest');
  return isLocale(chosen) ? chosen : null;
}

const nameFromEmail = (email: string) =>
  email.split('@')[0].split(/[._-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ').slice(0, 80) || email;

/**
 * Resolves who is making `request`. Never throws for a stranger: `user` is then null.
 * `verifiedEmail` is the Cloudflare Access check; tests pass their own.
 *
 * The guest host (guest-host.ts) is open to the internet and has no Access in front of it, so it honours only a guest's visit:
 * never an account's session cookie, and never an Access identity. A guest's visit has its own token, so it works under either
 * method. While the sign-in setting is refused (method.server.ts), nobody is an account: not by cookie, not by token.
 */
export async function getSession(request: Request, verifiedEmail: (r: Request) => Promise<string | undefined> = accessEmail, listFamilies: () => Promise<{ id: string }[]> = families): Promise<Session> {
  // A demo has no accounts and no share links: every visitor is the same viewer of every family, whatever the request carries.
  if (isDemo()) return await demoSession();
  const guest = await guestOf(request);
  const method = authMethod();
  if (onGuestHost(request) || !method) return { user: null, via: null, guest };
  return { ...(await (method === 'kindred' ? passkeySession(request) : accessSession(request, verifiedEmail, listFamilies))), guest };
}

/**
 * A demo's visitor: an account that exists nowhere (no row, no session, no cookie), a viewer of every family on the server. The
 * guard treats them as a member, so the pages a viewer reads work; every write is refused by the store (src/lib/store/index.ts).
 */
export async function demoSession(): Promise<Session> {
  const user: UserRow = { id: DEMO_USER_ID, name: 'Demo visitor', email: null, handle: DEMO_USER_ID, created: 0, last_seen: now(), locale: null };
  const memberships: MembershipRow[] = (await store.treeIds()).filter((tree) => !NOT_TREES.has(tree)).map((tree) => ({ user: user.id, tree, role: 'viewer', person: null, person_confirmed: 0, created: 0 }));
  return { user, via: 'demo', memberships };
}

/** `kindred`: the session cookie, and nothing else. An Access token on the request is not looked at. Any way in (a passkey, a password) ends in this cookie. */
async function passkeySession(request: Request): Promise<Session> {
  const token = sessionToken(request);
  if (token) {
    const found = await sessionWithUser(token);
    // A session of a way in that is off now is no session (turning it off in the console also deleted it; KINDRED_AUTH_METHODS
    // does not delete, so this is what ends those).
    if (found && resolveMethods(found.methodsSetting).methods.includes(sessionMethod(found.session))) {
      const { session: row, user, memberships } = found;
      await touchUser(user.id, user.last_seen);
      const slid = await slideSession(row);
      return {
        user, via: 'passkey', method: sessionMethod(row), memberships, sessionHash: row.hash,
        setCookie: slid ? cookie(request, token, Math.floor((slid - now()) / 1000)) : undefined,
      };
    }
  }
  return { user: null, via: null };
}

/** `cloudflare-access`: the verified token, and nothing else. A session cookie left from earlier is not looked at. */
async function accessSession(request: Request, verifiedEmail: (r: Request) => Promise<string | undefined>, listFamilies: () => Promise<{ id: string }[]>): Promise<Session> {
  const email = await verifiedEmail(request);
  if (!email) return { user: null, via: null };
  // A verified Access identity: the account with that email, or an invitation sent to that email,
  // accepted on this first visit. Further invitations to the same email are accepted as they come.
  // The first account (no setup code) is the steward of the server's families. A server with none
  // makes its first one here, exactly as passkey setup does (makeFirstFamily), so that account has a family.
  const firstAccount = (await userCount()) === 0 && !setupCodeRequired();
  let trees: { id: string }[] = firstAccount ? await listFamilies() : [];
  if (firstAccount && !trees.length) {
    try {
      trees = [{ id: await makeFirstFamily(translate(guestLocale(request), 'setup.family_default')) }];
    } catch (e) {
      // Nothing is signed in and no account is made: the reader gets /setup, which names the same problem when they try it.
      console.error('[kindred] no first family for this Access sign-in:', e instanceof Error ? e.message : e);
      return { user: null, via: null, uninvitedEmail: email };
    }
  }
  // One batch per decision. The first account is guarded by "nobody has an account yet", a new
  // account by the email's UNIQUE key, and each invitation by its own use; when another request got
  // there first, the batch writes nothing and the decision is made again on fresh reads.
  const user = await commit(async () => {
    let u = await userByEmail(email);
    // An account the retention job is retiring is going: no way in, and no new account for its address until it is gone.
    if (u?.retiring) return { writes: [], result: undefined };
    const pending = await pendingInvitesFor(email);
    const writes: Query[] = [];
    if (!u && (await userCount()) === 0 && !setupCodeRequired()) {
      const made = newUser(nameFromEmail(email), email, undefined, null, true);
      u = made.user;
      writes.push(noUsersYet(), made.insert, ...trees.map((tree) => upsertMembership(made.user.id, tree.id, 'steward')));
    }
    if (!u && !pending.length) return { writes: [], result: undefined };
    if (!u) {
      const made = newUser(nameFromEmail(email), email, undefined, null, true);
      u = made.user;
      writes.push(made.insert);
    }
    for (const inv of pending) writes.push(...useInvite(inv, u.id));
    return { writes, result: u };
  });
  if (!user) return { user: null, via: null, uninvitedEmail: email };
  // On Cloudflare: an account exists, so where the Durable Objects are kept is recorded (once per isolate; src/lib/store/cf.ts).
  await store.markPlace?.();
  // Access verified this address: an account made from an invitation's typed address is verified now (accounts migration 0050).
  if (!user.email_verified) await store.accounts().run('UPDATE user SET email_verified = 1 WHERE id = ? AND email = ?', user.id, email);
  await touchUser(user.id, user.last_seen);
  return { user, via: 'access' };
}

