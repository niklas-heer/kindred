// Who is asking: a session cookie from a passkey sign-in, or else (behind Cloudflare Access) a
// verified Access identity. The cookie holds a random token; the store keeps only its hash.
import { accessEmail } from './access.server';
import {
  createSession, createUser, deleteSession, now, pendingInvitesFor, sessionByToken, slideSession, touchUser, tx, useInvite,
  userByEmail, userById, type UserRow,
} from './store.server';

/** The site's own origin: KINDRED_ORIGIN when set (behind a proxy), else the request's. */
export function siteOrigin(request: Request): URL {
  const configured = process.env.KINDRED_ORIGIN?.trim();
  return new URL(configured ? new URL(configured).origin : new URL(request.url).origin);
}

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
export function startSession(request: Request, user: string): string {
  const old = sessionToken(request);
  if (old) deleteSession(old);
  const { token, expires } = createSession(user);
  return cookie(request, token, Math.floor((expires - now()) / 1000));
}

/** Ends the request's session; returns the Set-Cookie value that clears it. */
export function endSession(request: Request): string {
  const t = sessionToken(request);
  if (t) deleteSession(t);
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

const nameFromEmail = (email: string) =>
  email.split('@')[0].split(/[._-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ').slice(0, 80) || email;

/**
 * Resolves who is making `request`. Never throws for a stranger: `user` is then null.
 * `verifiedEmail` is the Cloudflare Access check; tests pass their own.
 */
export async function getSession(request: Request, verifiedEmail: (r: Request) => Promise<string | undefined> = accessEmail): Promise<Session> {
  const token = sessionToken(request);
  if (token) {
    const row = sessionByToken(token);
    const user = row && userById(row.user);
    if (row && user) {
      touchUser(user.id, user.last_seen);
      const slid = slideSession(row);
      return { user, via: 'passkey', setCookie: slid ? cookie(request, token, Math.floor((slid - now()) / 1000)) : undefined };
    }
  }

  const email = await verifiedEmail(request);
  if (!email) return { user: null, via: null };
  // A verified Access identity: the account with that email, or an invitation sent to that email,
  // accepted on this first visit. Further invitations to the same email are accepted as they come.
  const user = tx((d) => {
    let u = userByEmail(email);
    const pending = pendingInvitesFor(email);
    if (!u && !pending.length) return undefined;
    if (!u) u = createUser(d, nameFromEmail(email), email);
    for (const inv of pending) {
      useInvite(d, inv, u.id);
    }
    return u;
  });
  if (!user) return { user: null, via: null, uninvitedEmail: email };
  touchUser(user.id, user.last_seen);
  return { user, via: 'access' };
}

