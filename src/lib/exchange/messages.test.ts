// What the import preview says, in each language. Every code a file can produce has its text in German and
// Afrikaans, with its values filled in, so a reader never meets a bare key or an English sentence in another
// language. The file below is built to trigger every kind of note and conflict the reader can see.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingKeys, translate, type Key } from '../i18n/dictionary.ts';
import type { Vars } from '../i18n/types.ts';
import { fixtureTree } from './fixture.ts';
import { readGedcom } from './gedcom.ts';
import type { ExTree } from './model.ts';
import { planImport } from './plan.ts';

let n = 0;
const makeId = (given: string) => `${given.toLowerCase()}_msg${++n}`;

/** The family as it is: the fixture, plus a second Karl Linden, so a file's “Karl Linden” matches two people. */
function existing(): ExTree {
  const tree = fixtureTree();
  return { ...tree, people: [...tree.people, { ...tree.people[1], id: 'karl2', born: null }] };
}

const messy = [
  '0 HEAD',
  '2 DATE 1900', // sits under nothing
  '1 CHAR ISO-8859-1', // a charset that is not UTF-8
  'this line is not GEDCOM', // skipped
  '0 @I1@ INDI',
  '1 _KINDRED_ID same',
  '1 NAME Ida /Berg/',
  '1 BIRT',
  '2 DATE BEF 1900', // a date Kindred can only keep as about
  '1 _WEIRD x', // an unknown tag
  '0 @I2@ INDI',
  '1 _KINDRED_ID same', // the same id as an earlier person
  '1 NAME /Nobody/', // no given name
  '0 @I3@ INDI',
  '1 _KINDRED_ID anna', // matches Anna by id, with another birth place: a value conflict
  '1 NAME Anna /Linden/',
  '1 BIRT',
  '2 PLAC Hamburg',
  '0 @I4@ INDI',
  '1 NAME Karl /Linden/', // matches two people in the family
  '0 @F1@ FAM',
  '1 HUSB @I1@',
  '1 WIFE @I9@', // not in the file
  '1 CHIL @I2@',
  '0 @F2@ FAM',
  '1 HUSB @I1@',
  '1 MARR', // a marriage with one spouse
  '0 @F3@ FAM',
  '1 HUSB @I2@',
  '1 CHIL @I1@', // closes a loop: I1 is I2's parent, so I2 cannot be I1's
  '0 TRLR',
].join('\n');

test('every line the preview shows for a messy file has its text in German and Afrikaans', () => {
  const incoming = readGedcom(messy);
  const plan = planImport(incoming, existing(), makeId);
  const lines: { code: Key; vars: Vars }[] = [
    ...plan.issues.map((i) => ({ code: i.code, vars: i.vars })),
    ...plan.conflicts.map((c) => ({ code: c.code, vars: c.vars })),
  ];

  const codes = new Set(lines.map((l) => l.code));
  const expected = [
    'exchange.issue.line_skipped',
    'exchange.issue.line_orphan',
    'exchange.issue.tag_skipped',
    'exchange.issue.charset',
    'exchange.issue.no_given_name',
    'exchange.issue.unknown_ref',
    'exchange.issue.union_spouses',
    'exchange.issue.duplicate_id',
    'exchange.issue.ambiguous',
    'exchange.issue.cycles',
    'exchange.issue.date_birth',
    'exchange.conflict.field.born_place',
    'exchange.conflict.field.parent',
  ];
  for (const code of expected) assert.ok(codes.has(code as Key), `the messy file produces ${code}`);

  for (const { code, vars } of lines) {
    for (const locale of ['de', 'af'] as const) {
      assert.ok(!missingKeys(locale).includes(code), `${locale} has ${code}`);
      const text = translate(locale, code, vars);
      assert.doesNotMatch(text, /\{\w+\}/, `${locale} ${code} has every value filled in: ${text}`);
    }
  }
});

test('the conflicts carry the field and kind the sentence needs', () => {
  const plan = planImport(readGedcom(messy), existing(), makeId);
  const place = plan.conflicts.find((c) => c.code === 'exchange.conflict.field.born_place');
  assert.ok(place);
  assert.equal(place.kind, 'value');
  assert.equal(place.field, 'born place');
  // The route builds the sentence from the value sentence and the translated field name.
  const sentence = translate('de', 'exchange.conflict.value', { ...place.vars, field: translate('de', place.code) });
  assert.equal(sentence, 'Anna Linden: Geburtsort ist hier „Lindenby“ und in der Datei „Hamburg“; es bleibt, wie es ist');

  const loop = plan.conflicts.find((c) => c.kind === 'cycle');
  assert.ok(loop);
  assert.equal(loop.code, 'exchange.conflict.field.parent');
  assert.deepEqual(Object.keys(loop.vars).sort(), ['name', 'parent']);
  assert.equal(translate('af', 'exchange.conflict.cycle', loop.vars), `${loop.vars.parent} is reeds ’n nakomeling van ${loop.vars.name}, so kan nie ${loop.vars.name} se ouer wees nie`);
});

test('the refusals and the loop count are translated, and the count picks the plural', () => {
  for (const key of ['exchange.cycle_refused', 'exchange.import.needAllow'] as const) {
    for (const locale of ['de', 'af'] as const) assert.notEqual(translate(locale, key), translate('en', key), `${locale} ${key}`);
  }
  assert.match(translate('de', 'exchange.issue.cycles', { count: 1 }), /^1 Elternverbindung würde/);
  assert.match(translate('de', 'exchange.issue.cycles', { count: 2 }), /^2 Elternverbindungen würden/);
  assert.match(translate('af', 'exchange.issue.cycles', { count: 2 }), /^2 ouerskakels sou/);
});

test('every exchange key has an Afrikaans entry, so the preview is complete in all three languages', () => {
  const gaps = missingKeys('af').filter((k) => k.startsWith('exchange.'));
  assert.deepEqual(gaps, [], 'no exchange key falls back to English in Afrikaans');
});
