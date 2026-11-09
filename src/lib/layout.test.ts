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

// ---------- every marriage has its own line and date ----------

const yearLabel = (l: Layout, a: string, b: string) => l.edges.filter((e) => e.kind === 'marriage' && e.ids.includes(a) && e.ids.includes(b));
/** The path's horizontal run: [y, x from, x to]. */
const runOf = (d: string) => {
  const m = /^M(-?[\d.]+),(-?[\d.]+)H(-?[\d.]+)$/.exec(d)!;
  return [parseFloat(m[2]), parseFloat(m[1]), parseFloat(m[3])];
};
/** Every straight segment of a path, as [x1, y1, x2, y2]. */
function segments(d: string): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  let x = 0, y = 0;
  for (const [, c, v] of d.matchAll(/([MHV])(-?[\d.]+(?:,-?[\d.]+)?)/g)) {
    if (c === 'M') [x, y] = v.split(',').map(Number);
    else if (c === 'H') { out.push([x, y, Number(v), y]); x = Number(v); }
    else { out.push([x, y, x, Number(v)]); y = Number(v); }
  }
  return out;
}

test('both marriages of a man show their own line and date', () => {
  const l = family_(family(), 'lotte');
  for (const [partner, text] of [['ottilie', '⚭ 1953–1962'], ['theda', '⚭ 1965']] as const) {
    const edges = yearLabel(l, 'edmund', partner);
    assert.equal(edges.length, 1, `Edmund and ${partner} have exactly one marriage line`);
    assert.equal(edges[0].label?.text, text);
    const [, from, to] = runOf(edges[0].d);
    assert.ok(to - from > 80, `the line to ${partner} is visible between the cards, ${to - from}px long`);
  }
  assert.ok(yearLabel(l, 'edmund', 'ottilie')[0].dashed, 'the ended marriage keeps its dashed style');
  assert.ok(!yearLabel(l, 'edmund', 'theda')[0].dashed);
});

test("a child's line starts on their own parents' marriage line", () => {
  const l = family_(family(true), 'lotte');
  for (const [child, a, b] of [['lotte', 'arno', 'cosima'], ['cosima', 'edmund', 'ottilie']] as const) {
    const line = yearLabel(l, a, b)[0];
    const [y, from, to] = runOf(line.d);
    const edge = l.edges.find((e) => e.kind === 'line' && e.ids.includes(child) && e.ids.includes(a) && e.ids.includes(b));
    assert.ok(edge, `${child} has a connector from ${a} and ${b}`);
    assert.equal(edge!.d.indexOf(`M${(from + to) / 2},`), 0, `${child}'s connector starts in the middle of the line`);
    assert.equal(parseFloat(/^M[^,]*,(-?[\d.]+)/.exec(edge!.d)![1]), y, `${child}'s connector starts at the height of the line`);
  }
});

/** No connector passes through a marriage line, and no two connectors of different families touch. */
function assertNoCrossings(l: Layout, label: string) {
  const lines = l.edges.filter((e) => e.kind === 'line').flatMap((e) => segments(e.d).map((s) => ({ e, s })));
  const marriages = l.edges.filter((e) => e.kind === 'marriage').map((e) => ({ e, s: segments(e.d)[0] }));
  // A bar may only be met by its own family's lines: a marriage line is crossed if passed through, a bar even if touched.
  const crosses = (h: number[], v: number[], touch: boolean) => {
    const [hx0, hx1] = [Math.min(h[0], h[2]), Math.max(h[0], h[2])], [vy0, vy1] = [Math.min(v[1], v[3]), Math.max(v[1], v[3])];
    const slack = touch ? -0.5 : 0.5;
    return v[0] > hx0 + 0.5 && v[0] < hx1 - 0.5 && h[1] > vy0 + slack && h[1] < vy1 - slack;
  };
  const across = [...lines, ...marriages].filter(({ s }) => s[1] === s[3]);
  const downs = lines.filter(({ s }) => s[0] === s[2]);
  for (const a of across) for (const d of downs) {
    if (a.e.key === d.e.key || startX(a.e.d) === startX(d.e.d)) continue;
    assert.ok(!crosses(a.s, d.s, a.e.kind === 'line'), `${label}: ${a.e.key} meets ${d.e.key}`);
  }
}

test('no line of descent runs across a marriage line, or across another line of descent', () => {
  const f = family(true);
  for (const focus of ['lotte', 'egon']) assertNoCrossings(family_(f, focus), focus);
});

test('when both spouses of an ancestor couple married again, every child line stays clear', () => {
  // Both of the father's parents and both of the mother's parents have another marriage with a child.
  const couples = [['gpa', 'gma', 'dad'], ['opa', 'oma', 'mum']];
  const people: GPerson[] = [person('kid', 'Kid', 'f', '1990'), person('dad', 'Dad', 'm', '1960'), person('mum', 'Mum', 'f', '1962')];
  const links: [string, string][] = [['kid', 'dad'], ['kid', 'mum']];
  const unions: GUnion[] = [{ id: 'u-p', a: 'dad', b: 'mum', kind: 'marriage', start: '1985' }];
  for (const [a, b, child] of couples) {
    people.push(person(a, a, 'm', '1930'), person(b, b, 'f', '1932'), person(`${a}2`, `${a}2`, 'f', '1934'), person(`${b}2`, `${b}2`, 'm', '1931'), person(`${a}k`, `${a}k`, 'f', '1965'), person(`${b}k`, `${b}k`, 'm', '1966'));
    links.push([child, a], [child, b], [`${a}k`, a], [`${a}k`, `${a}2`], [`${b}k`, b], [`${b}k`, `${b}2`]);
    unions.push({ id: `u-${a}`, a, b, kind: 'marriage', start: '1955' }, { id: `u-${a}2`, a, b: `${a}2`, kind: 'marriage', start: '1964' }, { id: `u-${b}2`, a: b, b: `${b}2`, kind: 'marriage', start: '1965' });
  }
  const f = buildFamily({
    tree: { id: 't', name: 'T', tagline: '', theme: 'modern', focus: 'kid', people: people.length }, houses: [], places: [], people,
    parents: links.map(([child, parent]) => ({ child, parent, kind: 'biological', confidence: 'certain' }) as GParent), unions,
  });
  const l = family_(f, 'kid');
  assertNoCrossings(l, 'kid');
  // The inner spouse keeps their place on the line and is repeated beside their other marriage.
  for (const id of ['gma', 'opa']) assert.equal(l.nodes.filter((n) => n.id === id && n.role === 'dup').length, 1, `${id} is repeated once`);
  for (const id of ['gpa2', 'gma2', 'opa2', 'oma2', 'gpak', 'gmak', 'opak', 'omak']) assert.ok(l.nodes.some((n) => n.id === id), `${id} is drawn`);
  const ids = l.nodes.filter((n) => n.row === -2);
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) assert.ok(Math.abs(ids[i].x - ids[j].x) >= CARD_W, `${ids[i].key} and ${ids[j].key} do not overlap`);
});

function manyPartners(count: number): Family {
  const wives = Array.from({ length: count }, (_, i) => `w${i}`);
  const people: GPerson[] = [
    person('kid', 'Kid', 'f', '1990'), person('father', 'Father', 'm', '1950'),
    ...wives.map((w, i) => person(w, `Wife${i}`, 'f', `${1950 + i}`)),
  ];
  const links: [string, string][] = [['kid', 'father'], ['kid', 'w0'], ...wives.slice(1).map((w) => [`c-${w}`, w] as [string, string]), ...wives.slice(1).map((w) => [`c-${w}`, 'father'] as [string, string])];
  people.push(...wives.slice(1).map((w) => person(`c-${w}`, `Child${w}`, 'm', '1985')));
  const unions: GUnion[] = wives.map((w, i) => ({
    id: `u-${i}`, a: 'father', b: w, kind: 'marriage', start: `${1970 + i * 3}-01-01`, ...(i < count - 1 ? { end: `${1971 + i * 3}-01-01`, endReason: 'death' as const } : {}),
  }));
  return buildFamily({
    tree: { id: 't', name: 'T', tagline: '', theme: 'modern', focus: 'kid', people: people.length }, houses: [], places: [], people,
    parents: links.map(([child, parent]) => ({ child, parent, kind: 'biological', confidence: 'certain' }) as GParent), unions,
  });
}

test('however many partners a person has, each marriage shows its line and date', () => {
  for (const count of [2, 3, 4]) {
    const f = manyPartners(count);
    for (const focus of ['kid', 'father']) {
      const l = family_(f, focus);
      for (let i = 0; i < count; i++) {
        const edges = yearLabel(l, 'father', `w${i}`);
        assert.equal(edges.length, 1, `${focus}: one line for the marriage to w${i}`);
        assert.ok(edges[0].label?.text.includes(String(1970 + i * 3)), `${focus}: the date of the marriage to w${i}`);
      }
      assertNoOverlap(l, `${count} partners, focus ${focus}`);
    }
  }
});

test('a couple who married twice shows both marriages', () => {
  const graph: Graph = {
    tree: { id: 't', name: 'T', tagline: '', theme: 'modern', focus: 'kid', people: 3 }, houses: [], places: [],
    people: [person('kid', 'Kid', 'f', '1990'), person('a', 'A', 'm', '1950'), person('b', 'B', 'f', '1952')],
    parents: [['kid', 'a'], ['kid', 'b']].map(([child, parent]) => ({ child, parent, kind: 'biological', confidence: 'certain' }) as GParent),
    unions: [
      { id: 'u1', a: 'a', b: 'b', kind: 'marriage', start: '1975', end: '1980', endReason: 'divorce' },
      { id: 'u2', a: 'a', b: 'b', kind: 'marriage', start: '1985' },
    ],
  };
  const l = family_(buildFamily(graph), 'kid');
  const lines = yearLabel(l, 'a', 'b');
  assert.deepEqual(lines.map((e) => e.label?.text).sort(), ['⚭ 1975–1980', '⚭ 1985']);
  assert.notEqual(runOf(lines[0].d)[0], runOf(lines[1].d)[0], 'their lines do not lie on top of each other');
});
