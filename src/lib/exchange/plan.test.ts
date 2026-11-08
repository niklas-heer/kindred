import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyTree, fixtureTree } from './fixture.ts';
import { readGedcom, writeGedcom } from './gedcom.ts';
import { planImport } from './plan.ts';
import type { ExTree } from './model.ts';

let n = 0;
const makeId = (given: string) => `${given.toLowerCase()}_new${++n}`;

test('importing into an empty family adds everyone, with their own ids where those are free', () => {
  const plan = planImport(readGedcom(writeGedcom(fixtureTree()).text), emptyTree(), makeId);
  assert.equal(plan.add.length, 8);
  assert.ok(plan.add.some((p) => p.id === 'anna'), 'the id from _KINDRED_ID is kept');
  assert.equal(plan.matched.length, 0);
  assert.equal(plan.conflicts.length, 0);
});

test('importing the same file into the same family changes nothing and says so', () => {
  const tree = fixtureTree();
  const plan = planImport(readGedcom(writeGedcom(tree).text), tree, makeId);
  assert.equal(plan.add.length, 0);
  assert.equal(plan.matched.length, 8);
  assert.ok(plan.matched.every((m) => m.by === 'id'));
  assert.equal(plan.parents.length, 0);
  assert.equal(plan.duplicateParents, tree.parents.length);
  assert.equal(plan.unions.length, 0);
  assert.equal(plan.duplicateUnions, tree.unions.length);
  assert.equal(plan.conflicts.length, 0);
});

test('a file from another program matches by name and birth year, and a different birth year is a conflict', () => {
  const tree = fixtureTree();
  const foreign = [
    '0 HEAD',
    '0 @I1@ INDI',
    '1 NAME Anna /Linden/',
    '1 BIRT',
    '2 DATE ABT 1900', // Kindred has about 1900: the years agree, so it is the same person
    '2 PLAC Lindenby',
    '0 @I2@ INDI',
    '1 NAME Karl /Linden/',
    '1 BIRT',
    '2 DATE 1899', // Kindred has 1898: a different year, so this is a new person
    '0 @I3@ INDI',
    '1 NAME Hanna /Linden/',
    '1 BIRT',
    '2 DATE 1950',
    '2 PLAC Hamburg', // the family has no place for her, so there is nothing to disagree with
    '0 TRLR',
  ].join('\n');
  const plan = planImport(readGedcom(foreign), tree, makeId);
  assert.deepEqual(plan.matched.map((m) => [m.name, m.by]), [
    ['Anna Linden', 'name'],
    ['Hanna Linden', 'name'],
  ]);
  assert.equal(plan.add.length, 1, 'Karl with a different birth year is a new person');
  assert.equal(plan.add[0].given, 'Karl');
  assert.equal(plan.conflicts.length, 0, 'no conflict when one side has no value');
});

test('a different death date or birth place on a matched person is listed, never written over', () => {
  const tree = fixtureTree();
  const back = readGedcom(writeGedcom(tree).text);
  const anna = back.people.find((p) => p.given === 'Anna')!;
  anna.died = '1972';
  anna.bornPlace = 'Hamburg';
  const plan = planImport(back, tree, makeId);
  const fields = plan.conflicts.map((c) => `${c.field}:${c.existing}->${c.incoming}`).sort();
  assert.deepEqual(fields, ['born place:Lindenby->Hamburg', 'died:1971-06-14->1972']);
  assert.equal(plan.add.length, 0, 'the existing person is not re-added');
});

test('a name that matches two people is not guessed at: the person is added and the reader is told', () => {
  const tree: ExTree = {
    ...fixtureTree(),
    people: [...fixtureTree().people, { ...fixtureTree().people[1], id: 'karl2', born: null }],
  };
  const incoming = readGedcom(['0 HEAD', '0 @I1@ INDI', '1 NAME Karl /Linden/', '0 TRLR'].join('\n'));
  const plan = planImport(incoming, tree, makeId);
  assert.deepEqual(plan.ambiguous, ['Karl Linden']);
  assert.equal(plan.add.length, 1);
});

test('a partnership already in the family is counted as present, even with a different id', () => {
  const tree = fixtureTree();
  const incoming = readGedcom(writeGedcom(tree).text);
  incoming.unions[0] = { ...incoming.unions[0], preferredId: 'u-some-other-id' };
  const plan = planImport(incoming, tree, makeId);
  assert.equal(plan.duplicateUnions, tree.unions.length);
  assert.equal(plan.unions.length, 0);
});

test('a link to a person the file does not contain is not written', () => {
  const incoming = readGedcom(['0 HEAD', '0 @I1@ INDI', '1 NAME Ola /Berg/', '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I9@', '1 CHIL @I1@', '0 TRLR'].join('\n'));
  const plan = planImport(incoming, emptyTree(), makeId);
  assert.equal(plan.add.length, 1);
  assert.equal(plan.parents.length, 0);
});

test('two people in one file with the same id: the second is reported, not silently added as a copy', () => {
  const incoming = readGedcom(
    ['0 HEAD', '0 @I1@ INDI', '1 _KINDRED_ID same', '1 NAME Ida /Berg/', '0 @I2@ INDI', '1 _KINDRED_ID same', '1 NAME Ida /Berg/', '0 TRLR'].join('\n'),
  );
  const plan = planImport(incoming, emptyTree(), makeId);
  assert.equal(plan.add.length, 2, 'both are added, because the tree is empty');
  assert.ok(plan.issues.some((i) => /same id as an earlier person/.test(i.message)));
});
