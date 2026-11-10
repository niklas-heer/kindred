// node --test src/lib/print.test.ts — the Print page's rules: what of the living goes on paper, who is in a book and in which
// order, where ancestors and descendants stand on a chart, and how blocks are laid on pages.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFamily } from './graph.ts';
import {
  ancestorSlots, bookSections, clampGenerations, descendantTree, estimatePages, forPaper, namesOnly, Paginator, placeDescendants, registerLines, registerPages,
  roundEstimate, scopePeople, sheetSize, type Block,
} from './print.ts';
import type { GPerson, Graph } from './types.ts';

const person = (id: string, over: Partial<GPerson> = {}): GPerson => ({ id, given: id, living: false, stories: 0, contacts: 0, ...over });
const arms = { field: 'azure', division: 'plain', charge: 'none', chargeTincture: 'or' } as const;
const graph: Graph = {
  tree: { id: 'family', name: 'Family', tagline: '', theme: 'codex', focus: 'cleo', people: 7 },
  houses: [{ id: 'alder', name: 'Alder', arms }, { id: 'birch', name: 'Birch', arms }],
  people: [
    person('ada', { surname: 'Alder', house: 'alder', sex: 'f', born: '1890', died: '1960', bornPlace: 'Lindholm' }),
    person('bo', { surname: 'Birch', house: 'birch', sex: 'm', born: '1888', died: '1950' }),
    person('ben', { surname: 'Birch', house: 'birch', sex: 'm', born: '1920', died: '1990' }),
    person('dora', { surname: 'Alder', house: 'alder', sex: 'f', born: '1922', died: '2001' }),
    person('cleo', { surname: 'Birch', house: 'birch', sex: 'f', born: '2010-04-02', bornPlace: 'Brookmere', occupation: 'Pupil', living: true, photo: '1', portrait: 'portrait/x.png', stories: 2 }),
    person('eve', { surname: 'Elm', sex: 'f', born: '1925', living: true }),
    person('zed', { born: '1700', died: '1760' }),
  ],
  parents: [
    { child: 'ben', parent: 'ada', kind: 'biological', confidence: 'certain' },
    { child: 'ben', parent: 'bo', kind: 'biological', confidence: 'certain' },
    { child: 'dora', parent: 'ada', kind: 'biological', confidence: 'certain' },
    { child: 'cleo', parent: 'ben', kind: 'biological', confidence: 'certain' },
  ],
  unions: [
    { id: 'u1', a: 'ada', b: 'bo', kind: 'marriage', start: '1915', place: 'Lindholm' },
    { id: 'u2', a: 'ben', b: 'eve', kind: 'marriage', start: '1950-06-01', place: 'Brookmere' },
  ],
  places: [],
};
const f = buildFamily(graph);

test('paper sizes turn for landscape, and generations stay within what a chart can show', () => {
  assert.deepEqual(sheetSize('a4', 'portrait'), { w: 210, h: 297 });
  assert.deepEqual(sheetSize('letter', 'landscape'), { w: 279.4, h: 215.9 });
  assert.equal(clampGenerations('ancestors', 9), 6);
  assert.equal(clampGenerations('ancestors', 2), 4);
  assert.equal(clampGenerations('descendants', undefined), 4);
});

test('by default a living person is on paper by name only: no dates, places, occupation or photo', () => {
  const cleo = namesOnly(f.byId.get('cleo')!);
  assert.deepEqual(cleo, { id: 'cleo', given: 'cleo', living: true, stories: 0, contacts: 0, surname: 'Birch', house: 'birch', sex: 'f' });
  assert.equal(namesOnly(f.byId.get('ada')!), f.byId.get('ada'), 'the dead are untouched');
  const paper = forPaper(graph, { living: false, photos: true });
  assert.equal(paper.people.find((p) => p.id === 'cleo')!.born, undefined);
  assert.equal(paper.people.find((p) => p.id === 'ada')!.born, '1890');
  // A marriage with a living partner keeps who and what it is, without its date and place.
  assert.deepEqual(paper.unions.find((u) => u.id === 'u2'), { id: 'u2', a: 'ben', b: 'eve', kind: 'marriage' });
  assert.equal(paper.unions.find((u) => u.id === 'u1')!.start, '1915');
});

test('the living in full is the family as it is, and "no photos" takes every photo', () => {
  assert.equal(forPaper(graph, { living: true, photos: true }), graph);
  const drawn = forPaper(graph, { living: true, photos: false });
  const cleo = drawn.people.find((p) => p.id === 'cleo')!;
  assert.equal(cleo.photo, undefined);
  assert.equal(cleo.portrait, undefined);
  assert.equal(cleo.born, '2010-04-02');
});

test('a pedigree puts the father first and the mother second, and leaves unknown places open', () => {
  assert.deepEqual(ancestorSlots(f, 'cleo', 3), [['cleo'], ['ben', undefined], ['bo', 'ada', undefined, undefined]]);
  assert.deepEqual(ancestorSlots(f, 'dora', 2), [['dora'], [undefined, 'ada']], 'a lone mother stands in the second place');
  assert.deepEqual(ancestorSlots(f, 'nobody', 2), [[undefined], [undefined, undefined]]);
});

test('descendants are a tree to the asked depth, with partners, and laid out as a tree or an outline', () => {
  const tree = descendantTree(f, 'ada', 3)!;
  assert.deepEqual(tree.partners, ['bo']);
  assert.deepEqual(tree.children.map((c) => c.id), ['ben', 'dora']);
  assert.deepEqual(tree.children[0].children.map((c) => c.id), ['cleo']);
  assert.equal(descendantTree(f, 'ada', 2)!.children[0].children.length, 0);
  assert.equal(descendantTree(f, 'nobody', 3), undefined);
  const asTree = placeDescendants(tree, 'tree');
  assert.equal(asTree.rows, 2, 'as tall as it has leaves');
  assert.deepEqual(Object.fromEntries(asTree.placed.map((p) => [p.node.id, p.row])), { ada: 0.5, ben: 0, cleo: 0, dora: 1 });
  const outline = placeDescendants(tree, 'outline');
  assert.deepEqual(outline.placed.map((p) => [p.node.id, p.row]), [['ada', 0], ['ben', 1], ['cleo', 2], ['dora', 3]]);
});

test('someone who descends twice stands twice, and their children once', () => {
  const g: Graph = { ...graph, parents: [...graph.parents, { child: 'cleo', parent: 'dora', kind: 'adoptive', confidence: 'certain' }] };
  const tree = descendantTree(buildFamily(g), 'ada', 4)!;
  const cleos = [tree.children[0].children[0], tree.children[1].children[0]];
  assert.deepEqual(cleos.map((c) => [c.id, c.repeat]), [['cleo', false], ['cleo', true]]);
  assert.notEqual(cleos[0].key, cleos[1].key);
});

test('a scope names its people: a house, a line up, a line down with partners, one person, everyone', () => {
  assert.deepEqual(scopePeople(f, 'house', { house: 'alder' }).sort(), ['ada', 'dora']);
  assert.deepEqual(scopePeople(f, 'ancestors', { person: 'cleo' }).sort(), ['ada', 'ben', 'bo', 'cleo']);
  assert.deepEqual(scopePeople(f, 'descendants', { person: 'ada' }).sort(), ['ada', 'ben', 'bo', 'cleo', 'dora', 'eve']);
  assert.deepEqual(scopePeople(f, 'person', { person: 'zed' }), ['zed']);
  assert.equal(scopePeople(f, 'everyone', {}).length, 7);
  assert.deepEqual(scopePeople(f, 'descendants', { person: 'nobody' }), []);
});

test('a book has a section per house in the family’s order, the oldest generation first, then those without a house', () => {
  const sections = bookSections(f, scopePeople(f, 'everyone', {}));
  assert.deepEqual(sections, [
    { house: 'alder', people: ['ada', 'dora'] },
    { house: 'birch', people: ['bo', 'ben', 'cleo'] },
    { house: '', people: ['zed', 'eve'] },
  ]);
  assert.deepEqual(bookSections(f, ['dora']), [{ house: 'alder', people: ['dora'] }]);
});

test('the estimate grows with the people and what is told of them, and is said roundly', () => {
  const all = bookSections(f, scopePeople(f, 'everyone', {}));
  const brief = estimatePages(f, all, { living: false, photos: true });
  const full = estimatePages(f, all, { living: true, photos: true });
  assert.ok(brief >= 3 && full > brief, `${brief} then ${full}`);
  assert.equal(roundEstimate(37), 37);
  assert.equal(roundEstimate(412), 410);
  assert.equal(roundEstimate(1873), 1900);
});

const blocks = (prefix: string, ...heights: (number | [number, 'keep'])[]): Block[] =>
  heights.map((h, i) => (typeof h === 'number' ? { key: `${prefix}${i}`, h } : { key: `${prefix}${i}`, h: h[0], keep: true }));

test('a group that fits stays whole; with little room left it moves whole to the next page', () => {
  const p = new Paginator(100);
  assert.equal(p.add(blocks('a', 30, 30)), 0);
  assert.equal(p.add(blocks('b', 20, 15)), 0);
  // 5 left: not worth starting on.
  assert.equal(p.add(blocks('c', 40, 20)), 1);
  assert.deepEqual(p.pages.map((x) => x.keys), [['a0', 'a1', 'b0', 'b1'], ['c0', 'c1']]);
  assert.ok(p.pages.every((x) => x.used <= 100));
});

test('with a good part of the page left a group starts there and breaks between blocks, a kept block with the next', () => {
  const p = new Paginator(100);
  p.add(blocks('a', 50));
  assert.equal(p.add(blocks('b', [20, 'keep'], 20, 20)), 0, 'its first page is where its head is');
  assert.deepEqual(p.pages.map((x) => x.keys), [['a0', 'b0', 'b1'], ['b2']]);
  const q = new Paginator(100);
  q.add(blocks('a', 65));
  // The head alone would fit, but it is held to the block after it: both go over.
  q.add(blocks('b', [20, 'keep'], 20, 20));
  assert.deepEqual(q.pages.map((x) => x.keys), [['a0'], ['b0', 'b1', 'b2']]);
});

test('a group longer than a page runs over pages, and no page is over-full unless one block alone is', () => {
  const p = new Paginator(100);
  p.add(blocks('a', [30, 'keep'], 40, 40, 40, 40));
  assert.deepEqual(p.pages.map((x) => x.keys), [['a0', 'a1'], ['a2', 'a3'], ['a4']]);
  const kept = new Paginator(100);
  kept.add(blocks('k', [60, 'keep'], [60, 'keep'], 60));
  assert.deepEqual(kept.pages.map((x) => x.keys), [['k0'], ['k1'], ['k2']], 'a kept run taller than a page lets go');
});

test('a section starts on a new page and names the pages after it', () => {
  const p = new Paginator(100);
  p.startSection('Alder');
  p.add(blocks('a', 10));
  p.startSection('Birch');
  p.add(blocks('b', 10));
  assert.deepEqual(p.pages.map((x) => [x.section, x.keys]), [['Alder', ['a0']], ['Birch', ['b0']]]);
});

test('the register files people by surname under letters, and fills columns without leaving a letter at a foot', () => {
  const lines = registerLines(f, ['cleo', 'ada', 'zed', 'eve', 'dora'], (a, b) => a.localeCompare(b));
  assert.deepEqual(lines.map((l) => l.text), ['A', 'Alder, ada', 'Alder, dora', 'B', 'Birch, cleo', 'E', 'Elm, eve', 'Z', 'zed']);
  const pages = registerPages(lines, 4, 2, 3);
  // First page: columns of 3. "B" would be the last line of the first column, so it opens the second.
  assert.deepEqual(pages.map((page) => page.map((column) => column.map((l) => l.text))), [
    [['A', 'Alder, ada', 'Alder, dora'], ['B', 'Birch, cleo']],
    [['E', 'Elm, eve', 'Z', 'zed']],
  ]);
});
