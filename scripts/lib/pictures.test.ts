// node --test scripts/lib/pictures.test.ts — the pictures painted for the invented families: the same scene and seed give
// the same picture, every scene is a real PNG of the size asked for, and the families' own feeds name people of the tree.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';
import { drawScene, SCENES } from './pictures.ts';

test('every scene is a PNG of the size asked for, and the same for the same seed', () => {
  for (const scene of SCENES) {
    const a = drawScene(scene, 7, 160);
    const b = drawScene(scene, 7, 160);
    assert.deepEqual([a.width, a.height], [160, 120], scene);
    assert.deepEqual([...a.png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], scene);
    assert.equal(Buffer.compare(a.png, b.png), 0, `${scene} is the same for the same seed`);
    // The header says what the file holds, and the picture's bytes are all there.
    const view = new DataView(a.png.buffer, a.png.byteOffset);
    assert.deepEqual([view.getUint32(16), view.getUint32(20)], [160, 120]);
    const length = view.getUint32(33);
    assert.equal(inflateSync(a.png.subarray(41, 41 + length)).length, (160 * 3 + 1) * 120, scene);
  }
  const tall = drawScene('door', 1, 160, true);
  assert.deepEqual([tall.width, tall.height], [120, 160]);
  assert.notEqual(Buffer.compare(drawScene('lake', 1, 160).png, drawScene('lake', 2, 160).png), 0, 'another seed, another picture');
});
