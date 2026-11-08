// The family view draws every partner of every person shown, each child hangs from the union it was born of,
// and nothing overlaps. The family here: a focus (Lotte), her parents Arno (three partners, one divorced) and
// Cosima, and Cosima's father Edmund, who married twice and had children from both marriages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFamily, children, kinship, partnersOf, type Family } from './graph.ts';
import { CARD_W, layout, type LNode, type Layout } from './layout.ts';
import type { GPerson, GParent, GUnion, Graph } from './types.ts';

const person = (id: string, given: string, sex: 'm' | 'f', born?: string, died?: string): GPerson => ({
  id, given, sex, born, died, living: !died, stories: 0, contacts: 0,
});

function family(withSibling = false): Family {
  const people: GPerson[] = [
    person('edmund', 'Edmund', 'm', '1928-09-21', '2005-07-20'),
    person('ottilie', 'Ottilie', 'f', '1934-02-11', '1962-04-10'),
    person('theda', 'Theda', 'f', '1941-08-02'),
    person('cosima', 'Cosima', 'f', '1953-09-01'),
    person('wanda', 'Wanda', 'f', '1957-02-14'),
    person('ragna', 'Ragna', 'f', '1965-11-08'),
    person('ulrich', 'Ulrich', 'm', '1966-01-20'),
    person('arno', 'Arno', 'm', '~1950', '2019-12-01'),
    person('frieda', 'Frieda', 'f', '1951-07-30'),
    person('konrad', 'Konrad', 'm', '1972-06-14'),
    person('irmgard', 'Irmgard', 'f', '1960'),
    person('lotte', 'Lotte', 'f', '1981-03-22'),
    ...(withSibling ? [person('egon', 'Egon', 'm', '1979-05-05'), person('hedda', 'Hedda', 'f', '1980-02-02')] : []),
  ];
  const parents: GParent[] = [
    ['cosima', 'edmund'], ['cosima', 'ottilie'], ['wanda', 'edmund'], ['wanda', 'ottilie'],
    ['ragna', 'edmund'], ['ragna', 'theda'], ['ulrich', 'edmund'], ['ulrich', 'theda'],
    ['konrad', 'arno'], ['konrad', 'frieda'], ['lotte', 'arno'], ['lotte', 'cosima'],
    ...(withSibling ? [['egon', 'arno'], ['egon', 'cosima']] : []),
  ].map(([child, parent]) => ({ child, parent, kind: 'biological', confidence: 'certain' }) as GParent);
  const unions: GUnion[] = [
    { id: 'u-rm', a: 'edmund', b: 'ottilie', kind: 'marriage', start: '1953-06-13', end: '1962-04-10', endReason: 'death' },
    { id: 'u-rh', a: 'edmund', b: 'theda', kind: 'marriage', start: '1965-04-03' },
    { id: 'u-kg', a: 'arno', b: 'frieda', kind: 'partnership', start: '1971-05', end: '1974-03', endReason: 'separation' },
    { id: 'u-ke', a: 'arno', b: 'cosima', kind: 'marriage', start: '1978-08-19' },
    { id: 'u-kb', a: 'arno', b: 'irmgard', kind: 'marriage', start: '1999-05-22', end: '2008-02-29', endReason: 'divorce' },
    ...(withSibling ? [{ id: 'u-ta', a: 'egon', b: 'hedda', kind: 'marriage' as const, start: '2005-07-01' }] : []),
  ];
  const graph: Graph = {
    tree: { id: 't', name: 'T', tagline: '', theme: 'modern', focus: 'lotte', people: people.length },
    houses: [], places: [], people, parents, unions,
  };
  return buildFamily(graph);
}

const LAYOUT = { line: 'all' as const, up: 4, down: 3, collapsed: new Set<string>() };
const family_ = (f: Family, focus: string): Layout => layout(f, { ...LAYOUT, view: 'family', focus });

const mainOf = (l: Layout, id: string) => l.nodes.find((n) => n.id === id && n.role === 'main');
const xOfMarried = (l: Layout, id: string, partnerId: string) => {
  // The centre of the marriage between two people: the midpoint of their cards in the layout.
  const a = l.nodes.find((n) => n.id === id && (n.role === 'main' || n.role === 'dup'))!;
  const b = l.nodes.find((n) => n.id === partnerId && n.role !== 'ghost' && Math.abs(n.y - a.y) < 1)!;
  return (a.x + b.x) / 2;
};
/** The x where an edge's connector starts: the first move of its path. */
const startX = (d: string) => parseFloat(/^M(-?[\d.]+),/.exec(d)![1]);

test('every partner of every person shown is drawn beside them', () => {
  const f = family();
  for (const focus of ['lotte', 'cosima', 'edmund']) {
    const l = family_(f, focus);
    const drawn = new Set(l.nodes.map((n) => n.id));
    for (const n of l.nodes) {
      if (n.role === 'ghost') continue;
      for (const p of partnersOf(f, n.id)) assert.ok(drawn.has(p), `${focus}: ${p} is a partner of ${n.id} but is not drawn`);
    }
  }
});

test('ancestors keep every partner: Edmund shows Theda and Ottilie, Arno shows his three partners', () => {
  const l = family_(family(), 'lotte');
  const partnersDrawn = (id: string) => l.nodes.filter((n) => n.role === 'partner' || n.role === 'dup').filter((n) => partnersOf(family(), id).includes(n.id)).map((n) => n.id);
  assert.ok(l.nodes.some((n) => n.id === 'theda' && n.role === 'partner'), 'Theda beside Edmund');
  assert.ok(l.nodes.some((n) => n.id === 'frieda' && n.role === 'partner'), 'Frieda beside Arno');
  assert.ok(l.nodes.some((n) => n.id === 'irmgard' && n.role === 'partner'), 'Irmgard beside Arno');
  assert.ok(l.nodes.some((n) => n.id === 'cosima' && n.role === 'main'), 'Cosima is the other parent');
  assert.ok(partnersDrawn('arno').length >= 2);
});

test('a second partner sits on the outer side, in marriage order, nearest the person first', () => {
  const l = family_(family(), 'lotte');
  const arno = mainOf(l, 'arno')!;
  const frieda = l.nodes.find((n) => n.id === 'frieda' && n.role === 'partner')!;
  const irmgard = l.nodes.find((n) => n.id === 'irmgard' && n.role === 'partner')!;
  assert.ok(frieda.x < arno.x && irmgard.x < frieda.x, 'Frieda (1971) is nearer Arno than Irmgard (1999), both to his left');
  // Cosima, the other parent, stays on the other side of the line.
  assert.ok(mainOf(l, 'cosima')!.x > arno.x);
});

function assertNoOverlap(l: Layout, label: string) {
  const cards = l.nodes.filter((n) => n.role !== 'ghost');
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
    const a: LNode = cards[i], b: LNode = cards[j];
    if (a.row !== b.row) continue;
    assert.ok(Math.abs(a.x - b.x) >= CARD_W - 1, `${label}: ${a.id} (${a.key}) and ${b.id} (${b.key}) overlap on row ${a.row}`);
  }
}

test('no two cards overlap on the same row, in any view', () => {
  const f = family();
  for (const focus of ['lotte', 'cosima', 'edmund']) assertNoOverlap(family_(f, focus), `family ${focus}`);
  assertNoOverlap(layout(f, { view: 'dynasty', focus: 'edmund', root: 'edmund', line: 'all', up: 4, down: 4, collapsed: new Set() }), 'dynasty edmund');
  assertNoOverlap(layout(f, { view: 'dynasty', focus: 'arno', root: 'arno', line: 'all', up: 4, down: 4, collapsed: new Set() }), 'dynasty arno');
  assertNoOverlap(layout(f, { view: 'ancestors', focus: 'lotte', line: 'all', up: 4, down: 4, collapsed: new Set() }), 'ancestors lotte');
});

test("a child of the second marriage hangs from that marriage, not the first", () => {
  const l = family_(family(), 'lotte');
  const hildaAt = xOfMarried(l, 'edmund', 'theda');
  const helgaEdge = l.edges.find((e) => e.ids.includes('ragna') && e.ids.includes('theda'));
  assert.ok(helgaEdge, 'Ragna is connected to her mother Theda');
  assert.ok(!helgaEdge!.ids.includes('ottilie'), "Ragna's connector does not go through Ottilie");
  assert.ok(Math.abs(startX(helgaEdge!.d) - hildaAt) < 0.5, "Ragna's connector starts at the Edmund–Theda marriage");
  const mariaEdge = l.edges.find((e) => e.ids.includes('wanda') && e.ids.includes('ottilie'));
  assert.ok(mariaEdge, 'Wanda is connected to Ottilie');
  assert.ok(!mariaEdge!.ids.includes('theda'));
  assert.ok(Math.abs(startX(mariaEdge!.d) - xOfMarried(l, 'edmund', 'ottilie')) < 0.5);
});

test("a half-sibling of the focus hangs from the parent's other marriage", () => {
  const l = family_(family(), 'lotte');
  const jonasEdge = l.edges.find((e) => e.ids.includes('konrad') && e.ids.includes('frieda'));
  assert.ok(jonasEdge, 'Konrad is connected to Frieda');
  assert.ok(!jonasEdge!.ids.includes('cosima'));
  assert.ok(Math.abs(startX(jonasEdge!.d) - xOfMarried(l, 'arno', 'frieda')) < 0.5);
});

test('the descendant view draws each union with its own children', () => {
  const f = family();
  const l = layout(f, { view: 'dynasty', focus: 'edmund', root: 'edmund', line: 'all', up: 4, down: 4, collapsed: new Set() });
  assert.deepEqual(children(f, 'edmund').sort(), ['cosima', 'ulrich', 'ragna', 'wanda'].sort());
  assert.ok(l.nodes.some((n) => n.id === 'theda' && n.role === 'partner'));
  const helgaEdge = l.edges.find((e) => e.ids.includes('ragna') && e.ids.includes('theda'));
  assert.ok(helgaEdge && !helgaEdge.ids.includes('ottilie'));
});

test('the ancestors view is the pedigree: parents only, no extra partners', () => {
  const l = layout(family(), { view: 'ancestors', focus: 'lotte', line: 'all', up: 4, down: 4, collapsed: new Set() });
  assert.ok(!l.nodes.some((n) => n.role === 'partner'), 'no partner cards');
  assert.ok(!l.nodes.some((n) => n.id === 'theda'), 'Theda is not in the pedigree');
  assert.ok(l.nodes.some((n) => n.id === 'edmund' && n.role === 'main'));
});

test('kinship: half-relations come from the union the line runs through', () => {
  const f = family();
  assert.equal(kinship(f, 'lotte', 'ragna')?.label, 'half-aunt');
  assert.equal(kinship(f, 'lotte', 'ulrich')?.label, 'half-uncle');
  assert.equal(kinship(f, 'lotte', 'wanda')?.label, 'aunt', 'Wanda shares both parents with Cosima: a full aunt');
  assert.equal(kinship(f, 'lotte', 'konrad')?.label, 'half-brother');
  assert.equal(kinship(f, 'lotte', 'cosima')?.label, 'mother');
});

/** The height of a connector's bar: the first horizontal run of its path. */
const barY = (d: string) => parseFloat(/^M[^V]*V(-?[\d.]+)/.exec(d)![1]);

test('a full sibling and their partner sit beside the focus; the half-sibling hangs on its own bar', () => {
  const f = family(true);
  const l = family_(f, 'lotte');
  const egon = l.nodes.find((n) => n.id === 'egon' && n.role === 'sibling');
  const hedda = l.nodes.find((n) => n.id === 'hedda' && n.role === 'partner');
  assert.ok(egon && hedda, 'Egon is drawn as a sibling and Hedda as his partner');
  assert.ok(Math.abs(hedda!.x - egon!.x) > CARD_W, 'Hedda is beside Egon, not on top of him');
  const fullBar = l.edges.find((e) => e.ids.includes('egon') && e.ids.includes('cosima'));
  const halfBar = l.edges.find((e) => e.ids.includes('konrad') && e.ids.includes('frieda'));
  assert.ok(fullBar && halfBar, 'both sibling connectors exist');
  assert.notEqual(barY(fullBar!.d), barY(halfBar!.d), "the two families' bars are on different lanes");
  assert.ok(!halfBar!.ids.includes('egon'), "Konrad's connector does not carry Egon");
});
