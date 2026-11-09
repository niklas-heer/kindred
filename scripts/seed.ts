// Builds <data>/<id>.db from every data/seed/*.json (or the files given as arguments). <data> is
// KINDRED_DATA_DIR when it is set, else data/: point it at a scratch folder to try a seed without
// touching the real families.
//   node scripts/seed.ts [--force] [data/seed/realm.json ...]
// An existing database holds what the family typed in, so it is left alone unless --force is given;
// even then the old file is first copied to backups/ in that folder.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openSqlite } from '../src/lib/store/node.ts';
import { storeFurther } from '../src/lib/further-given.ts';
import type { SeedTree } from '../src/lib/seed-format.ts';

const DATA = process.env.KINDRED_DATA_DIR ? resolve(process.env.KINDRED_DATA_DIR) : resolve('data');
const args = process.argv.slice(2);
const force = args.includes('--force');
const named = args.filter((a) => a !== '--force');
const files = named.length
  ? named
  : readdirSync('data/seed').filter((f) => f.endsWith('.json') && !f.endsWith('-places.json')).map((f) => join('data/seed', f));

/**
 * Contacts are person fields now (migration 0003, src/components/fields/model.ts): each kind is a field
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

  // Person fields: the contacts in the family's order, then the favourite things after them (as migration 0003 laid them out).
  const field = db.prepare('INSERT INTO person_field (id, person, type, label, value, ord, created_by_name, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const ords = new Map<string, number>();
  let fields = 0;
  for (const c of t.contacts) {
    const { type, key } = CONTACT_FIELD[c.kind];
    const ord = ords.get(c.person) ?? 0;
    ords.set(c.person, ord + 1);
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
  db.exec('COMMIT');
  const fk = db.prepare('PRAGMA foreign_key_check').all();
  db.close();
  console.log(`${path}: ${t.people.length} people, ${t.unions.length} unions, ${t.stories.length} stories, ${(t.places ?? []).length} places, ${fields} fields${fk.length ? `, ${fk.length} broken references!` : ''}`);
}
