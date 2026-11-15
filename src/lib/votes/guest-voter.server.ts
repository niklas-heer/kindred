// A guest who votes is told apart by the `kindred_voter` cookie, which the server makes the first time they cast a ballot and
// never before. Only its hash is stored (as the guest's key), and the address is never kept: the limits count an 18-bit hash of
// the network, as join requests do. The key comes only from this cookie, so nothing here accepts one from the client.
import { cookie, tokenIn } from '../auth/join.server.ts';
import { networkOf } from '../auth/join-rules.ts';
import { clientIP } from '../auth/throttle.server.ts';
import { hashToken, randomToken } from '../auth/tokens.server.ts';

const COOKIE = 'kindred_voter';
const DAY_SECONDS = 86_400;
const MAX_AGE_DAYS = 90;

/** The key for a voter cookie's token: `g:` and its hash. */
const keyOf = async (token: string) => `g:${await hashToken('visitor', `vote:${token}`)}`;

/** This guest's key, from the cookie they were given when they first voted, or undefined. */
export async function guestVoterKey(request: Request): Promise<string | undefined> {
  const token = tokenIn(request, COOKIE);
  return token ? await keyOf(token) : undefined;
}

/**
 * The guest's key, and the Set-Cookie to send: the cookie they hold, or a fresh one. It lasts 90 days, and never longer than
 * the share link (`expires`, ms since the epoch).
 */
export async function voterCookie(request: Request, expires: number | null, now = Date.now()): Promise<{ key: string; setCookie: string }> {
  const token = tokenIn(request, COOKIE) ?? randomToken(32);
  const seconds = Math.min(MAX_AGE_DAYS * DAY_SECONDS, expires === null ? Infinity : Math.floor((expires - now) / 1000));
  return { key: await keyOf(token), setCookie: cookie(request, COOKIE, token, Math.max(0, seconds)) };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** 18 bits of a hash of an address's network (an IPv6 /64, or the IPv4 address): each value stands for thousands of addresses. */
export async function netOfAddress(ip: string): Promise<number> {
  return [...(await hashToken('share-ip', `vote:${networkOf(ip)}`)).slice(0, 3)].reduce((n, c) => n * 64 + B64.indexOf(c), 0);
}

/** The network of this request's client, as a number from 0 to 262143. */
export const netOf = (request: Request) => netOfAddress(clientIP(request));
