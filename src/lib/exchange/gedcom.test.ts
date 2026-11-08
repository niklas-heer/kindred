import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromGedcomDate, toGedcomDate } from './dates.ts';
import { emptyTree, fixtureTree, LONG_BIO } from './fixture.ts';
import { readGedcom, writeGedcom } from './gedcom.ts';
import { planImport } from './plan.ts';
import type { ExPerson, ExTree } from './model.ts';

const sorted = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => (a.id < b.id ? -1 : 1));
/** The person fields GEDCOM carries; epithets and portraits are not in the text. */
const carried = (p: ExPerson) => ({ ...p, epithet: null, portrait: null });

test('a family goes to GEDCOM and comes back the same', () => {
  const tree = fixtureTree();
  const { text } = writeGedcom(tree, new Date('2026-11-08T12:00:00Z'));
  const back = readGedcom(text);
  const plan = planImport(back, emptyTree(), (g) => `new_${g}`);

  assert.deepEqual(sorted(plan.add.map(carried)), sorted(tree.people.map(carried)));
  assert.deepEqual(
    plan.parents.map((l) => `${l.child}<${l.parent}:${l.kind}:${l.confidence}`).sort(),
    tree.parents.map((l) => `${l.child}<${l.parent}:${l.kind}:${l.confidence}`).sort(),
  );
  // A partnership's partners come in either order: the file writes the husband first.
  const pair = (u: { id: string; a: string; b: string }) => ({ ...u, a: [u.a, u.b].sort()[0], b: [u.a, u.b].sort()[1] });
  assert.deepEqual(
    plan.unions.map(pair).sort((x, y) => (x.id < y.id ? -1 : 1)),
    tree.unions.map(pair).sort((x, y) => (x.id < y.id ? -1 : 1)),
  );
  assert.deepEqual(plan.conflicts, []);
  assert.equal(plan.ambiguous.length, 0);
});

test('the file is deterministic and has the header and trailer a reader expects', () => {
  const a = writeGedcom(fixtureTree(), new Date('2026-11-08T12:00:00Z')).text;
  const b = writeGedcom(fixtureTree(), new Date('2026-11-08T12:00:00Z')).text;
  assert.equal(a, b);
  assert.match(a, /^0 HEAD\r\n/);
  assert.match(a, /\r\n1 CHAR UTF-8\r\n/);
  assert.match(a, /\r\n0 TRLR\r\n$/);
  assert.doesNotMatch(a, /(?<!\r)\n/, 'every line ends with CRLF');
});

test('a long biography is split into CONC lines and rebuilt exactly, with @ and line breaks', () => {
  const { text } = writeGedcom(fixtureTree());
  for (const line of text.split('\r\n')) assert.ok(line.length <= 255, `line too long: ${line.length}`);
  assert.match(text, /\r\n3 CONC /, 'long text is continued under its CONT line');
  const anna = readGedcom(text).people.find((p) => p.id === '@I1@');
  assert.ok(anna);
  assert.equal(anna.bio, LONG_BIO);
});

test('multiple marriages each keep their own dates, and children go to the right parents', () => {
  const tree = fixtureTree();
  const back = readGedcom(writeGedcom(tree).text);
  const karl = back.people.find((p) => p.given === 'Karl')!.id;
  const married = back.unions.filter((u) => u.a === karl || u.b === karl);
  assert.equal(married.length, 2);
  const first = married.find((u) => u.start === '1920-05-02')!;
  assert.equal(first.end, '1930');
  assert.equal(first.endReason, 'divorce');
  assert.equal(first.place, 'Lindenby');
  const second = married.find((u) => u.start === '1935')!;
  assert.equal(second.endReason, 'death');
  const hanna = back.people.find((p) => p.given === 'Hanna')!.id;
  const hannaParents = back.parents.filter((l) => l.child === hanna).map((l) => l.parent).sort();
  assert.deepEqual(hannaParents, [first.a === karl ? first.b : first.a, karl].sort());
});

test('an adoptive and a step link keep their kind and confidence', () => {
  const back = readGedcom(writeGedcom(fixtureTree()).text);
  assert.ok(back.parents.some((l) => l.kind === 'adoptive' && l.child === '@I8@'), 'Pim is adopted');
  const step = back.parents.find((l) => l.kind === 'step')!;
  assert.equal(step.confidence, 'probable');
});

test('a birth parent and a step parent of one child keep their own kinds: each is its own family', () => {
  const { text, losses } = writeGedcom(fixtureTree());
  const back = readGedcom(text);
  const lea = back.parents.filter((l) => l.child === '@I6@');
  assert.deepEqual(lea.map((l) => l.kind).sort(), ['biological', 'step']);
  assert.ok(lea.some((l) => l.kind === 'step' && l.confidence === 'probable'));
  assert.ok(!losses.some((l) => /one kind/.test(l)));
});

test('three parents of one kind is reported: a GEDCOM family holds two', () => {
  const tree = fixtureTree();
  tree.parents.push({ child: 'otto', parent: 'anna', kind: 'biological', confidence: 'certain' });
  const { losses } = writeGedcom(tree);
  assert.ok(losses.some((l) => /Otto has 3 parents of one kind/.test(l)));
});

test('partial and approximate dates: years, months, days, about', () => {
  assert.deepEqual(fromGedcomDate('1953'), { date: '1953' });
  assert.deepEqual(fromGedcomDate('AUG 1953'), { date: '1953-08' });
  assert.deepEqual(fromGedcomDate('8 AUG 1953'), { date: '1953-08-08' });
  assert.deepEqual(fromGedcomDate('ABT 1900'), { date: '~1900' });
  assert.deepEqual(fromGedcomDate('abt  8 aug 1953'), { date: '~1953-08-08' });
  assert.deepEqual(fromGedcomDate('CAL 1880'), { date: '~1880' });
  assert.deepEqual(fromGedcomDate(''), { date: null });
  for (const d of ['1953', '1953-08', '1953-08-08', '~1900', '~1900-02']) {
    assert.equal(fromGedcomDate(toGedcomDate(d)).date, d, `round trip of ${d}`);
  }
});

test('ranges and before/after keep their nearest year, and say so', () => {
  const bet = fromGedcomDate('BET 1900 AND 1910');
  assert.equal(bet.date, '~1900');
  assert.match(bet.note ?? '', /about its earlier year/);
  const bef = fromGedcomDate('BEF 1900');
  assert.equal(bef.date, '~1900');
  assert.match(bef.note ?? '', /about/);
  assert.match(fromGedcomDate('FROM 1900 TO 1910').note ?? '', /start/);
});

test('dates Kindred cannot store are dropped with a reason', () => {
  const impossible = fromGedcomDate('31 FEB 1900');
  assert.equal(impossible.date, null);
  assert.match(impossible.note ?? '', /real date/);
  const free = fromGedcomDate('the winter of the bad harvest');
  assert.equal(free.date, null);
  assert.match(free.note ?? '', /not a date Kindred can store/);
  assert.equal(fromGedcomDate('1900 OR 1901').date, null);
});

test('unknown tags are skipped and counted, and the rest of the file still reads', () => {
  const text = [
    '0 HEAD',
    '1 CHAR UTF-8',
    '1 SOUR Some other program',
    '0 @S1@ SOUR',
    '1 TITL A source',
    '0 @I1@ INDI',
    '1 NAME Mira /Lind/',
    '2 SOUR @S1@',
    '2 _WEIRD something',
    '1 BIRT',
    '2 DATE 1901',
    '1 _KINDRED_ID mira',
    '0 @I2@ INDI',
    '1 NAME Tove /Lind/',
    '0 @F1@ FAM',
    '1 HUSB @I1@',
    '1 WIFE @I2@',
    '1 CHIL @I3@',
    '0 TRLR',
  ].join('\r\n');
  const back = readGedcom(text);
  assert.equal(back.people.length, 2);
  assert.equal(back.people[0].preferredId, 'mira');
  assert.equal(back.people[0].born, '1901');
  const skipped = back.issues.map((i) => i.message).join('\n');
  assert.match(skipped, /Skipped 1× _WEIRD/);
  assert.match(skipped, /Skipped 2× SOUR/, 'the source record and the one under NAME; the header is not data');
  assert.match(skipped, /refers to @I3@/);
  assert.equal(back.unions.length, 0, 'a marriage-less pair is not a partnership');
});

test('a marriage with only one spouse is not a partnership, and the reader is told', () => {
  const text = ['0 HEAD', '0 @I1@ INDI', '1 NAME A /B/', '0 @I2@ INDI', '1 NAME C /D/', '0 @F1@ FAM', '1 HUSB @I1@', '1 MARR', '0 @F2@ FAM', '1 HUSB @I2@', '1 MARR', '0 TRLR'].join('\n');
  const back = readGedcom(text);
  assert.equal(back.unions.length, 0);
  assert.equal(back.issues.filter((i) => /needs two spouses/.test(i.message)).length, 2);
});

test('text that is not GEDCOM is refused with a reason', () => {
  assert.throws(() => readGedcom('hello\nthis is a letter, not a family file'), /not a GEDCOM family file/);
});

test('a line that is not GEDCOM is skipped, not fatal', () => {
  const back = readGedcom(['0 HEAD', 'this line is junk', '0 @I1@ INDI', '1 NAME Ruth /Kern/', '0 TRLR'].join('\n'));
  assert.equal(back.people.length, 1);
  assert.ok(back.issues.some((i) => /Line 2 is not GEDCOM/.test(i.message)));
});

test('a file without a BOM and with LF endings reads the same as CRLF', () => {
  const crlf = writeGedcom(fixtureTree()).text;
  const lf = '﻿' + crlf.replace(/\r\n/g, '\n');
  assert.deepEqual(readGedcom(lf).people, readGedcom(crlf).people);
});

test('what the format cannot carry is listed for the report', () => {
  const { losses } = writeGedcom(fixtureTree());
  const all = losses.join('\n');
  assert.match(all, /3 stories, memories and sayings are not exported/);
  assert.match(all, /2 contact details and other fields are not exported/);
  assert.match(all, /1 houses and their arms are not exported/);
  assert.match(all, /1 portraits are referenced by their media key only/);
});

test('an empty family writes a valid file and reads back with nothing', () => {
  const empty: ExTree = emptyTree();
  const { text } = writeGedcom(empty);
  const back = readGedcom(text);
  assert.equal(back.people.length, 0);
  assert.equal(back.tree.id, 'scratch');
});
