// What a family draft card decides, apart from how it looks: what goes to the server, and what the card can truthfully
// say about it. A link the server's check found would loop is left out for good: it is never sent and is not counted.
import { MAX_FURTHER } from '~/lib/further-given';
import { NEW_REF, type FamilyLink, type FamilyPerson } from '~/lib/ai/types';
import { blankValue, DEFAULT_LABEL, defaultVisibility, fieldIssue, storedValue } from '~/lib/fields/model';

export type Status = 'todo' | 'done' | 'failed';
export interface DraftRow extends FamilyPerson { status: Status; id?: string; error?: string; /** Chosen on the card: this row is someone already in the tree, so no one new is created. */ existing?: string }
export interface DraftLink extends FamilyLink { uid: string; status: Status; error?: string }
export interface LinkToSend { uid: string; payload: { anchor: string; person: string; relation: FamilyLink['relation']; coParent?: string } }

export type DraftDetail = NonNullable<FamilyPerson['details']>[number];

/** A detail's value as it is sent: trimmed, with the empty parts left out. */
const detailValue = (d: DraftDetail) => Object.fromEntries(Object.entries(d.value).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));

/**
 * Exactly what approving saves for this detail, by the same rules as the server (family.server.ts): its label or the
 * type's own, the level its type starts at, and only the parts the type keeps. With an `issue` the server skips it.
 */
export function detailPreview(d: DraftDetail) {
  const value = detailValue(d);
  const issue = fieldIssue(d.type, value);
  const kept: Record<string, string> = issue ? value : storedValue(d.type, value);
  return {
    label: d.label?.trim() || DEFAULT_LABEL[d.type] || d.type,
    level: defaultVisibility(d.type),
    issue,
    parts: Object.keys(blankValue(d.type)).flatMap((k): [string, string][] => (kept[k] ? [[k, kept[k]]] : [])),
  };
}

/** The parts of a detail the card can edit. Whether someone has left a faith is a flag, not text. */
export const detailKeys = (d: DraftDetail) => Object.keys(blankValue(d.type)).filter((k) => k !== 'left');

export const patchDetail = (details: DraftDetail[] | undefined, index: number, change: { label: string } | { key: string; value: string }) =>
  details?.map((d, i) => (i !== index ? d : 'label' in change ? { ...d, label: change.label } : { ...d, value: { ...d.value, [change.key]: change.value } }));
export const dropDetail = (details: DraftDetail[] | undefined, index: number) => details?.filter((_, i) => i !== index);

/** The person as the server takes it: empty fields left out, so a blank date is not sent as a date, and a memory emptied on the card is not sent at all. */
export function cleanPerson(r: FamilyPerson & { existing?: string }): FamilyPerson & { existing?: string } {
  const s = (v?: string) => (v && v.trim() ? v.trim() : undefined);
  const body = s(r.story?.body);
  return {
    ref: r.ref, given: r.given.trim(), furtherGiven: r.furtherGiven?.map((x) => x.trim()).filter(Boolean).slice(0, MAX_FURTHER), surname: s(r.surname), sex: r.sex || undefined, born: s(r.born), bornPlace: s(r.bornPlace),
    died: s(r.died), diedPlace: s(r.diedPlace), living: r.living, occupation: s(r.occupation),
    story: r.story && body ? { kind: r.story.kind, title: s(r.story.title), body, teller: r.story.teller || undefined } : undefined,
    social: r.social?.flatMap((x) => (x.handle.trim() ? [{ network: x.network, handle: x.handle.trim() }] : [])),
    details: r.details?.flatMap((d) => {
      const value = detailValue(d);
      return Object.keys(value).length ? [{ type: d.type, label: s(d.label), value }] : [];
    }),
    unsure: r.unsure?.map((x) => x.trim()).filter(Boolean),
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

/**
 * What makes a link the same link in every session. `linksToSend` swaps a reference for a real id once its row is added, and that
 * differs between a tab that added the row and one that did not, so the key is built from the draft's own references instead. Which
 * person a row stands for is part of it: pointing a row at someone already in the tree makes it another link.
 */
export function linkIdentity(rows: DraftRow[], l: DraftLink) {
  const end = (ref?: string) => ref && { ref, existing: rows.find((r) => r.ref === ref)?.existing };
  return { anchor: end(l.anchor), person: end(l.person), coParent: end(l.coParent), relation: l.relation };
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
