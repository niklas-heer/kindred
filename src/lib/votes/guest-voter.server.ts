// A guest who votes is told apart by the `kindred_voter` cookie, which the server makes the first time they cast a ballot and
// never before. Only a hash of it and the family is stored (as the guest's key), so one browser is a different key in each
// family and two families' databases cannot be joined on a guest. The address is never kept: the limits count 18 bits of an
// HMAC of the vote and the network under the server's secret, so the value differs from vote to vote, and a copy of the
// database, which lacks the secret, cannot try every address against it to find a guest's. The key comes only from this
// cookie, so nothing here accepts one from the client.
import { cookie, tokenIn } from '../auth/join.server.ts';
import { serverHmac } from '../auth/seal.server.ts';
import { networkOf } from '../auth/join-rules.ts';
import { clientIP } from '../auth/throttle.server.ts';
import { hashToken, randomToken } from '../auth/tokens.server.ts';

const COOKIE = 'kindred_voter';
const DAY_SECONDS = 86_400;
const MAX_AGE_DAYS = 90;

/** The key for a voter cookie's token in one family: `g:` and the hash of both. */
const keyOf = async (token: string, tree: string) => `g:${await hashToken('visitor', `vote:${tree}:${token}`)}`;

/** This guest's key in the family `tree`, from the cookie they were given when they first voted, or undefined. */
export async function guestVoterKey(request: Request, tree: string): Promise<string | undefined> {
  const token = tokenIn(request, COOKIE);
  return token ? await keyOf(token, tree) : undefined;
}

/**
 * The guest's key in the family `tree`, and the Set-Cookie to send: the cookie they hold, or a fresh one. It lasts 90 days,
 * and never longer than the share link (`expires`, ms since the epoch).
 */
export async function voterCookie(request: Request, tree: string, expires: number | null, now = Date.now()): Promise<{ key: string; setCookie: string }> {
  const token = tokenIn(request, COOKIE) ?? randomToken(32);
  const seconds = Math.min(MAX_AGE_DAYS * DAY_SECONDS, expires === null ? Infinity : Math.floor((expires - now) / 1000));
  return { key: await keyOf(token, tree), setCookie: cookie(request, COOKIE, token, Math.max(0, seconds)) };
}

/**
 * 18 bits of an HMAC, under the server's secret, of the vote and an address's network (an IPv6 /64, or the IPv4 address):
 * each value stands for thousands of addresses, the same network is another value in another vote, and without the secret
 * no address can be tested against it.
 */
export async function netOfAddress(ip: string, vote: string): Promise<number> {
  const mac = await serverHmac('vote-net', new TextEncoder().encode(`${vote}:${networkOf(ip)}`));
  return (mac[0]! << 10) | (mac[1]! << 2) | (mac[2]! >> 6);
}

/** The network of this request's client in the vote `vote`, as a number from 0 to 262143. */
export const netOf = (request: Request, vote: string) => netOfAddress(clientIP(request), vote);
