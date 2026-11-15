// What each reader sees of suggestions (tree migration 0039). Making one is suggest.server.ts, deciding one review.server.ts.
//
//   review-suggestions  editor   every waiting suggestion (with the record's values for "current → suggested"), the counts,
//                                and every pending file
//   suggest             viewer   their own suggestions and their states, and their own waiting suggestion's files; a
//                                share-link guest the same, by their `kindred_voter` cookie's key
//
// What it promises:
// - Nobody else reads a suggestion: not another member, not another guest, and no other read of the family (the tree, the
//   feed, the history, the exports, the assistant), because pending values live only in the suggestion tables.
// - A suggester sees what they wrote, its state, and a decline's reason; never the record's values (`basis`, `current`),
//   nor who decided. A decided suggestion stays in their list for EXPIRY_DAYS after it was decided; a withdrawn one goes.
// - A guest of a link that protects living people (src/lib/protect-living.ts) no longer gets a suggestion of theirs, nor its
//   files, about someone since marked living: that person is, to them, no one.
// - A pending file is served (src/routes/api/suggestion-file.$tree.$id.ts) only to reviewers and to its own suggester while
//   it waits; an approved one is a source's file (src/routes/api/source-file.$tree.$key.ts), served to members alone, as
//   sources are. Both as the type their bytes were checked to be, under a safe name, kept by no shared cache.
import { forbidden } from '../auth/errors.ts';
import { fail } from '../auth/guard.server.ts';
import { db, q } from '../db.server.ts';
import { needsMember, type Who } from '../feed/posts.server.ts';
import { LIVING_IDS } from '../protect-living.ts';
import { DOCUMENT_EXT, documentFileName, isPdf, type DocumentMime } from '../research.ts';
import { can, needs as lowestRole } from '../roles.ts';
import { SOURCE_FILES } from '../sources.server.ts';
import { detailsOf, PERSON_COLUMNS, type PersonRow } from './suggest.server.ts';
import { EXPIRY_DAYS, SOURCE_FILE_KEY, type EventPayload, type FactValue, type SuggestionKind, type SuggestionPayload, type SuggestionStatus, type SuggestionView } from './types.ts';

/** Whose own suggestions: a member's (by account), or a guest's (by their cookie's key; '' when they have none). */
export type SuggestionOwner = { kind: 'member'; who: Who } | { kind: 'guest'; key: string; protectLiving: boolean };

/** The most suggestions one list carries; the limits on waiting ones keep a family's far below it. */
const LIST_MAX = 500;
const DAY_MS = 86_400_000;

const isReviewer = (who: Who) => !who.guest && !!who.id && can(who.role, 'review-suggestions');
function needsReviewer(who: Who) {
  needsMember(who);
  if (!can(who.role, 'review-suggestions')) throw fail(forbidden('review-suggestions', lowestRole('review-suggestions')));
}

/** A guest's key as the votes cookie makes it (`g:` and a hash); anything else names no guest. */
const guestKey = (key: string) => key.startsWith('g:');
/**
 * A condition on `s` for a protecting link's guest: the suggestion is about no one living, as suggest.server.ts requires when
 * it is made: not its person, nor either partner of a couple it corrects.
 */
const NOT_LIVING = `(s.person IS NULL OR s.person NOT IN (${LIVING_IDS}))
  AND NOT EXISTS (SELECT 1 FROM partnership u WHERE u.id = json_extract(s.payload, '$.partnership') AND (u.a IN (${LIVING_IDS}) OR u.b IN (${LIVING_IDS})))`;

interface Row {
  id: string; kind: SuggestionKind; person: string | null; payload: string; basis: string | null; note: string; status: SuggestionStatus;
  adjusted: number; reason: string | null; account: string | null; guest_key: string | null; author_name: string; author_person: string | null;
  created_at: string; decided_at: string | null; applied: string | null; begun: number;
}
interface FileRow { id: string; suggestion: string; name: string; mime: string; size: number }

const COLUMNS = `s.id, s.kind, s.person, s.payload, s.basis, s.note, s.status, s.adjusted, s.reason, s.account, s.guest_key, s.author_name,
  s.author_person, s.created_at, s.decided_at, s.applied, EXISTS (SELECT 1 FROM history h WHERE h.suggestion = s.id) AS begun`;

/** The record's values now for each correction among the suggestions `where` selects, by suggestion id: "current → suggested". */
async function currentValues(tree: string, where: string, params: (string | number)[]): Promise<Map<string, Record<string, FactValue>>> {
  // Each read selects through the suggestions themselves, so no list of ids is bound (D1 takes at most 100 parameters).
  const [people, events, couples, rows] = (await db(tree).readBatch([
    q(`SELECT ${PERSON_COLUMNS} FROM person WHERE id IN (SELECT s.person FROM suggestion s WHERE ${where} AND s.kind = 'details')`, ...params),
    q(`SELECT id, date, place, note FROM life_event WHERE id IN (SELECT json_extract(s.payload, '$.event') FROM suggestion s WHERE ${where} AND s.kind = 'event')`, ...params),
    q(`SELECT id, kind, start, place FROM partnership WHERE id IN (SELECT json_extract(s.payload, '$.partnership') FROM suggestion s WHERE ${where} AND s.kind = 'event')`, ...params),
    q(`SELECT s.id, s.kind, s.person, s.payload FROM suggestion s WHERE ${where} AND s.kind IN ('details', 'event') ORDER BY s.created_at DESC, s.rowid DESC LIMIT ${LIST_MAX}`, ...params),
  ])) as unknown as [
    PersonRow[], { id: string; date: string | null; place: string | null; note: string }[], { id: string; kind: string; start: string | null; place: string | null }[],
    { id: string; kind: SuggestionKind; person: string | null; payload: string }[],
  ];
  const person = new Map(people.map((p) => [p.id, detailsOf(p) as Record<string, FactValue>]));
  const event = new Map(events.map((e) => [e.id, { date: e.date || null, place: e.place || null, note: e.note } as Record<string, FactValue>]));
  const couple = new Map(couples.map((u) => [u.id, { partnershipKind: u.kind, start: u.start || null, startPlace: u.place || null } as Record<string, FactValue>]));
  const out = new Map<string, Record<string, FactValue>>();
  for (const r of rows) {
    const payload = JSON.parse(r.payload) as Record<string, unknown>;
    const p = payload as EventPayload;
    const now = r.kind === 'details' ? person.get(r.person ?? '') : p.event ? event.get(p.event) : p.partnership ? couple.get(p.partnership) : undefined;
    if (!now) continue;
    const fields = Object.keys(payload).filter((k) => k !== 'event' && k !== 'partnership');
    out.set(r.id, Object.fromEntries(fields.map((k) => [k, now[k] ?? null])));
  }
  return out;
}

/** The suggestions `where` selects, newest first, as this reader sees them: a reviewer with the record's values, `mine` by `own`. */
async function views(tree: string, where: string, params: (string | number)[], reader: { reviewer: boolean; own: (r: Row) => boolean }): Promise<SuggestionView[]> {
  const [rows, files] = (await db(tree).readBatch([
    q(`SELECT ${COLUMNS} FROM suggestion s WHERE ${where} ORDER BY s.created_at DESC, s.rowid DESC LIMIT ${LIST_MAX}`, ...params),
    q(`SELECT f.id, f.suggestion, f.name, f.mime, f.size FROM suggestion_file f JOIN suggestion s ON s.id = f.suggestion WHERE ${where} ORDER BY f.created_at, f.rowid`, ...params),
  ])) as unknown as [Row[], FileRow[]];
  const current = reader.reviewer ? await currentValues(tree, where, params) : new Map<string, Record<string, FactValue>>();
  const filesOf = new Map<string, SuggestionView['files']>();
  for (const f of files) {
    let list = filesOf.get(f.suggestion);
    if (!list) filesOf.set(f.suggestion, (list = []));
    list.push({ id: f.id, name: f.name, mime: f.mime, size: f.size });
  }
  return rows.map((r): SuggestionView => {
    const applied = r.applied ? (JSON.parse(r.applied) as { partial?: true; adjustedUnknown?: true }) : {};
    const waiting = r.status === 'waiting';
    const begun = r.begun === 1;
    const mine = reader.own(r);
    return {
      id: r.id, kind: r.kind, person: r.person, payload: JSON.parse(r.payload) as SuggestionPayload,
      basis: reader.reviewer && r.basis ? (JSON.parse(r.basis) as Record<string, FactValue>) : null,
      current: (reader.reviewer && current.get(r.id)) || null,
      note: r.note, status: r.status,
      adjusted: r.status !== 'approved' ? false : applied.adjustedUnknown ? null : r.adjusted === 1,
      partial: applied.partial === true,
      reason: r.reason,
      author: { name: r.author_name, person: r.author_person, guest: r.guest_key !== null },
      createdAt: r.created_at, decidedAt: r.decided_at,
      files: filesOf.get(r.id) ?? [],
      mine,
      may: {
        withdraw: mine && waiting && !begun,
        approve: reader.reviewer && waiting,
        // An approval that changed records is finished by approving again, or closed as partly applied; never declined.
        decline: reader.reviewer && waiting && !begun,
        close: reader.reviewer && waiting && begun,
      },
    };
  });
}

/** The waiting suggestions, newest first, about one person when `person` is given (a reviewer's). */
export async function waitingSuggestions(tree: string, who: Who, o: { person?: string } = {}): Promise<SuggestionView[]> {
  needsReviewer(who);
  const where = `s.status = 'waiting'${o.person ? ' AND s.person = ?' : ''}`;
  return views(tree, where, o.person ? [o.person] : [], { reviewer: true, own: (r) => r.account === who.id });
}

/**
 * The suggester's own suggestions, newest first: the waiting ones, and those decided within EXPIRY_DAYS (not withdrawn
 * ones), about one person when `person` is given. A guest without a key has none.
 */
export async function mySuggestions(tree: string, by: SuggestionOwner, o: { person?: string; now?: Date } = {}): Promise<SuggestionView[]> {
  if (by.kind === 'member') needsMember(by.who);
  else if (!guestKey(by.key)) return [];
  const since = new Date((o.now ?? new Date()).getTime() - EXPIRY_DAYS * DAY_MS).toISOString();
  const parts = [
    by.kind === 'member' ? 's.account = ?' : 's.guest_key = ?',
    "s.status <> 'withdrawn'",
    "(s.status = 'waiting' OR coalesce(s.decided_at, s.created_at) > ?)",
  ];
  const params: (string | number)[] = [by.kind === 'member' ? by.who.id : by.key, since];
  if (by.kind === 'guest' && by.protectLiving) parts.push(NOT_LIVING);
  if (o.person) {
    parts.push('s.person = ?');
    params.push(o.person);
  }
  return views(tree, parts.join(' AND '), params, { reviewer: by.kind === 'member' && isReviewer(by.who), own: () => true });
}

/** How many suggestions wait, in all and per person they are about (a reviewer's: the navigation's and a person page's count). */
export async function suggestionCounts(tree: string, who: Who): Promise<{ total: number; people: Record<string, number> }> {
  needsReviewer(who);
  const rows = await db(tree).all<{ person: string | null; n: number }>("SELECT person, count(*) AS n FROM suggestion WHERE status = 'waiting' GROUP BY person");
  return {
    total: rows.reduce((n, r) => n + r.n, 0),
    people: Object.fromEntries(rows.filter((r) => r.person !== null).map((r) => [r.person!, r.n])),
  };
}

// ---------- files ----------

/** A stored file to serve: its media storage key, type and name. */
export interface ServedFile { key: string; mime: string; name: string }

/**
 * The pending file `id` if this reader may fetch it: a reviewer any waiting suggestion's, a suggester only their own waiting
 * suggestion's (a protecting link's guest none about someone living). Null for everyone else, as for no such file.
 */
export async function pendingFile(tree: string, reader: SuggestionOwner, id: string): Promise<ServedFile | null> {
  let who: string;
  const params: (string | number)[] = [id];
  if (reader.kind === 'member') {
    if (reader.who.guest || !reader.who.id) return null;
    if (isReviewer(reader.who)) who = '1';
    else {
      who = 's.account = ?';
      params.push(reader.who.id);
    }
  } else {
    if (!guestKey(reader.key)) return null;
    who = `s.guest_key = ?${reader.protectLiving ? ` AND ${NOT_LIVING}` : ''}`;
    params.push(reader.key);
  }
  const f = await db(tree).get<ServedFile>(
    `SELECT f.key, f.mime, f.name FROM suggestion_file f JOIN suggestion s ON s.id = f.suggestion WHERE f.id = ? AND s.status = 'waiting' AND ${who}`, ...params);
  return f ?? null;
}

/** The source's file `key` (without `source/`) if this reader may fetch it: a member, as sources are members'. Never a guest's. */
export async function sourceFile(tree: string, who: Who, key: string): Promise<ServedFile | null> {
  if (who.guest || !who.id || !SOURCE_FILE_KEY.test(key)) return null;
  const f = await db(tree).get<ServedFile>('SELECT media_key AS key, mime, name FROM source_file WHERE media_key = ? LIMIT 1', `${SOURCE_FILES}${key}`);
  return f ?? null;
}

/** RFC 5987's encoding of a name: what encodeURIComponent leaves, without the characters it may not hold. */
const rfc5987 = (s: string) => encodeURIComponent(s).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * The headers a suggestion's or a source's file is served with. An uploaded file must never run as a page, whatever is in
 * it (as research documents, src/routes/api/research.$tree.$key.ts): the type its bytes were checked to be, nosniff, a CSP
 * that loads nothing (a picture sandboxed; a PDF cannot be shown sandboxed, and cannot run as a page of this origin), and a
 * name with the extension of its type. `keep` lets the reader's own browser keep it for an hour; no shared cache may.
 */
export function fileHeaders(file: { mime: string; name: string }, o: { download: boolean; keep: boolean }): Record<string, string> {
  const ext = DOCUMENT_EXT[file.mime as DocumentMime];
  const mime = ext ? file.mime : 'application/octet-stream';
  const stem = file.name.replace(/\.[^.]*$/, '');
  const ascii = ext ? documentFileName(stem, file.mime as DocumentMime) : 'file';
  const full = `${stem.replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, 120) || 'file'}${ext ? `.${ext}` : ''}`;
  const pdf = isPdf(mime);
  return {
    'Content-Type': mime,
    'Content-Disposition': `${o.download || !ext ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${rfc5987(full)}`,
    'Cache-Control': o.keep ? 'private, max-age=3600' : 'private, no-store',
    Vary: 'Cookie',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': pdf ? "default-src 'none'; style-src 'unsafe-inline'; object-src 'self'; frame-ancestors 'self'" : "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'X-Frame-Options': pdf ? 'SAMEORIGIN' : 'DENY',
  };
}
