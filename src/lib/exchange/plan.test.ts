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

// ---------- the link form's parent rules ----------

/** A file with people (id, birth year) and FAM records (parents, children), each child's link of the given kind. */
function familyFile(people: [id: string, born: string | null][], fams: { parents: string[]; children: string[]; kind?: string }[]): string {
  const famcOf = new Map<string, string[]>();
  fams.forEach((f, i) => f.children.forEach((c) => famcOf.set(c, [...(famcOf.get(c) ?? []), `F${i}`])));
  const lines = ['0 HEAD'];
  for (const [id, born] of people) {
    lines.push(`0 @${id}@ INDI`, `1 _KINDRED_ID ${id}`, `1 NAME ${id.toUpperCase()} /Test/`);
    if (born) lines.push('1 BIRT', `2 DATE ${born}`);
    for (const f of famcOf.get(id) ?? []) {
      lines.push(`1 FAMC @${f}@`);
      const kind = fams[Number(f.slice(1))].kind;
      if (kind) lines.push(`2 _KINDRED_KIND ${kind}`);
    }
  }
  fams.forEach((f, i) => {
    lines.push(`0 @F${i}@ FAM`, '1 _KINDRED_KIND parents');
    const [h, w] = f.parents;
    if (h) lines.push(`1 HUSB @${h}@`);
    if (w) lines.push(`1 WIFE @${w}@`);
    for (const c of f.children) lines.push(`1 CHIL @${c}@`);
  });
  lines.push('0 TRLR');
  return lines.join('\n') + '\n';
}

test('a third birth parent for someone already in the family is a conflict, and is not added', () => {
  // The family has Hanna with her two birth parents, Anna and Karl. An older file says Greta and Otto are her parents.
  const tree = fixtureTree();
  const text = familyFile(
    [['hanna', '1950'], ['greta', '1925-03-08'], ['otto', '1944-11']],
    [{ parents: ['otto', 'greta'], children: ['hanna'] }],
  );
  const plan = planImport(readGedcom(text), tree, makeId);
  assert.equal(plan.matched.length, 3);
  assert.deepEqual(plan.parents, [], 'no link is written');
  const refused = plan.conflicts.filter((c) => c.kind === 'parents');
  assert.equal(refused.length, 2);
  assert.ok(refused.every((c) => c.id === 'hanna' && c.field === 'parent'));
  assert.deepEqual(refused.map((c) => c.vars.parent).sort(), ['Greta Berg', 'Otto Linden']);
  assert.ok(plan.issues.some((i) => i.code === 'exchange.issue.parents_refused' && i.vars.count === 2));
  assert.equal(plan.cycles.length, 0, 'these do not refuse the whole file');
});

test('a parent of another kind is not a third parent: a step parent beside two birth parents is added', () => {
  const tree = fixtureTree();
  const text = familyFile([['hanna', '1950'], ['jonas', '1948-07-30']], [{ parents: ['jonas'], children: ['hanna'], kind: 'step' }]);
  const plan = planImport(readGedcom(text), tree, makeId);
  assert.deepEqual(plan.parents.map((l) => `${l.child}<${l.parent}:${l.kind}`), ['hanna<jonas:step']);
  assert.deepEqual(plan.conflicts, []);
});

test('a parent born after (or in the same year as) the child is a conflict, and is not added', () => {
  const text = familyFile(
    [['kid', '1900'], ['young', '1910'], ['same', '1900'], ['old', '1870']],
    [{ parents: ['young', 'old'], children: ['kid'] }, { parents: ['same'], children: ['kid'], kind: 'adoptive' }],
  );
  const plan = planImport(readGedcom(text), emptyTree(), makeId);
  assert.deepEqual(plan.parents.map((l) => `${l.child}<${l.parent}`), ['kid<old']);
  const order = plan.conflicts.filter((c) => c.kind === 'order');
  assert.deepEqual(order.map((c) => c.vars.parent).sort(), ['SAME Test', 'YOUNG Test']);
  assert.ok(order.every((c) => c.vars.name === 'KID Test'));
});

test('a step or foster parent may be younger than the child', () => {
  const text = familyFile([['kid', '1900'], ['step', '1905']], [{ parents: ['step'], children: ['kid'], kind: 'step' }]);
  const plan = planImport(readGedcom(text), emptyTree(), makeId);
  assert.equal(plan.parents.length, 1);
  assert.deepEqual(plan.conflicts, []);
});

test('three birth parents in the file alone: the first two are added and the third is a conflict', () => {
  const text = familyFile(
    [['kid', '1900'], ['a', '1870'], ['b', '1871'], ['c', '1872']],
    [{ parents: ['a', 'b'], children: ['kid'] }, { parents: ['c'], children: ['kid'] }],
  );
  const plan = planImport(readGedcom(text), emptyTree(), makeId);
  assert.deepEqual(plan.parents.map((l) => l.parent), ['a', 'b']);
  assert.deepEqual(plan.conflicts.map((c) => [c.kind, c.vars.parent]), [['parents', 'C Test']]);
});

test('a link with an unknown birth year on either side passes the birth-order rule, as in the link form', () => {
  const text = familyFile([['kid', null], ['p', '1990']], [{ parents: ['p'], children: ['kid'] }]);
  assert.equal(planImport(readGedcom(text), emptyTree(), makeId).parents.length, 1);
});

// ---------- partnerships already in the family ----------

test('re-importing after a marriage date was corrected matches the marriage and lists the difference, adding nothing', () => {
  const tree = fixtureTree();
  const file = readGedcom(writeGedcom(tree).text);
  // The date is corrected in the family after the file was made.
  tree.unions = tree.unions.map((u) => (u.id === 'u-anna-karl' ? { ...u, start: '1921-05-02' } : u));
  const plan = planImport(file, tree, makeId);
  assert.deepEqual(plan.unions, [], 'no second marriage');
  assert.equal(plan.duplicateUnions, tree.unions.length);
  assert.deepEqual(
    plan.conflicts.map((c) => [c.field, c.existing, c.incoming, c.vars.name]),
    [['union start', '1921-05-02', '1920-05-02', 'Anna Linden & Karl Linden']],
  );
});

test('a changed kind, end or place of a partnership is a conflict, never a second partnership', () => {
  const tree = fixtureTree();
  const file = readGedcom(writeGedcom(tree).text);
  tree.unions = tree.unions.map((u) =>
    u.id === 'u-hanna-jonas' ? { ...u, kind: 'marriage' as const } : u.id === 'u-karl-greta' ? { ...u, end: '1961', place: 'Ulm' } : u,
  );
  const plan = planImport(file, tree, makeId);
  assert.deepEqual(plan.unions, []);
  assert.deepEqual(plan.conflicts.map((c) => `${c.field}:${c.existing}->${c.incoming}`).sort(), [
    'union end:1961->1960',
    'union kind:marriage->partnership',
  ]);
  assert.ok(plan.conflicts.every((c) => c.kind === 'value'));
});

test('a partnership id that is already taken is not reused for a different couple', () => {
  const tree = fixtureTree();
  // A file with a new couple whose partnership carries an id the family already uses.
  const text = [
    '0 HEAD',
    '0 @a@ INDI', '1 NAME Ida /Neu/',
    '0 @b@ INDI', '1 NAME Ole /Neu/',
    '0 @F1@ FAM', '1 _KINDRED_ID u-anna-karl', '1 _KINDRED_KIND marriage', '1 HUSB @b@', '1 WIFE @a@',
    '0 TRLR',
  ].join('\n');
  const plan = planImport(readGedcom(text), tree, makeId);
  assert.equal(plan.unions.length, 1);
  assert.notEqual(plan.unions[0].id, 'u-anna-karl');
  assert.match(plan.unions[0].id, /^union_new/);
});

test('new people and partnerships never share an id, even when the id maker repeats itself', () => {
  // Two people named alike and two partnerships without ids of their own, and an id maker that always says the same:
  // newId's six hex digits do that in practice once a file has a few thousand partnerships.
  const text = [
    '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
    '0 @I1@ INDI', '1 NAME Ada /Testfield/', '0 @I2@ INDI', '1 NAME Ada /Testfield/',
    '0 @I3@ INDI', '1 NAME Bo /Testfield/', '0 @I4@ INDI', '1 NAME Cy /Testfield/',
    '0 @F1@ FAM', '1 HUSB @I3@', '1 WIFE @I1@', '1 MARR', '0 @F2@ FAM', '1 HUSB @I4@', '1 WIFE @I2@', '1 MARR', '0 TRLR', '',
  ].join('\r\n');
  const plan = planImport(readGedcom(text), emptyTree(), (given) => `${given.toLowerCase()}_same`);
  const people = plan.add.map((p) => p.id);
  assert.equal(new Set(people).size, people.length, `people: ${people.join(', ')}`);
  const unions = plan.unions.map((u) => u.id);
  assert.equal(unions.length, 2);
  assert.equal(new Set(unions).size, 2, `partnerships: ${unions.join(', ')}`);
});

test('new sources, events and citations never share an id: a file with 20,000 events, as newId makes them', () => {
  // newId's six hex digits: among 20,000 new ids a dozen pairs are alike, on average.
  const newIdLike = (given: string) => `${given}_${crypto.randomUUID().slice(0, 6)}`;
  const N = 20_000;
  const lines = ['0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8', '0 @I1@ INDI', '1 NAME Ada /Testfield/'];
  for (let i = 0; i < N; i++) lines.push('1 EVEN', `2 TYPE Thing ${i}`, `2 DATE ${1000 + (i % 900)}`, `2 SOUR @S${i % 5000}@`, `3 PAGE p${i}`);
  for (let i = 0; i < 5000; i++) lines.push(`0 @S${i}@ SOUR`, `1 TITL Source ${i}`);
  lines.push('0 TRLR', '');
  const plan = planImport(readGedcom(lines.join('\n')), emptyTree(), newIdLike);
  const distinct = (ids: string[]) => new Set(ids).size;
  assert.equal(plan.events.length, N);
  assert.equal(distinct(plan.events.map((e) => e.id)), N, 'events');
  assert.equal(distinct(plan.sources.map((x) => x.id)), plan.sources.length, 'sources');
  assert.equal(plan.citations.length, N);
  assert.equal(distinct(plan.citations.map((c) => c.id)), N, 'citations');
  // An id maker that always says the same still gives each its own.
  const small = planImport(readGedcom(lines.slice(0, 6 + 5 * 3).concat('0 @S0@ SOUR', '1 TITL A', '0 @S1@ SOUR', '1 TITL B', '0 @S2@ SOUR', '1 TITL C', '0 TRLR', '').join('\n')), emptyTree(), (given) => `${given}_same`);
  assert.equal(distinct(small.events.map((e) => e.id)), 3);
  assert.equal(distinct(small.sources.map((x) => x.id)), 3);
  assert.equal(distinct(small.citations.map((c) => c.id)), 3);
});
