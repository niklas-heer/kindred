// Builds <data>/<id>.db from every data/seed/*.json (or the files given as arguments). <data> is
// KINDRED_DATA_DIR when it is set, else data/: point it at a scratch folder to try a seed without
// touching the real families.
//   node scripts/seed.ts [--force] [data/seed/realm.json ...]
// A family's feed is dated back from the moment of seeding (KINDRED_SEED_NOW sets another), and its pictures are painted
// into <data>/media/<id>/ (scripts/lib/pictures.ts).
// An existing database holds what the family typed in, so it is left alone unless --force is given;
// even then the old file is first copied to backups/ in that folder.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openSqlite } from '../src/lib/store/node.ts';
import { storeFurther } from '../src/lib/further-given.ts';
import { seedAccount } from '../src/lib/feed/voice.ts';
import type { SeedPicture, SeedTree } from '../src/lib/seed-format.ts';
import { drawScene } from './lib/pictures.ts';

const DATA = process.env.KINDRED_DATA_DIR ? resolve(process.env.KINDRED_DATA_DIR) : resolve('data');
const args = process.argv.slice(2);
const force = args.includes('--force');
const named = args.filter((a) => a !== '--force');
const files = named.length
  ? named
  : readdirSync('data/seed').filter((f) => f.endsWith('.json') && !f.endsWith('-places.json')).map((f) => join('data/seed', f));

/**
 * Contacts are person fields now (migration 0003, src/lib/fields/model.ts): each kind is a field
 * type, and its value is stored under one key. Messenger handles are "social" fields.
 */
const CONTACT_FIELD = {
  phone: { type: 'phone', key: 'number' },
  email: { type: 'email', key: 'address' },
  address: { type: 'address', key: 'street' },
  web: { type: 'website', key: 'url' },
  messenger: { type: 'social', key: 'handle' },
} as const;

for (const file of files) {
  const t: SeedTree = JSON.parse(readFileSync(file, 'utf8'));
  const path = join(DATA, `${t.id}.db`);
  if (existsSync(path)) {
    if (!force) {
      console.log(`${path}: exists, kept (it may hold edits; use --force to rebuild, a backup is made first)`);
      continue;
    }
    mkdirSync(join(DATA, 'backups'), { recursive: true });
    const backup = join(DATA, 'backups', `${t.id}-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    // Fold the write-ahead log in first, so the copy is complete.
    const old = new DatabaseSync(path);
    old.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    old.close();
    copyFileSync(path, backup);
    console.log(`${path}: backed up to ${backup}`);
  }
  for (const p of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(p)) rmSync(p);
  // A new file gets the schema from migrations/ (src/lib/store/node.ts).
  const db = openSqlite(path, 'tree', { create: true });
  db.exec('BEGIN');
  const meta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries({ id: t.id, name: t.name, tagline: t.tagline, theme: t.theme, focus: t.focus })) meta.run(k, v);

  const house = db.prepare('INSERT INTO house (id, name, motto, arms, founder) VALUES (?, ?, ?, ?, ?)');
  for (const h of t.houses) house.run(h.id, h.name, h.motto ?? null, JSON.stringify(h.arms), h.founder ?? null);

  const person = db.prepare(`INSERT INTO person (id, given, surname, house, sex, born, born_place, died, died_place, living,
    epithet, title, occupation, bio, traits, look, nickname, current_given, current_surname, further_given) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const p of t.people) {
    person.run(p.id, p.given, p.surname ?? null, p.house ?? null, p.sex ?? null, p.born ?? null, p.bornPlace ?? null,
      p.died ?? null, p.diedPlace ?? null, p.living ? 1 : 0, p.epithet ?? null, p.title ?? null, p.occupation ?? null,
      p.bio ?? null, p.traits ? JSON.stringify(p.traits) : null, p.look ? JSON.stringify(p.look) : null,
      p.nickname ?? null, p.currentGiven ?? null, p.currentSurname ?? null, storeFurther(p.furtherGiven));
  }
  const parent = db.prepare('INSERT OR IGNORE INTO parent (child, parent, kind, confidence) VALUES (?, ?, ?, ?)');
  for (const r of t.parents) parent.run(r.child, r.parent, r.kind ?? 'biological', r.confidence ?? 'certain');

  const union = db.prepare('INSERT INTO partnership (id, a, b, kind, start, end, end_reason, place) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const u of t.unions) union.run(u.id, u.a, u.b, u.kind ?? 'marriage', u.start ?? null, u.end ?? null, u.endReason ?? null, u.place ?? null);

  const story = db.prepare('INSERT INTO story (id, person, kind, title, body, author, at, context) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  // The interface sets its own quotation marks around sayings.
  const unquote = (s: { kind: string; body: string }) => (s.kind === 'quote' ? s.body.trim().replace(/^["“„]|["”“]$/g, '') : s.body);
  for (const s of t.stories) story.run(s.id, s.person, s.kind, s.title ?? null, unquote(s), s.author, s.at, s.context ?? null);

  const place = db.prepare('INSERT OR REPLACE INTO place (name, lat, lng, country) VALUES (?, ?, ?, ?)');
  for (const p of t.places ?? []) place.run(p.name, p.lat, p.lng, p.country ?? null);

  // Life events, sources and citations (migration 0024), in that order: a citation names a source and an event.
  const now = new Date().toISOString();
  const ords = new Map<string, number>();
  const event = db.prepare('INSERT INTO life_event (id, person, type, label, date, end_date, place, note, ord, created_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const e of t.events ?? []) {
    const ord = ords.get(e.person) ?? 0;
    ords.set(e.person, ord + 1);
    event.run(e.id, e.person, e.type, e.label ?? null, e.date ?? null, e.endDate ?? null, e.place ?? null, e.note ?? '', ord, 'seed', now, now);
  }
  const source = db.prepare('INSERT INTO source (id, title, author, publication, reference, date, note, created_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const x of t.sources ?? []) source.run(x.id, x.title, x.author ?? null, x.publication ?? null, x.reference ?? null, x.date ?? null, x.note ?? '', 'seed', now, now);
  const citation = db.prepare('INSERT INTO citation (id, source, fact, person, parent, event, partnership, page, quality, transcription, created_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const c of t.citations ?? []) {
    const f = c.target;
    const cols = f.fact === 'event' ? [null, null, f.event, null] : f.fact === 'partnership' ? [null, null, null, f.partnership] : f.fact === 'parent' ? [f.child, f.parent, null, null] : [f.person, null, null, null];
    citation.run(c.id, c.source, f.fact, ...cols, c.page ?? null, c.quality ?? null, c.transcription ?? '', 'seed', now, now);
  }

  // Person fields: the contacts in the family's order, then the favourite things after them (as migration 0003 laid them out).
  const field = db.prepare('INSERT INTO person_field (id, person, type, label, value, ord, created_by_name, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const fieldOrds = new Map<string, number>();
  let fields = 0;
  for (const c of t.contacts) {
    const { type, key } = CONTACT_FIELD[c.kind];
    const ord = fieldOrds.get(c.person) ?? 0;
    fieldOrds.set(c.person, ord + 1);
    const label = c.label ?? (c.kind === 'messenger' ? 'Messenger' : '');
    field.run(crypto.randomUUID(), c.person, type, label, JSON.stringify({ [key]: c.value }), ord, 'seed', 'seed');
    fields++;
  }
  for (const p of t.people) {
    if (p.favourite?.trim()) {
      field.run(crypto.randomUUID(), p.id, 'favourites', '', JSON.stringify({ text: p.favourite }), 1000, 'seed', 'seed');
      fields++;
    }
  }
  // The family's feed and gallery (migration 0029, docs/feed.md). A seed has no accounts: whoever writes, comments, reacts or
  // adds a photograph does so as `seed:<person id>` (src/lib/feed/voice.ts), which the app reads as that person. Times are
  // counted back from now, so a family seeded today has a feed that reads as recent. The pictures are painted here
  // (scripts/lib/pictures.ts) and stored as gallery pictures with their small copies; an earlier seeding's are replaced.
  const mediaDir = join(DATA, 'media', t.id);
  for (const folder of ['gallery', 'thumb']) rmSync(join(mediaDir, folder), { recursive: true, force: true });
  const byId = new Map(t.people.map((p) => [p.id, p]));
  const shown = (id: string) => { const p = byId.get(id)!; return [p.currentGiven ?? p.given, p.currentSurname ?? p.surname].filter(Boolean).join(' '); };
  // KINDRED_SEED_NOW (an ISO moment) is the clock to count back from, for a run that has a clock of its own (scripts/screenshots.ts).
  const seeded = process.env.KINDRED_SEED_NOW ? Date.parse(process.env.KINDRED_SEED_NOW) : Date.now();
  if (!Number.isFinite(seeded)) throw new Error(`KINDRED_SEED_NOW is not a moment: ${process.env.KINDRED_SEED_NOW}`);
  const when = (daysAgo: number, time: string, hoursLater = 0) => {
    const day = new Date(seeded - daysAgo * 86_400_000).toISOString().slice(0, 10);
    // Never in the future: a post "today at 19:05" seeded in the morning was written a moment ago.
    return new Date(Math.min(Date.parse(`${day}T${time}:00.000Z`) + hoursLater * 3_600_000, seeded - 60_000)).toISOString();
  };
  const mediaRow = db.prepare('INSERT INTO media (key, mime, width, height, caption, album, uploaded_by, uploaded_at, thumb) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  let pictures = 0;
  const store = (key: string, bytes: Uint8Array) => { mkdirSync(dirname(join(mediaDir, key)), { recursive: true }); writeFileSync(join(mediaDir, key), bytes); };
  const paint = (p: SeedPicture, by: string, at: string, album: string | null): string => {
    const id = crypto.randomUUID();
    const full = drawScene(p.scene, p.seed, 1280, p.tall);
    store(`gallery/${id}.png`, full.png);
    store(`thumb/${id}.png`, drawScene(p.scene, p.seed, 400, p.tall).png);
    mediaRow.run(`gallery/${id}.png`, 'image/png', full.width, full.height, p.caption ?? null, album, seedAccount(by), at, `thumb/${id}.png`);
    pictures++;
    return `gallery/${id}.png`;
  };
  const albums = new Map<string, string>();
  const albumRow = db.prepare('INSERT INTO album (id, name, at) VALUES (?, ?, ?)');
  for (const u of t.uploads ?? []) {
    const at = when(u.daysAgo, u.time);
    if (u.album && !albums.has(u.album)) { albums.set(u.album, crypto.randomUUID()); albumRow.run(albums.get(u.album)!, u.album, at); }
    // A minute apart, the last one first to arrive, as an upload sends them.
    u.pictures.forEach((p, i) => paint(p, u.by, new Date(Date.parse(at) - (u.pictures.length - i) * 60_000).toISOString(), u.album ? albums.get(u.album)! : null));
  }
  const post = db.prepare('INSERT INTO post (id, account, author_name, author_person, body, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const postMedia = db.prepare('INSERT INTO post_media (post, media, ord) VALUES (?, ?, ?)');
  const postPerson = db.prepare('INSERT OR IGNORE INTO post_person (post, person) VALUES (?, ?)');
  const comment = db.prepare("INSERT INTO comment (id, target_kind, target, account, author_name, body, created_at) VALUES (?, 'post', ?, ?, ?, ?, ?)");
  const reaction = db.prepare("INSERT OR IGNORE INTO reaction (target_kind, target, account, kind, created_at) VALUES ('post', ?, ?, ?, ?)");
  for (const p of t.posts ?? []) {
    const id = crypto.randomUUID();
    const at = when(p.daysAgo, p.time);
    post.run(id, seedAccount(p.by), shown(p.by), p.by, p.body, at);
    (p.pictures ?? []).forEach((pic, i) => postMedia.run(id, paint(pic, p.by, at, null), i));
    for (const person of p.people ?? []) postPerson.run(id, person);
    for (const c of p.comments ?? []) comment.run(crypto.randomUUID(), id, seedAccount(c.by), shown(c.by), c.body, when(p.daysAgo, p.time, c.hoursLater));
    (p.reactions ?? []).forEach((r, i) => reaction.run(id, seedAccount(r.by), r.kind, when(p.daysAgo, p.time, 0.2 + i * 0.3)));
  }

  db.exec('COMMIT');
  const fk = db.prepare('PRAGMA foreign_key_check').all();
  db.close();
  console.log(`${path}: ${t.people.length} people, ${t.unions.length} unions, ${t.stories.length} stories, ${(t.places ?? []).length} places, ${fields} fields, ${(t.events ?? []).length} events, ${(t.sources ?? []).length} sources, ${(t.citations ?? []).length} citations, ${(t.posts ?? []).length} posts, ${pictures} pictures${fk.length ? `, ${fk.length} broken references!` : ''}`);
}
