// A portrait that is stored today draws exactly as it does today. Families already have portraits, and none may change
// unless someone edits it: this test draws a wide set of stored looks (people as the invented families store them, people
// with no look at all, and looks with every part the editor offered when this was written) at the three sizes, and compares
// each drawing with the print kept in portrait-frozen.fixture.json.
//
// The cases are made here from fixed lists and a seeded generator, never from the portrait's own catalogues, so adding an
// option does not move them. When a case fails, a stored look draws differently: fix the drawing, not the fixture. The
// fixture is written only with KINDRED_FREEZE_PORTRAITS=write, to add cases; it never replaces a print that is there
// (KINDRED_FREEZE_PORTRAITS=rewrite does, for a change to every portrait that the family was told about).
//
// That has happened once: the hair, the beards and the moustaches were redrawn for everyone (docs/portraits.md, "Hair and
// beards were redrawn"), and every print was taken again. So that the redraw could not move anything else, a second
// fixture, portrait-frozen-rest.fixture.json, keeps the prints of the same cases drawn without those three layers, taken
// from the drawing as it was before: with them left out, old and new drawings are the same bytes. That file is never
// rewritten. Cases added after it was taken (section 7) have no print in it. (Before that redraw was released, the eight
// short cuts were told apart better, and the prints of the cases wearing them were taken once more.)
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, after } from 'node:test';
import { createServer } from 'vite';

process.env.KINDRED_DATA_DIR = mkdtempSync(join(tmpdir(), 'kindred-portrait-frozen-'));
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } });
after(() => vite.close());
const look = await vite.ssrLoadModule('/src/lib/portrait-look.ts');
const avatar = await vite.ssrLoadModule('/src/components/portrait/avatar.ts');
const palette = await vite.ssrLoadModule('/src/components/portrait/palette.ts');

const FIXTURE = join(import.meta.dirname, 'portrait-frozen.fixture.json');
const REST = join(import.meta.dirname, 'portrait-frozen-rest.fixture.json');
const NOW = 2026;

// ---------- the parts a look could store when this was written (frozen: never add to these lists) ----------

const HAIR_STYLES = ['tuft', 'cropped', 'short', 'side-part', 'swept', 'curly', 'afro', 'quiff', 'bowl', 'shoulder', 'long', 'wavy', 'braid', 'bun', 'chignon', 'bob', 'pixie', 'ponytail', 'pigtails', 'periwig', 'powdered', 'receding', 'bald'];
const BEARDS = ['none', 'stubble', 'short', 'full', 'long', 'goatee', 'vandyke', 'muttonchops'];
const MOUSTACHES = ['none', 'thin', 'chevron', 'handlebar', 'walrus'];
const BROWS = ['soft', 'straight', 'arched', 'thick', 'thin', 'bushy'];
const GLASSES = ['none', 'round', 'oval', 'square', 'browline', 'half'];
const HEADWEAR = ['none', 'crown', 'circlet', 'mitre', 'veil', 'wimple', 'hood', 'coif', 'beret', 'mobcap', 'tricorn', 'tophat', 'bonnet', 'flatcap', 'fedora', 'cloche', 'headscarf', 'beanie'];
const CLOTHING = ['tunic', 'cotehardie', 'gown', 'doublet', 'bodice', 'ruff', 'lace-collar', 'coat', 'stays', 'frock', 'victorian', 'suit', 'blouse', 'suit-slim', 'pearls', 'shirt', 'turtleneck', 'sweater', 'tshirt', 'hoodie', 'cardigan', 'smock', 'sailor', 'pinafore', 'knit', 'stripes', 'onesie'];
const MARKS = ['freckles', 'mole', 'blush', 'dimples', 'scar'];
const FACES = ['round', 'oval', 'square', 'long', 'heart'];
const NOSES = ['straight', 'aquiline', 'broad', 'snub'];
const EYE_SHAPES = ['round', 'almond', 'hooded'];
const LEVELS = ['jaw', 'noseSize', 'mouthWidth', 'mouthFullness', 'eyeSize', 'eyeSpacing', 'browHeight', 'earSize', 'hairline'];
const TINCTURES = ['or', 'argent', 'gules', 'azure', 'vert', 'sable', 'purpure'];
// The parts added since, as they stood when hair and beards were redrawn (frozen too).
const LATER_HAIR = ['buzz', 'coily', 'fade', 'slicked', 'thinning', 'mullet', 'fringe', 'curly-long', 'locs', 'box-braids', 'cornrows', 'side-braid', 'crown-braid', 'beehive', 'space-buns', 'textured-crop', 'messy', 'undercut', 'swept-back'];
const LATER_BEARDS = ['circle', 'chinstrap', 'sideburns', 'soul-patch'];
const LATER_MOUSTACHES = ['pencil', 'horseshoe', 'imperial'];
const BEARD_SHAPES = ['round', 'square', 'pointed', 'forked'];
const SKINS = 9;
const HAIRS = 10;
const EYES = 7;

// ---------- a seeded generator (mulberry32), so the cases are the same on every machine ----------

function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  return { next, int, chance: (p: number) => next() < p, pick: <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] };
}

interface Person { id: string; given: string; sex?: string; born?: string; died?: string; living?: boolean; look?: Record<string, unknown> }
interface Case { name: string; person: Person; house?: { id: string; arms: { field: string; field2?: string } }; at?: number }

const id = (prefix: string, n: number) => `${prefix}${String(n).padStart(4, '0')}`;
const houseOf = (r: ReturnType<typeof rng>) => {
  if (r.chance(0.4)) return undefined;
  const field = r.pick(TINCTURES);
  return { id: `h-${field}`, arms: { field, ...(r.chance(0.6) ? { field2: r.pick(TINCTURES) } : {}) } };
};

/** A life: born in `year`, dead or living, as the seeds write their dates (some approximate, some with a month). */
function life(r: ReturnType<typeof rng>, year: number): Pick<Person, 'born' | 'died' | 'living'> {
  const span = r.int(0, 92);
  const born = r.chance(0.1) ? `~${year}` : r.chance(0.5) ? String(year) : `${year}-${String(r.int(1, 12)).padStart(2, '0')}`;
  if (year + span >= NOW) return { born, living: true };
  return { born, died: String(year + span) };
}

function cases(): Case[] {
  const out: Case[] = [];

  // 1. People as the invented families store them: three colours, sometimes a beard or headwear, everything else automatic.
  const a = rng(1867);
  for (let i = 1; i <= 520; i++) {
    const year = i <= 260 ? a.int(850, 1210) : a.int(1560, 2024);
    const sex = a.chance(0.03) ? 'x' : a.chance(0.5) ? 'm' : 'f';
    const seedLook: Record<string, unknown> = { skin: a.int(0, 5), hair: a.int(0, 7), eyes: a.int(0, 4) };
    if (sex === 'm' && a.chance(0.45)) seedLook.beard = true;
    if (i <= 260 && a.chance(0.12)) seedLook.headwear = a.pick(['crown', 'veil', 'circlet', 'hood', 'mitre']);
    out.push({ name: `seed ${i}`, person: { id: id('p', i), given: 'A', sex, ...life(a, year), look: seedLook }, house: houseOf(a) });
  }

  // 2. People nobody has given a look, or dates, or a sex: the portrait is automatic all the way.
  const b = rng(42);
  for (let i = 1; i <= 160; i++) {
    const person: Person = { id: b.chance(0.5) ? id('q', i) : `01J${b.int(1e6, 9e6).toString(36)}${i}`, given: 'B' };
    if (b.chance(0.8)) person.sex = b.pick(['m', 'f', 'x']);
    if (b.chance(0.8)) {
      Object.assign(person, life(b, b.int(1400, 2024)));
    } else {
      // No birth date: half of them have a death date, and half of the rest are known to be living.
      const dead = b.chance(0.5);
      if (dead) person.died = String(b.int(1500, 2000));
      else if (b.chance(0.5)) person.living = true;
    }
    out.push({ name: `bare ${i}`, person, house: houseOf(b) });
  }

  // 3. Every part, one at a time, on a man and a woman of several eras, at several ages.
  const BASES: [string, string, number][] = [['m', '1180', 44], ['f', '1530', 30], ['m', '1740', 61], ['f', '1875', 70], ['m', '1931', 38], ['f', '1968', 52], ['x', '1994', 27], ['f', '2015', 9], ['m', '2010', 15]];
  const one = (field: string, values: readonly unknown[]) => {
    values.forEach((v, i) => {
      for (let k = 0; k < 3; k++) {
        const [sex, born, age] = BASES[(i + k * 4) % BASES.length];
        out.push({
          name: `${field}=${JSON.stringify(v)} on ${sex} ${born} at ${age}`,
          person: { id: `part-${field}-${i}-${k}`, given: 'C', sex, born, living: true, look: { skin: (i + k) % 8, hair: (i * 3 + k) % HAIRS, eyes: (i + k) % EYES, age, [field]: v } },
        });
      }
    });
  };
  one('hairStyle', HAIR_STYLES);
  one('beardStyle', BEARDS);
  one('moustache', MOUSTACHES);
  one('brows', BROWS);
  one('glasses', GLASSES);
  one('headwear', HEADWEAR);
  one('clothing', CLOTHING);
  one('face', FACES);
  one('noseShape', NOSES);
  one('eyeShape', EYE_SHAPES);
  one('marks', [[], ...MARKS.map((m) => [m]), MARKS, ['freckles', 'mole'], ['scar', 'dimples', 'blush']]);
  one('hairGreys', [false, true]);
  one('beard', [false, true]);
  for (const k of LEVELS) one(k, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (let s = 0; s < SKINS; s++) for (let h = 0; h < HAIRS; h++) {
    const [sex, born, age] = BASES[(s + h) % BASES.length];
    out.push({ name: `skin ${s} hair ${h}`, person: { id: `tone-${s}-${h}`, given: 'D', sex, born, living: true, look: { skin: s, hair: h, eyes: (s + h) % EYES, age: age + h } } });
  }

  // 4. Looks as the editor saved them: many parts at once, on anybody, with and without a house.
  const c = rng(20261110);
  for (let i = 1; i <= 1400; i++) {
    const sex = c.pick(['m', 'f', 'm', 'f', 'x']);
    const full: Record<string, unknown> = { skin: c.int(0, SKINS - 1), hair: c.int(0, HAIRS - 1), eyes: c.int(0, EYES - 1) };
    const maybe = (p: number, field: string, values: readonly unknown[]) => { if (c.chance(p)) full[field] = c.pick(values); };
    maybe(0.7, 'hairStyle', HAIR_STYLES);
    maybe(0.5, 'beardStyle', BEARDS);
    maybe(0.5, 'moustache', MOUSTACHES);
    maybe(0.6, 'brows', BROWS);
    maybe(0.4, 'glasses', GLASSES);
    maybe(0.35, 'headwear', HEADWEAR);
    maybe(0.4, 'clothing', CLOTHING);
    maybe(0.5, 'face', FACES);
    maybe(0.5, 'noseShape', NOSES);
    maybe(0.5, 'eyeShape', EYE_SHAPES);
    maybe(0.15, 'hairGreys', [false]);
    maybe(0.1, 'beard', [true, false]);
    if (c.chance(0.4)) full.marks = MARKS.filter(() => c.chance(0.3));
    for (const k of LEVELS) if (c.chance(0.35)) full[k] = c.int(0, 10);
    if (c.chance(0.3)) full.age = c.int(0, 100);
    out.push({ name: `edited ${i}`, person: { id: c.chance(0.5) ? id('e', i) : `edit-${c.int(1e5, 9e5)}`, given: 'E', sex, ...life(c, c.int(860, 2024)), look: full }, house: houseOf(c) });
  }

  // 5. The same people at another age: the editor's life stages and the chronicle show them so.
  const d = rng(7);
  for (let i = 1; i <= 240; i++) {
    const from = out[d.int(0, out.length - 1)];
    out.push({ ...from, name: `${from.name}, shown at another age`, at: d.pick([1, 3, 8, 12, 16, 19, 30, 44, 52, 64, 78, 95]) });
  }

  // 6. Stored looks older than the three colours being required: a look that says only part of itself.
  const partial = [{ beard: true }, { headwear: 'crown' }, { hair: 3 }, { skin: 2 }, { eyes: 4, hairStyle: 'bun' }, {}];
  partial.forEach((p, i) => out.push({ name: `partial ${i}`, person: { id: id('old', i), given: 'F', sex: i % 2 ? 'f' : 'm', born: String(1700 + i * 55), died: String(1760 + i * 55), look: p } }));

  // 7. What a look could store when hair and beards were redrawn: the later hair styles, a beard as coverage, length and
  // shape, the later moustaches, and colours of one's own. (Added with that redraw; frozen from then on, like the rest.)
  one('hairStyle', LATER_HAIR);
  one('beardStyle', LATER_BEARDS);
  one('moustache', LATER_MOUSTACHES);
  one('hairHex', ['#5c3b21', '#d9b36c', '#2f6fd0', '#101014']);
  const e = rng(20261111);
  for (let i = 1; i <= 160; i++) {
    const look: Record<string, unknown> = { skin: e.int(0, 14), hair: e.int(0, 17), eyes: e.int(0, 9), hairStyle: e.pick([...HAIR_STYLES.slice(1), ...LATER_HAIR]), moustache: e.pick([...MOUSTACHES, ...LATER_MOUSTACHES]) };
    look.beardStyle = e.pick([...BEARDS, ...LATER_BEARDS]);
    if (e.chance(0.7)) look.beardLength = e.int(0, 10);
    if (e.chance(0.6)) look.beardShape = e.pick(BEARD_SHAPES);
    if (e.chance(0.3)) look.beardHex = e.pick(['#b5522c', '#ece5d0', '#2b201b']);
    if (e.chance(0.3)) look.hairHex = e.pick(['#5c3b21', '#d9b36c', '#2f6fd0']);
    if (e.chance(0.5)) look.age = e.int(20, 95);
    out.push({ name: `bearded ${i}`, person: { id: id('b', i), given: 'G', sex: 'm', ...life(e, e.int(900, 2000)), look }, house: houseOf(e) });
  }
  return out;
}

function print(c: Case, bare = false): string {
  const a = look.resolveAppearance(c.person, NOW, c.at);
  const dress = palette.dressOf(c.house, look.hash(`${c.person.id}:dress`));
  const h = createHash('sha256');
  for (const detail of ['sm', 'md', 'lg']) h.update(avatar.avatarSvg(a, dress, detail, bare));
  return h.digest('hex').slice(0, 12);
}

test('every stored look draws as it did when its print was taken', () => {
  const all = cases();
  const prints = all.map((c) => print(c));
  const mode = process.env.KINDRED_FREEZE_PORTRAITS;
  const kept: string[] = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, 'utf8')).prints : [];
  if (mode === 'rewrite' || (mode === 'write' && prints.length > kept.length)) {
    const next = mode === 'rewrite' ? prints : [...kept, ...prints.slice(kept.length)];
    writeFileSync(FIXTURE, `${JSON.stringify({ about: 'Prints of portrait drawings; see portrait-frozen.test.ts. Never edit by hand.', now: NOW, prints: next })}\n`);
    kept.splice(0, kept.length, ...next);
  }
  assert.ok(kept.length > 0, 'the fixture is missing: it is part of the repository');
  assert.equal(prints.length, kept.length, 'the cases changed: they are frozen, only ever add to the end');
  const changed = all.map((c, i) => ({ c, i })).filter(({ i }) => prints[i] !== kept[i]);
  assert.equal(
    changed.length, 0,
    `${changed.length} of ${all.length} stored looks draw differently now. The first few:\n` +
      changed.slice(0, 8).map(({ c, i }) => `  #${i} ${c.name}: ${JSON.stringify(c.person)}${c.at === undefined ? '' : ` at ${c.at}`}`).join('\n'),
  );
});

test('with the hair, the beard and the moustache left out, every stored look draws as it did before they were redrawn', () => {
  const all = cases();
  const prints = all.map((c) => print(c, true));
  if (process.env.KINDRED_FREEZE_PORTRAITS === 'rest' && !existsSync(REST)) {
    writeFileSync(REST, `${JSON.stringify({ about: 'Prints of portrait drawings without hair, beard and moustache, taken before those were redrawn; see portrait-frozen.test.ts. Never edit by hand, never rewrite.', now: NOW, prints })}\n`);
  }
  const kept: string[] = JSON.parse(readFileSync(REST, 'utf8')).prints;
  // The cases that existed before the redraw: the first 3,067. Later ones were never drawn the old way.
  assert.equal(kept.length, 3067);
  assert.ok(prints.length >= kept.length, 'the cases changed: they are frozen, only ever add to the end');
  const changed = all.slice(0, kept.length).map((c, i) => ({ c, i })).filter(({ i }) => prints[i] !== kept[i]);
  assert.equal(
    changed.length, 0,
    `${changed.length} of ${all.length} stored looks draw differently under the hair and the beard. The first few:\n` +
      changed.slice(0, 8).map(({ c, i }) => `  #${i} ${c.name}: ${JSON.stringify(c.person)}${c.at === undefined ? '' : ` at ${c.at}`}`).join('\n'),
  );
});

test('the cases cover every part a look could store, and a wide spread of people', () => {
  const all = cases();
  assert.ok(all.length > 2500, `${all.length} cases`);
  const seen = (field: string) => new Set(all.map((c) => c.person.look?.[field]).filter((v) => typeof v === 'string'));
  for (const [field, values] of Object.entries({ hairStyle: [...HAIR_STYLES, ...LATER_HAIR], beardStyle: [...BEARDS, ...LATER_BEARDS], moustache: [...MOUSTACHES, ...LATER_MOUSTACHES], brows: BROWS, glasses: GLASSES, headwear: HEADWEAR, clothing: CLOTHING, face: FACES, noseShape: NOSES, eyeShape: EYE_SHAPES })) {
    assert.deepEqual([...seen(field)].sort(), [...values].sort(), field);
  }
  // Two prints of one drawing are possible; hundreds of different ones are what a wide spread means.
  assert.ok(new Set(all.map((c) => print(c))).size > 2000);
});
