// Who is suggesting in this request, for the server functions (suggestions.functions.ts) and the upload route
// (src/routes/api/suggestion-upload.$tree.$id.ts): a member, through `requireMember` (suggest.server.ts checks the `suggest`
// role), or a share-link guest, through `requireReader`, known by their `kindred_voter` cookie (votes/guest-voter.server.ts).
// A guest's key comes only from that cookie, never from the client. Making a suggestion (`makerOf`) also works out the name a
// guest goes by and their network, and gives a new guest a cookie, which the caller sends only once the write was taken, so a
// refused suggestion leaves the browser as it was; reading, attaching and withdrawing (`suggesterOf`) need none of that.
import { signedOut } from '../auth/errors.ts';
import { currentSession, fail, requireMember, requireReader } from '../auth/guard.server.ts';
import { guestVoterKey, netOf, voterCookie } from '../votes/guest-voter.server.ts';
import { guestName, type Maker, type Suggester } from './suggest.server.ts';

/**
 * The scope a guest's network is counted under (`netOf`): one for all of a family's suggestions, so the per-network limit
 * counts them together. No vote's id (a UUID) looks like it.
 */
const netScope = (tree: string) => `suggestions:${tree}`;

export interface Asking {
  by: Suggester;
  /** The member's account; none for a guest. */
  account?: string;
}

export interface Making {
  by: Maker;
  /** The member's account; none for a guest. */
  account?: string;
  /** The guest's new voter cookie, to send once the write was taken. */
  setCookie?: string;
}

/** The suggester asking in `request`, to read, attach to or withdraw their own; a guest without the cookie has the key ''. */
export async function suggesterOf(tree: string, request: Request): Promise<Asking> {
  const reader = await requireReader(tree);
  if (!reader.guest) return member(tree);
  const guest = await sessionGuest();
  return { by: { kind: 'guest', key: (await guestVoterKey(request, tree)) ?? '', link: guest.link, protectLiving: reader.protectLiving } };
}

/**
 * The suggester making a suggestion in `request`. A guest without the cookie is given one; their `name` is the one they give,
 * or else the one they gave with their latest suggestion here; a guest without either has none, and making a suggestion
 * refuses that (`suggest.err.name`).
 */
export async function makerOf(tree: string, request: Request, o: { name?: string }): Promise<Making> {
  const reader = await requireReader(tree);
  if (!reader.guest) return member(tree);
  const guest = await sessionGuest();
  const had = await guestVoterKey(request, tree);
  const made = had ? undefined : await voterCookie(request, tree, guest.expires);
  const given = o.name?.trim() ?? '';
  const name = given || (had ? await guestName(tree, had) : null) || '';
  return {
    by: { kind: 'guest', key: had ?? made!.key, name, link: guest.link, net: await netOf(request, netScope(tree)), protectLiving: reader.protectLiving },
    setCookie: made?.setCookie,
  };
}

async function member(tree: string): Promise<Asking & { by: Maker }> {
  const m = await requireMember(tree);
  return { by: { kind: 'member', who: { id: m.user.id, name: m.user.name, role: m.role, person: m.person, personConfirmed: m.personConfirmed } }, account: m.user.id };
}

async function sessionGuest() {
  const guest = (await currentSession()).guest;
  if (!guest) throw fail(signedOut());
  return guest;
}
