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

// ---------- hair and beards redrawn: colours of one's own, and a beard as coverage, length and shape ----------

test('a colour of one\'s own is a hash and six hex digits, or it is dropped: on saving, in the schema and in the drawing', () => {
  const base = { skin: 1, hair: 2, eyes: 0 };
  assert.equal(look.hexColour('#8A5631'), '#8a5631');
  const BAD = ['8a5631', '#8a563', '#8a56311', '#8a563g', '#fff', 'red', 'rgb(1,2,3)', '#8a5631"/><script>alert(1)</script>', '"><svg onload=alert(1)>', ' #8a5631', '#8a5631 ', '', 0x8a5631, null, ['#8a5631'], { hex: '#8a5631' }];
  for (const bad of BAD) {
    assert.equal(look.hexColour(bad), undefined, JSON.stringify(bad));
    const clean = look.sanitizeLook({ ...base, hairHex: bad, beardHex: bad });
    assert.deepEqual(clean, base, `saving drops ${JSON.stringify(bad)}`);
    if (typeof bad === 'string') assert.equal(types.lookSchema.safeParse({ ...base, hairHex: bad }).success, false, `the schema refuses ${JSON.stringify(bad)}`);
    // A stored look is trusted by nobody: a bad value that reached the database draws as if it were not there.
    for (const detail of ['sm', 'md', 'lg']) assert.equal(draw({ ...base, beardStyle: 'full', hairHex: bad, beardHex: bad }, detail, { sex: 'm' }), draw({ ...base, beardStyle: 'full' }, detail, { sex: 'm' }), JSON.stringify(bad));
  }
  assert.deepEqual(look.sanitizeLook({ ...base, hairHex: '#12ABef', beardHex: '#B5522C' }), { ...base, hairHex: '#12abef', beardHex: '#b5522c' });
  assert.equal(types.lookSchema.safeParse({ ...base, hairHex: '#12abef', beardHex: '#b5522c', beardLength: 7, beardShape: 'forked' }).success, true);
  // Whatever a look holds, the drawing holds nothing but the markup it is made of: no quote, bracket or script survives into it.
  const svg = draw({ ...base, hairHex: '#123456"><script>', beardHex: 'javascript:alert(1)', beardStyle: 'full' }, 'lg', { sex: 'm' });
  assert.doesNotMatch(svg, /script|javascript/);
});

test('a hair colour of one\'s own wins over the swatch, greys like a natural colour, and stays as it is when it is plainly dyed', () => {
  const at = (l: object, born: string) => look.resolveAppearance(person({ look: { skin: 1, hair: 2, eyes: 0, ...l }, born }), NOW);
  assert.equal(at({ hairHex: '#5c3b21' }, '1990').hair, '#5c3b21');
  assert.equal(at({ hairHex: '#5c3b21' }, '1990').hairBase, '#5c3b21');
  assert.match(draw({ skin: 1, hair: 2, eyes: 0, hairHex: '#5c3b21' }, 'lg', { born: '2000' }), /fill="#5c3b21"/);
  assert.doesNotMatch(draw({ skin: 1, hair: 2, eyes: 0, hairHex: '#5c3b21' }, 'lg', { born: '2000' }), new RegExp(`fill="${look.HAIR[2]}"`));
  assert.notEqual(at({ hairHex: '#5c3b21' }, '1940').hair, '#5c3b21', 'a brown of one\'s own is grey by 86');
  assert.equal(at({ hairHex: '#5c3b21', hairGreys: false }, '1940').hair, '#5c3b21');
  assert.equal(at({ hairHex: '#2f6fd0' }, '1940').hair, '#2f6fd0', 'blue is dyed, and stays blue');
  for (const natural of ['#17151a', '#4a3226', '#a3482a', '#c66c2e', '#d2ac69', '#ece5d0', '#8a8a8a']) assert.equal(look.looksDyed(natural), false, natural);
  for (const dyed of ['#2f6fd0', '#3aa35a', '#7b57b3', '#e07aa8', '#2f8c84']) assert.equal(look.looksDyed(dyed), true, dyed);
  // The index stays the fallback: the nearest swatch.
  assert.equal(look.nearestHair(look.HAIR[6]), 6);
  assert.equal(look.nearestHair('#000000'), 8);
});

test('a beard is where it grows, how long it is and how it is cut: the older names keep their meaning', () => {
  assert.deepEqual(look.beardSpec('short'), { cover: 'full', length: 2, shape: 'round' });
  assert.deepEqual(look.beardSpec('full'), { cover: 'full', length: 5, shape: 'round' });
  assert.deepEqual(look.beardSpec('long'), { cover: 'full', length: 9, shape: 'pointed' });
  assert.deepEqual(look.beardSpec('vandyke'), { cover: 'goatee', length: 6, shape: 'pointed' });
  assert.deepEqual(look.beardSpec('goatee'), { cover: 'goatee', length: 4, shape: 'round' });
  assert.deepEqual(look.beardSpec('circle'), { cover: 'circle', length: 3, shape: 'round' });
  // A look's own length and shape win over the name's; values that are not lengths or shapes do not.
  assert.deepEqual(look.beardSpec('short', { beardLength: 8, beardShape: 'forked' }), { cover: 'full', length: 8, shape: 'forked' });
  assert.deepEqual(look.beardSpec('long', { beardLength: 11, beardShape: 'spiky' }), { cover: 'full', length: 9, shape: 'pointed' });
  const man = { sex: 'm', born: '1970' };
  const base = { skin: 2, hair: 1, eyes: 0, moustache: 'none', hairStyle: 'short' };
  // Every beard ever stored is kept on saving and by the schema, has a name in three languages, and draws as its new fields say.
  for (const [id, preset] of Object.entries(look.BEARD_PRESETS) as [string, { cover: string; length: number; shape: string }][]) {
    assert.equal(look.sanitizeLook({ ...base, beardStyle: id }).beardStyle, id);
    assert.equal(types.lookSchema.safeParse({ ...base, beardStyle: id }).success, true, id);
    for (const locale of ['en', 'de', 'af']) assert.ok(dict.translate(locale, `look.beard.${id.replace(/-/g, '_')}`), `${id} (${locale})`);
    for (const detail of ['sm', 'md', 'lg']) assert.equal(draw({ ...base, beardStyle: id }, detail, man), draw({ ...base, beardStyle: preset.cover, beardLength: preset.length, beardShape: preset.shape }, detail, man), `${id} at ${detail}`);
  }
  for (const o of [...look.BEARD_SHAPES, ...look.BEARD_LENGTHS]) for (const locale of ['en', 'de', 'af']) assert.ok(dict.translate(locale, o.label) && dict.KEYS.includes(o.label), o.label);
  // Length and shape show: every step of length draws a different full beard, and so does every shape of a long one.
  const lengths = Array.from({ length: 11 }, (_, n) => draw({ ...base, beardStyle: 'full', beardLength: n }, 'lg', man));
  assert.equal(new Set(lengths).size, 11);
  assert.equal(new Set(look.BEARD_SHAPES.map((o: { id: string }) => draw({ ...base, beardStyle: 'full', beardLength: 8, beardShape: o.id }, 'lg', man))).size, 4);
  assert.deepEqual(look.sanitizeLook({ ...base, beardLength: 4.5, beardShape: 'spiky' }), base);
  assert.deepEqual(look.sanitizeLook({ ...base, beardLength: 10, beardShape: 'square' }), { ...base, beardLength: 10, beardShape: 'square' });
});

test('the moustache is its own part: a full beard leaves the upper lip to it, and both take the beard\'s colour', () => {
  const man = (l: object) => look.resolveAppearance(person({ id: 'p-clean', sex: 'm', born: '1975', look: { skin: 2, hair: 1, eyes: 0, ...l } }), NOW);
  // Nobody chose a moustache: a full beard comes with one, as it always looked. Choosing "none" shaves the lip.
  assert.notEqual(man({ beardStyle: 'full' }).moustache, 'none');
  assert.notEqual(man({ beardStyle: 'long' }).moustache, 'none');
  assert.equal(man({ beardStyle: 'full', moustache: 'none' }).moustache, 'none');
  assert.equal(man({ beardStyle: 'full', moustache: 'walrus' }).moustache, 'walrus');
  const base = { skin: 2, hair: 1, eyes: 0, hairStyle: 'bald', beardStyle: 'full' };
  const m = { sex: 'm', born: '1975' };
  assert.notEqual(draw({ ...base, moustache: 'none' }, 'lg', m), draw({ ...base, moustache: 'chevron' }, 'lg', m));
  // No patch of skin painted over the beard to make a mouth: the only skin-coloured shapes are the ones a beardless face has.
  const skin = look.SKIN[2];
  const count = (svg: string) => svg.split(`fill="${skin}"`).length - 1;
  assert.equal(count(draw({ ...base, moustache: 'none' }, 'lg', m)), count(draw({ ...base, beardStyle: 'none', moustache: 'none' }, 'lg', m)));
  assert.equal(count(draw({ ...base, beardStyle: 'circle', moustache: 'none' }, 'lg', m)), count(draw({ ...base, beardStyle: 'none', moustache: 'none' }, 'lg', m)));
  // The beard's colour: the hair's unless it has its own, and the moustache follows it.
  assert.equal(man({ beardStyle: 'full' }).beardColour, man({ beardStyle: 'full' }).hair);
  assert.equal(man({ beardStyle: 'full', beardHex: '#b5522c' }).beardColour, '#b5522c');
  assert.equal(man({ beardStyle: 'full', beardHex: '#b5522c' }).hair, look.HAIR[1]);
  const red = draw({ ...base, moustache: 'handlebar', beardStyle: 'none', beardHex: '#b5522c' }, 'lg', m);
  assert.match(red, /fill="#b5522c"/, 'a moustache alone takes the colour too');
});

test('the editor\'s first choices are about twenty hair styles, and every style ever stored still has its place and its drawing', () => {
  const first = look.HAIR_STYLES.filter((o: { more?: boolean }) => !o.more);
  assert.ok(first.length >= 18 && first.length <= 22, `${first.length} first choices`);
  for (const id of ['cropped', 'side-part', 'swept-back', 'bob', 'curly', 'coily', 'long', 'ponytail', 'bun', 'bald', 'receding', 'textured-crop', 'undercut', 'messy']) assert.ok(first.some((o: { id: string }) => o.id === id), id);
  // The styles a look could store before the redraw (the frozen test's own lists) and since.
  const STORED = ['cropped', 'short', 'side-part', 'swept', 'curly', 'afro', 'quiff', 'bowl', 'shoulder', 'long', 'wavy', 'braid', 'bun', 'chignon', 'bob', 'pixie', 'ponytail', 'pigtails', 'periwig', 'powdered', 'receding', 'bald', 'buzz', 'coily', 'fade', 'slicked', 'thinning', 'mullet', 'fringe', 'curly-long', 'locs', 'box-braids', 'cornrows', 'side-braid', 'crown-braid', 'beehive', 'space-buns'];
  const ids = look.HAIR_STYLES.map((o: { id: string }) => o.id);
  for (const id of STORED) assert.ok(ids.includes(id), id);
  assert.equal(new Set(ids).size, ids.length, 'no style twice');
  // Each draws its own silhouette: no two styles are the same picture, at the list size or the largest.
  const base = { skin: 3, hair: 2, eyes: 1, glasses: 'none', headwear: 'none', clothing: 'shirt' };
  for (const detail of ['sm', 'lg']) assert.equal(new Set([...ids, 'tuft'].map((id: string) => draw({ ...base, hairStyle: id }, detail, { sex: 'f', born: '1980' }))).size, ids.length + 1, detail);
  for (const o of look.MOUSTACHES) assert.ok(['none', 'pencil', 'chevron', 'handlebar', 'walrus'].includes(o.id) !== !!o.more, o.id);
});

test('at the list size hair is its silhouette alone: one flat shape a layer, no rim, no highlight, no line of flow', () => {
  const base = { skin: 3, hair: 2, eyes: 1, grey: 0, glasses: 'none', headwear: 'none', clothing: 'shirt', beardStyle: 'none', moustache: 'none' };
  const ink = look.HAIR[2];
  const bare = avatar.avatarSvg(look.resolveAppearance(person({ look: base }), NOW), DRESS, 'sm', true);
  for (const o of look.HAIR_STYLES) {
    // A powdered wig is its own colour, and whitens the brows with it: not this test's business.
    if (o.id === 'powdered') continue;
    const svg = draw({ ...base, hairStyle: o.id }, 'sm');
    // What the hair adds to the drawing: paths filled with the hair's colour and nothing else.
    const added = (svg.match(/<path [^>]*>/g) ?? []).filter((p: string) => !bare.includes(p));
    assert.ok(added.length >= 1 && added.length <= 4, `${o.id}: ${added.length} shapes`);
    for (const p of added) assert.match(p, new RegExp(`^<path d="[^"]+" fill="${ink}"( opacity="\\.42")?/>$`), `${o.id}: ${p.slice(0, 40)}…${p.slice(-60)}`);
  }
});

test('a hat presses the hair down: nothing of it shows above the hat, and hair worn with a crown or a bow keeps its shape', () => {
  const base = { skin: 3, hair: 2, eyes: 1, hairStyle: 'curly', clothing: 'shirt' };
  assert.match(draw({ ...base, headwear: 'cap' }), /<clipPath id="hh">/);
  assert.match(draw({ ...base, headwear: 'cap' }, 'sm'), /clip-path="url\(#hh\)"/);
  for (const worn of ['none', 'crown', 'headband', 'bow', 'tiara', 'flower-crown', 'kippah']) assert.doesNotMatch(draw({ ...base, headwear: worn }), /id="hh"/, worn);
  // Covered hair draws no hair at all, as before.
  assert.doesNotMatch(draw({ ...base, grey: 0, headwear: 'hijab' }), new RegExp(`fill="${look.HAIR[2]}"`));
  assert.match(draw({ ...base, grey: 0, headwear: 'cap' }), new RegExp(`fill="${look.HAIR[2]}"`));
});
