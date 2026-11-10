// node --test src/lib/tree-view.test.ts — the tree page's rules: lenses, a house's first person, folding, walking a
// row with the arrow keys, the generation marks and today's birthdays.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFamily, type Family } from './graph.ts';
import type { LNode } from './layout.ts';
import type { GParent, GPerson, GUnion, Graph, House } from './types.ts';
import { birthdaysOn, foldAllBut, houseRoot, lensMembers, rowMark, rowNeighbour, toggled } from './tree-view.ts';

const person = (id: string, extra: Partial<GPerson> = {}): GPerson => ({ id, given: id, living: true, stories: 0, contacts: 0, ...extra });

// Bram founded nothing but heads House Vale: his son Cas and grandson Dirk are Vales; Cas married Elke (House Moor),
// whose brother Finn has a son Gus. Hugo has no house and no family.
function family(houses: House[] = [{ id: 'vale', name: 'House Vale' }, { id: 'moor', name: 'Moor' }] as House[]): Family {
  const people: GPerson[] = [
    person('bram', { house: 'vale', living: false, born: '1900-03-04' }),
    person('cas', { house: 'vale', born: '1930-11-10' }),
    person('dirk', { house: 'vale', born: '1960-11-10' }),
    person('elke', { house: 'moor', born: '1932-11-10' }),
    person('finn', { house: 'moor', born: '1935' }),
    person('gus', { house: 'moor' }),
    person('hugo', { born: '1990-11-10' }),
    person('moorsire', { house: 'moor', living: false }),
  ];
  const parents: GParent[] = [['cas', 'bram'], ['dirk', 'cas'], ['dirk', 'elke'], ['elke', 'moorsire'], ['finn', 'moorsire'], ['gus', 'finn']]
    .map(([child, parent]) => ({ child, parent, kind: 'biological', confidence: 'certain' }) as GParent);
  const unions: GUnion[] = [{ id: 'u1', a: 'cas', b: 'elke', kind: 'marriage' }];
  const graph: Graph = { tree: { id: 't', name: 'T', tagline: '', theme: 'codex', focus: 'dirk', people: people.length }, houses, places: [], people, parents, unions };
  return buildFamily(graph);
}

const sorted = (s: Set<string> | null) => (s ? [...s].sort() : s);

test('a lens lights the line, the living, the house, the gaps or a path; "none" lights everyone', () => {
  const f = family();
  const opts = { sel: 'cas', from: 'dirk', to: 'gus', gapped: (p: GPerson) => !p.born };
  assert.equal(lensMembers(f, 'none', opts), null);
  assert.deepEqual(sorted(lensMembers(f, 'line', opts)), ['bram', 'cas', 'dirk']);
  assert.deepEqual(sorted(lensMembers(f, 'living', opts)), ['cas', 'dirk', 'elke', 'finn', 'gus', 'hugo']);
  assert.deepEqual(sorted(lensMembers(f, 'house', opts)), ['bram', 'cas', 'dirk']);
  assert.deepEqual(sorted(lensMembers(f, 'gaps', opts)), ['gus', 'moorsire']);
  assert.deepEqual(sorted(lensMembers(f, 'path', opts)), ['dirk', 'elke', 'finn', 'gus', 'moorsire']);
  // No path between two people lights everyone rather than nobody.
  assert.equal(lensMembers(f, 'path', { ...opts, to: 'hugo' }), null);
  // Someone without a house lights everyone else without one.
  assert.deepEqual(sorted(lensMembers(f, 'house', { ...opts, sel: 'hugo' })), ['hugo']);
});

test("a house's tree starts at its founder, else at the member with the most descendants in the house", () => {
  assert.equal(houseRoot(family(), 'vale'), 'bram');
  assert.equal(houseRoot(family(), 'moor'), 'moorsire');
  assert.equal(houseRoot(family([{ id: 'vale', name: 'Vale', founder: 'cas' }] as House[]), 'vale'), 'cas');
  // A founder who is not in the tree is passed over.
  assert.equal(houseRoot(family([{ id: 'vale', name: 'Vale', founder: 'zed' }] as House[]), 'vale'), 'bram');
  assert.equal(houseRoot(family(), 'nobody'), undefined);
});

test('folding the others keeps the line to the selected person open', () => {
  const f = family();
  const nodes = ['bram', 'cas', 'dirk', 'elke', 'finn', 'gus', 'moorsire'].map((id) => ({ id }));
  assert.deepEqual(sorted(foldAllBut(f, nodes, 'dirk')), ['finn']);
  assert.deepEqual(sorted(foldAllBut(f, nodes, 'gus')), ['bram', 'cas', 'elke']);
});

test('toggling adds what is missing and takes out what is there, leaving the original alone', () => {
  const s = new Set(['a']);
  assert.deepEqual([...toggled(s, 'b')], ['a', 'b']);
  assert.deepEqual([...toggled(s, 'a')], []);
  assert.deepEqual([...s], ['a']);
});

test('the arrow keys walk to the nearest real card in the same row', () => {
  const node = (id: string, x: number, row = 0, role: LNode['role'] = 'main'): LNode => ({ key: id, id, x, y: 0, row, role });
  const nodes = [node('a', 0), node('b', 100), node('dup', 150, 0, 'dup'), node('ghost', 180, 0, 'ghost'), node('c', 300), node('up', 120, -1)];
  const cur = { row: 0, x: 100 };
  assert.equal(rowNeighbour(nodes, cur, 'left')?.id, 'a');
  assert.equal(rowNeighbour(nodes, cur, 'right')?.id, 'c');
  assert.equal(rowNeighbour(nodes, { row: 0, x: 300 }, 'right'), undefined);
});

test('a generation row is marked by count in a dynasty and by distance elsewhere', () => {
  assert.equal(rowMark('dynasty', true, 5, 0), 'I');
  assert.equal(rowMark('dynasty', true, 5, 19), 'XX');
  assert.equal(rowMark('dynasty', true, 5, 20), '21');
  assert.equal(rowMark('dynasty', false, 5, 3), '4');
  assert.equal(rowMark('family', true, 0, 3), '●');
  assert.equal(rowMark('family', false, -2, 0), '↑2');
  assert.equal(rowMark('ancestors', false, 3, 0), '↓3');
});

test('birthdays are the living with a full date on this day, with the age they turn', () => {
  const got = birthdaysOn(family().graph.people, new Date(2026, 10, 10));
  assert.deepEqual(got.map((b) => [b.person.id, b.age]), [['cas', 96], ['dirk', 66], ['elke', 94], ['hugo', 36]]);
  assert.deepEqual(birthdaysOn(family().graph.people, new Date(2026, 0, 1)), []);
});
