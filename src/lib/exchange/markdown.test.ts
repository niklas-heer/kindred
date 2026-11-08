import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import { fixtureTree } from './fixture.ts';
import { markdownArchive, noteNames } from './markdown.ts';

const ROOT = resolve(import.meta.dirname, '../../..');

/** The front matter of one note, parsed as YAML. */
function frontMatter(text: string): Record<string, unknown> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(m, 'a note starts with front matter');
  return parse(m[1]);
}

test('every note has valid YAML front matter in the v1 shape, and its biography under ## Story', () => {
  const { files, losses } = markdownArchive(fixtureTree(), new Set(), new Date('2026-11-08T00:00:00Z'));
  const notes = files.filter((f) => f.path.startsWith('people/'));
  assert.equal(notes.length, 8);
  const anna = frontMatter(notes.find((f) => f.path === 'people/anna.md')!.data as string);
  assert.equal(anna.version, 1);
  assert.equal(anna.type, 'person');
  assert.equal(anna.id, 'anna');
  assert.equal(anna.name, 'Anna Linden');
  assert.equal(anna.born, 'about 1900', 'Kindred’s ~1900 is v1’s "about 1900"');
  assert.equal(anna.birth_place, 'Lindenby');
  assert.equal(anna.living, false);
  const body = notes.find((f) => f.path === 'people/anna.md')!.data as string;
  assert.match(body, /\n## Story\n\nAnna kept the bakery/);
  assert.ok(files.some((f) => f.path === 'README.md'));
  assert.ok(Array.isArray(losses));
});

test('a marriage is an event on the lower-id partner’s note, a partnership a partners entry, and a divorce an event too', () => {
  const { files } = markdownArchive(fixtureTree());
  const note = (id: string) => frontMatter(files.find((f) => f.path === `people/${id}.md`)!.data as string);
  const events = note('anna').events as { type: string; date?: string; people: string[]; ended?: string }[];
  const marriage = events.find((e) => e.type === 'marriage')!;
  assert.equal(marriage.date, '1920-05-02');
  assert.deepEqual(marriage.people, ['[[people/karl]]'], 'the owner is implicit: only the other partner is listed');
  assert.ok(events.some((e) => e.type === 'divorce' && e.date === '1930'), 'the divorce is an event');
  assert.equal(note('karl').events, undefined, 'Anna’s marriage to Karl is declared on Anna’s note, not Karl’s');
  const second = (note('greta').events as { type: string; date?: string; ended?: string; ended_by?: string }[]).find((e) => e.type === 'marriage')!;
  assert.equal(second.date, '1935');
  assert.equal(second.ended, '1960');
  assert.equal(second.ended_by, 'death');
  assert.deepEqual((note('hanna').partners as { person: string }[]).map((p) => p.person), ['[[people/jonas]]']);
  assert.equal(note('jonas').partners, undefined, 'the partnership is declared once');
});

test('parents carry relation, kind, role and status, and step-parent links are left out and reported', () => {
  const { files, losses } = markdownArchive(fixtureTree());
  const hanna = frontMatter(files.find((f) => f.path === 'people/hanna.md')!.data as string);
  const parents = hanna.parents as { person: string; relation: string; kind: string; role: string; status: string }[];
  assert.deepEqual(parents.map((p) => p.role).sort(), ['father', 'mother']);
  assert.ok(parents.every((p) => p.relation === 'biological_parent' && p.status === 'accepted'));
  const lea = frontMatter(files.find((f) => f.path === 'people/lea.md')!.data as string);
  assert.deepEqual((lea.parents as { person: string; kind: string }[]).map((p) => [p.person, p.kind]), [['[[people/jonas]]', 'biological']], 'the step link is not written; the birth parent is');
  assert.ok(losses.some((l) => /1 step-parent links are not written/.test(l)));
  const pim = frontMatter(files.find((f) => f.path === 'people/pim.md')!.data as string);
  assert.ok((pim.parents as { relation: string }[]).every((p) => p.relation === 'adoptive_parent'));
});

test('a note name is safe, and unique when two ids would make the same file name', () => {
  const names = noteNames([
    { ...fixtureTree().people[0], id: 'a/b' },
    { ...fixtureTree().people[0], id: 'a_b' },
  ]);
  assert.equal(names.get('a/b'), 'a_b');
  assert.equal(names.get('a_b'), 'a_b-2');
});

test('a portrait is listed only when its file is in the archive', () => {
  const tree = fixtureTree();
  const without = frontMatter(markdownArchive(tree).files.find((f) => f.path === 'people/anna.md')!.data as string);
  assert.equal(without.portrait, undefined);
  const withFile = frontMatter(markdownArchive(tree, new Set(['attachments/anna.jpg'])).files.find((f) => f.path === 'people/anna.md')!.data as string);
  assert.equal(withFile.portrait, 'attachments/anna.jpg');
});

test('the v1 importer reads a Kindred archive back into the same people, dates and links', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kindred-md-'));
  try {
    const tree = fixtureTree();
    const { files } = markdownArchive(tree, new Set(), new Date('2026-11-08T00:00:00Z'));
    for (const f of files) {
      mkdirSync(join(dir, 'archive', f.path, '..'), { recursive: true });
      writeFileSync(join(dir, 'archive', f.path), f.data as string);
    }
    const out = join(dir, 'seed.json');
    execFileSync(process.execPath, [join(ROOT, 'scripts/import-kindred.ts'), join(dir, 'archive'), out], { cwd: ROOT, stdio: 'pipe' });
    const seed = JSON.parse(readFileSync(out, 'utf8')) as {
      people: { id: string; given: string; surname?: string; born?: string; bornPlace?: string; living: boolean; nickname?: string }[];
      parents: { child: string; parent: string; kind: string }[];
      unions: { a: string; b: string; kind: string; start?: string; place?: string }[];
    };
    assert.equal(seed.people.length, 8);
    assert.equal(seed.unions.length, 3, 'two marriages and a partnership, with no self-pairs');
    assert.ok(seed.unions.every((u) => u.a !== u.b));
    const anna = seed.people.find((p) => p.id === 'anna')!;
    assert.equal(anna.given, 'Anna');
    assert.equal(anna.surname, 'Linden');
    assert.equal(anna.born, '~1900', 'v1’s "about 1900" comes back as ~1900');
    assert.equal(anna.bornPlace, 'Lindenby');
    assert.equal(seed.people.find((p) => p.id === 'hanna')!.nickname, 'Hanni');
    assert.ok(seed.parents.some((l) => l.child === 'hanna' && l.parent === 'anna' && l.kind === 'biological'));
    assert.ok(seed.parents.some((l) => l.child === 'pim' && l.kind === 'adoptive'));
    const marriage = seed.unions.find((u) => u.kind === 'marriage' && u.start === '1920-05-02');
    assert.ok(marriage, 'the marriage event comes back with its date');
    assert.equal(marriage!.place, 'Lindenby');
    assert.ok(seed.unions.some((u) => u.kind === 'partnership'), 'the partnership comes back');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
