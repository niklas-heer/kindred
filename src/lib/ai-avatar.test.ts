// The model is given the portrait's own lists, and one odd value doesn't lose the whole portrait.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, after } from 'node:test';
import { createServer } from 'vite';

process.env.KINDRED_DATA_DIR = mkdtempSync(join(tmpdir(), 'kindred-avatar-'));
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } });
after(() => vite.close());
const vision = await vite.ssrLoadModule('/src/lib/ai/vision.server.ts');
const look = await vite.ssrLoadModule('/src/lib/portrait-look.ts');
const types = await vite.ssrLoadModule('/src/lib/ai/types.ts');

test('every look field is required, so Anthropic can compile the schema', () => {
  // Nineteen optional fields made it spend two minutes and then refuse the schema as too complex.
  assert.deepEqual([...vision.LOOK_JSON.required].sort(), Object.keys(vision.LOOK_JSON.properties).sort());
});

test('every style field offers the portrait\'s own values, and era fields are not asked for', () => {
  const p = vision.LOOK_JSON.properties;
  for (const k of ['hairStyle', 'beardStyle', 'moustache', 'glasses', 'brows']) {
    assert.deepEqual(p[k].enum, [...look.PHOTO_LOOK_FIELDS[k].of], k);
  }
  assert.deepEqual(p.marks.items.enum, [...look.PHOTO_LOOK_FIELDS.marks.of]);
  for (const k of ['headwear', 'clothing', 'age']) assert.equal(p[k], undefined, k);
});

test('a value the portrait doesn\'t know is dropped, and the rest is kept', () => {
  const r = types.lookSchema.safeParse(look.sanitizeLook({ skin: 2, hair: 1, eyes: 0, glasses: 'sunglasses', beardStyle: 'full', hairStyle: 'short hair' }));
  assert.equal(r.success, true);
  assert.equal(r.data.beardStyle, 'full');
  assert.equal(r.data.glasses, undefined);
  assert.equal(r.data.hairStyle, undefined);
});

test('the face fields survive the look schema, and every value the portrait offers is accepted', () => {
  const face = { face: 'heart', noseShape: 'snub', eyeShape: 'hooded', jaw: 0, noseSize: 10, mouthWidth: 3, mouthFullness: 7, eyeSize: 5, eyeSpacing: 6, browHeight: 4, earSize: 8, hairline: 2 };
  const clean = look.sanitizeLook({ skin: 3, hair: 2, eyes: 1, ...face });
  const r = types.lookSchema.safeParse(clean);
  assert.equal(r.success, true);
  assert.deepEqual(r.data, clean);
  for (const k of look.LEVEL_KEYS) assert.equal((r.data as Record<string, unknown>)[k], (face as Record<string, unknown>)[k], k);
  const base = { skin: 0, hair: 0, eyes: 0 };
  for (const f of look.FACE_SHAPES) assert.equal(types.lookSchema.safeParse({ ...base, face: f.id }).success, true, f.id);
  for (const f of look.NOSE_SHAPES) assert.equal(types.lookSchema.safeParse({ ...base, noseShape: f.id }).success, true, f.id);
  for (const f of look.EYE_SHAPES) assert.equal(types.lookSchema.safeParse({ ...base, eyeShape: f.id }).success, true, f.id);
  assert.equal(types.lookSchema.safeParse({ ...base, face: 'triangle' }).success, false);
  assert.equal(types.lookSchema.safeParse({ ...base, jaw: 11 }).success, false);
});
