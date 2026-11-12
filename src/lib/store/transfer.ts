// What a family's records are when they leave its database, and how they travel: which tables are the family's (copied
// by the D1 transfer, the move into a Durable Object and a steward's backup) and which are left out, and the rows as data
// (a table, its columns and plain values), never as SQL. Shared by the Worker (src/lib/store/move.server.ts, the backup
// route) and the scripts (scripts/lib/d1-transfer.ts, scripts/import-to-do.ts). No Node or Worker APIs here.
/**
 * Every table a family's data lives in, in the order its foreign keys need: a row is only written after the row it
 * refers to. A table added by a migration must be listed here, or the transfer refuses (see `planTables`).
 */
export const COPIED_TABLES: readonly string[] = [
  'meta', // the family's name, theme and starting point
  'house', // houses: person.house refers to them
  'person', // people: nearly every other table refers to them
  'parent', // parent links
  'partnership', // marriages and other unions
  'story', // memories, notes, quotes and recipes
  'story_translation', // chronicle translations, kept beside each story (migration 0014): asked for once, so copied after their story
  'place', // map pins for the atlas
  'photo', // portraits: the row keeps a media key, the picture itself is in R2
  'person_field', // the Edit tab's fields: contacts, medical and editors' notes, in their order (not the personal ones, see below)
  'house_succession', // who heads each house, its heir and its country
  'house_meaning', // what each house's name means, as the steward researched and chose it (migration 0012)
  'house_arms_review', // the steward's latest check of each house's arms against its name (migration 0012)
  'house_translation', // AI translations of the name meanings and the arms check, kept beside them (migration 0019): asked for once, so copied after their house
  'album', // gallery albums
  'media', // gallery pictures: the row keeps a media key, the picture is in R2
  'media_person', // face boxes and the people tagged in gallery pictures
  'portrait', // painted portraits (migration 0013): candidates and each person's accepted one; the picture is in media (portrait/)
  'occupation_translation', // cached translations of occupations, per text and locale (asked for once, so copied)
  'research_project', // the Research page's projects (migration 0017)
  'research_document', // a project's documents: the row keeps a media key, the file is in R2 (research/)
  'research_note', // a project's notes
  'research_picture', // gallery pictures linked to a project (after media)
  'research_person', // people linked to a project (after person)
  'research_place', // Atlas places linked to a project (after place)
  'life_event', // a person's life events (migration 0024), after person
  'source', // the family's sources, after research_document and media, which a source may link to
  'citation', // a source cited for a fact, after source and every fact it may name: person, parent, partnership, life_event
  // Reactions and comments on stories and gallery photos (migration 0027), after both. They name accounts, which are not
  // copied: a comment keeps the name it was written under, and a reaction still counts, though nobody on the target owns it.
  'reaction',
  'comment',
  'today_week', // the weeks a steward asked their own question of the week, or none (migration 0028)
  'today_answer', // which week's question a memory answers, after story
  // The family's feed (migration 0029): posts, their pictures and the people they are about, after person and media. A post
  // names its writer's account, which is not copied, and keeps the name and the person it was written under, so on the
  // target it reads as before; nobody there can change it, and an editor can remove it.
  'post',
  'post_media',
  'post_person',
  // Recipes (migration 0031): what makes a story a structured recipe, after story, and its pictures: the rows keep media
  // keys, the pictures are in R2 (recipe/, and the covers' small copies in recipe-thumb/).
  'recipe',
  'recipe_image',
];

/**
 * Tables left out on purpose. They are bookkeeping about the copy, not the family, and the target keeps its own.
 * `op` holds the retry keys of changes already sent, which expire after 30 days and mean nothing on another database.
 * `d1_migrations` is wrangler's record of the schema the target already has from `migrations apply`.
 */
export const LEFT_OUT_TABLES: Record<string, string> = {
  op: 'retry keys of changes already sent; they expire after 30 days',
  d1_migrations: "wrangler's record of the migrations applied to the target",
  // The ancestry revision (migration 0011) counts changes to parent links on whichever database holds them. The copy's
  // parent rows bump the target's own counter as they are written, and the import guards only that the number it read
  // is still the one in the batch, so the target keeps its own (seeded at 0) rather than receiving the source's.
  ancestry_rev: 'the ancestry revision counts changes on the database that holds the links; the target keeps its own',
  // The Campaign (migration 0025) is a game, not part of the family's records, and it names members by their account ids,
  // which are not copied. The target starts with the game off and an empty hall of fame.
  campaign: 'the game\'s switch and season number; the target starts with the game off',
  campaign_season: 'the game\'s seasons and hall of fame; not part of the family\'s records',
  campaign_member: 'the game\'s orders, keyed by account ids, which are not copied',
  campaign_log: 'the game\'s chronicle, which names accounts',
  campaign_push: 'the game\'s push claims, keyed by account ids',
  // The Campaign's reigns (migration 0032) are a game's scores, keyed by account ids, which are not copied.
  campaign_run: 'the game\'s reigns and their scores, keyed by account ids, which are not copied',
  // The week's field (migration 0034) is the game's too; the target plays fresh weeks of its own.
  campaign_week: 'the game\'s field of each week; the target plays weeks of its own',
  // The change history (migration 0026) names members by their account ids, which are not copied, and its personal rows
  // would have no one to show them to. The target starts its own history.
  history: 'the change history, which names accounts; the target starts its own',
  response_push: 'members\' choice of a push about answers to what they wrote, keyed by account ids, which are not copied',
  // The daily quiz (migration 0028) is a game too: its answers are keyed by account ids, which are not copied, and a day's
  // question is drawn again from the records on the target. The quiz starts switched on there, as in a new family.
  today_settings: 'the switch for the daily quiz; the target starts with the quiz on',
  quiz_day: 'the quiz questions already drawn; the target draws its own from the records',
  quiz_answer: 'the quiz answers and streaks, keyed by account ids, which are not copied',
  // "Who is this?" (migration 0033): proposals and passes are the game's, keyed by account ids, which are not copied. A
  // confirmed proposal is already a tag in `media_person`, which is copied with its `named_by`.
  tag_proposal: 'the "Who is this?" proposals, keyed by account ids, which are not copied; confirmed ones are tags already',
  tag_pass: 'the pictures a member passed on in "Who is this?", keyed by account ids',
};

/**
 * Rows a copied table holds back, as a SQL condition on the rows that go. A personal field belongs to one account, and
 * accounts are not copied (docs/deploy-cloudflare.md): on the target its owner would not exist, so nobody could ever see or
 * remove it. It stays in the source database.
 */
export const COPY_ONLY: Record<string, string> = { person_field: "visibility <> 'personal'" };

export interface TablePlan {
  /** The tables whose rows are copied, in order. */
  copy: string[];
  /** The tables present in the copy and left out on purpose. */
  leftOut: string[];
}

/**
 * Decides which of a migrated copy's tables are copied. Refuses (throws) when a table has no decision, or when a
 * table the transfer copies is missing, so a new migration cannot be left behind silently.
 */
export function planTables(present: string[]): TablePlan {
  const names = new Set(present);
  const unknown = present.filter((t) => !t.startsWith('sqlite_') && !COPIED_TABLES.includes(t) && !Object.hasOwn(LEFT_OUT_TABLES, t));
  if (unknown.length) {
    throw new Error(`No decision for the table${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')}: add ${unknown.length > 1 ? 'them' : 'it'} to COPIED_TABLES or LEFT_OUT_TABLES in scripts/lib/d1-transfer.ts.`);
  }
  const missing = COPIED_TABLES.filter((t) => !names.has(t));
  if (missing.length) throw new Error(`The copy has no ${missing.join(', ')} table: is it migrated to the current schema?`);
  return {
    copy: [...COPIED_TABLES],
    leftOut: present.filter((t) => Object.hasOwn(LEFT_OUT_TABLES, t)).sort(),
  };
}

// ---------- rows as data ----------

/** One value of a row as it travels in JSON: text, a number, NULL, or a BLOB as base64. */
export type Cell = string | number | null | { b64: string };
/** Some rows of one table: the column names, and each row's values in that order. */
export interface TableRows { table: string; columns: string[]; rows: Cell[][] }

/** Tables that are the target's own and never receive rows: SQLite's, Cloudflare's and wrangler's migration record. */
export const NOT_IMPORTED = /^(sqlite_|_cf_|d1_migrations$)/;
/** Table and column names: plain identifiers, so they can be quoted safely once checked against the schema. */
export const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
/** Tables a migration seeds with a row (db.ts SEEDED_TABLES): an imported row replaces the seed instead of clashing. */
const SEEDED = new Set(['ancestry_rev']);

const toBase64 = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** A value read from SQLite, as a cell. A bigint beyond a safe number is refused rather than rounded. */
export function toCell(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') {
    if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error(`a number too large to send: ${v}`);
    return Number(v);
  }
  if (v instanceof Uint8Array) return { b64: toBase64(v) };
  if (v instanceof ArrayBuffer) return { b64: toBase64(new Uint8Array(v)) };
  throw new Error(`a value that is not text, a number, NULL or bytes: ${typeof v}`);
}

/** A cell as the value to bind. Anything else (an object, a boolean, a non-finite number) is refused. */
export function fromCell(c: unknown): string | number | null | Uint8Array {
  if (c === null || typeof c === 'string') return c;
  if (typeof c === 'number' && Number.isFinite(c)) return c;
  if (c && typeof c === 'object' && Object.keys(c).length === 1 && typeof (c as { b64?: unknown }).b64 === 'string') return fromBase64((c as { b64: string }).b64);
  throw new Error('A value must be text, a number, null or {"b64": "..."}');
}

/** The tables of a family database and their columns, as the target's own schema says. */
export type Schema = Map<string, string[]>;

/**
 * The one statement that writes rows of `table` into `schema`, its values bound as parameters. Refuses a table the schema
 * does not have (or one that never receives rows), a column that table does not have, and a repeated column. Only the
 * names it checked reach the SQL; nothing else does, so an import can write values and never read or run anything.
 */
export function importStatement(schema: Schema, table: string, columns: string[]): string {
  const known = schema.get(table);
  if (!NAME.test(table) || NOT_IMPORTED.test(table) || !known) throw new Error(`The family's database has no table "${String(table).slice(0, 64)}" to import into`);
  if (!columns.length) throw new Error(`No columns for ${table}`);
  const seen = new Set<string>();
  for (const c of columns) {
    if (!NAME.test(c) || !known.includes(c)) throw new Error(`${table} has no column "${String(c).slice(0, 64)}"`);
    if (seen.has(c)) throw new Error(`${table}: the column ${c} is named twice`);
    seen.add(c);
  }
  return `INSERT${SEEDED.has(table) ? ' OR REPLACE' : ''} INTO "${table}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
}

/** Rows of one table as data, in batches of at most `count` rows and about `bytes` of JSON each. */
export function rowBatches(table: string, columns: string[], rows: Cell[][], count = 500, bytes = 1_500_000): TableRows[] {
  const out: TableRows[] = [];
  let current: Cell[][] = [];
  let size = 0;
  for (const r of rows) {
    const n = JSON.stringify(r).length;
    if (current.length && (current.length >= count || size + n > bytes)) {
      out.push({ table, columns, rows: current });
      current = [];
      size = 0;
    }
    current.push(r);
    size += n;
  }
  if (current.length) out.push({ table, columns, rows: current });
  return out;
}

/** A family as a steward's backup holds it (GET /api/backup/<tree>): what a move to another install copies. */
export interface FamilyBackup {
  kindred: 'family-backup';
  version: 1;
  tree: string;
  /** The last tree migration the family's database had: a restore needs a Kindred with the same schema. */
  schema: string;
  made: string;
  tables: { table: string; columns: string[]; rows: Cell[][] }[];
}
