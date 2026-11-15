// Reviewing suggestions on the server (tree migration 0039): approving one, which applies it to the family's records,
// declining one, and the people already in the tree a missing relative may be. Making one is suggest.server.ts.
//
//   review-suggestions  editor  approve (as suggested, or adjusted), decline, see a missing relative's possible matches
//
// What it promises:
// - An approval changes the records only through the write paths the forms use, under the reviewer's role and with their
//   checks: a person's facts through `correctPerson` (person.server.ts), a missing relative through the add-relative plan or,
//   for someone already in the tree, the link plan and `fillGaps` for the facts they lack (relations.server.ts), an event
//   through `saveEvent`, a couple through the partnership details plan, a source through `saveSource` and `saveCitation`.
//   Every history row it writes names the suggestion (`once`'s `suggestion`), and each of those writes is made only while
//   the suggestion is still waiting.
// - It runs as steps, each with its own retry key `sugg-<id>-<n>` (the same for every reviewer, and bound to the values
//   approved), so an approval that failed half-way and is approved again replays the steps that were written instead of
//   writing them twice; the last step moves the files and marks the suggestion approved (`status`, `adjusted`, `decided_*`,
//   `applied`), guarded on it still waiting. A retry must approve the same values: other values are refused by the retry key.
// - A correction (a person's facts, an event, a couple) rests on the values it was made against (`basis`), or on those the
//   reviewer was shown (`seen`): when the record moved on from them, other than to the suggested value, it is refused as
//   `changed` and nothing is written.
// - A person whose processing is restricted (GDPR Art. 18) is not changed, as the edit forms refuse it.
// - Files move from `suggest/` to `source/<uuid>.<ext>` through the counted media store (stored anew, then the pending
//   object deleted), as files of the suggested source or of a source made for them that cites the facts changed. They had
//   their metadata taken out when they were attached. Declining deletes them from storage.
// - Errors are translation keys (`suggest.err.*`), as in suggest.server.ts, or the refusals of the write paths themselves:
//     gone      no such suggestion                   state    it is no longer waiting
//     changed   the record moved on since            payload  adjusted values are not a valid suggestion of its kind
//     person    the person it is about, or the one named as already in the tree, is not there
//     event     the event or couple it corrects is not this person's       reason  the decline reason is too long
//     files     a file was attached while it was being approved: approve it again
import { forbidden, AuthError } from '../auth/errors.ts';
import { fail } from '../auth/guard.server.ts';
import { db, media, NOT_A_RECORD, once, q, guard, change, type Db, type OnceOptions, type OpKey } from '../db.server.ts';
import { saveEvent, type LifeReader } from '../events.server.ts';
import type { EventType, Fact } from '../events.ts';
import { needsMember, type Who } from '../feed/posts.server.ts';
import { refuseRestricted } from '../gdpr/subject.server.ts';
import { correctPerson, fillGaps, type Correctable } from '../person.server.ts';
import { addRelativePlan, linkPlan, partnershipDetailsPlan } from '../relations.server.ts';
import { cleanComment } from '../responses.ts';
import { can, needs as lowestRole } from '../roles.ts';
import { saveCitation, saveSource } from '../sources.server.ts';
import { CHANGED_SINCE_OPENED } from '../fields/model.ts';
import type { GParent, GUnion } from '../types.ts';
import { checkPayload, detailsOf, PERSON_COLUMNS, type PersonRow } from './suggest.server.ts';
import { MAX_REASON, type DetailsPayload, type EventPayload, type RelativePayload, type SourcePayload, type SuggestionKind, type SuggestionPayload } from './types.ts';

const err = (code: string) => new Error(`suggest.err.${code}`);

function needsReviewer(who: Who) {
  needsMember(who);
  if (!can(who.role, 'review-suggestions')) throw fail(forbidden('review-suggestions', lowestRole('review-suggestions')));
}

/** A person whose processing is restricted is not changed (GDPR Art. 18), as the edit forms refuse it. */
async function notRestricted(tree: string, person: string) {
  try {
    await refuseRestricted(tree, person);
  } catch (e) {
    throw e instanceof AuthError ? fail(e) : e;
  }
}

/** Two values alike, whatever the order of an object's keys. */
const same = (a: unknown, b: unknown) => JSON.stringify(sorted(a ?? null)) === JSON.stringify(sorted(b ?? null));
const sorted = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sorted(x)])) : v;

interface SuggestionRow {
  id: string; kind: SuggestionKind; person: string | null; payload: string; basis: string | null; status: string; author_name: string;
}

/** The suggestion, waiting; `gone` or `state` otherwise. */
async function waiting(d: Db, id: string): Promise<SuggestionRow> {
  const r = await d.get<SuggestionRow>('SELECT id, kind, person, payload, basis, status, author_name FROM suggestion WHERE id = ?', id);
  if (!r) throw err('gone');
  if (r.status !== 'waiting') throw err('state');
  return r;
}

// ---------- approving ----------

/** What an approval wrote, kept with the suggestion (`applied`) for the history and the suggester's view. */
export interface Applied {
  /** The person added for a missing relative, the one named as already in the tree, or the one whose facts changed. */
  person?: string;
  /** The couple a missing partner's link made, or the one corrected. */
  partnership?: string;
  /** The event added or corrected. */
  event?: string;
  /** The suggested source, or the source made for the files. */
  source?: string;
  citations?: string[];
  /** The files' storage keys, as the source lists them. */
  files?: string[];
}

export interface ApproveOptions {
  /**
   * For a correction: the record's values as the reviewer was shown them (the suggestion's own fields, as its payload names
   * them), in place of those it was made against. Approving after a `changed` refusal sends what the reviewer now sees.
   */
  seen?: Record<string, unknown>;
  /** For a missing relative: the person already in the tree they are. Only the link, and the facts that person lacks, are written. */
  existing?: string;
  /** The title of the source made for the files of a suggestion that is not a source. */
  sourceTitle?: string;
  now?: Date;
}

/** The fixed step numbers of an approval, so a retry finds each step's key whatever else changed. */
const STEP = { main: 1, gaps: 2, backs: 3, filesSource: 4, cite: 5, last: 9 } as const;
/** The facts a source for a details suggestion's files cites, each its own step after STEP.cite. */
const DETAIL_FACTS = [
  ['birth', ['born', 'bornPlace']],
  ['death', ['died', 'diedPlace']],
  ['name', ['given', 'surname', 'birthName', 'nickname', 'title']],
] as const;

interface Ctx {
  tree: string;
  d: Db;
  row: SuggestionRow;
  person: string;
  payload: SuggestionPayload;
  seen: Record<string, unknown>;
  existing?: string;
  reader: LifeReader;
  opts: OnceOptions;
  /** Runs step `n` with its retry key; `replay` is true when it was written before (its checks are then not run again). */
  step: <T>(n: number, run: (op: OpKey, replay: boolean) => Promise<T>) => Promise<T>;
}

/** The changes that differ from what the record now has and from the value suggested: the fields `changed` refuses on. */
function moved(now: Record<string, unknown>, target: Record<string, unknown>, seen: Record<string, unknown>) {
  return Object.keys(target).some((k) => k in seen && !same(now[k], seen[k]) && !same(now[k], target[k]));
}

async function applyDetails(c: Ctx, out: Applied): Promise<Fact[]> {
  const P = c.payload as DetailsPayload;
  await c.step(STEP.main, async (op, replay) => {
    const r = await c.d.get<PersonRow>(`SELECT ${PERSON_COLUMNS} FROM person WHERE id = ?`, c.person);
    if (!r) throw err('person');
    const now = detailsOf(r);
    if (!replay && moved(now, P, c.seen)) throw err('changed');
    // The person as the suggestion reads them afterwards, then as the columns store it: the surname they go by is the
    // current one only where it is not their birth surname (detailsOf in suggest.server.ts).
    const t = { ...now, ...P };
    const want: Record<Correctable, string | number | null> = {
      given: t.given, surname: t.birthName, current_surname: t.surname === t.birthName ? null : t.surname, nickname: t.nickname, title: t.title,
      sex: t.sex, living: t.living ? 1 : 0, born: t.born, born_place: t.bornPlace, died: t.died, died_place: t.diedPlace,
    };
    const had = r as unknown as Record<Correctable, string | number | null>;
    const set = Object.fromEntries(Object.entries(want).filter(([k, v]) => v !== (had[k as Correctable] || (k === 'living' ? 0 : null)))) as Partial<typeof want>;
    // What the person had in every column written, and both surnames whenever one is: the target was decided on them.
    const columns = Object.keys(set).some((k) => k === 'surname' || k === 'current_surname') ? [...Object.keys(set), 'surname', 'current_surname'] : Object.keys(set);
    const seen = Object.fromEntries(columns.map((k) => [k, had[k as Correctable]]));
    try {
      await correctPerson(c.tree, c.person, set, seen, op, c.opts);
    } catch (e) {
      throw e instanceof Error && e.message === CHANGED_SINCE_OPENED ? err('changed') : e;
    }
  });
  out.person = c.person;
  return DETAIL_FACTS.filter(([, keys]) => keys.some((k) => k in P)).map(([fact]) => ({ fact, person: c.person }));
}

async function applyRelative(c: Ctx, out: Applied): Promise<Fact[]> {
  const P = c.payload as RelativePayload;
  const relation = P.link.kind;
  const partnership = P.link.partnerKind ? { kind: P.link.partnerKind as GUnion['kind'] } : undefined;
  const parentKind = P.link.parentKind as GParent['kind'] | undefined;
  let other: string;
  if (c.existing) {
    const existing = c.existing;
    const link = await c.step(STEP.main, (op) =>
      once(c.tree, op, 'linkRelative', (d) => linkPlan(d, { anchor: c.person, person: existing, relation, partnership, parentKind }), c.opts));
    other = existing;
    if (link.partnership) out.partnership = link.partnership;
    // The facts the person in the tree lacks; what they have stays (fillGaps with nothing seen fills only gaps).
    const gaps = Object.fromEntries((['born', 'died', 'sex'] as const).filter((k) => P.person[k]).map((k) => [k, P.person[k]!]));
    if (Object.keys(gaps).length) await c.step(STEP.gaps, (op) => fillGaps(c.tree, existing, gaps, {}, op, c.opts));
  } else {
    other = await c.step(STEP.main, (op) =>
      once(c.tree, op, 'addRelative', (d) => addRelativePlan(d, { anchor: c.person, relation, person: P.person, partnership, parentKind }), c.opts));
    if (relation === 'partner') out.partnership = `${c.person}__${other}`;
  }
  out.person = other;
  if (relation === 'parent') return [{ fact: 'parent', child: c.person, parent: other }];
  if (relation === 'child') return [{ fact: 'parent', child: other, parent: c.person }];
  if (relation === 'partner' && out.partnership) return [{ fact: 'partnership', partnership: out.partnership }];
  return [{ fact: 'name', person: other }];
}

async function applyEvent(c: Ctx, out: Applied): Promise<Fact[]> {
  const P = c.payload as EventPayload;
  if (P.partnership !== undefined) {
    const id = P.partnership;
    await c.step(STEP.main, async (op, replay) => {
      const u = await c.d.get<{ a: string; b: string; kind: string; start: string | null; place: string | null }>('SELECT a, b, kind, start, place FROM partnership WHERE id = ?', id);
      if (!u || (u.a !== c.person && u.b !== c.person)) throw err('event');
      const now = { partnershipKind: u.kind, start: u.start || null, startPlace: u.place || null };
      const target = { partnershipKind: P.partnershipKind, start: P.start, startPlace: P.startPlace };
      const fields = Object.fromEntries(Object.entries(target).filter(([, v]) => v !== undefined));
      if (!replay && moved(now, fields, c.seen)) throw err('changed');
      const t = { ...now, ...fields } as typeof now;
      await once(c.tree, op, 'setPartnershipDetails', (d) => partnershipDetailsPlan(d, { id, kind: t.partnershipKind as GUnion['kind'], start: t.start, place: t.startPlace }), c.opts);
    });
    out.partnership = id;
    return [{ fact: 'partnership', partnership: id }];
  }
  if (P.event !== undefined) {
    const id = P.event;
    await c.step(STEP.main, async (op, replay) => {
      const e = await c.d.get<{ type: EventType; label: string | null; date: string | null; end_date: string | null; place: string | null; note: string }>(
        'SELECT type, label, date, end_date, place, note FROM life_event WHERE id = ? AND person = ?', id, c.person);
      if (!e) throw err('event');
      const now = { date: e.date || null, place: e.place || null, note: e.note };
      const fields = Object.fromEntries((['date', 'place', 'note'] as const).filter((k) => P[k] !== undefined).map((k) => [k, P[k]]));
      if (!replay && moved(now, fields, c.seen)) throw err('changed');
      const t = { ...now, ...fields } as typeof now;
      await saveEvent(c.tree, c.reader, { id, person: c.person, type: e.type, label: e.label, date: t.date, endDate: e.end_date, place: t.place, note: t.note ?? '' }, op, c.opts);
    });
    out.event = id;
    return [{ fact: 'event', event: id }];
  }
  const added = await c.step(STEP.main, (op) => saveEvent(c.tree, c.reader, {
    person: c.person, type: P.kind as EventType, label: P.label ?? null, date: P.date ?? null, endDate: null, place: P.place ?? null, note: P.note ?? '',
  }, op, c.opts));
  out.event = added.id;
  return [{ fact: 'event', event: added.id }];
}

async function applySource(c: Ctx, out: Applied): Promise<Fact[]> {
  const P = c.payload as SourcePayload;
  // A transcription belongs to a citation; with no fact to cite it stays with the source, in its note.
  const note = P.backs ? (P.note ?? '') : [P.note, P.transcription].filter(Boolean).join('\n\n');
  const source = await c.step(STEP.main, (op) => saveSource(c.tree, c.reader, {
    title: P.title, author: P.author ?? null, publication: P.publication ?? null, reference: P.reference ?? null, date: P.date ?? null, note, document: null, media: null,
  }, op, c.opts));
  out.source = source.id;
  if (P.backs) {
    const target: Fact = P.backs.fact === 'event' ? { fact: 'event', event: P.backs.event! } : { fact: P.backs.fact as 'birth', person: c.person };
    const cited = await c.step(STEP.backs, (op) =>
      saveCitation(c.tree, c.reader, { source: source.id, target, page: null, quality: null, transcription: P.transcription ?? '' }, op, c.opts));
    out.citations = [cited.id];
  }
  return [];
}

const APPLY: Record<SuggestionKind, (c: Ctx, out: Applied) => Promise<Fact[]>> = {
  details: applyDetails, relative: applyRelative, event: applyEvent, source: applySource,
};

/** The values approved, and whether they are not the suggested ones: a reviewer's adjusted values are checked as a suggestion is. */
async function approvedPayload(d: Db, who: Who, row: SuggestionRow, adjusted: SuggestionPayload | null | undefined): Promise<{ payload: SuggestionPayload; adjusted: boolean }> {
  const stored = JSON.parse(row.payload) as SuggestionPayload;
  if (adjusted === undefined || adjusted === null) return { payload: stored, adjusted: false };
  const { payload } = await checkPayload(d, who, row.kind, row.person, adjusted);
  // A correction stays a correction of the same event or couple, and a new event stays new.
  if (row.kind === 'event') {
    const a = payload as EventPayload, s = stored as EventPayload;
    if (a.event !== s.event || a.partnership !== s.partnership) throw err('payload');
  }
  return { payload, adjusted: !same(payload, stored) };
}

/**
 * Approves a waiting suggestion: applies it (as suggested, or with the reviewer's `adjusted` values, a payload of its kind)
 * through the forms' write paths, then moves its files and marks it approved. See the top of this file for the rules.
 */
export async function approveSuggestion(
  tree: string, who: Who, id: string, adjusted?: SuggestionPayload | null, options: ApproveOptions = {},
): Promise<{ applied: Applied }> {
  needsReviewer(who);
  const d = db(tree);
  const row = await waiting(d, id);
  // Only a source may be about no one, and then it backs nothing.
  const person = row.person ?? '';
  if (row.person) await notRestricted(tree, row.person);
  if (options.existing !== undefined) {
    if (row.kind !== 'relative') throw err('payload');
    if (!(await d.get('SELECT 1 AS x FROM person WHERE id = ?', options.existing))) throw err('person');
    await notRestricted(tree, options.existing);
  }
  const approved = await approvedPayload(d, who, row, adjusted);
  const files = (await d.get<{ n: number }>('SELECT count(*) AS n FROM suggestion_file WHERE suggestion = ?', id))?.n ?? 0;
  const title = cleanComment(options.sourceTitle ?? '').replace(/\s+/g, ' ').slice(0, 300) || `Supplied with a suggestion by ${row.author_name}`;
  // What every step's retry key is bound to: the same approval sent again replays, different values are refused.
  const fingerprint = { payload: approved.payload, existing: options.existing ?? null };
  const opOf = (n: number): OpKey => ({ key: `sugg-${id}-${n}`, user: `suggestion:${id}`, payload: fingerprint });
  const c: Ctx = {
    tree, d, row, person, payload: approved.payload, existing: options.existing,
    seen: options.seen ?? (row.basis ? (JSON.parse(row.basis) as Record<string, unknown>) : {}),
    reader: { id: who.id, name: who.name, role: who.role },
    opts: { suggestion: id },
    step: async (n, run) => run(opOf(n), !!(await d.get('SELECT 1 AS x FROM op WHERE key = ?', opOf(n).key))),
  };

  const out: Applied = {};
  const facts = await APPLY[row.kind](c, out);
  let filesSource = row.kind === 'source' ? out.source : undefined;
  if (files && row.kind !== 'source') {
    const made = await c.step(STEP.filesSource, (op) => saveSource(tree, c.reader, {
      title, author: null, publication: null, reference: null, date: null, note: '', document: null, media: null,
    }, op, c.opts));
    filesSource = made.id;
    out.source = made.id;
    for (const [i, target] of facts.entries()) {
      const cited = await c.step(STEP.cite + i, (op) => saveCitation(tree, c.reader, { source: made.id, target, page: null, quality: null, transcription: '' }, op, c.opts));
      (out.citations ??= []).push(cited.id);
    }
  }
  return { applied: await c.step(STEP.last, (op) => finish(c, out, filesSource, approved.adjusted, who, options.now ?? new Date(), op)) };
}

/** The last step: the files move to their source, and the suggestion is marked approved with what was written. */
function finish(c: Ctx, out: Applied, source: string | undefined, adjusted: boolean, who: Who, now: Date, op: OpKey): Promise<Applied> {
  const { tree, row } = c;
  return once(tree, op, 'approveSuggestion', async (d) => {
    await waiting(d, row.id);
    const files = await d.all<{ key: string; mime: string; name: string }>('SELECT key, mime, name FROM suggestion_file WHERE suggestion = ? ORDER BY created_at, rowid', row.id);
    // A file attached after the approval began has no source made for it yet: approving again makes one.
    if (files.length && !source) throw err('files');
    const at = source ? await d.get<{ title: string; n: number; last: number; names: string | null }>(
      `SELECT s.title, (SELECT count(*) FROM source_file WHERE source = s.id) AS n, (SELECT coalesce(max(ord), -1) FROM source_file WHERE source = s.id) AS last,
         (SELECT group_concat(name, ', ') FROM (SELECT name FROM source_file WHERE source = s.id ORDER BY ord)) AS names FROM source s WHERE s.id = ?`, source) : undefined;
    if (source && !at) throw new Error('sources.err.gone');
    // Stored anew under source/, then (after the batch) the pending objects deleted; a batch that does not commit takes the new ones back.
    const moved: { key: string; mime: string; name: string }[] = [];
    const abandon = async () => {
      for (const m of moved) await media.delete(tree, m.key).catch(() => {});
    };
    try {
      for (const f of files) {
        const obj = await media.get(tree, f.key);
        if (!obj) {
          console.error('suggest.err.file_gone', f.key);
          continue;
        }
        const bytes = obj.body instanceof Uint8Array ? obj.body : new Uint8Array(await new Response(obj.body).arrayBuffer());
        const key = `source/${crypto.randomUUID()}.${f.key.split('.').pop()}`;
        await media.put(tree, key, bytes, f.mime);
        moved.push({ key, mime: f.mime, name: f.name });
      }
    } catch (e) {
      await abandon();
      throw e;
    }
    const applied: Applied = { ...out, ...(moved.length ? { files: moved.map((m) => m.key) } : {}) };
    const stamp = now.toISOString();
    return {
      writes: [
        // Its files as read: one added or withdrawn meanwhile makes the plan read them again.
        guard('(SELECT count(*) FROM suggestion_file WHERE suggestion = ?) = ?', row.id, files.length),
        ...(source && at ? [
          guard('(SELECT count(*) FROM source_file WHERE source = ?) = ?', source, at.n),
          ...moved.map((m, i) => q('INSERT INTO source_file (source, media_key, mime, name, ord, added_at) VALUES (?, ?, ?, ?, ?, ?)', source, m.key, m.mime, m.name, at.last + 1 + i, stamp)),
        ] : []),
        q('DELETE FROM suggestion_file WHERE suggestion = ?', row.id),
        q(`UPDATE suggestion SET status = 'approved', adjusted = ?, decided_by = ?, decided_by_name = ?, decided_at = ?, applied = ? WHERE id = ? AND status = 'waiting'`,
          adjusted ? 1 : 0, who.id, who.name, stamp, JSON.stringify(applied), row.id),
      ],
      // The source's files are part of the record: their names, before and after.
      history: source && at && moved.length
        ? change('source', source, { files: at.names }, { files: [at.names, ...moved.map((m) => m.name)].filter(Boolean).join(', ') }, { label: at.title })
        : [],
      result: applied,
      after: async () => {
        for (const f of files) await media.delete(tree, f.key).catch((e) => console.error('suggest.err.delete_failed', f.key, e));
      },
      abandon,
    };
  }, c.opts);
}

// ---------- declining ----------

/** Declines a waiting suggestion, with an optional reason the suggester sees; its files are deleted from storage. */
export async function declineSuggestion(tree: string, who: Who, id: string, reason?: string, now: Date = new Date()): Promise<void> {
  needsReviewer(who);
  const text = cleanComment(reason ?? '');
  if (text.length > MAX_REASON) throw err('reason');
  return once(tree, undefined, 'declineSuggestion', async (d) => {
    await waiting(d, id);
    const keys = (await d.all<{ key: string }>('SELECT key FROM suggestion_file WHERE suggestion = ?', id)).map((r) => r.key);
    return {
      writes: [
        guard("EXISTS (SELECT 1 FROM suggestion WHERE id = ? AND status = 'waiting')", id),
        // Its files as read: one added meanwhile makes the plan read them again, so none is left in storage.
        guard('(SELECT count(*) FROM suggestion_file WHERE suggestion = ?) = ?', id, keys.length),
        q('DELETE FROM suggestion_file WHERE suggestion = ?', id),
        q("UPDATE suggestion SET status = 'declined', reason = ?, decided_by = ?, decided_by_name = ?, decided_at = ? WHERE id = ?",
          text || null, who.id, who.name, now.toISOString(), id),
      ],
      history: NOT_A_RECORD,
      result: undefined,
      after: async () => {
        for (const key of keys) await media.delete(tree, key).catch((e) => console.error('suggest.err.delete_failed', key, e));
      },
    };
  });
}

// ---------- possible matches ----------

/** How many of the best matches are shown. */
const MATCHES = 5;
/** Below this a person is not offered. */
const MIN_SCORE = 0.5;

const fold = (s: string | null | undefined) => (s ?? '').trim().toLocaleLowerCase('en').normalize('NFD').replace(/\p{M}/gu, '');
const yearOf = (s: string | null | undefined) => (s ? parseInt(s.replace(/^~/, ''), 10) : NaN);

/** Whether two words differ by at most one letter (added, left out or changed). */
function nearly(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i);
}

/** How alike two names are: the same 1, one letter apart or one the start of the other 0.7, else 0. */
function nameScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  return nearly(a, b) || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a))) ? 0.7 : 0;
}

/** How near two years are: unknown on either side 0.5, the same 1, within two 0.7, within five 0.4; null when too far apart. */
function yearScore(a: number, b: number): number | null {
  if (Number.isNaN(a) || Number.isNaN(b)) return 0.5;
  const gap = Math.abs(a - b);
  return gap === 0 ? 1 : gap <= 2 ? 0.7 : gap <= 5 ? 0.4 : null;
}

/**
 * The people already in the tree a missing relative may be: a similar given name, the surname at birth or now, and near
 * birth and death years, best first. Only shown to the reviewer, who may approve the suggestion as one of them; never
 * applied by itself. Other kinds of suggestion have none.
 */
export async function matchCandidates(tree: string, who: Who, id: string): Promise<{ person: string; score: number }[]> {
  needsReviewer(who);
  const d = db(tree);
  const row = await d.get<SuggestionRow>('SELECT id, kind, person, payload, basis, status, author_name FROM suggestion WHERE id = ?', id);
  if (!row) throw err('gone');
  if (row.kind !== 'relative') return [];
  const p = (JSON.parse(row.payload) as RelativePayload).person;
  const people = await d.all<{ id: string; given: string; surname: string | null; current_surname: string | null; born: string | null; died: string | null }>(
    'SELECT id, given, surname, current_surname, born, died FROM person WHERE id IS NOT ?', row.person);
  const out: { person: string; score: number }[] = [];
  for (const x of people) {
    const given = nameScore(fold(p.given), fold(x.given));
    if (!given) continue;
    const theirs = [x.surname, x.current_surname].map(fold).filter(Boolean);
    const surname = !fold(p.surname) || !theirs.length ? 0.5 : Math.max(...theirs.map((s) => nameScore(fold(p.surname), s)));
    const born = yearScore(yearOf(p.born), yearOf(x.born));
    const died = yearScore(yearOf(p.died), yearOf(x.died));
    if (born === null || died === null) continue;
    const score = Math.round((0.45 * given + 0.25 * surname + 0.2 * born + 0.1 * died) * 100) / 100;
    if (score >= MIN_SCORE) out.push({ person: x.id, score });
  }
  return out.sort((a, b) => b.score - a.score || a.person.localeCompare(b.person)).slice(0, MATCHES);
}
