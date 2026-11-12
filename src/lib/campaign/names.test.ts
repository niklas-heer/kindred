// The campaign's invented names: everything the generator can make is compared with the names it must stay clear of.
// Run with: KINDRED_DATA_DIR=$(mktemp -d) node --test src/lib/campaign/names.test.ts
// With GeoNames' cities500.txt at hand, KINDRED_GEONAMES=<file> compares the whole list with every place in it too.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { KNOWN_NAMES } from './known-names.ts';
import { DENIED, DENIED_ROOTS, NAME_KINDS, allowed, dealName, everyMade, everyName, type MadeName } from './names.ts';
import { rng } from './rng.ts';

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** A name as one word: "Mare Drevostum" is "drevostum", "Drevost-fell" is "drevostfell". */
const word = (name: string) => fold(name.replace(/^Mare /, '')).replace(/ /g, '');

/** Whether two words are the same or one letter apart (a letter changed, added or left out). */
function near(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  return short.length === long.length ? short.slice(i + 1) === long.slice(i + 1) : short.slice(i) === long.slice(i + 1);
}

const every: MadeName[] = NAME_KINDS.flatMap((kind) => everyMade(kind));
const dealt = every.filter((m) => m.allowed);
const known = [...KNOWN_NAMES];
/** Known names long enough to be recognised inside or beside another word. */
const long = known.filter((k) => k.length >= 5);
const byLength = new Map<number, string[]>();
for (const k of long) byLength.set(k.length, [...(byLength.get(k.length) ?? []), k]);
const nearKnown = (w: string) => [w.length - 1, w.length, w.length + 1].flatMap((n) => byLength.get(n) ?? []).find((k) => near(w, k));

test('every name has the generator’s shape, and the list is large', () => {
  for (const m of every) {
    assert.match(m.name, m.kind === 'sea' ? /^Mare [A-Z][a-z]+$/ : m.kind === 'continent' ? /^[A-Z][a-z]+$/ : /^[A-Z][a-z]+-[a-z]+$/, m.name);
    assert.ok(m.name.length >= 7 && m.name.length <= 16, `${m.name} is ${m.name.length} letters`);
  }
  assert.equal(new Set(every.map((m) => m.name)).size, every.length, 'no name is made twice');
  assert.ok(dealt.length > every.length * 0.85, `${dealt.length} of ${every.length} may be dealt`);
  for (const m of every) assert.equal(allowed(m.name), m.allowed, m.name);
  assert.ok(!allowed('Valeria') && !allowed('Berlin'), 'a name the generator does not make is not allowed');
});

test('no root is a known name, begins with one, or is one letter from one', () => {
  const roots = [...new Set(dealt.map((m) => m.root))];
  const hits = roots.flatMap((root) => {
    const w = word(root);
    const hit = KNOWN_NAMES.has(w) ? w : long.find((k) => w.startsWith(k)) ?? nearKnown(w);
    return hit ? [`${root} (${hit})`] : [];
  });
  assert.deepEqual(hits, [], 'add these roots to DENIED_ROOTS in names.ts');
});

test('no name that may be dealt is a known name, begins with one, or is one letter from one', () => {
  const hits = dealt.flatMap((m) => {
    const w = word(m.name);
    const hit = KNOWN_NAMES.has(w) ? w : long.find((k) => w.startsWith(k)) ?? nearKnown(w);
    return hit ? [`${m.name} (${hit})`] : [];
  });
  assert.deepEqual(hits, [], 'add these to DENIED in names.ts');
});

test('the names the council found in the first continent can no longer be made', () => {
  const names = new Set(every.map((m) => word(m.name)));
  for (const old of ['Valeria', 'Valinor', 'Elinor', 'Elanor', 'Darunia', 'Selandia', 'Alandia', 'Alania', 'Valoria', 'Orania']) {
    assert.ok(KNOWN_NAMES.has(fold(old)) || !names.has(fold(old)), old);
    assert.ok(!names.has(fold(old)), `${old} is not made`);
  }
});

test('what is denied is still made, and still refused', () => {
  const roots = new Set(every.map((m) => m.root));
  const names = new Set(every.map((m) => m.name));
  for (const root of DENIED_ROOTS) assert.ok(roots.has(root), `${root} is a root the generator makes`);
  for (const name of DENIED) assert.ok(names.has(name) && !allowed(name), `${name} is made, and refused`);
  for (const m of every) if (DENIED_ROOTS.has(m.root)) assert.ok(!m.allowed, m.name);
});

test('dealing gives each name once, and no two with the same head', () => {
  for (let i = 0; i < 40; i++) {
    const random = rng(`deal:${i}`);
    const taken = new Set<string>(), roots = new Set<string>();
    const names = [dealName('continent', random, taken, roots), dealName('sea', random, taken, roots), dealName('sea', random, taken, roots)];
    for (const kind of ['seat', 'seat', 'seat', 'seat', 'haven', 'town', 'plains', 'plains', 'plains', 'plains', 'forest', 'forest', 'highland', 'highland', 'marsh', 'marsh'] as const) names.push(dealName(kind, random, taken, roots));
    assert.equal(new Set(names).size, names.length);
    for (const name of names) assert.ok(allowed(name), `${name} may be dealt`);
    const heads = names.map((n) => n.replace(/^Mare /, '').slice(0, 3));
    assert.equal(new Set(heads).size, heads.length, heads.join(' '));
  }
});

test('with GeoNames at hand, no name or root that may be dealt is a real place’s', { skip: !process.env.KINDRED_GEONAMES || !existsSync(process.env.KINDRED_GEONAMES) }, () => {
  const places = new Set<string>();
  for (const line of readFileSync(process.env.KINDRED_GEONAMES!, 'utf8').split('\n')) {
    const f = line.split('\t');
    if (f.length < 4) continue;
    for (const name of [f[1], f[2], ...f[3].split(',')]) if (name) places.add(fold(name));
  }
  const hits = dealt.filter((m) => places.has(fold(m.name)) || places.has(word(m.name)) || places.has(fold(m.name.replace(/^Mare /, '')))).map((m) => m.name);
  assert.deepEqual(hits, [], 'add these to DENIED in names.ts');
  const roots = [...new Set(dealt.map((m) => m.root))].filter((root) => places.has(fold(root)));
  assert.deepEqual(roots, [], 'add these roots to DENIED_ROOTS in names.ts');
  assert.ok(everyName('continent').length > 100);
});
