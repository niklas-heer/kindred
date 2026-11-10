// node --test scripts/import-kindred.test.ts — the v1 archive importer on a two-person archive in a temp folder. The family
// view opens on the person named as the third argument, or else on the first person; an unknown name is an error. Nothing
// under data/ is read or written.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const work = mkdtempSync(join(tmpdir(), 'kindred-import-test-'));
test.after(() => rmSync(work, { recursive: true, force: true }));

const archive = join(work, 'archive');
mkdirSync(join(archive, 'people'), { recursive: true });
for (const [id, name] of [['ada-heer', 'Ada Heer'], ['bert-jones', 'Bert Jones']]) {
  writeFileSync(join(archive, 'people', `${id}.md`), `---\nid: ${id}\nname: ${name}\nliving: true\n---\n## Story\nA note.\n`);
}

const script = join(import.meta.dirname, 'import-kindred.ts');
const run = (out: string, ...extra: string[]) => spawnSync(process.execPath, [script, archive, out, ...extra], { encoding: 'utf8' });

test('the family view opens on the person named as the third argument, or else on the first person', () => {
  const first = join(work, 'first.json');
  const r1 = run(first);
  assert.equal(r1.status, 0, r1.stderr);
  const tree1 = JSON.parse(readFileSync(first, 'utf8'));
  assert.equal(tree1.focus, tree1.people[0].id, 'the first person in the archive');
  assert.ok(['ada-heer', 'bert-jones'].includes(tree1.focus));

  const second = join(work, 'second.json');
  const r2 = run(second, 'bert-jones');
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(JSON.parse(readFileSync(second, 'utf8')).focus, 'bert-jones');
});

test('a focus that names no note is an error, and nothing is written', () => {
  const out = join(work, 'unknown.json');
  const r = run(out, 'nobody-here');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no person note named nobody-here\.md/);
  assert.throws(() => readFileSync(out), /ENOENT/);
});

test('an archive Kindred v2 wrote comes back with its life events, sources and citations', async () => {
  const { fixtureTree } = await import('../src/lib/exchange/fixture.ts');
  const { markdownArchive } = await import('../src/lib/exchange/markdown.ts');
  const tree = fixtureTree();
  tree.events = [
    { id: 'ev-bapt', person: 'anna', type: 'baptism', label: null, date: '~1900-04', endDate: null, place: 'Lindenby', note: '', ord: 0 },
    { id: 'ev-school', person: 'anna', type: 'education', label: 'Village school', date: '1906', endDate: '1914', place: null, note: 'Top of her class', ord: 1 },
    { id: 'ev-job', person: 'karl', type: 'occupation', label: 'Miller', date: '1920', endDate: null, place: null, note: '', ord: 0 },
  ];
  tree.sources = [
    { id: 'src-parish', title: 'Parish register of Lindenby', author: null, publication: 'Lindenby parish office', reference: 'KB 7', date: '~1900', note: 'Baptisms 1890–1910', document: null, media: null },
    { id: 'src-letter', title: 'A letter from Karl', author: 'Karl Linden', publication: null, reference: null, date: null, note: '', document: null, media: null },
  ];
  tree.citations = [
    { id: 'c1', source: 'src-parish', target: { fact: 'birth', person: 'anna' }, page: 'p. 12', quality: 'original', transcription: 'Anna, daughter of…' },
    { id: 'c2', source: 'src-parish', target: { fact: 'event', event: 'ev-bapt' }, page: 'p. 12', quality: 'original', transcription: '' },
    { id: 'c3', source: 'src-letter', target: { fact: 'name', person: 'karl' }, page: null, quality: 'derivative', transcription: '' },
    { id: 'c4', source: 'src-letter', target: { fact: 'partnership', partnership: 'u-anna-karl' }, page: null, quality: null, transcription: 'We married in May.' },
    { id: 'c5', source: 'src-parish', target: { fact: 'parent', child: 'hanna', parent: 'anna' }, page: 'p. 40', quality: 'unsure', transcription: '' },
  ];
  const v2 = join(work, 'v2-archive');
  for (const f of markdownArchive(tree).files) {
    mkdirSync(join(v2, f.path, '..'), { recursive: true });
    writeFileSync(join(v2, f.path), f.data);
  }
  const out = join(work, 'v2.json');
  const r = spawnSync(process.execPath, [script, v2, out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const seed = JSON.parse(readFileSync(out, 'utf8'));

  const byId = new Map(seed.events.map((e: { id: string }) => [e.id, e]));
  assert.equal(seed.events.length, 3, 'marriages stay partnerships, not events');
  assert.deepEqual(byId.get('ev-bapt'), { id: 'ev-bapt', person: 'anna', type: 'baptism', date: '~1900-04', place: 'Lindenby' });
  assert.deepEqual(byId.get('ev-school'), { id: 'ev-school', person: 'anna', type: 'education', label: 'Village school', date: '1906', endDate: '1914', note: 'Top of her class' });

  assert.deepEqual(
    seed.sources.sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)),
    [
      { id: 'src-letter', title: 'A letter from Karl', author: 'Karl Linden' },
      { id: 'src-parish', title: 'Parish register of Lindenby', publication: 'Lindenby parish office', reference: 'KB 7', date: '~1900', note: 'Baptisms 1890–1910' },
    ],
  );

  const facts = (cs: { source: string; target: unknown; page?: string | null; quality?: string | null; transcription?: string | null }[]) =>
    cs.map((c) => JSON.stringify([c.source, c.target, c.page || null, c.quality || null, c.transcription || null])).sort();
  assert.deepEqual(facts(seed.citations), facts(tree.citations), 'every citation, naming the same source and fact');
  assert.equal(new Set(seed.citations.map((c: { id: string }) => c.id)).size, seed.citations.length, 'each with an id of its own');
});
