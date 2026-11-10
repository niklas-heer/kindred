// The portrait's face fields: old looks stay valid and draw, the new fields are checked on the way in,
// and the photo schema offers exactly the portrait's own values.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, after } from 'node:test';
import { createServer } from 'vite';

process.env.KINDRED_DATA_DIR = mkdtempSync(join(tmpdir(), 'kindred-portrait-look-'));
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } });
after(() => vite.close());
const look = await vite.ssrLoadModule('/src/lib/portrait-look.ts');
const avatar = await vite.ssrLoadModule('/src/components/portrait/avatar.ts');
const vision = await vite.ssrLoadModule('/src/lib/ai/vision.server.ts');
// Every module is loaded here, before the first test: the tests above a later load would finish, and close Vite, while it ran.
const dict = await vite.ssrLoadModule('/src/lib/i18n/dictionary.ts');
const types = await vite.ssrLoadModule('/src/lib/ai/types.ts');
const { LOOKS } = await vite.ssrLoadModule('/scripts/lib/dressed.ts');

const DRESS = { cloth: '#6e5b45', trim: '#b5a07a', metal: '#c9a14a' };
const NOW = 2026;
const person = (over = {}) => ({ id: 'p-test', sex: 'f', born: '1980', living: true, ...over });

test('an old look (no face fields) survives sanitising unchanged, and draws at every size', () => {
  const old = { skin: 2, hair: 1, eyes: 0, hairStyle: 'bob', beardStyle: 'none', glasses: 'round', marks: ['freckles'], age: 40 };
  assert.deepEqual(look.sanitizeLook(old), old);
  for (const detail of ['sm', 'md', 'lg']) {
    const svg = avatar.avatarSvg(look.resolveAppearance(person({ look: old }), NOW), DRESS, detail);
    assert.match(svg, /^<svg /);
  }
});

test('an absent measure is automatic: stable for a person and kept within 2 to 8', () => {
  const a = look.autoFeatures('p-one');
  assert.deepEqual(look.autoFeatures('p-one'), a);
  for (const k of look.LEVEL_KEYS) assert.ok(a[k] >= 2 && a[k] <= 8, `${k} = ${a[k]}`);
  const ap = look.resolveAppearance(person({ id: 'p-one' }), NOW);
  assert.deepEqual(ap.feat, a);
  assert.equal(ap.face, look.resolveAppearance(person({ id: 'p-one' }), NOW).face);
});

test('recorded face fields win over the automatic ones', () => {
  const ap = look.resolveAppearance(person({ look: { skin: 1, hair: 2, eyes: 1, face: 'square', noseShape: 'aquiline', eyeShape: 'hooded', jaw: 9, earSize: 0 } }), NOW);
  assert.equal(ap.face, 'square');
  assert.equal(ap.noseShape, 'aquiline');
  assert.equal(ap.eyeShape, 'hooded');
  assert.equal(ap.feat.jaw, 9);
  assert.equal(ap.feat.earSize, 0);
  // Measures not recorded stay automatic.
  assert.equal(ap.feat.hairline, look.autoFeatures('p-test').hairline);
});

test('sanitising keeps valid face fields and drops stray ones', () => {
  const out = look.sanitizeLook({
    skin: 2, hair: 1, eyes: 0,
    face: 'square', noseShape: 'snub', eyeShape: 'almond',
    jaw: 7, noseSize: 11, mouthWidth: 5.5, mouthFullness: '6', eyeSize: -1, eyeSpacing: 10, browHeight: 0, earSize: null, hairline: 4,
  });
  assert.equal(out.face, 'square');
  assert.equal(out.noseShape, 'snub');
  assert.equal(out.eyeShape, 'almond');
  assert.equal(out.jaw, 7);
  assert.equal(out.eyeSpacing, 10);
  assert.equal(out.browHeight, 0);
  assert.equal(out.hairline, 4);
  for (const k of ['noseSize', 'mouthWidth', 'mouthFullness', 'eyeSize', 'earSize']) assert.equal(out[k], undefined, k);
  assert.equal(look.sanitizeLook({ skin: 1, hair: 1, eyes: 1, face: 'triangle', eyeShape: 'wide' }).face, undefined);
});

test('the photo schema offers the portrait\'s own shapes and whole numbers from 0 to 10', () => {
  const p = vision.LOOK_JSON.properties;
  assert.deepEqual(p.face.enum, look.FACE_SHAPES.map((o: { id: string }) => o.id));
  assert.deepEqual(p.noseShape.enum, look.NOSE_SHAPES.map((o: { id: string }) => o.id));
  assert.deepEqual(p.eyeShape.enum, look.EYE_SHAPES.map((o: { id: string }) => o.id));
  for (const k of look.LEVEL_KEYS) {
    assert.equal(p[k].type, 'integer', k);
    assert.equal(p[k].minimum, 0, k);
    assert.equal(p[k].maximum, 10, k);
    assert.ok(p[k].description.length > 20, `${k} needs a description of what to look at`);
  }
  for (const k of ['headwear', 'clothing', 'age']) assert.equal(p[k], undefined, k);
});

test('every face shape, nose, eye shape and life stage draws at every size', () => {
  let n = 0;
  for (const face of look.FACE_SHAPES) for (const noseShape of look.NOSE_SHAPES) for (const eyeShape of look.EYE_SHAPES) {
    const recorded = { skin: 3, hair: 4, eyes: 2, face: face.id, noseShape: noseShape.id, eyeShape: eyeShape.id, jaw: 0, noseSize: 10, mouthWidth: 10, mouthFullness: 0 };
    for (const at of [1, 8, 17, 32, 58, 80]) for (const detail of ['sm', 'md', 'lg']) {
      const ap = look.resolveAppearance(person({ look: recorded, sex: n % 2 ? 'm' : 'f' }), NOW, at);
      assert.match(avatar.avatarSvg(ap, DRESS, detail), /<\/svg>$/);
      n++;
    }
  }
  assert.ok(n > 0);
});

// ---------- the character editor's second version: more parts, and nothing that was there moves ----------

const OLD = { skin: 2, hair: 1, eyes: 0, hairStyle: 'bob', glasses: 'round', marks: ['freckles'], age: 40 };
const draw = (l: object, detail = 'lg', over = {}) => avatar.avatarSvg(look.resolveAppearance(person({ look: l, ...over }), NOW), DRESS, detail);
/** Every part chosen from a list, with the field that stores it. */
const CATALOGUES: [string, string][] = [
  ['hairStyle', 'HAIR_STYLES'], ['beardStyle', 'BEARDS'], ['moustache', 'MOUSTACHES'], ['brows', 'BROWS'], ['glasses', 'GLASSES'], ['headwear', 'HEADWEAR'],
  ['clothing', 'CLOTHING'], ['face', 'FACE_SHAPES'], ['noseShape', 'NOSE_SHAPES'], ['eyeShape', 'EYE_SHAPES'], ['expression', 'EXPRESSIONS'],
  ['earrings', 'EARRINGS'], ['necklace', 'NECKLACES'], ['backdrop', 'BACKDROPS'],
];
const PALETTES: [string, string, string][] = [['skin', 'SKIN', 'SKIN_LABELS'], ['hair', 'HAIR', 'HAIR_LABELS'], ['eyes', 'EYES', 'EYE_LABELS'], ['lips', 'LIPS', 'LIP_LABELS'], ['frames', 'FRAMES', 'FRAME_LABELS'], ['clothColour', 'CLOTH', 'CLOTH_LABELS']];

test('a look from before the new parts resolves to "nothing added": no expression, average build, no jewellery, a plain backdrop', () => {
  const a = look.resolveAppearance(person({ look: OLD }), NOW);
  assert.equal(a.expression, undefined);
  assert.equal(a.build, 5);
  assert.deepEqual([a.earrings, a.necklace, a.backdrop, a.extras], ['none', 'none', 'plain', []]);
  for (const k of ['lips', 'frames', 'cloth', 'trim', 'hat']) assert.equal(a[k], undefined, k);
  // Saying the neutral values out loud draws the same picture as leaving them out.
  for (const detail of ['sm', 'md', 'lg']) assert.equal(draw({ ...OLD, build: 5, earrings: 'none', necklace: 'none', backdrop: 'plain', extras: [] }, detail), draw(OLD, detail), detail);
});

test('a person nobody gave colours keeps natural ones: the automatic choice never reaches the colours added later', () => {
  for (let i = 0; i < 400; i++) {
    const a = look.resolveAppearance({ id: `auto-${i}`, sex: i % 2 ? 'm' : 'f', born: '1990', living: true }, NOW);
    assert.ok(look.HAIR.slice(0, 10).includes(a.hairBase), `hair of auto-${i}`);
    assert.ok(look.EYES.slice(0, 7).includes(a.eyes), `eyes of auto-${i}`);
    const d = look.defaultLook({ id: `auto-${i}` });
    assert.ok(d.hair < 10 && d.eyes < 7);
  }
});

test('every part in every catalogue has a name in three languages, is kept by the server and by the assistant\'s schema, and draws at every size', () => {
  for (const [field, list] of CATALOGUES) {
    for (const o of look[list]) {
      for (const locale of ['en', 'de', 'af']) assert.ok(dict.translate(locale, o.label) && dict.KEYS.includes(o.label), `${o.label} (${locale})`);
      const l = { skin: 3, hair: 2, eyes: 1, [field]: o.id };
      assert.equal(look.sanitizeLook(l)[field], o.id, `${field} ${o.id} is kept`);
      assert.equal(types.lookSchema.safeParse(l).success, true, `${field} ${o.id} passes the schema`);
      for (const detail of ['sm', 'md', 'lg']) for (const sex of ['m', 'f']) for (const born of ['1150', '1930', '2015']) assert.match(draw(l, detail, { sex, born }), /<\/svg>$/);
    }
  }
  for (const list of ['MARKS', 'EXTRAS']) {
    const field = list === 'MARKS' ? 'marks' : 'extras';
    for (const o of look[list]) {
      assert.ok(dict.KEYS.includes(o.label), o.label);
      const l = { skin: 3, hair: 2, eyes: 1, [field]: [o.id] };
      assert.deepEqual(look.sanitizeLook(l)[field], [o.id]);
      assert.equal(types.lookSchema.safeParse(l).success, true, o.id);
      for (const detail of ['sm', 'md', 'lg']) assert.match(draw(l, detail), /<\/svg>$/);
    }
  }
  for (const [field, palette, labels] of PALETTES) {
    assert.equal(look[palette].length, look[labels].length, `${palette} and its names`);
    look[palette].forEach((colour: string, i: number) => {
      assert.match(colour, /^#[0-9a-f]{6}$/);
      assert.ok(dict.KEYS.includes(look[labels][i]), look[labels][i]);
      const l = { skin: 3, hair: 2, eyes: 1, glasses: 'round', [field]: i };
      assert.equal(look.sanitizeLook(l)[field], i, `${field} ${i}`);
      assert.equal(types.lookSchema.safeParse(l).success, true, `${field} ${i}`);
    });
  }
  for (const k of [...look.GREY_LABELS, ...look.LINES_LABELS, ...Object.values(look.HAIR_GROUP_LABELS), ...Object.values(look.HEADWEAR_GROUP_LABELS), ...Object.values(look.CLOTHING_GROUP_LABELS)]) assert.ok(dict.KEYS.includes(k), k);
});

test('each new part shows: choosing it changes the large drawing', () => {
  const base = { skin: 3, hair: 2, eyes: 1, glasses: 'none', headwear: 'none', clothing: 'shirt', beardStyle: 'none', moustache: 'none', hairStyle: 'short', brows: 'thick', face: 'oval', noseShape: 'straight', eyeShape: 'almond', marks: [] };
  const plain = draw(base, 'lg', { sex: 'm', born: '1970' });
  const differs = (l: object, what: string) => assert.notEqual(draw({ ...base, ...l }, 'lg', { sex: 'm', born: '1970' }), plain, what);
  for (const [field, list] of CATALOGUES) for (const o of look[list]) if (base[field as keyof typeof base] !== o.id && !['none', 'plain'].includes(o.id)) differs({ [field]: o.id }, `${field} ${o.id}`);
  for (const o of look.MARKS) if (o.id !== 'blush') differs({ marks: [o.id] }, o.id);
  for (const o of look.EXTRAS) differs({ extras: [o.id] }, o.id);
  for (const [field, n] of [['grey', 3], ['lines', 3], ['build', 9], ['build', 1], ['lips', 0], ['clothColour', 13]] as const) differs({ [field]: n }, `${field} ${n}`);
  assert.notEqual(draw({ ...base, clothing: 'dress', trimColour: 13 }, 'lg'), draw({ ...base, clothing: 'dress' }, 'lg'), 'the second colour, on clothes that have one');
  differs({ glasses: 'round', frames: 4 }, 'frames');
  assert.notEqual(draw({ ...base, headwear: 'beanie', hatColour: 13 }, 'lg'), draw({ ...base, headwear: 'beanie' }, 'lg'), 'hat colour');
});

test('greying follows age until someone sets it, and dyed hair keeps its colour', () => {
  const at = (l: object, born: string) => look.resolveAppearance(person({ look: { skin: 1, hair: 2, eyes: 0, ...l }, born }), NOW);
  assert.notEqual(at({}, '1940').hair, at({}, '1940').hairBase, 'grey by 86');
  assert.equal(at({ grey: 0 }, '1940').hair, look.HAIR[2], 'set to none');
  assert.notEqual(at({ grey: 2 }, '2000').hair, look.HAIR[2], 'grey at 26 when set');
  assert.equal(at({ grey: 3 }, '2000').hair, at({ grey: 3 }, '1940').hair, 'white is white at any age');
  assert.equal(at({ hair: 12 }, '1940').hair, look.HAIR[12], 'dyed blue stays blue');
  assert.equal(look.autoGrey(person({ look: { skin: 1, hair: 2, eyes: 0 }, born: '2000' }), NOW), 0);
  assert.ok(look.autoGrey(person({ look: { skin: 1, hair: 2, eyes: 0 }, born: '1930' }), NOW) >= 2);
});

test('sanitising keeps the new parts that are valid and drops the rest', () => {
  const out = look.sanitizeLook({
    skin: 12, hair: 15, eyes: 9, grey: 3, lines: 0, build: 8, lips: 2, frames: 5, clothColour: 19, trimColour: 0, hatColour: 7,
    expression: 'grin', earrings: 'hoops', necklace: 'cross', backdrop: 'books', extras: ['hearing-aid', 'pipe', 'jetpack', 'pipe'],
  });
  assert.deepEqual(out, {
    skin: 12, hair: 15, eyes: 9, grey: 3, lines: 0, build: 8, lips: 2, frames: 5, clothColour: 19, trimColour: 0, hatColour: 7,
    expression: 'grin', earrings: 'hoops', necklace: 'cross', backdrop: 'books', extras: ['hearing-aid', 'pipe'],
  });
  const bad = look.sanitizeLook({ skin: 99, hair: -1, eyes: 1.5, grey: 4, lines: -1, build: 11, lips: 9, frames: 'gold', clothColour: 20, expression: 'smirk', earrings: true, backdrop: 'moon', extras: ['jetpack'] });
  assert.deepEqual(bad, { skin: look.SKIN_NEUTRAL, hair: 0, eyes: 0 });
});

test('a child wears a child\'s things: grown-up headwear and a pipe wait until they are grown', () => {
  const kid = (l: object) => look.resolveAppearance(person({ look: { skin: 1, hair: 2, eyes: 0, age: 8, ...l } }), NOW);
  assert.equal(kid({ headwear: 'tophat' }).headwear, 'none');
  assert.equal(kid({ headwear: 'peaked-cap' }).headwear, 'none');
  for (const h of ['cap', 'sunhat', 'bow', 'hijab', 'kippah', 'turban', 'flower-crown']) assert.equal(kid({ headwear: h }).headwear, h, h);
  assert.deepEqual(kid({ extras: ['pipe', 'medal', 'hearing-aid', 'scarf'] }).extras, ['hearing-aid', 'scarf']);
  assert.equal(look.headwearShows('tophat', 'child'), false);
  assert.equal(look.headwearShows('tophat', 'elder'), true);
});

test('a list-size drawing stays light: flat colour for a backdrop, and no part adds more than a few hundred bytes', () => {
  const base = { skin: 3, hair: 2, eyes: 1, glasses: 'none', headwear: 'none', clothing: 'shirt', hairStyle: 'short' };
  const size = (l: object) => draw({ ...base, ...l }, 'sm', { sex: 'f', born: '1970' }).length;
  const plain = size({});
  for (const o of look.BACKDROPS) assert.ok(size({ backdrop: o.id }) - plain <= 260, `backdrop ${o.id}: +${size({ backdrop: o.id }) - plain}`);
  for (const o of look.EXTRAS) assert.ok(size({ extras: [o.id] }) - plain <= 700, `${o.id}: +${size({ extras: [o.id] }) - plain}`);
  for (const [field, list] of [['earrings', 'EARRINGS'], ['necklace', 'NECKLACES'], ['expression', 'EXPRESSIONS']] as const) for (const o of look[list]) assert.ok(size({ [field]: o.id }) - plain <= 520, `${field} ${o.id}: +${size({ [field]: o.id }) - plain}`);
  // The heaviest of the old headwear, hair and clothes at list size is the measure for the new ones.
  const worst = (field: string, ids: string[]) => Math.max(...ids.map((id) => size({ [field]: id })));
  const OLD_HEADWEAR = ['crown', 'circlet', 'mitre', 'veil', 'wimple', 'hood', 'coif', 'beret', 'mobcap', 'tricorn', 'tophat', 'bonnet', 'flatcap', 'fedora', 'cloche', 'headscarf', 'beanie'];
  const OLD_HAIR = ['cropped', 'short', 'side-part', 'swept', 'curly', 'afro', 'quiff', 'bowl', 'shoulder', 'long', 'wavy', 'braid', 'bun', 'chignon', 'bob', 'pixie', 'ponytail', 'pigtails', 'periwig', 'powdered', 'receding', 'bald'];
  const OLD_CLOTHING = ['tunic', 'cotehardie', 'gown', 'doublet', 'bodice', 'ruff', 'lace-collar', 'coat', 'stays', 'frock', 'victorian', 'suit', 'blouse', 'suit-slim', 'pearls', 'shirt', 'turtleneck', 'sweater', 'tshirt', 'hoodie', 'cardigan', 'smock', 'sailor', 'pinafore', 'knit', 'stripes', 'onesie'];
  for (const [field, list, old] of [['headwear', 'HEADWEAR', OLD_HEADWEAR], ['hairStyle', 'HAIR_STYLES', OLD_HAIR], ['clothing', 'CLOTHING', OLD_CLOTHING]] as const) {
    const limit = worst(field, old);
    for (const o of look[list]) assert.ok(size({ [field]: o.id }) <= limit, `${field} ${o.id} is ${size({ [field]: o.id })} bytes at list size; the heaviest before was ${limit}`);
  }
});

test('the looks the invented family is given by hand are looks the portrait keeps whole', () => {
  assert.ok(Object.keys(LOOKS).length >= 10);
  for (const [id, worn] of Object.entries(LOOKS)) {
    const l = { skin: 1, hair: 1, eyes: 1, ...(worn as object) };
    assert.deepEqual(look.sanitizeLook(l), l, id);
  }
});
