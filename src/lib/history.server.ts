// The family's change history (tree migration 0026): what every change to the family's records wrote, and who made it.
//
// Writing. Every change goes through `once` (db.server.ts), and every plan says what it did to the family's records in
// `history`: a list of entries (`added`, `removed`, `change` below build them), or NOT_A_RECORD for a change that touches
// none (the Campaign, a cache). `once` turns the entries into rows in the same batch as the change, so a change cannot be
// written without its row, and a plan that names no history, or calls a write of the family's records NOT_A_RECORD, is
// refused before anything is written (`checkHistory`). The type makes `history` required, so a new change cannot forget it.
//
// What a row keeps. Who (the account and the name shown then), what kind of record, which one, the person it is about,
// added, changed or removed, and for a change only the fields that changed, before and after, cut short and capped
// (`MAX_VALUE`, `MAX_FIELDS_JSON`). Never a picture or a document; a picture, the arms or a portrait's look are kept as
// "changed" without their content. Saves of the same record by the same person within ten minutes are one row (an autosave
// writes at every pause in typing), and a change that ends where it started leaves no row.
//
// Who reads a row. The same three levels as a person's fields (visibility.ts): `family` for every member, `editors` for
// editors and stewards, `personal` for its owner alone. A Personal field's row is personal and never carries its content.
// Private research is `editors`. A value only editors may read inside a family row (a source's link to a private document)
// is held back from everyone else. A share-link guest reads no history at all.
import { accounts } from './auth/store.server.ts';
import { isDemo } from './demo.ts';
import { can } from './roles.ts';
import { guard, q, type Db, type Query } from './store/index.ts';
import type { Audience, Visibility } from './visibility.ts';
import {
  HISTORY_FILTERS, isRestorable, type HistoryAction, type HistoryFieldChange, type HistoryFilter, type HistoryItem, type HistoryKind,
  type HistoryPage, type HistoryValue, type WhatsNew, type WhatsNewGroup, type WhatsNewLine, type WhatsNewReply,
} from './history.ts';

// ---------- what a plan says ----------

/** A plan that writes nothing of the family's records says so with this (the Campaign, translations, caches). */
export const NOT_A_RECORD = 'not-a-record' as const;

/** The changed fields of one row: `f` maps a field to [before, after]; `t` were cut short, `o` keep no content, `e` are for editors. */
export interface Diff { f: Record<string, [HistoryValue, HistoryValue]>; t?: string[]; o?: string[]; e?: string[] }

/** One row a change writes. */
export interface HistoryEntry {
  kind: HistoryKind;
  record: string;
  action: HistoryAction;
  /** The person the change is about. Their name is read by `once` unless given (give it for a person being added or removed). */
  person?: string | null;
  personName?: string | null;
  label?: string | null;
  level?: Visibility;
  /** The account a personal row belongs to. */
  owner?: string | null;
  diff?: Diff | null;
  count?: number;
  /** False keeps this row apart from an earlier save of the same record (a restore is always its own row). */
  fold?: boolean;
}

/** What a plan says about the family's records: the rows to write (possibly none, when nothing a reader would call a change happened), or NOT_A_RECORD. */
export type HistoryOf = readonly HistoryEntry[] | typeof NOT_A_RECORD;

type Extra = Partial<Omit<HistoryEntry, 'kind' | 'record' | 'action' | 'diff'>>;

/** A record added. */
export const added = (kind: HistoryKind, record: string, extra: Extra = {}): HistoryEntry => ({ kind, record, action: 'added', ...extra });
/** A record removed. Give its label and person's name: after the batch they are gone. */
export const removed = (kind: HistoryKind, record: string, extra: Extra = {}): HistoryEntry => ({ kind, record, action: 'removed', ...extra });

/**
 * A record changed: the fields of `after` that differ from `before` (fields not in `after` are not compared, so a partial
 * update passes only what it writes). Nothing when nothing differs. `opaque` fields are recorded as changed without their
 * content; `editors` fields keep their values for editors and stewards only.
 */
export function change(kind: HistoryKind, record: string, before: Record<string, unknown>, after: Record<string, unknown>, extra: Extra & { opaque?: readonly string[]; editors?: readonly string[] } = {}): HistoryEntry[] {
  const { opaque = [], editors = [], ...rest } = extra;
  const diff = diffOf(before, after, opaque, editors);
  return diff ? [{ kind, record, action: 'changed', diff, ...rest }] : [];
}

// ---------- keeping it small ----------

/** The longest value kept, in characters; a longer one is cut and marked. */
export const MAX_VALUE = 400;
/** The most a row's fields may take, as JSON. Beyond it the largest values are kept as "changed" without content. */
export const MAX_FIELDS_JSON = 4000;
/** Saves of one record by one person within this long are one row. */
export const MERGE_MS = 10 * 60_000;

const same = (a: unknown, b: unknown) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
const norm = (v: unknown): unknown => (v === undefined || v === '' ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

/** A value as a row keeps it, and whether it was cut. */
function cell(v: unknown): [HistoryValue, boolean] {
  const n = norm(v);
  if (n === null || typeof n === 'number') return [n as HistoryValue, false];
  const s = typeof n === 'string' ? n : JSON.stringify(n);
  return s.length > MAX_VALUE ? [`${s.slice(0, MAX_VALUE)}…`, true] : [s, false];
}

function diffOf(before: Record<string, unknown>, after: Record<string, unknown>, opaque: readonly string[], editors: readonly string[]): Diff | null {
  const diff: Diff = { f: {} };
  for (const k of Object.keys(after)) {
    if (same(before[k], after[k])) continue;
    if (opaque.includes(k)) {
      diff.f[k] = [null, null];
      (diff.o ??= []).push(k);
      continue;
    }
    const [b, cutB] = cell(before[k]);
    const [a, cutA] = cell(after[k]);
    diff.f[k] = [b, a];
    if (cutB || cutA) (diff.t ??= []).push(k);
    if (editors.includes(k)) (diff.e ??= []).push(k);
  }
  return Object.keys(diff.f).length ? fit(diff) : null;
}

/** Caps a row's fields: while the JSON is too large, the largest value left is kept as "changed" without content. */
function fit(diff: Diff): Diff {
  while (JSON.stringify(diff).length > MAX_FIELDS_JSON) {
    const [name] = Object.entries(diff.f)
      .filter(([k]) => !diff.o?.includes(k))
      .sort((x, y) => JSON.stringify(y[1]).length - JSON.stringify(x[1]).length)[0] ?? [];
    if (!name) break;
    diff.f[name] = [null, null];
    (diff.o ??= []).push(name);
    diff.t = diff.t?.filter((k) => k !== name);
  }
  return diff;
}

/** Two changes to one record as one: the first's before, the second's after. Null when it ends where it started. */
export function mergeDiffs(first: Diff, next: Diff): Diff | null {
  const out: Diff = { f: { ...first.f } };
  const union = (a?: string[], b?: string[]) => [...new Set([...(a ?? []), ...(b ?? [])])];
  const o = union(first.o, next.o), t = union(first.t, next.t), e = union(first.e, next.e);
  for (const [k, [b, a]] of Object.entries(next.f)) out.f[k] = [k in first.f ? first.f[k]![0] : b, a];
  for (const [k, [b, a]] of Object.entries(out.f)) if (!o.includes(k) && !t.includes(k) && same(b, a)) delete out.f[k];
  const keep = (list: string[]) => list.filter((k) => k in out.f);
  if (keep(o).length) out.o = keep(o);
  if (keep(t).length) out.t = keep(t);
  if (keep(e).length) out.e = keep(e);
  return Object.keys(out.f).length ? fit(out) : null;
}

// ---------- who ----------

/** Who makes a change: an account and the name it shows, or Kindred itself (account null) for a daily job or a script. */
export interface Actor { account: string | null; name: string }
export const KINDRED: Actor = { account: null, name: '' };

let actorSource: ((tree: string) => Actor | undefined) | undefined;
let fixedActor: Actor | undefined;
/** Set by the permission checks (auth/guard.server.ts), which know who the request is. */
export const onActor = (fn: (tree: string) => Actor | undefined) => { actorSource = fn; };
/** Makes every change from now on this actor's, until called with undefined. For tests and scripts, which have no request. */
export const actingAs = (a: Actor | undefined) => { fixedActor = a; };

export function currentActor(tree: string): Actor {
  if (fixedActor) return fixedActor;
  try {
    return actorSource?.(tree) ?? KINDRED;
  } catch {
    return KINDRED;
  }
}

// ---------- the check in `once` ----------

/** The tables that hold the family's records. A write to any of them needs history. */
export const RECORD_TABLES = new Set([
  'meta', 'house', 'house_succession', 'house_meaning', 'person', 'parent', 'partnership', 'story', 'place', 'photo', 'person_field',
  'album', 'media', 'media_person', 'portrait', 'life_event', 'source', 'citation', 'research_project', 'research_document',
  'research_note', 'research_picture', 'research_person', 'research_place',
]);

const WRITE = /^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM)\s+["`[]?(\w+)/i;

/** The tables a list of statements writes to (reads and guards are not writes). */
export function tablesWritten(writes: readonly Query[]): string[] {
  return [...new Set(writes.map((w) => WRITE.exec(w.sql)?.[1]?.toLowerCase()).filter((t): t is string => !!t && t !== 'guard'))];
}

/**
 * Refuses a plan that writes without saying what it did to the family's records, or that calls a write of them
 * NOT_A_RECORD. Throws before anything is written: this is a mistake in the code, never in what a reader sent.
 */
export function checkHistory(fn: string, writes: readonly Query[], history: HistoryOf | undefined): void {
  const tables = tablesWritten(writes);
  if (!tables.length) return;
  // Codes, not sentences: no reader can cause these, only a change written without its history.
  if (history === undefined) throw new Error(`history.missing:${fn}`);
  const records = tables.filter((t) => RECORD_TABLES.has(t));
  if (history === NOT_A_RECORD && records.length) throw new Error(`history.not_a_record:${fn}:${records.join(',')}`);
}

// ---------- the rows, for the batch ----------

const PERSON_NAME = 'trim(coalesce(current_given, given) || \' \' || coalesce(coalesce(current_surname, surname), \'\'))';
const iso = (ms: number) => new Date(ms).toISOString();

interface StoredRow {
  id: number; at: string; account: string | null; name: string; kind: HistoryKind; record: string; person: string | null; person_name: string | null;
  label: string | null; action: HistoryAction; level: Visibility; owner: string | null; fields: string | null; count: number; fn: string;
}

/**
 * The statements that write a change's history rows, decided on reads like the change itself: the names of the people
 * it is about, and the row an earlier save of the same record by the same person may be folded into (`MERGE_MS`). A
 * folded row is guarded on what was read, so two saves racing make the plan decide again rather than lose a change.
 */
export async function historyWrites(d: Db, fn: string, actor: Actor, entries: readonly HistoryEntry[], now = Date.now()): Promise<Query[]> {
  if (!entries.length) return [];
  const needNames = [...new Set(entries.filter((e) => e.person && e.personName === undefined).map((e) => e.person!))];
  const merging = actor.account ? entries.filter((e) => e.fold !== false && e.action === 'changed' && (e.diff || e.level === 'personal')).slice(0, 20) : [];
  const reads: Query[] = [];
  if (needNames.length) reads.push(q(`SELECT id, ${PERSON_NAME} AS name FROM person WHERE id IN (${needNames.map(() => '?').join(', ')})`, ...needNames));
  for (const e of merging) reads.push(q('SELECT * FROM history WHERE kind = ? AND record = ? ORDER BY id DESC LIMIT 1', e.kind, e.record));
  const results = reads.length ? await d.readBatch(reads) : [];
  const names = new Map((needNames.length ? (results.shift() as { id: string; name: string }[]) : []).map((r) => [r.id, r.name]));
  const latest = new Map(merging.map((e, i) => [e, results[i]?.[0] as unknown as StoredRow | undefined]));

  const at = iso(now);
  const out: Query[] = [];
  for (const e of entries) {
    const level = e.level ?? 'family';
    const owner = level === 'personal' ? (e.owner ?? actor.account) : null;
    if (level === 'personal' && !owner) continue; // a personal row with nobody to read it is no row
    const diff = level === 'personal' ? null : (e.diff ?? null);
    const personName = e.person ? (e.personName ?? names.get(e.person) ?? (e.kind === 'person' ? e.label : null) ?? null) : null;
    const prev = latest.get(e);
    if (prev && prev.account === actor.account && prev.action === 'changed' && prev.level === level && prev.owner === owner
      && now - Date.parse(prev.at) < MERGE_MS && (level === 'personal' || (diff && prev.fields))) {
      out.push(guard('EXISTS (SELECT 1 FROM history WHERE id = ? AND fields IS ? AND id = (SELECT max(id) FROM history WHERE kind = ? AND record = ?))', prev.id, prev.fields, e.kind, e.record));
      if (level === 'personal') {
        out.push(q('UPDATE history SET at = ?, fn = ? WHERE id = ?', at, fn, prev.id));
        continue;
      }
      const merged = mergeDiffs(JSON.parse(prev.fields!) as Diff, diff!);
      out.push(merged
        ? q('UPDATE history SET at = ?, fields = ?, label = ?, person_name = ?, fn = ? WHERE id = ?', at, JSON.stringify(merged), e.label ?? prev.label, personName ?? prev.person_name, fn, prev.id)
        : q('DELETE FROM history WHERE id = ?', prev.id));
      continue;
    }
    if (e.action === 'changed' && level !== 'personal' && !diff) continue;
    out.push(q(
      'INSERT INTO history (at, account, name, kind, record, person, person_name, label, action, level, owner, fields, count, fn) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      at, actor.account, actor.name, e.kind, e.record, e.person ?? null, personName, e.label ?? null, e.action, level, owner,
      diff ? JSON.stringify(diff) : null, Math.max(1, Math.round(e.count ?? 1)), fn,
    ));
  }
  return out;
}

// ---------- reading ----------

/** A SQL condition on `history` for the rows this audience may read, and its parameters. A guest matches nothing. */
export function historyVisibleTo(a: Audience): { sql: string; params: string[] } {
  if (a.guest || !a.role) return { sql: '0', params: [] };
  const parts = ["level = 'family'"];
  const params: string[] = [];
  if (can(a.role, 'edit-person')) parts.push("level = 'editors'");
  if (a.account) {
    parts.push("(level = 'personal' AND owner = ?)");
    params.push(a.account);
  }
  return { sql: `(${parts.join(' OR ')})`, params };
}

/** The same rule for a row in hand. */
export function mayReadRow(a: Audience, r: { level: string; owner: string | null }): boolean {
  if (a.guest || !a.role) return false;
  if (r.level === 'family') return true;
  if (r.level === 'editors') return can(a.role, 'edit-person');
  return r.level === 'personal' && !!a.account && r.owner === a.account;
}

const keyCache = new Map<string, string>();
/** A stable key for an author within one family, so the filter never sends an account id to the browser. */
export async function authorKey(tree: string, account: string): Promise<string> {
  const id = `${tree}\n${account}`;
  let k = keyCache.get(id);
  if (!k) {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`kindred-history\n${id}`)));
    k = [...h.slice(0, 8)].map((x) => x.toString(16).padStart(2, '0')).join('');
    if (keyCache.size > 5000) keyCache.clear();
    keyCache.set(id, k);
  }
  return k;
}

/** A stored row as this reader may see it. The caller has checked `mayReadRow`. */
export async function itemOf(tree: string, a: Audience, r: StoredRow): Promise<HistoryItem> {
  const editor = !!a.role && can(a.role, 'edit-person');
  const diff = r.fields ? (JSON.parse(r.fields) as Diff) : null;
  const fields: HistoryFieldChange[] = diff
    ? Object.entries(diff.f).map(([name, [before, after]]) => {
      const opaque = diff.o?.includes(name);
      const hidden = !editor && diff.e?.includes(name);
      return {
        name,
        before: hidden || opaque ? null : before,
        after: hidden || opaque ? null : after,
        ...(hidden ? { hidden: true as const } : {}),
        ...(opaque ? { opaque: true as const } : {}),
        ...(diff.t?.includes(name) && !hidden ? { truncated: true as const } : {}),
      };
    })
    : [];
  return {
    id: r.id, at: r.at, author: r.name, authorKey: r.account ? await authorKey(tree, r.account) : null, byMe: !!a.account && r.account === a.account,
    kind: r.kind, record: r.record, person: r.person, personName: r.person_name, label: r.label, action: r.action, count: r.count, fields,
    restorable: editor && r.kind === 'person' && r.action === 'changed' && r.level === 'family'
      ? fields.filter((f) => isRestorable(f.name) && !f.opaque && !f.truncated && !f.hidden).map((f) => f.name)
      : [],
  };
}

export const HISTORY_PAGE = 50;

export interface HistoryQuery { person?: string; filter?: HistoryFilter; author?: string; before?: number; limit?: number }

/** The family's history, newest first, as this reader may see it, filtered by person, kind and author, a page at a time. */
export async function historyPage(tree: string, d: Db, a: Audience, o: HistoryQuery = {}): Promise<HistoryPage> {
  const vis = historyVisibleTo(a);
  if (vis.sql === '0') return { items: [], next: null, authors: [] };
  const limit = Math.min(Math.max(o.limit ?? HISTORY_PAGE, 1), 200);
  const where = [vis.sql];
  const params: (string | number)[] = [...vis.params];
  if (o.person) { where.push('person = ?'); params.push(o.person); }
  if (o.filter) {
    const kinds = HISTORY_FILTERS[o.filter];
    where.push(`kind IN (${kinds.map(() => '?').join(', ')})`);
    params.push(...kinds);
  }
  if (o.before) { where.push('id < ?'); params.push(o.before); }
  const [accountRows] = await d.readBatch([q(`SELECT DISTINCT account FROM history WHERE ${vis.sql} AND account IS NOT NULL`, ...vis.params)]);
  const accountsSeen = (accountRows as { account: string }[]).map((r) => r.account);
  const keyed = await Promise.all(accountsSeen.map(async (acc) => [await authorKey(tree, acc), acc] as const));
  if (o.author) {
    const acc = keyed.find(([k]) => k === o.author)?.[1];
    if (o.author === 'kindred') where.push('account IS NULL');
    else if (!acc) return { items: [], next: null, authors: await authorsOf(tree, d, a) };
    else { where.push('account = ?'); params.push(acc); }
  }
  const rows = await d.all<StoredRow>(`SELECT * FROM history WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`, ...params, limit + 1);
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  return {
    items: await Promise.all(page.map((r) => itemOf(tree, a, r))),
    next: more ? page[page.length - 1]!.id : null,
    authors: await authorsOf(tree, d, a),
  };
}

/** Everyone who changed something this reader may see, with the name they had most recently. */
async function authorsOf(tree: string, d: Db, a: Audience): Promise<{ key: string; name: string }[]> {
  const vis = historyVisibleTo(a);
  const rows = await d.all<{ account: string; name: string }>(
    `SELECT account, name FROM history WHERE id IN (SELECT max(id) FROM history WHERE ${vis.sql} AND account IS NOT NULL GROUP BY account) ORDER BY name`,
    ...vis.params,
  );
  return Promise.all(rows.map(async (r) => ({ key: await authorKey(tree, r.account), name: r.name })));
}

/** One row, if this reader may read it. */
export async function historyRow(d: Db, a: Audience, id: number): Promise<StoredRow | undefined> {
  const r = await d.get<StoredRow>('SELECT * FROM history WHERE id = ?', id);
  return r && mayReadRow(a, r) ? r : undefined;
}

// ---------- what's new ----------

/** The most rows "What's new" groups. Older news beyond it is on the History page. */
const NEWS_ROWS = 1000;

/**
 * What changed since `since` that this reader may see, made by someone else, grouped by the person it is about (the family
 * as a whole last), each group's lines one per author, kind and action. Plus comments and reactions on what the reader
 * wrote, when the family has them.
 */
export async function whatsNew(d: Db, a: Audience, since: number, first = false): Promise<WhatsNew> {
  const vis = historyVisibleTo(a);
  const empty: WhatsNew = { since: iso(since), first, groups: [], replies: [], total: 0 };
  if (vis.sql === '0') return empty;
  const rows = await d.all<StoredRow>(
    `SELECT * FROM history WHERE ${vis.sql} AND at > ? AND account IS NOT ? ORDER BY id DESC LIMIT ?`,
    ...vis.params, iso(since), a.account, NEWS_ROWS,
  );
  const groups = new Map<string, WhatsNewGroup & { records: Map<string, Set<string>> }>();
  for (const r of rows) {
    const key = r.person ?? '';
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { person: r.person, name: r.person_name, lines: [], records: new Map() }));
    const lineKey = `${r.name}\n${r.kind}\n${r.action}`;
    let line = g.lines.find((l) => `${l.author}\n${l.kind}\n${l.action}` === lineKey);
    if (!line) g.lines.push((line = { author: r.name, kind: r.kind, action: r.action, count: 0, label: r.label } satisfies WhatsNewLine));
    // A change counts each record once, however many saves it took; an addition or a removal counts what it stands for.
    let records = g.records.get(lineKey);
    if (!records) g.records.set(lineKey, (records = new Set()));
    if (r.action === 'changed') {
      if (!records.has(r.record)) line.count += 1;
    } else line.count += r.count;
    records.add(r.record);
    if (records.size > 1) line.label = null;
  }
  const ordered = [...groups.values()].sort((x, y) => (x.person === null ? 1 : 0) - (y.person === null ? 1 : 0));
  return {
    ...empty,
    groups: ordered.map(({ person, name, lines }) => ({ person, name, lines })),
    replies: a.account ? await repliesTo(d, a.account, since) : [],
    total: rows.length,
  };
}

/**
 * Comments and reactions since `since` on what this account wrote: the stories it added (by its history rows, or by its
 * name for stories older than history) and the photos it uploaded. A reader's own comments and reactions are not news
 * to them. `created_at` is ISO text in both tables (tree migration 0027).
 */
export async function repliesTo(d: Db, account: string, since: number): Promise<WhatsNewReply[]> {
  const mine = `((x.target_kind = 'media' AND x.target IN (SELECT key FROM media WHERE uploaded_by = ?))
    OR (x.target_kind = 'story' AND (x.target IN (SELECT id FROM story WHERE author_account = ?)
      OR x.target IN (SELECT record FROM history WHERE kind = 'story' AND action = 'added' AND account = ?))))`;
  const after = iso(since);
  const [comments, reactions] = (await d.readBatch([
    q(`SELECT x.target_kind, x.target, max(x.author_name) AS author, count(*) AS n FROM comment x
       WHERE x.account IS NOT ? AND x.created_at > ? AND ${mine} GROUP BY x.target_kind, x.target LIMIT 50`,
      account, after, account, account, account),
    q(`SELECT x.target_kind, x.target, count(*) AS n FROM reaction x
       WHERE x.account IS NOT ? AND x.created_at > ? AND ${mine} GROUP BY x.target_kind, x.target LIMIT 50`,
      account, after, account, account, account),
  ])) as [
    { target_kind: 'story' | 'media'; target: string; author: string | null; n: number }[],
    { target_kind: 'story' | 'media'; target: string; n: number }[],
  ];
  const out: WhatsNewReply[] = [
    ...comments.map((r): WhatsNewReply => ({ kind: 'comment', target: r.target_kind, id: r.target, label: null, person: null, author: r.author ?? '', count: r.n })),
    ...reactions.map((r): WhatsNewReply => ({ kind: 'reaction', target: r.target_kind, id: r.target, label: null, person: null, author: '', count: r.n })),
  ];
  if (!out.length) return out;
  const stories = out.filter((r) => r.target === 'story').map((r) => r.id);
  const photos = out.filter((r) => r.target === 'media').map((r) => r.id);
  const marks = (xs: string[]) => xs.map(() => '?').join(', ');
  const [storyRows, photoRows] = await d.readBatch([
    q(`SELECT id, person, coalesce(title, '') AS label FROM story WHERE id IN (${marks(stories) || "''"})`, ...stories),
    q(`SELECT key AS id, coalesce(caption, '') AS label FROM media WHERE key IN (${marks(photos) || "''"})`, ...photos),
  ]);
  const byStory = new Map((storyRows as { id: string; person: string; label: string }[]).map((r) => [r.id, r]));
  const byPhoto = new Map((photoRows as { id: string; label: string }[]).map((r) => [r.id, r]));
  for (const r of out) {
    const s = r.target === 'story' ? byStory.get(r.id) : undefined;
    const p = r.target === 'media' ? byPhoto.get(r.id) : undefined;
    r.label = (s?.label || p?.label) || null;
    r.person = s?.person ?? null;
  }
  // A comment on something since removed is no news.
  return out.filter((r) => (r.target === 'story' ? byStory.has(r.id) : byPhoto.has(r.id)));
}

/** How many changes since `after` this reader may see, made by someone else (at most `cap`): the menu's dot. */
export async function newsCount(d: Db, a: Audience, after: number, cap = 99): Promise<number> {
  const vis = historyVisibleTo(a);
  if (vis.sql === '0') return 0;
  const r = await d.get<{ n: number }>(
    `SELECT count(*) AS n FROM (SELECT 1 FROM history WHERE ${vis.sql} AND at > ? AND account IS NOT ? LIMIT ?)`,
    ...vis.params, iso(after), a.account, cap,
  );
  return r?.n ?? 0;
}

// ---------- since your last visit (accounts migration 0026) ----------

/** No opening of the family for this long ends a visit. */
export const VISIT_GAP = 2 * 3_600_000;
/** Opening the family again within this long writes nothing. */
const TOUCH_MS = 60_000;
/** A first visit's news covers this long. */
export const FIRST_LOOK = 14 * 86_400_000;
/** News is never older than this, however long someone was away. */
export const MAX_LOOK = 90 * 86_400_000;

export interface Visit { since: number; shown: number | null; lastSeen: number; /** 1 during the first visit; 0 when unknown (from before it was counted). */ visits: number }

/**
 * Notes that a member opened the family. The rule, in one statement so two requests cannot disagree:
 * - The first time, the news starts FIRST_LOOK ago, and `visits` is 1; each new visit counts one more.
 * - A visit ends after VISIT_GAP without opening the family. When a new one starts, `since` moves up to `shown`, the last
 *   time "What's new" or the History page showed this member the news, and never further: news that came after they last
 *   looked stays news, and so does everything when they never looked.
 * - During a visit `since` stays where it is, so opening the page twice in a minute shows the same news.
 */
export async function noteVisit(user: string, tree: string, now = Date.now()): Promise<void> {
  if (isDemo()) return; // a demo has no members and stores nothing
  await accounts().run(
    `INSERT INTO family_visit (user, tree, since, shown, last_seen, visits) VALUES (?, ?, ?, NULL, ?, 1)
     ON CONFLICT (user, tree) DO UPDATE SET
       since = CASE WHEN ? - family_visit.last_seen > ? AND family_visit.shown IS NOT NULL AND family_visit.shown > family_visit.since
                    THEN family_visit.shown ELSE family_visit.since END,
       visits = CASE WHEN ? - family_visit.last_seen > ? AND family_visit.visits > 0 THEN family_visit.visits + 1 ELSE family_visit.visits END,
       last_seen = ?
     WHERE ? - family_visit.last_seen > ?`,
    user, tree, now - FIRST_LOOK, now, now, VISIT_GAP, now, VISIT_GAP, now, now, TOUCH_MS,
  );
}

/** The member's visit, after `noteVisit`. */
export async function visitOf(user: string, tree: string): Promise<Visit | undefined> {
  const r = await accounts().get<{ since: number; shown: number | null; last_seen: number; visits: number }>('SELECT since, shown, last_seen, visits FROM family_visit WHERE user = ? AND tree = ?', user, tree);
  return r && { since: r.since, shown: r.shown, lastSeen: r.last_seen, visits: r.visits };
}

/** The news up to `now` has been shown to this member. Only moves forward. */
export async function markShown(user: string, tree: string, now = Date.now()): Promise<void> {
  if (isDemo()) return;
  await accounts().run('UPDATE family_visit SET shown = ? WHERE user = ? AND tree = ? AND (shown IS NULL OR shown < ?)', now, user, tree, now);
}

/** Where a member's news starts: their visit's `since`, but never more than MAX_LOOK ago. */
export const newsSince = (v: Visit | undefined, now = Date.now()) => Math.max(v?.since ?? now - FIRST_LOOK, now - MAX_LOOK);

// ---------- keeping ----------

/** How long history is kept by default, in years (KINDRED_HISTORY_YEARS; 0 keeps it for ever). */
export const KEEP_YEARS = 3;

export function keepYears(read: (name: string) => string | undefined): number {
  const raw = read('KINDRED_HISTORY_YEARS');
  if (raw === undefined) return KEEP_YEARS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : KEEP_YEARS;
}

/** Deletes a family's history older than `years`. Returns how many rows went. */
export async function pruneHistory(d: Db, years: number, now = Date.now()): Promise<number> {
  if (years <= 0) return 0;
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - Math.floor(years));
  cutoff.setUTCDate(cutoff.getUTCDate() - Math.round((years % 1) * 365));
  return (await d.run('DELETE FROM history WHERE at < ?', cutoff.toISOString())).changes;
}
