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
const look = await vite.ssrLoadModule('/src/components/portrait/look.ts');
const types = await vite.ssrLoadModule('/src/lib/ai/types.ts');

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
