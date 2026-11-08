// What a family draft card decides, apart from how it looks: what goes to the server, and what the card can truthfully
// say about it. A link the server's check found would loop is left out for good: it is never sent and is not counted.
import { NEW_REF, type FamilyLink, type FamilyPerson } from '~/lib/ai/types';

export type Status = 'todo' | 'done' | 'failed';
export interface DraftRow extends FamilyPerson { status: Status; id?: string; error?: string; /** Chosen on the card: this row is someone already in the tree, so no one new is created. */ existing?: string }
export interface DraftLink extends FamilyLink { uid: string; status: Status; error?: string }
export interface LinkToSend { uid: string; payload: { anchor: string; person: string; relation: FamilyLink['relation']; coParent?: string } }

/** The person as the server takes it: empty fields left out, so a blank date is not sent as a date, and a memory emptied on the card is not sent at all. */
export function cleanPerson(r: FamilyPerson & { existing?: string }): FamilyPerson & { existing?: string } {
  const s = (v?: string) => (v && v.trim() ? v.trim() : undefined);
  const body = s(r.story?.body);
  return {
    ref: r.ref, given: r.given.trim(), surname: s(r.surname), sex: r.sex || undefined, born: s(r.born), bornPlace: s(r.bornPlace),
    died: s(r.died), diedPlace: s(r.diedPlace), living: r.living, occupation: s(r.occupation),
    story: r.story && body ? { kind: r.story.kind, title: s(r.story.title), body, teller: r.story.teller || undefined } : undefined,
    social: r.social?.flatMap((x) => (x.handle.trim() ? [{ network: x.network, handle: x.handle.trim() }] : [])),
    existing: r.existing || undefined,
  };
}

/** The links to send with these rows: not added yet, not left out, and with every end known by then. */
export function linksToSend(rows: DraftRow[], links: DraftLink[], leftOut: ReadonlySet<string>, sending: ReadonlySet<string>): LinkToSend[] {
  // A reference is a row sent now (the server maps it to the id it creates), a row already added (its real id), or an id in the tree.
  const doneId = (ref: string) => rows.find((r) => r.ref === ref && r.status === 'done')?.id;
  const resolve = (x: string): string | undefined => (sending.has(x) ? x : doneId(x) ?? (NEW_REF.test(x) ? undefined : x));
  const out: LinkToSend[] = [];
  for (const l of links) {
    if (l.status === 'done' || leftOut.has(l.uid)) continue;
    const anchor = resolve(l.anchor);
    const person = resolve(l.person);
    const coParent = l.coParent ? resolve(l.coParent) : undefined;
    if (!anchor || !person || (l.coParent && !coParent)) continue;
    out.push({ uid: l.uid, payload: { anchor, person, relation: l.relation, ...(coParent ? { coParent } : {}) } });
  }
  return out;
}

/** Where the card stands. `unfinished` is what a retry could still send; `settled` means something was added and nothing is left to send. */
export function draftProgress(rows: DraftRow[], links: DraftLink[], leftOut: ReadonlySet<string>) {
  const counted = links.filter((l) => !leftOut.has(l.uid));
  const peopleDone = rows.filter((r) => r.status === 'done').length;
  const linksDone = counted.filter((l) => l.status === 'done').length;
  const unfinished = rows.length - peopleDone + counted.length - linksDone;
  const anyDone = peopleDone + linksDone > 0;
  return {
    peopleDone, peopleTotal: rows.length, linksDone, linksTotal: counted.length, unfinished, anyDone,
    failed: rows.some((r) => r.status === 'failed') || counted.some((l) => l.status === 'failed'),
    settled: anyDone && unfinished === 0,
  };
}
