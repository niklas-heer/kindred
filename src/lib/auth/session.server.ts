// Who is asking: a session cookie from a passkey sign-in, or else (behind Cloudflare Access) a
// verified Access identity. The cookie holds a random token; the store keeps only its hash.
import { setupCodeRequired } from './setup.server.ts';
import { families, makeFirstFamily } from './trees.server.ts';
import { accessEmail } from './access.server.ts';
import { isLocale, negotiateLocale, translate, type Locale } from '../i18n/dictionary.ts';
import {
  commit, createSession, deleteSession, newUser, noUsersYet, now, pendingInvitesFor, sessionByToken, slideSession, touchUser, upsertMembership, useInvite,
  userByEmail, userById, userCount, type UserRow,
} from './store.server.ts';
import type { Query } from '../store/index.ts';

import { siteOrigin } from './origin.ts';
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
 * and the old one, if any, is ended. Returns the Set-Cookie value.
 */
export async function startSession(request: Request, user: string): Promise<string> {
  const old = sessionToken(request);
  if (old) await deleteSession(old);
  const { token, expires } = await createSession(user);
  return cookie(request, token, Math.floor((expires - now()) / 1000));
}

/** Ends the request's session; returns the Set-Cookie value that clears it. */
export async function endSession(request: Request): Promise<string> {
  const t = sessionToken(request);
  if (t) await deleteSession(t);
  return cookie(request, '', 0);
}

export interface Session {
  user: UserRow | null;
  /** How they are signed in. */
  via: 'passkey' | 'access' | null;
  /** A verified Cloudflare Access email that has no account and no invitation. */
  uninvitedEmail?: string;
  /** A refreshed session cookie to send back (sliding expiry). */
  setCookie?: string;
}

/** The reader's language before they have an account: the guest cookie the app sets, else the browser's preference. */
function guestLocale(request: Request): Locale {
  const chosen = readCookie(request, 'kindred_locale_guest');
  return isLocale(chosen) ? chosen : negotiateLocale(request.headers.get('accept-language') ?? '');
}

const nameFromEmail = (email: string) =>
  email.split('@')[0].split(/[._-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ').slice(0, 80) || email;

/**
 * Resolves who is making `request`. Never throws for a stranger: `user` is then null.
 * `verifiedEmail` is the Cloudflare Access check; tests pass their own.
 */
export async function getSession(request: Request, verifiedEmail: (r: Request) => Promise<string | undefined> = accessEmail, listFamilies: () => Promise<{ id: string }[]> = families): Promise<Session> {
  const token = sessionToken(request);
  if (token) {
    const row = await sessionByToken(token);
    const user = row && (await userById(row.user));
    if (row && user) {
      await touchUser(user.id, user.last_seen);
      const slid = await slideSession(row);
      return { user, via: 'passkey', setCookie: slid ? cookie(request, token, Math.floor((slid - now()) / 1000)) : undefined };
    }
  }

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
      // Nothing is signed in and no account is made: the reader gets /setup, whose passkey step names the same problem.
      console.error('[kindred] no first family for this Access sign-in:', e instanceof Error ? e.message : e);
      return { user: null, via: null };
    }
  }
  // One batch per decision. The first account is guarded by "nobody has an account yet", a new
  // account by the email's UNIQUE key, and each invitation by its own use; when another request got
  // there first, the batch writes nothing and the decision is made again on fresh reads.
  const user = await commit(async () => {
    let u = await userByEmail(email);
    const pending = await pendingInvitesFor(email);
    const writes: Query[] = [];
    if (!u && (await userCount()) === 0 && !setupCodeRequired()) {
      const made = newUser(nameFromEmail(email), email);
      u = made.user;
      writes.push(noUsersYet(), made.insert, ...trees.map((tree) => upsertMembership(made.user.id, tree.id, 'steward')));
    }
    if (!u && !pending.length) return { writes: [], result: undefined };
    if (!u) {
      const made = newUser(nameFromEmail(email), email);
      u = made.user;
      writes.push(made.insert);
    }
    for (const inv of pending) writes.push(...useInvite(inv, u.id));
    return { writes, result: u };
  });
  if (!user) return { user: null, via: null, uninvitedEmail: email };
  await touchUser(user.id, user.last_seen);
  return { user, via: 'access' };
}

