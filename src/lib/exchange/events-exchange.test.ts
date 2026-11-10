// Life events, sources and citations through GEDCOM and the Markdown archive: Kindred's own export comes back as the same
// events, sources and citations, a second import of it adds nothing, and another program's usual tags are read. The last
// test runs the whole way through a scratch family database (never data/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';

const dir = mkdtempSync(join(tmpdir(), 'kindred-events-exchange-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');

const { openSqlite } = await import('../store/node.ts');
const { readGedcom, writeGedcom } = await import('./gedcom.ts');
const { fixtureTree, emptyTree } = await import('./fixture.ts');
const { readTree } = await import('./model.ts');
const { planImport } = await import('./plan.ts');
const { markdownArchive } = await import('./markdown.ts');
const { db } = await import('../db.server.ts');
const { applyImport, previewImport } = await import('./import.server.ts');
const { nothingToAdd, summaryLines } = await import('./preview-summary.ts');
import type { ExTree } from './model.ts';

test.after(() => rmSync(dir, { recursive: true, force: true }));

/** The fixture family with a life recorded: events of every shape, two sources, and a citation of every kind of fact. */
function withLife(): ExTree {
  const t = fixtureTree();
  t.events = [
    { id: 'ev-bapt', person: 'anna', type: 'baptism', label: null, date: '~1900-04', endDate: null, place: 'Lindenby', note: '', ord: 0 },
    { id: 'ev-school', person: 'anna', type: 'education', label: 'Village school', date: '1906', endDate: '1914', place: null, note: 'Top of her class', ord: 1 },
    { id: 'ev-shop', person: 'anna', type: 'custom', label: 'Opened the bakery', date: '1922', endDate: null, place: 'Ulm', note: '', ord: 2 },
    { id: 'ev-job', person: 'karl', type: 'occupation', label: 'Miller', date: '1920', endDate: null, place: null, note: '', ord: 0 },
    { id: 'ev-war', person: 'karl', type: 'military', label: null, date: '1916', endDate: '1918', place: null, note: '', ord: 1 },
    { id: 'ev-grave', person: 'anna', type: 'burial', label: null, date: '1971-06-18', endDate: null, place: 'Ulm', note: '', ord: 3 },
  ];
  t.sources = [
    { id: 'src-parish', title: 'Parish register of Lindenby', author: null, publication: 'Lindenby parish office', reference: 'KB 7', date: '1900', note: 'Baptisms 1890–1910', document: null, media: null },
    { id: 'src-letter', title: 'A letter from Karl', author: 'Karl Linden', publication: null, reference: 'https://example.org/letter', date: null, note: '', document: null, media: null },
  ];
  t.citations = [
    { id: 'c1', source: 'src-parish', target: { fact: 'birth', person: 'anna' }, page: 'p. 12', quality: 'original', transcription: 'Anna, daughter of…' },
    { id: 'c2', source: 'src-parish', target: { fact: 'event', event: 'ev-bapt' }, page: 'p. 12', quality: 'original', transcription: '' },
    { id: 'c3', source: 'src-letter', target: { fact: 'name', person: 'karl' }, page: null, quality: 'derivative', transcription: '' },
    { id: 'c4', source: 'src-letter', target: { fact: 'partnership', partnership: 'u-anna-karl' }, page: null, quality: null, transcription: 'We married in May.' },
    { id: 'c5', source: 'src-parish', target: { fact: 'parent', child: 'hanna', parent: 'anna' }, page: 'p. 40', quality: 'unsure', transcription: '' },
    { id: 'c6', source: 'src-parish', target: { fact: 'death', person: 'anna' }, page: null, quality: null, transcription: '' },
    { id: 'c7', source: 'src-letter', target: { fact: 'partnership', partnership: 'u-hanna-jonas' }, page: null, quality: null, transcription: '' },
  ];
  return t;
}

const NOW = new Date('2026-11-10T12:00:00Z');

test('Kindred’s own GEDCOM brings back the same events, sources and citations, with their ids', () => {
  const tree = withLife();
  const { text } = writeGedcom(tree, NOW);
  assert.match(text, /\r\n1 BAPM\r\n2 _KINDRED_ID ev-bapt\r\n2 DATE ABT APR 1900\r\n2 PLAC Lindenby\r\n2 SOUR @S2@\r\n3 PAGE p\. 12\r\n3 QUAY 3\r\n/);
  assert.match(text, /\r\n1 EVEN\r\n2 TYPE Opened the bakery\r\n/, 'a custom event is EVEN with its label as TYPE');
  assert.match(text, /\r\n1 EDUC Village school\r\n[\s\S]*?2 DATE FROM 1906 TO 1914\r\n/);
  assert.match(text, /\r\n0 @S2@ SOUR\r\n1 _KINDRED_ID src-parish\r\n1 TITL Parish register of Lindenby\r\n/);
  const back = readGedcom(text, NOW);
  const plan = planImport(back, emptyTree(), (g) => `${g}-new`);
  assert.deepEqual(plan.sources.map((s) => s.id).sort(), ['src-letter', 'src-parish']);
  assert.deepEqual(plan.sources.find((s) => s.id === 'src-letter'), tree.sources![1]);
  const byId = new Map(plan.events.map((e) => [e.id, e]));
  for (const e of tree.events!) assert.deepEqual(byId.get(e.id), e, `event ${e.id}`);
  assert.equal(plan.add.find((p) => p.id === 'karl')!.occupation, 'Miller', 'the occupation event does not replace the person’s occupation');
  const want = (c: NonNullable<typeof tree.citations>[number]) => JSON.stringify({ ...c });
  assert.deepEqual(plan.citations.map(want).sort(), tree.citations!.map(want).sort());
});

test('importing the same file into the family it came from adds no event, source or citation twice', () => {
  const tree = withLife();
  const plan = planImport(readGedcom(writeGedcom(tree, NOW).text, NOW), tree, (g) => `${g}-new`);
  assert.equal(plan.events.length, 0);
  assert.equal(plan.sources.length, 0);
  assert.equal(plan.citations.length, 0);
  assert.equal(plan.duplicateEvents, 6);
  assert.equal(plan.duplicateSources, 2);
  assert.equal(plan.duplicateCitations, 7);
});

test('another program’s events and citations are read: EVEN with a TYPE, an inline source, a citation under FAMC, QUAY 0', () => {
  const text = [
    '0 HEAD', '1 CHAR UTF-8',
    '0 @I1@ INDI', '1 NAME Ole /Strand/', '1 SEX M', '1 BIRT', '2 DATE 1850', '1 OCCU Fisherman',
    '1 EVEN', '2 TYPE Moved to the coast', '2 DATE ABT 1875', '2 PLAC Harbour Town', '2 SOUR Family bible', '3 QUAY 0',
    '1 BURI', '2 DATE 1920', '2 SOUR @S9@', '3 PAGE Row 4', '3 DATA', '4 TEXT Here lies Ole', '1 _MILT', '2 DATE 1870',
    '1 DEAT', '2 DATE 1919', '1 FAMS @F1@',
    '0 @I2@ INDI', '1 NAME Mia /Strand/', '1 SEX F', '1 FAMC @F1@', '2 SOUR @S9@',
    '0 @F1@ FAM', '1 HUSB @I1@', '1 CHIL @I2@',
    '0 @S9@ SOUR', '1 TITL Churchyard survey', '1 AUTH Local society',
    '0 TRLR',
  ].join('\n');
  const inc = readGedcom(text, NOW);
  const ole = inc.events!.filter((e) => e.person === '@I1@');
  assert.deepEqual(ole.map((e) => e.type), ['custom', 'burial', 'military']);
  assert.equal(ole[0].label, 'Moved to the coast');
  assert.equal(ole[0].date, '~1875');
  assert.equal(inc.people.find((p) => p.id === '@I1@')!.occupation, 'Fisherman', 'an OCCU without a date stays the person’s occupation');
  assert.ok(inc.sources!.some((s) => s.title === 'Family bible'), 'a SOUR with only text is a source of its own');
  const plan = planImport(inc, emptyTree(), (g) => `${g}-${Math.random().toString(36).slice(2, 6)}`);
  assert.equal(plan.sources.length, 2);
  const burial = plan.citations.find((c) => c.target.fact === 'event' && plan.events.find((e) => e.id === (c.target as { event: string }).event)?.type === 'burial')!;
  assert.equal(burial.page, 'Row 4');
  assert.equal(burial.transcription, 'Here lies Ole');
  assert.equal(plan.citations.find((c) => c.transcription === '' && c.target.fact === 'event')!.quality, 'unsure');
  assert.ok(plan.citations.some((c) => c.target.fact === 'parent'), 'a SOUR under FAMC cites the link to that family’s parent');
});

test('the Markdown archive carries events in each note, sources in sources/, and citations naming both', () => {
  const { files } = markdownArchive(withLife(), new Set(), NOW);
  const note = (path: string) => parse(/^---\n([\s\S]*?)\n---\n/.exec(files.find((f) => f.path === path)!.data as string)![1]);
  const anna = note('people/anna.md');
  const types = (anna.events as { type: string }[]).map((e) => e.type);
  assert.ok(['marriage', 'baptism', 'education', 'custom', 'burial'].every((x) => types.includes(x)));
  const school = (anna.events as { type: string; end?: string; label?: string }[]).find((e) => e.type === 'education')!;
  assert.equal(school.end, '1914');
  assert.equal(school.label, 'Village school');
  const cites = anna.citations as { fact: string; source: string; page?: string; event?: string; partnership?: string }[];
  assert.ok(cites.some((c) => c.fact === 'birth' && c.source === '[[sources/parish-register-of-lindenby]]' && c.page === 'p. 12'));
  assert.ok(cites.some((c) => c.fact === 'partnership' && c.partnership === 'u-anna-karl'), 'on the note that declares the partnership');
  const parish = note('sources/parish-register-of-lindenby.md');
  assert.equal(parish.type, 'source');
  assert.equal(parish.reference, 'KB 7');
  assert.ok(note('people/hanna.md').citations, 'a parent link’s citation is on the child’s note');
});

test('a GEDCOM file applied to an empty family writes its events, sources and citations', async () => {
  const d = openSqlite(join(dir, 'scratch.db'), 'tree', { create: true });
  d.exec("INSERT INTO meta (key, value) VALUES ('id', 'scratch'), ('name', 'Scratch'), ('tagline', ''), ('theme', 'modern'), ('focus', '')");
  d.close();
  const tree = withLife();
  const result = await applyImport('scratch', writeGedcom(tree, NOW).text, undefined, false);
  assert.equal(result.events, 6);
  assert.equal(result.sources, 2);
  assert.equal(result.citations, 7);
  const back = await readTree(db('scratch'));
  assert.equal(back.events!.length, 6);
  assert.deepEqual(back.events!.find((e) => e.id === 'ev-school'), tree.events![1]);
  assert.equal(back.citations!.length, 7);
  const again = await applyImport('scratch', writeGedcom(back, NOW).text, undefined, true);
  assert.deepEqual([again.events, again.sources, again.citations], [0, 0, 0], 'its own export changes nothing');
});

test('the import preview counts new events, sources and citations, and a file that brings only those still has something to add', async () => {
  const d = openSqlite(join(dir, 'preview.db'), 'tree', { create: true });
  d.exec("INSERT INTO meta (key, value) VALUES ('id', 'preview'), ('name', 'Preview'), ('tagline', ''), ('theme', 'modern'), ('focus', '')");
  d.close();
  const lines = (p: Parameters<typeof summaryLines>[0]) => Object.fromEntries(summaryLines(p).map((l) => [l.key.replace('exchange.import.summary.', ''), l.count]));
  const first = await previewImport('preview', writeGedcom(withLife(), NOW).text);
  assert.equal(nothingToAdd(first), false);
  const firstLines = lines(first);
  assert.deepEqual([firstLines.events, firstLines.sources, firstLines.citations], [6, 2, 7]);
  assert.equal(firstLines.records_there, undefined, 'a line with nothing to count is left out');

  // The family has its people and links but no life yet: the same people with their life is not "nothing to add".
  const bare = withLife();
  bare.events = []; bare.sources = []; bare.citations = [];
  await applyImport('preview', writeGedcom(bare, NOW).text, undefined, false);
  const life = await previewImport('preview', writeGedcom(withLife(), NOW).text);
  assert.deepEqual([life.addCount, life.parents, life.unions], [0, 0, 0]);
  assert.equal(nothingToAdd(life), false, 'events, sources and citations are something to add');
  assert.deepEqual([lines(life).events, lines(life).sources, lines(life).citations], [6, 2, 7]);

  await applyImport('preview', writeGedcom(withLife(), NOW).text, undefined, true);
  const again = await previewImport('preview', writeGedcom(withLife(), NOW).text);
  assert.equal(nothingToAdd(again), true);
  assert.equal(lines(again).records_there, 15, 'six events, two sources and seven citations already there');
});
