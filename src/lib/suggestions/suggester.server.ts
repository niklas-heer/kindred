// Who is suggesting in this request, for the server functions (suggestions.functions.ts) and the upload route
// (src/routes/api/suggestion-upload.$tree.$id.ts): a member, through `requireMember` (suggest.server.ts checks the `suggest`
// role), or a share-link guest, through `requireReader`, known by their `kindred_voter` cookie (votes/guest-voter.server.ts).
// A guest's key comes only from that cookie, never from the client. A new guest is given one only when `newCookie` asks
// (making a suggestion), and the caller sends it only once the write was taken, so a refused suggestion leaves the browser
// as it was.
import { signedOut } from '../auth/errors.ts';
import { currentSession, fail, requireMember, requireReader } from '../auth/guard.server.ts';
import { guestVoterKey, netOf, voterCookie } from '../votes/guest-voter.server.ts';
import { guestName, type Suggester } from './suggest.server.ts';

/**
 * The scope a guest's network is counted under (`netOf`): one for all of a family's suggestions, so the per-network limit
 * counts them together. No vote's id (a UUID) looks like it.
 */
const netScope = (tree: string) => `suggestions:${tree}`;

export interface Asking {
  by: Suggester;
  /** The member's account; none for a guest. */
  account?: string;
  /** The guest's new voter cookie, to send once the write was taken. */
  setCookie?: string;
}

/**
 * The suggester asking in `request`. A guest's `name` is the one they give, or else the one they gave with their latest
 * suggestion here; a guest without either has none, and making a suggestion refuses that (`suggest.err.name`).
 */
export async function suggesterOf(tree: string, request: Request, o: { name?: string; newCookie?: boolean } = {}): Promise<Asking> {
  const reader = await requireReader(tree);
  if (!reader.guest) {
    const m = await requireMember(tree);
    return { by: { kind: 'member', who: { id: m.user.id, name: m.user.name, role: m.role, person: m.person, personConfirmed: m.personConfirmed } }, account: m.user.id };
  }
  const guest = (await currentSession()).guest;
  if (!guest) throw fail(signedOut());
  let key = await guestVoterKey(request, tree);
  const had = key;
  let setCookie: string | undefined;
  if (!key && o.newCookie) ({ key, setCookie } = await voterCookie(request, tree, guest.expires));
  const given = o.name?.trim() ?? '';
  const name = given || (had ? await guestName(tree, had) : null) || '';
  return {
    by: { kind: 'guest', key: key ?? '', name, link: guest.link, net: await netOf(request, netScope(tree)), protectLiving: reader.protectLiving },
    setCookie,
  };
}
