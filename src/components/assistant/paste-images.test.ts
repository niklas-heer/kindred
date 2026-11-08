import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pastedImages, type ClipboardLike } from './paste-images.ts';

const png = new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' });
const clip = (text: string, files: File[] = [], items: ClipboardLike['items'] = []): ClipboardLike => ({ files, items, getData: () => text });

test('a screenshot alone is attached', () => assert.deepEqual(pastedImages(clip('', [png])), [png]));
test('a screenshot tool that adds the file path as text is still attached', () => {
  for (const path of ['/Users/someone/Desktop/CleanShot-1.png', 'file:///tmp/shot.png', 'shot.png']) assert.deepEqual(pastedImages(clip(path, [png])), [png]);
});
test('an image offered only through clipboard items is attached', () => {
  assert.deepEqual(pastedImages(clip('', [], [{ kind: 'file', type: 'image/png', getAsFile: () => png }])), [png]);
});
test('real writing stays text, even with a picture beside it', () => assert.deepEqual(pastedImages(clip('Hello from the family', [png])), []));
test('nothing to attach', () => { assert.deepEqual(pastedImages(clip('')), []); assert.deepEqual(pastedImages(null), []); });
