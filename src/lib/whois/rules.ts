// "Who is this?": the rule that turns a proposal into a tag. Plain code, so the server and its tests share it.
//
// A name a member gives is a proposal. It becomes a tag when someone who may tag pictures in the gallery (`upload-photo`, a
// contributor or higher) agrees, and that someone is not the member who proposed it: two people have then said so, and one of
// them could have tagged the picture anyway. Agreeing is either pressing Confirm on a waiting proposal or naming the same
// person in the same picture while playing. A viewer's agreement is kept as a second proposal, which the confirmer sees.
import { can, type Role } from '../roles.ts';

/** Whether `account` with `role` may confirm a proposal made by `proposer`. */
export const mayConfirm = (role: Role, account: string, proposer: string): boolean => can(role, 'upload-photo') && account !== proposer;

/**
 * What naming `person` in a picture does, given what is there: `already` when they are tagged in it, `confirm` when another
 * member proposed the same and the reader may confirm theirs, otherwise `propose`.
 */
export function onNaming(o: { role: Role; account: string; tagged: boolean; proposers: readonly string[] }): 'already' | 'confirm' | 'propose' {
  if (o.tagged) return 'already';
  return o.proposers.some((p) => mayConfirm(o.role, o.account, p)) ? 'confirm' : 'propose';
}

/** The first moment of the reader's month, in UTC, for "You named 7 people this month". */
export const monthStart = (now: Date): string => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

/** How many pictures one round shows. */
export const ROUND = 5;
/** A box around a tapped point, for a proposal: about a face's size, kept inside the picture. */
export function boxAround(x: number, y: number, size = 0.18): { x: number; y: number; w: number; h: number } {
  const half = size / 2;
  const clamp = (n: number) => Math.min(Math.max(n - half, 0), 1 - size);
  return { x: clamp(x), y: clamp(y), w: size, h: size };
}
