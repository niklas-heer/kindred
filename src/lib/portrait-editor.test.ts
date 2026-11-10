// The character editor's rules: steps back and forward, "Surprise me" keeps who the person is, and a ready-made look
// changes what is worn and never the face.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, after } from 'node:test';
import { createServer } from 'vite';

process.env.KINDRED_DATA_DIR = mkdtempSync(join(tmpdir(), 'kindred-portrait-editor-'));
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } });
after(() => vite.close());
const ed = await vite.ssrLoadModule('/src/lib/portrait-editor.ts');
const look = await vite.ssrLoadModule('/src/lib/portrait-look.ts');
const avatar = await vite.ssrLoadModule('/src/components/portrait/avatar.ts');
const { KEYS } = await vite.ssrLoadModule('/src/lib/i18n/dictionary.ts');

const NOW = 2026;
const DRESS = { cloth: '#6e5b45', trim: '#b5a07a', metal: '#c9a14a' };
const A = { skin: 2, hair: 1, eyes: 0 };
const B = { ...A, hairStyle: 'bob' };
const C = { ...B, glasses: 'round' };
/** A fixed sequence in [0, 1), so a failure can be run again. */
function sequence(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('a change is a step: undo takes it back, redo brings it again, and a new change ends what could be redone', () => {
  let d = ed.startDraft(A);
  assert.equal(ed.canUndo(d), false);
  assert.equal(ed.changed(d), false);
  d = ed.commit(ed.commit(d, B), C);
  assert.deepEqual(d.now, C);
  assert.equal(ed.changed(d), true);
  d = ed.undo(d);
  assert.deepEqual(d.now, B);
  assert.equal(ed.canRedo(d), true);
  d = ed.redo(d);
  assert.deepEqual(d.now, C);
  d = ed.commit(ed.undo(ed.undo(d)), { ...A, glasses: 'oval' });
  assert.equal(ed.canRedo(d), false, 'a new change is a new future');
  assert.deepEqual(ed.undo(d).now, A);
});

test('choosing what is already chosen is no step, and undo with nothing to undo does nothing', () => {
  const d = ed.startDraft(A);
  assert.equal(ed.commit(d, { ...A }), d);
  assert.equal(ed.undo(d), d);
  assert.equal(ed.redo(d), d);
});

test('"back to how it was" returns the first look, and is itself a step that can be undone', () => {
  let d = ed.commit(ed.commit(ed.startDraft(A), B), C);
  d = ed.revert(d);
  assert.deepEqual(d.now, A);
  assert.equal(ed.changed(d), false);
  assert.deepEqual(ed.undo(d).now, C);
  // A person nobody had given a look goes back to having none.
  const none = ed.revert(ed.commit(ed.startDraft(undefined), B));
  assert.equal(none.now, undefined);
});

test('the steps kept have an end, and the newest are the ones kept', () => {
  let d = ed.startDraft(A);
  for (let i = 0; i < ed.MAX_STEPS + 50; i++) d = ed.commit(d, { ...A, age: i % 100, jaw: i % 11, noseSize: Math.floor(i / 11) % 11 });
  assert.equal(d.past.length, ed.MAX_STEPS);
  assert.notDeepEqual(d.past[0], A);
});

const PEOPLE = [
  { id: 'p1', given: 'A', sex: 'f', born: '1890', died: '1971' },
  { id: 'p2', given: 'B', sex: 'm', born: '2001', living: true },
  { id: 'p3', given: 'C', sex: 'm', born: '1120', died: '1180' },
  { id: 'p4', given: 'D', sex: 'f', born: '2017', living: true },
  { id: 'p5', given: 'E', sex: 'x', born: '1964', living: true },
];

test('"Surprise me" keeps the age shown, the skin (or a neighbouring shade) and headwear that is part of who they are', () => {
  for (const [i, person] of PEOPLE.entries()) {
    const rand = sequence(100 + i);
    const before = { skin: 4, hair: 0, eyes: 0, age: 44, headwear: 'hijab', hatColour: 8 };
    const order = look.SKIN_ORDER;
    for (let k = 0; k < 60; k++) {
      const next = ed.surprise(person, before, NOW, rand);
      assert.equal(next.age, 44);
      assert.equal(next.headwear, 'hijab');
      assert.equal(next.hatColour, 8);
      assert.ok(Math.abs(order.indexOf(next.skin) - order.indexOf(4)) <= 1, `skin ${next.skin}`);
      assert.deepEqual(look.sanitizeLook(next), next, 'a surprise is a look the server keeps whole');
    }
  }
});

test('a surprise dresses people for their own time: no hoodie in 1150, no ruff today, no beard on a child', () => {
  const rand = sequence(7);
  const modern = new Set(['hoodie', 'tshirt', 'polo', 'plaid', 'jacket', 'dress', 'overalls', 'stripes']);
  for (let k = 0; k < 150; k++) {
    const old = ed.surprise(PEOPLE[2], A, NOW, rand);
    assert.ok(!modern.has(old.clothing), `1150: ${old.clothing}`);
    assert.ok(!['fade', 'mullet', 'buzz', 'beehive'].includes(old.hairStyle), `1150: ${old.hairStyle}`);
    const young = ed.surprise(PEOPLE[1], A, NOW, rand);
    assert.ok(!['ruff', 'doublet', 'tunic', 'frock', 'victorian'].includes(young.clothing), `2001: ${young.clothing}`);
    const child = ed.surprise(PEOPLE[3], A, NOW, rand);
    assert.equal(child.beardStyle, 'none');
    assert.equal(child.moustache, 'none');
    assert.equal(child.extras, undefined);
  }
});

test('surprises differ from one another, and each one draws', () => {
  const rand = sequence(3);
  const seen = new Set<string>();
  for (let k = 0; k < 40; k++) {
    const next = ed.surprise(PEOPLE[0], A, NOW, rand);
    seen.add(JSON.stringify(next));
    for (const detail of ['sm', 'lg']) assert.match(avatar.avatarSvg(look.resolveAppearance({ ...PEOPLE[0], look: next }, NOW), DRESS, detail), /<\/svg>$/);
  }
  assert.ok(seen.size > 35, `${seen.size} different looks in 40`);
});

test('a person nobody has given a skin tone gets one from a surprise', () => {
  const next = ed.surprise(PEOPLE[4], undefined, NOW, sequence(9));
  assert.notEqual(next.skin, look.SKIN_NEUTRAL);
});

test('a ready-made look changes what is worn and never the face', () => {
  const face = { skin: 5, hair: 2, eyes: 3, face: 'square', noseShape: 'broad', eyeShape: 'monolid', jaw: 8, marks: ['vitiligo'], build: 7, lines: 2, age: 61, hairGreys: false };
  const worn = { hairStyle: 'afro', glasses: 'horn', clothing: 'hoodie', headwear: 'cap', backdrop: 'sea', earrings: 'hoops' };
  for (const preset of ed.PRESETS) {
    const next = ed.applyPreset({ ...face, ...worn }, preset);
    for (const [k, v] of Object.entries(face)) assert.deepEqual(next[k], v, `${preset.id} changed ${k}`);
    // What the look does not name is taken off, so two looks in a row do not pile up.
    for (const k of Object.keys(worn)) assert.deepEqual(next[k], preset.outfit[k], `${preset.id}: ${k}`);
    assert.deepEqual(look.sanitizeLook(next), next, `${preset.id} is a look the server keeps whole`);
    assert.ok(KEYS.includes(preset.label), `${preset.id} has a name`);
  }
});

test('the looks offered fit the person: of their time, a child\'s for a child, and the ones drawn for their sex first', () => {
  const ids = (person: object, at?: number) => ed.presetsFor(person, A, NOW, at).map((p: { id: string }) => p.id);
  const grandmother = ids(PEOPLE[0]);
  assert.ok(grandmother.includes('grandmother-1950') && grandmother.includes('bride'));
  assert.ok(grandmother.indexOf('grandmother-1950') < grandmother.indexOf('grandfather-1950'));
  assert.ok(!grandmother.includes('crowned') && !grandmother.includes('today'));
  const lord = ids(PEOPLE[2]);
  assert.ok(lord.includes('crowned') && lord.includes('court'));
  assert.ok(!lord.includes('groom') && !lord.includes('doctor'));
  const child = ids(PEOPLE[3]);
  assert.deepEqual(child, ['kid-today']);
  assert.deepEqual(ids(PEOPLE[3], 1), [], 'a baby wears what babies wear');
  assert.ok(ids(PEOPLE[1]).includes('today'));
});
