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

// ---------- ancestry cycles ----------

/** A GEDCOM file with the given people (by id, named after it) and one family per parent link, the parent as husband. */
function fileWith(people: string[], links: [child: string, parent: string][]): string {
  const lines = [
    '0 HEAD',
    ...people.flatMap((id) => [`0 @${id}@ INDI`, `1 NAME ${id.toUpperCase()} /Test/`]),
    ...links.flatMap(([child, parent], i) => [`0 @F${i}@ FAM`, `1 HUSB @${parent}@`, `1 CHIL @${child}@`]),
    '0 TRLR',
  ];
  return lines.join('\n') + '\n';
}

test('two people who are each the other’s parent: one link is added, the other is refused as a conflict', () => {
  const plan = planImport(readGedcom(fileWith(['a', 'b'], [['b', 'a'], ['a', 'b']])), emptyTree(), makeId);
  assert.equal(plan.add.length, 2);
  assert.equal(plan.parents.length, 1, 'the first link is kept');
  assert.equal(plan.cycles.length, 1, 'the link that closes the loop is refused');
  assert.deepEqual(
    { child: plan.cycles[0].childName, parent: plan.cycles[0].parentName },
    { child: 'A Test', parent: 'B Test' },
  );
  assert.equal(plan.conflicts.filter((c) => c.field === 'parent').length, 1, 'shown as a conflict in the preview');
  assert.ok(plan.issues.some((i) => i.level === 'loss'), 'and reported as a loss');
});

test('a longer loop of three is caught at the link that closes it, and the two links before it are kept', () => {
  // a is b's parent, b is c's parent, c is a's parent: the last link closes the loop.
  const plan = planImport(readGedcom(fileWith(['a', 'b', 'c'], [['b', 'a'], ['c', 'b'], ['a', 'c']])), emptyTree(), makeId);
  assert.equal(plan.parents.length, 2);
  assert.equal(plan.cycles.length, 1);
  assert.equal(plan.cycles[0].childName, 'A Test');
  assert.equal(plan.cycles[0].parentName, 'C Test');
});

test('a loop through the family’s existing links is caught, even though the file alone has none', () => {
  const tree = fixtureTree();
  const [link] = tree.parents;
  const name = (id: string) => {
    const p = tree.people.find((x) => x.id === id)!;
    return { given: p.given, surname: p.surname };
  };
  const child = name(link.child);
  const parent = name(link.parent);
  // The file says the family's child is the parent of the family's parent: a loop through the existing link.
  const text = [
    '0 HEAD',
    `0 @x@ INDI`, `1 NAME ${child.given} /${child.surname ?? ''}/`,
    `0 @y@ INDI`, `1 NAME ${parent.given} /${parent.surname ?? ''}/`,
    '0 @F1@ FAM', '1 HUSB @x@', '1 CHIL @y@',
    '0 TRLR',
  ].join('\n') + '\n';
  const plan = planImport(readGedcom(text), tree, makeId);
  assert.equal(plan.matched.length, 2, 'both people are the family’s own');
  assert.equal(plan.cycles.length, 1);
  assert.equal(plan.parents.length, 0);
});

test('a family with two parents, and the diamond above it, is not a loop', () => {
  // a is the parent of b and c; b and c are both parents of d. Nothing loops back.
  const plan = planImport(readGedcom(fileWith(['a', 'b', 'c', 'd'], [['b', 'a'], ['c', 'a'], ['d', 'b'], ['d', 'c']])), emptyTree(), makeId);
  assert.equal(plan.parents.length, 4);
  assert.equal(plan.cycles.length, 0);
  assert.equal(plan.conflicts.filter((c) => c.field === 'parent').length, 0);
});
