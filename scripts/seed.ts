// Rebuilds data/<id>.db from every data/seed/*.json (or the files given as arguments).
//   node scripts/seed.ts [data/seed/realm.json ...]
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA } from '../src/lib/schema.ts';
import type { SeedTree } from '../src/lib/seed-format.ts';

const files = process.argv.length > 2
  ? process.argv.slice(2)
  : readdirSync('data/seed').filter((f) => f.endsWith('.json') && !f.endsWith('-places.json')).map((f) => join('data/seed', f));

for (const file of files) {
  const t: SeedTree = JSON.parse(readFileSync(file, 'utf8'));
  const path = `data/${t.id}.db`;
  for (const p of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(p)) rmSync(p);
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  db.exec('BEGIN');
  const meta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries({ id: t.id, name: t.name, tagline: t.tagline, theme: t.theme, focus: t.focus })) meta.run(k, v);

  const house = db.prepare('INSERT INTO house (id, name, motto, arms, founder) VALUES (?, ?, ?, ?, ?)');
  for (const h of t.houses) house.run(h.id, h.name, h.motto ?? null, JSON.stringify(h.arms), h.founder ?? null);

  const person = db.prepare(`INSERT INTO person (id, given, surname, house, sex, born, born_place, died, died_place, living,
    epithet, title, occupation, bio, traits, look, nickname, favourite) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const p of t.people) {
    person.run(p.id, p.given, p.surname ?? null, p.house ?? null, p.sex ?? null, p.born ?? null, p.bornPlace ?? null,
      p.died ?? null, p.diedPlace ?? null, p.living ? 1 : 0, p.epithet ?? null, p.title ?? null, p.occupation ?? null,
      p.bio ?? null, p.traits ? JSON.stringify(p.traits) : null, p.look ? JSON.stringify(p.look) : null,
      p.nickname ?? null, p.favourite ?? null);
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

  const contact = db.prepare('INSERT INTO contact (person, kind, label, value) VALUES (?, ?, ?, ?)');
  for (const c of t.contacts) contact.run(c.person, c.kind, c.label ?? null, c.value);
  db.exec('COMMIT');
  const fk = db.prepare('PRAGMA foreign_key_check').all();
  db.close();
  console.log(`${path}: ${t.people.length} people, ${t.unions.length} unions, ${t.stories.length} stories, ${(t.places ?? []).length} places${fk.length ? `, ${fk.length} broken references!` : ''}`);
}
