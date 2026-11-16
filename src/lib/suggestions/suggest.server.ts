// Suggesting on the server (tree migration 0039): the family's settings, making a suggestion, attaching files to it and
// withdrawing it. Reviewing and applying one is review.server.ts.
//
//   suggest         viewer   suggest, attach files to and withdraw your own (withdrawing needs only membership); a share-link
//                            guest too, while the family's `suggest_guests` is on (files while `suggest_guest_files` is on)
//   manage-access   steward  change the family's settings, as the family's other steward settings are
//
// What it promises:
// - A suggestion is the family talking, not a record: making, attaching and withdrawing write no record and no change
//   history (NOT_A_RECORD). Only an approval (review.server.ts) changes the tree.
// - Each kind is checked against the record as it is, with the value rules the edit forms use (partial dates, sex, names,
//   places, event types): a details suggestion keeps only the fields it changes, with their values on record as its
//   `basis`, and one that changes nothing is refused; a correction of an event (or of a partnership) keeps the event's
//   (or the partnership's) values as its basis. Every check another request could undo meanwhile is a guard in the batch.
// - A guest of a link that protects living people (src/lib/protect-living.ts) suggests nothing on or about a living person:
//   such a person is refused exactly as one who is not there (`person`), so the refusal tells them nothing; a relative
//   they suggest is not living, and neither is anyone a partnership they correct joins.
// - Limits: a member at most MEMBER_WAITING waiting; a guest network at most GUEST_WAITING_PER_NETWORK waiting per link, a
//   link at most GUEST_WAITING_PER_LINK; up to MAX_FILES files of at most MAX_FILE_BYTES, images and PDFs whose bytes agree
//   with their type (pictures without their metadata); the family's waiting suggestions' files at most PENDING_BYTES.
// - Files go through the counted media store under `suggest/<uuid>.<ext>`, so they count against the family's storage; a
//   file whose row is not written is deleted again, and withdrawing deletes a suggestion's files.
// - Errors are translation keys (`suggest.err.*`), translated where they are shown:
//     payload      the suggestion is not a valid one of its kind   person     no such person (or, for such a guest, living)
//     unchanged    it changes nothing                              living     such a guest suggested someone living
//     event        no such event or partnership of this person, a custom event without its label, a burial of the living
//     backs        the fact a source backs is not one of its person's
//     note         the note is too long                            name       a guest's name is empty or too long
//     guests       guests may not suggest here                     guest_files  guests may not attach files here
//     limit        too many waiting from this network or link      too_many   the member has too many waiting
//     file_type    not an image or PDF its bytes agree with        file_size  the file is too large
//     files        the suggestion has its files                    pending    the family's pending files are full
//     gone         no such suggestion of yours                     state      it is no longer waiting
//     partial      an approval of it has begun: only approving it again (which finishes it) is left
//     settings     the settings are not two switches
import { z } from 'zod';
import { forbidden } from '../auth/errors.ts';
import { fail } from '../auth/guard.server.ts';
import { validDate } from '../dates.ts';
import { change, db, guard, media, NOT_A_RECORD, once, q, type Db, type OpKey, type Query } from '../db.server.ts';
import { AFTER_DEATH, EVENT_TYPES, type EventType } from '../events.ts';
import { needsMember, type Who } from '../feed/posts.server.ts';
import { MAX_FURTHER, MAX_FURTHER_LENGTH } from '../further-given.ts';
import { checkDocument } from '../research.ts';
import { cleanComment } from '../responses.ts';
import { can, needs as lowestRole, type Action } from '../roles.ts';
import { stripMetadata } from '../strip-metadata.ts';
import type { GParent, GUnion } from '../types.ts';
import { MAX_GUEST_NAME } from '../votes/types.ts';
import {
  FILE_TYPES, GUEST_WAITING_PER_LINK, GUEST_WAITING_PER_NETWORK, MAX_FILE_BYTES, MAX_FILES, MAX_NOTE, MEMBER_WAITING, PENDING_BYTES,
  SUGGESTION_KINDS, type DetailsPayload, type SuggestionKind, type SuggestionPayload,
} from './types.ts';

/**
 * Who suggests: a member, or a share-link guest. A guest's `key` is their `kindred_voter` cookie's key in this family
 * (`guestVoterKey`/`voterCookie` in votes/guest-voter.server.ts); `link` is the share link they came through, `net` their
 * network (`netOf`, under one fixed scope for the family's suggestions, so the limits count it across them), and
 * `protectLiving` whether that link protects living people.
 */
export type Suggester =
  | { kind: 'member'; who: Who }
  | { kind: 'guest'; key: string; name: string; link: string; net: number; protectLiving: boolean };

const err = (code: string) => new Error(`suggest.err.${code}`);
/** The person column's value: the id when that person is in the tree, else NULL. */
const PERSON = '(SELECT id FROM person WHERE id = ?)';
const personOf = (p: string | null | undefined) => (p && p !== '-' ? p : null);
const oneLine = (text: string) => cleanComment(text).replace(/\s+/g, ' ').trim();
/** Whether this suggester may not suggest about the living: a guest of a link that protects them. */
const protects = (by: Suggester) => by.kind === 'guest' && by.protectLiving;

function needs(who: Who, action: Action) {
  needsMember(who);
  if (!can(who.role, action)) throw fail(forbidden(action, lowestRole(action)));
}

/** Refuses a suggester who may not suggest at all: a member below `suggest`, a guest without a key or a name. Returns the name shown. */
function authorName(by: Suggester): string {
  if (by.kind === 'member') {
    needs(by.who, 'suggest');
    return by.who.name;
  }
  if (!by.key.startsWith('g:')) throw err('guests');
  const name = oneLine(by.name);
  if (!name || name.length > MAX_GUEST_NAME) throw err('name');
  return name;
}

// ---------- the family's settings ----------

export interface SuggestSettings { guests: boolean; guestFiles: boolean }

async function settingsIn(d: Db): Promise<SuggestSettings> {
  const rows = await d.all<{ key: string; value: string }>("SELECT key, value FROM meta WHERE key IN ('suggest_guests', 'suggest_guest_files')");
  const m = new Map(rows.map((r) => [r.key, r.value]));
  return { guests: m.get('suggest_guests') !== '0', guestFiles: m.get('suggest_guest_files') !== '0' };
}
/** A guard: the setting `key` is still on (on unless stored as '0'). */
const settingOn = (key: 'suggest_guests' | 'suggest_guest_files') => guard(`coalesce((SELECT value FROM meta WHERE key = '${key}'), '1') <> '0'`);

/** Whether guests may suggest, and attach files; both on unless a steward turned them off. */
export async function suggestSettings(tree: string): Promise<SuggestSettings> {
  return settingsIn(db(tree));
}

/** Changes the family's settings (a steward). `meta` is a record, so the change is in the history. */
export async function saveSuggestSettings(tree: string, who: Who, s: SuggestSettings, op?: OpKey): Promise<void> {
  needs(who, 'manage-access');
  if (typeof s?.guests !== 'boolean' || typeof s.guestFiles !== 'boolean') throw err('settings');
  return once(tree, op, 'saveSuggestSettings', async (d) => {
    const had = await settingsIn(d);
    const family = (await d.get<{ value: string }>("SELECT value FROM meta WHERE key = 'name'"))?.value ?? tree;
    return {
      writes: [
        guard("EXISTS (SELECT 1 FROM meta WHERE key = 'id')"),
        q("INSERT INTO meta (key, value) VALUES ('suggest_guests', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", s.guests ? '1' : '0'),
        q("INSERT INTO meta (key, value) VALUES ('suggest_guest_files', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", s.guestFiles ? '1' : '0'),
      ],
      history: change('family', 'suggest_settings',
        { suggest_guests: had.guests ? 1 : 0, suggest_guest_files: had.guestFiles ? 1 : 0 },
        { suggest_guests: s.guests ? 1 : 0, suggest_guest_files: s.guestFiles ? 1 : 0 }, { label: family }),
      result: undefined,
    };
  });
}

// ---------- the shapes of each kind ----------

const PARENT_KINDS = ['biological', 'adoptive', 'foster', 'step'] as const satisfies readonly GParent['kind'][];
const UNION_KINDS = ['marriage', 'partnership', 'betrothal', 'other'] as const satisfies readonly GUnion['kind'][];
const FACTS = ['birth', 'death', 'name', 'event'] as const;
const id = z.string().min(1).max(200);
/** A partial date as the edit forms take it ('' is none). */
const date = z.string().trim().refine((s) => s === '' || validDate(s));
/** Text that may be none: trimmed, '' and null are none. */
const text = (max: number) => z.string().trim().max(max).nullable().transform((s) => s || null);
const maybeDate = date.nullable().transform((s) => s || null);

const detailsShape = z.strictObject({
  given: z.string().trim().min(1).max(120),
  surname: text(120),
  birthName: text(120),
  nickname: text(120),
  title: text(200),
  sex: z.enum(['m', 'f', 'x', '']).nullable().transform((s) => s || null),
  living: z.boolean(),
  born: maybeDate,
  bornPlace: text(200),
  died: maybeDate,
  diedPlace: text(200),
}).partial();

const relativeShape = z.strictObject({
  person: z.strictObject({
    given: z.string().trim().min(1).max(120),
    furtherGiven: z.array(z.string().trim().min(1).max(MAX_FURTHER_LENGTH)).max(MAX_FURTHER).optional(),
    surname: z.string().trim().max(120).optional(),
    sex: z.enum(['m', 'f', 'x']).optional(),
    born: date.optional(),
    died: date.optional(),
    living: z.boolean(),
  }),
  link: z.strictObject({
    kind: z.enum(['parent', 'child', 'partner', 'sibling']),
    parentKind: z.enum(PARENT_KINDS).optional(),
    partnerKind: z.enum(UNION_KINDS).optional(),
  }),
}).refine((r) => (r.link.parentKind === undefined || r.link.kind === 'parent' || r.link.kind === 'child') && (r.link.partnerKind === undefined || r.link.kind === 'partner'));

const eventShape = z.strictObject({
  event: id.optional(),
  kind: z.enum(EVENT_TYPES).optional(),
  label: z.string().trim().max(200).optional(),
  date: maybeDate.optional(),
  place: text(200).optional(),
  note: z.string().trim().max(4000).optional(),
  partnership: id.optional(),
  partnershipKind: z.enum(UNION_KINDS).optional(),
  start: maybeDate.optional(),
  startPlace: text(200).optional(),
});

const sourceShape = z.strictObject({
  title: z.string().trim().min(1).max(300),
  author: z.string().trim().max(200).optional(),
  publication: z.string().trim().max(300).optional(),
  reference: z.string().trim().max(500).optional(),
  date: date.optional(),
  note: z.string().trim().max(4000).optional(),
  transcription: z.string().trim().max(4000).optional(),
  backs: z.strictObject({ fact: z.enum(FACTS), event: id.optional() }).optional(),
});

/** An object without its undefined keys, and without empty text where `empty` says (a new thing has no "none" to set). */
function compact<T extends object>(o: T, empty = false): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && !(empty && (v === '' || v === null)))) as T;
}

function parsed<S extends z.ZodType>(shape: S, payload: unknown): z.output<S> {
  const r = shape.safeParse(payload);
  if (!r.success) throw err('payload');
  return r.data;
}

// ---------- each kind against the record ----------

/** A person's row as the checks read it. */
export interface PersonRow {
  id: string; given: string; surname: string | null; current_surname: string | null; nickname: string | null; title: string | null;
  sex: 'm' | 'f' | 'x' | null; living: number; born: string | null; born_place: string | null; died: string | null; died_place: string | null;
}
export const PERSON_COLUMNS = 'id, given, surname, current_surname, nickname, title, sex, living, born, born_place, died, died_place';

/** The person's facts a details suggestion may change, as it reads them: `surname` the one they go by now, `birthName` at birth. */
export function detailsOf(r: PersonRow): Required<DetailsPayload> {
  const none = (s: string | null) => s || null;
  return {
    given: r.given, surname: none(r.current_surname) ?? none(r.surname), birthName: none(r.surname), nickname: none(r.nickname),
    title: none(r.title), sex: r.sex || null, living: r.living === 1, born: none(r.born), bornPlace: none(r.born_place),
    died: none(r.died), diedPlace: none(r.died_place),
  };
}

/** The person the suggestion is about, as this suggester may see them, else `person`: one living is, to such a guest, no one. */
async function personFor(d: Db, by: Suggester, person: string | null): Promise<PersonRow> {
  if (!person) throw err('person');
  const r = await d.get<PersonRow>(`SELECT ${PERSON_COLUMNS} FROM person WHERE id = ?`, person);
  if (!r || (protects(by) && r.living !== 0)) throw err('person');
  return r;
}
/** A guard: the person is there (not living, for such a guest, or when `dead`). */
const personThere = (by: Suggester, person: string, dead = false) =>
  guard(`EXISTS (SELECT 1 FROM person WHERE id = ?${protects(by) || dead ? ' AND living = 0' : ''})`, person);

interface Checked { payload: SuggestionPayload; basis: Record<string, unknown> | null; guards: Query[] }

async function checkDetails(d: Db, by: Suggester, person: string | null, raw: unknown): Promise<Checked> {
  const given = parsed(detailsShape, raw);
  const p = await personFor(d, by, person);
  const now = detailsOf(p);
  const payload: Record<string, unknown> = {};
  const basis: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(compact(given)) as [keyof DetailsPayload, unknown][]) {
    if (v === now[k]) continue;
    payload[k] = v;
    basis[k] = now[k];
  }
  if (!Object.keys(payload).length) throw err('unchanged');
  if (protects(by) && payload.living === true) throw err('living');
  return {
    payload: payload as DetailsPayload,
    basis,
    guards: [
      personThere(by, p.id),
      // The person exactly as read: a change landing meanwhile makes the plan decide (and capture its basis) again.
      guard(`EXISTS (SELECT 1 FROM person WHERE id = ? AND given IS ? AND surname IS ? AND current_surname IS ? AND nickname IS ? AND title IS ?
        AND sex IS ? AND living = ? AND born IS ? AND born_place IS ? AND died IS ? AND died_place IS ?)`,
      p.id, p.given, p.surname, p.current_surname, p.nickname, p.title, p.sex, p.living, p.born, p.born_place, p.died, p.died_place),
    ],
  };
}

async function checkRelative(d: Db, by: Suggester, person: string | null, raw: unknown): Promise<Checked> {
  const given = parsed(relativeShape, raw);
  const p = await personFor(d, by, person);
  if (protects(by) && given.person.living) throw err('living');
  const payload = { person: compact(given.person, true), link: compact(given.link) };
  return { payload, basis: null, guards: [personThere(by, p.id)] };
}

const PARTNERSHIP_FIELDS = ['partnership', 'partnershipKind', 'start', 'startPlace'] as const;
const CORRECTION_FIELDS = ['event', 'date', 'place', 'note'] as const;
const NEW_EVENT_FIELDS = ['kind', 'label', 'date', 'place', 'note'] as const;
const only = (o: object, keys: readonly string[]) => Object.keys(o).every((k) => keys.includes(k));

/** The fields of a correction that differ from the record: the payload, or `unchanged`. */
function differing(next: Record<string, unknown>, now: Record<string, unknown>): Record<string, unknown> {
  const out = Object.fromEntries(Object.entries(next).filter(([k, v]) => v !== undefined && v !== now[k]));
  if (!Object.keys(out).length) throw err('unchanged');
  return out;
}

async function checkEvent(d: Db, by: Suggester, person: string | null, raw: unknown): Promise<Checked> {
  const given = compact(parsed(eventShape, raw));
  if (given.partnership !== undefined) {
    if (!only(given, PARTNERSHIP_FIELDS)) throw err('payload');
    const p = await personFor(d, by, person);
    const u = await d.get<{ a: string; b: string; kind: string; start: string | null; place: string | null }>('SELECT a, b, kind, start, place FROM partnership WHERE id = ?', given.partnership);
    if (!u || (u.a !== p.id && u.b !== p.id)) throw err('event');
    const other = u.a === p.id ? u.b : u.a;
    // A partnership with a living partner is about the living: such a guest is told what a living person gets them.
    if (protects(by) && (await d.get<{ living: number }>('SELECT living FROM person WHERE id = ?', other))?.living !== 0) throw err('person');
    const now = { partnershipKind: u.kind, start: u.start || null, startPlace: u.place || null };
    const changed = differing({ partnershipKind: given.partnershipKind, start: given.start, startPlace: given.startPlace }, now);
    return {
      payload: { partnership: given.partnership, ...changed },
      basis: now,
      guards: [
        personThere(by, p.id),
        ...(protects(by) ? [personThere(by, other)] : []),
        guard('EXISTS (SELECT 1 FROM partnership WHERE id = ? AND a = ? AND b = ? AND kind = ? AND start IS ? AND place IS ?)', given.partnership, u.a, u.b, u.kind, u.start, u.place),
      ],
    };
  }
  if (given.event !== undefined) {
    if (!only(given, CORRECTION_FIELDS)) throw err('payload');
    const p = await personFor(d, by, person);
    const e = await d.get<{ date: string | null; place: string | null; note: string }>('SELECT date, place, note FROM life_event WHERE id = ? AND person = ?', given.event, p.id);
    if (!e) throw err('event');
    const now = { date: e.date || null, place: e.place || null, note: e.note };
    const changed = differing({ date: given.date, place: given.place, note: given.note }, now);
    return {
      payload: { event: given.event, ...changed },
      basis: now,
      guards: [
        personThere(by, p.id),
        guard('EXISTS (SELECT 1 FROM life_event WHERE id = ? AND person = ? AND date IS ? AND place IS ? AND note = ?)', given.event, p.id, e.date, e.place, e.note),
      ],
    };
  }
  if (given.kind === undefined || !only(given, NEW_EVENT_FIELDS)) throw err('payload');
  const p = await personFor(d, by, person);
  const kind: EventType = given.kind;
  // A custom event needs its label, as the event form does; a burial or cremation is only for someone not living.
  if ((kind === 'custom' && !given.label) || (AFTER_DEATH.has(kind) && p.living !== 0)) throw err('event');
  return { payload: compact(given, true), basis: null, guards: [personThere(by, p.id, AFTER_DEATH.has(kind))] };
}

async function checkSource(d: Db, by: Suggester, person: string | null, raw: unknown): Promise<Checked> {
  const given = parsed(sourceShape, raw);
  const guards: Query[] = [];
  const p = person === null ? null : await personFor(d, by, person);
  if (p) guards.push(personThere(by, p.id));
  const backs = given.backs;
  if (backs) {
    if (!p || (backs.fact === 'event') !== (backs.event !== undefined)) throw err('backs');
    if (backs.event !== undefined) {
      if (!(await d.get('SELECT 1 AS x FROM life_event WHERE id = ? AND person = ?', backs.event, p.id))) throw err('backs');
      guards.push(guard('EXISTS (SELECT 1 FROM life_event WHERE id = ? AND person = ?)', backs.event, p.id));
    }
  }
  return { payload: compact({ ...given, backs: backs && compact(backs) }, true), basis: null, guards };
}

const CHECKS: Record<SuggestionKind, (d: Db, by: Suggester, person: string | null, raw: unknown) => Promise<Checked>> = {
  details: checkDetails, relative: checkRelative, event: checkEvent, source: checkSource,
};

/**
 * A reviewer's adjusted values for a suggestion of this kind, checked as a suggestion is (review.server.ts): its stored form
 * (a correction keeps only what differs from the record) and the record's values it differs from.
 */
export async function checkPayload(d: Db, who: Who, kind: SuggestionKind, person: string | null, raw: unknown): Promise<{ payload: SuggestionPayload; basis: Record<string, unknown> | null }> {
  const { payload, basis } = await CHECKS[kind](d, { kind: 'member', who }, person, raw);
  return { payload, basis };
}

// ---------- making one ----------

/** The guards that keep this suggester within their limits, as counted now; refused when they are at one. */
async function withinLimits(d: Db, by: Suggester): Promise<Query[]> {
  if (by.kind === 'member') {
    const mine = await d.get<{ n: number }>("SELECT count(*) AS n FROM suggestion WHERE status = 'waiting' AND account = ?", by.who.id);
    if ((mine?.n ?? 0) >= MEMBER_WAITING) throw err('too_many');
    return [guard("(SELECT count(*) FROM suggestion WHERE status = 'waiting' AND account = ?) < ?", by.who.id, MEMBER_WAITING)];
  }
  const counts = await d.get<{ net: number; link: number }>(
    "SELECT count(CASE WHEN net = ? THEN 1 END) AS net, count(*) AS link FROM suggestion WHERE status = 'waiting' AND guest_key IS NOT NULL AND link = ?", by.net, by.link);
  if ((counts?.net ?? 0) >= GUEST_WAITING_PER_NETWORK || (counts?.link ?? 0) >= GUEST_WAITING_PER_LINK) throw err('limit');
  return [
    // The counts as read: two guests arriving at once cannot both be the twenty-first.
    guard("(SELECT count(*) FROM suggestion WHERE status = 'waiting' AND guest_key IS NOT NULL AND link = ? AND net = ?) < ?", by.link, by.net, GUEST_WAITING_PER_NETWORK),
    guard("(SELECT count(*) FROM suggestion WHERE status = 'waiting' AND guest_key IS NOT NULL AND link = ?) < ?", by.link, GUEST_WAITING_PER_LINK),
  ];
}

/**
 * Makes a suggestion about `person` (null only for a source that backs nothing), waiting for an editor or steward. The
 * payload is checked against the record as it is now and stored as checked; see the top of this file for the rules.
 */
export async function createSuggestion(
  tree: string, by: Suggester, input: { kind: SuggestionKind; person: string | null; payload: SuggestionPayload; note?: string }, now: Date = new Date(),
): Promise<{ id: string }> {
  const name = authorName(by);
  if (!SUGGESTION_KINDS.includes(input.kind) || (input.note !== undefined && typeof input.note !== 'string')) throw err('payload');
  const note = cleanComment(input.note ?? '').trim();
  if (note.length > MAX_NOTE) throw err('note');
  return once(tree, undefined, 'createSuggestion', async (d) => {
    if (by.kind === 'guest' && !(await settingsIn(d)).guests) throw err('guests');
    const checked = await CHECKS[input.kind](d, by, input.person, input.payload);
    const limits = await withinLimits(d, by);
    const id = crypto.randomUUID();
    const member = by.kind === 'member' ? by.who : null;
    const guest = by.kind === 'guest' ? by : null;
    return {
      writes: [
        ...(guest ? [settingOn('suggest_guests')] : []),
        ...checked.guards,
        ...limits,
        q(`INSERT INTO suggestion (id, kind, person, payload, basis, note, status, account, guest_key, author_name, author_person, link, net, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?, ?, ?, ${PERSON}, ?, ?, ?)`,
        id, input.kind, input.person, JSON.stringify(checked.payload), checked.basis && JSON.stringify(checked.basis), note,
        member?.id ?? null, guest?.key ?? null, name, member?.personConfirmed ? personOf(member.person) : null, guest?.link ?? null, guest?.net ?? null,
        now.toISOString()),
      ],
      history: NOT_A_RECORD,
      result: { id },
    };
  });
}

/**
 * The name a guest gave with their latest suggestion in this family (by their cookie's key), or null: a guest gives it with
 * their first suggestion, and it stands for the next ones.
 */
export async function guestName(tree: string, key: string): Promise<string | null> {
  if (!key.startsWith('g:')) return null;
  const r = await db(tree).get<{ author_name: string }>('SELECT author_name FROM suggestion WHERE guest_key = ? ORDER BY created_at DESC LIMIT 1', key);
  return r?.author_name ?? null;
}

// ---------- your own suggestion ----------

interface OwnRow { id: string; person: string | null; status: string }

/** The suggester's own suggestion, waiting, and the guard that it still is; `gone` when it is not theirs (or not there). */
async function ownWaiting(d: Db, by: Suggester, id: string): Promise<{ row: OwnRow; guard: Query }> {
  const column = by.kind === 'member' ? 'account' : 'guest_key';
  const owner = by.kind === 'member' ? by.who.id : by.key;
  const row = await d.get<OwnRow>(`SELECT id, person, status FROM suggestion WHERE id = ? AND ${column} = ?`, id, owner);
  if (!row) throw err('gone');
  if (row.status !== 'waiting') throw err('state');
  return { row, guard: guard(`EXISTS (SELECT 1 FROM suggestion WHERE id = ? AND ${column} = ? AND status = 'waiting')`, id, owner) };
}

/** Refuses a suggester who may not touch their own suggestions: a member must be one, a guest must have a key. */
function ownerCheck(by: Suggester) {
  if (by.kind === 'member') needsMember(by.who);
  else if (!by.key.startsWith('g:')) throw err('gone');
}

// ---------- files ----------

const EXT: Record<(typeof FILE_TYPES)[number], string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf',
};

/** The file's bytes to store: of a type the suggestion takes, its bytes agreeing with it, a picture without its metadata. */
async function checkedBytes(mime: string, bytes: Uint8Array): Promise<Uint8Array> {
  if (!(FILE_TYPES as readonly string[]).includes(mime) || !bytes.length) throw err('file_type');
  if (bytes.length > MAX_FILE_BYTES) throw err('file_size');
  // The research documents' check: the bytes decide the type, and a PDF with active content is refused.
  if ('refused' in (await checkDocument(bytes, mime))) throw err('file_type');
  const clean = stripMetadata(bytes, mime);
  if (!clean) throw err('file_type');
  return clean;
}

/** A file's name as shown to reviewers: without a path, on one line, at most 200 characters. */
const fileName = (name: string) => oneLine(name.split(/[\\/]/).pop() ?? '').slice(0, 200) || 'file';

/** The family's waiting suggestions' files, in bytes. */
const PENDING_SUM = "SELECT coalesce(sum(f.size), 0) FROM suggestion_file f JOIN suggestion s ON s.id = f.suggestion WHERE s.status = 'waiting'";

/**
 * Attaches a file to the suggester's own waiting suggestion: stored under `suggest/<uuid>.<ext>` through the counted media
 * store, then its row; a row the database does not take leaves no file behind.
 */
export async function addSuggestionFile(
  tree: string, by: Suggester, suggestionId: string, file: { name: string; mime: string; bytes: Uint8Array }, now: Date = new Date(),
): Promise<{ id: string }> {
  if (by.kind === 'member') needs(by.who, 'suggest');
  else ownerCheck(by);
  const bytes = await checkedBytes(file.mime, file.bytes);
  const name = fileName(file.name);
  return once(tree, undefined, 'addSuggestionFile', async (d) => {
    const own = await ownWaiting(d, by, suggestionId);
    const guards: Query[] = [own.guard];
    if (by.kind === 'guest') {
      const settings = await settingsIn(d);
      if (!settings.guests) throw err('guests');
      if (!settings.guestFiles) throw err('guest_files');
      guards.push(settingOn('suggest_guests'), settingOn('suggest_guest_files'));
      // Someone marked living since: such a guest adds nothing about them.
      if (by.protectLiving && own.row.person) {
        await personFor(d, by, own.row.person);
        guards.push(personThere(by, own.row.person));
      }
    }
    const files = (await d.get<{ n: number }>('SELECT count(*) AS n FROM suggestion_file WHERE suggestion = ?', suggestionId))?.n ?? 0;
    if (files >= MAX_FILES) throw err('files');
    const pending = (await d.get<{ n: number }>(`SELECT (${PENDING_SUM}) AS n`))?.n ?? 0;
    if (pending + bytes.length > PENDING_BYTES) throw err('pending');
    const id = crypto.randomUUID();
    const key = `suggest/${crypto.randomUUID()}.${EXT[file.mime as keyof typeof EXT]}`;
    await media.put(tree, key, bytes, file.mime);
    return {
      writes: [
        ...guards,
        guard('(SELECT count(*) FROM suggestion_file WHERE suggestion = ?) < ?', suggestionId, MAX_FILES),
        // The ceiling as read: two uploads at once cannot both take the last room.
        guard(`(${PENDING_SUM}) + ? <= ?`, bytes.length, PENDING_BYTES),
        q('INSERT INTO suggestion_file (id, suggestion, key, mime, size, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          id, suggestionId, key, file.mime, bytes.length, name, now.toISOString()),
      ],
      history: NOT_A_RECORD,
      result: { id },
      // Logged by its key alone, as a withdrawal's: the sweep (expiry.server.ts) takes the stray object later.
      abandon: () => media.delete(tree, key).catch((e) => console.error('suggest.err.delete_failed', key, e)),
    };
  });
}

// ---------- withdrawing ----------

/**
 * Whether an approval of the suggestion has begun and changed the records (review.server.ts): it may then only be approved
 * again, which finishes it, never withdrawn or declined, or the records would keep a change nobody approved to the end.
 */
export const partlyApproved = async (d: Db, id: string) => !!(await d.get('SELECT 1 AS x FROM history WHERE suggestion = ? LIMIT 1', id));
/** The guard of the same: no change of the records names the suggestion yet. */
export const NOT_PARTLY_APPROVED = (id: string) => guard('NOT EXISTS (SELECT 1 FROM history WHERE suggestion = ?)', id);

/** Withdraws the suggester's own waiting suggestion: its files go from storage, with their rows. */
export async function withdrawSuggestion(tree: string, by: Suggester, id: string, now: Date = new Date()): Promise<void> {
  ownerCheck(by);
  return once(tree, undefined, 'withdrawSuggestion', async (d) => {
    const own = await ownWaiting(d, by, id);
    if (await partlyApproved(d, id)) throw err('partial');
    const keys = (await d.all<{ key: string }>('SELECT key FROM suggestion_file WHERE suggestion = ?', id)).map((r) => r.key);
    return {
      writes: [
        own.guard,
        NOT_PARTLY_APPROVED(id),
        // Its files as read: one added meanwhile makes the plan read them again, so none is left in storage.
        guard('(SELECT count(*) FROM suggestion_file WHERE suggestion = ?) = ?', id, keys.length),
        q('DELETE FROM suggestion_file WHERE suggestion = ?', id),
        q("UPDATE suggestion SET status = 'withdrawn', decided_at = ? WHERE id = ?", now.toISOString(), id),
      ],
      history: NOT_A_RECORD,
      result: undefined,
      after: async () => {
        for (const key of keys) await media.delete(tree, key).catch((e) => console.error('suggest.err.delete_failed', key, e));
      },
    };
  });
}
