// Text through GEDCOM and back: whatever a family writes in a biography, a place or a name must come back exactly.
// The awkward cases are where continuation lines are cut (GEDCOM 5.5.1 wants CONC split at a non-space, because
// readers trim the spaces around a value), Markdown hard breaks (two trailing spaces), blank lines, characters
// outside the BMP, and a leading "@". A seeded generator mixes them, so a failure is the same on every run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyTree } from './fixture.ts';
import { readGedcom, writeGedcom } from './gedcom.ts';
import type { ExPerson, ExTree } from './model.ts';

const person = (p: Partial<ExPerson> & Pick<ExPerson, 'id' | 'given'>): ExPerson => ({
  furtherGiven: [],
  surname: null,
  currentGiven: null,
  currentSurname: null,
  sex: null,
  born: null,
  bornPlace: null,
  died: null,
  diedPlace: null,
  living: false,
  title: null,
  epithet: null,
  occupation: null,
  nickname: null,
  bio: null,
  portrait: null,
  ...p,
});

const treeOf = (people: ExPerson[]): ExTree => ({ ...emptyTree(), people });

/** Writes the people and reads them back, keyed by their Kindred id. */
function roundTrip(people: ExPerson[]) {
  const { text } = writeGedcom(treeOf(people));
  for (const line of text.split('\r\n')) assert.ok(line.length <= 255, `line too long: ${line.length}`);
  const back = readGedcom(text);
  return { text, back, byId: new Map(back.people.map((p) => [p.preferredId, p])) };
}

test('a continuation line is never cut at a space, so no two words are glued together', () => {
  const bio = 'x'.repeat(119) + ' word after the boundary';
  const { text, byId } = roundTrip([person({ id: 'ann', given: 'Ann', bio })]);
  assert.equal(byId.get('ann')!.bio, bio);
  for (const line of text.split('\r\n')) {
    if (/^\d+ CONC /.test(line)) assert.doesNotMatch(line, /^\d+ CONC \s/, 'a CONC value does not start with a space');
  }
  const noteLines = text.split('\r\n').filter((l) => / (NOTE|CONC) /.test(l));
  for (const l of noteLines.slice(0, -1)) assert.doesNotMatch(l, /\s$/, 'a line that is continued does not end with a space');
});

test('trailing spaces (a Markdown hard break), blank lines and indentation come back', () => {
  const bio = 'Line one  \n   \nindented\tline\n\n\nlast  ';
  const { byId } = roundTrip([person({ id: 'bea', given: 'Bea', bio })]);
  assert.equal(byId.get('bea')!.bio, bio);
});

test('a newline in a death place is written as a continuation line, not a broken line', () => {
  const { back, byId } = roundTrip([person({ id: 'cy', given: 'Cy', diedPlace: 'Hamburg\nAltona', bornPlace: 'Ulm\nSöflingen' })]);
  assert.equal(byId.get('cy')!.diedPlace, 'Hamburg\nAltona');
  assert.equal(byId.get('cy')!.bornPlace, 'Ulm\nSöflingen');
  assert.deepEqual(back.issues.filter((i) => i.code === 'exchange.issue.line_skipped'), []);
});

test('a slash in a name comes back as a slash', () => {
  const { byId } = roundTrip([
    person({ id: 'dee', given: 'Dee/Di', surname: 'Berg/Kern', currentGiven: 'Di/Dee', currentSurname: 'Kern/Berg' }),
    person({ id: 'eli', given: 'Eli', furtherGiven: ['A/B'], surname: null }),
  ]);
  const dee = byId.get('dee')!;
  assert.equal(dee.given, 'Dee/Di');
  assert.equal(dee.surname, 'Berg/Kern');
  assert.equal(dee.currentGiven, 'Di/Dee');
  assert.equal(dee.currentSurname, 'Kern/Berg');
  assert.deepEqual(byId.get('eli')!.furtherGiven, ['A/B']);
});

/** A small seeded generator (mulberry32), so the property test is the same on every run. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The pieces awkward text is made of. */
const PIECES = [
  'word',
  ' ',
  '  ',
  '\t',
  '\n',
  '  \n',
  '\n\n',
  '@',
  '@@',
  '@I1@',
  '@#DJULIAN@',
  '😀',
  '𝔊',
  'é',
  'é',
  'ß',
  '/',
  'x'.repeat(130),
  'y'.repeat(119) + ' ',
  ' '.repeat(125),
  'Anna kept the bakery',
];

function awkward(next: () => number): string {
  const n = 1 + Math.floor(next() * 40);
  let s = '';
  for (let i = 0; i < n; i++) s += PIECES[Math.floor(next() * PIECES.length)];
  // Some texts start with "@" or a space, where a reader is most likely to misread a value.
  const r = next();
  if (r < 0.15) s = '@' + s;
  else if (r < 0.25) s = ' ' + s;
  return s;
}

test('any biography comes back exactly: a property test over awkward texts', () => {
  const next = random(20261109);
  const people: ExPerson[] = [];
  for (let i = 0; i < 300; i++) {
    let bio = awkward(next);
    // A biography that is only whitespace is no biography: the reader keeps none.
    if (!bio.trim()) bio = 'x' + bio;
    people.push(person({ id: `p${i}`, given: `P${i}`, bio }));
  }
  const { byId } = roundTrip(people);
  for (const p of people) {
    const got = byId.get(p.id)!.bio;
    assert.equal(got, p.bio, `biography of ${p.id}: ${JSON.stringify(p.bio)}`);
  }
});

test('any place, title and occupation comes back, with only the spaces around it trimmed', () => {
  const next = random(7);
  const people: ExPerson[] = [];
  for (let i = 0; i < 200; i++) {
    const v = () => {
      const s = awkward(next).trim();
      return s ? s : null;
    };
    people.push(person({ id: `q${i}`, given: `Q${i}`, bornPlace: v(), diedPlace: v(), title: v(), occupation: v(), nickname: v(), living: next() < 0.5 }));
  }
  const { byId } = roundTrip(people);
  for (const p of people) {
    const got = byId.get(p.id)!;
    for (const k of ['bornPlace', 'diedPlace', 'title', 'occupation', 'nickname'] as const) {
      assert.equal(got[k], p[k], `${k} of ${p.id}: ${JSON.stringify(p[k])}`);
    }
  }
});

test('a surrogate pair is never split across two lines', () => {
  const bio = '😀'.repeat(300) + '𝔊'.repeat(7);
  const { text, byId } = roundTrip([person({ id: 'emo', given: 'Emo', bio })]);
  for (const line of text.split('\r\n')) assert.ok(line.isWellFormed(), 'every line is well-formed UTF-16');
  assert.equal(byId.get('emo')!.bio, bio);
});
