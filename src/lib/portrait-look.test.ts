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
const look = await vite.ssrLoadModule('/src/components/portrait/look.ts');
const avatar = await vite.ssrLoadModule('/src/components/portrait/avatar.ts');
const vision = await vite.ssrLoadModule('/src/lib/ai/vision.server.ts');

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
