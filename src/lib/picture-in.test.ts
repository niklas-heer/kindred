// node --test src/lib/picture-in.test.ts — an uploaded picture and its thumbnail pass the same checks: the declared type,
// the first bytes, the size, and the metadata stripped. Pure: no server.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkedPicture, checkedThumb, THUMB_MAX_BYTES } from './picture-in.ts';

const bytes = (...parts: (number[] | string)[]) => new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));
const segment = (marker: number, body: Uint8Array) => bytes([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff], [...body]);
const APP0 = segment(0xe0, bytes('JFIF\0', [1, 1, 0, 0, 1, 0, 1, 0, 0]));
const EXIF = segment(0xe1, bytes('Exif\0\0', 'GPS 52.5200N 13.4050E'));
const SOS = segment(0xda, bytes([1, 1, 0, 0, 0x3f, 0]));
const jpeg = (...middle: Uint8Array[]) => bytes([0xff, 0xd8], ...middle.map((m) => [...m]), [0x12, 0x34], [0xff, 0xd9]);
const file = (data: Uint8Array, type = 'image/jpeg') => new File([data as Uint8Array<ArrayBuffer>], 'thumb.jpg', { type });

test('a thumbnail loses its EXIF and GPS like the photo', async () => {
  const got = await checkedThumb(file(jpeg(APP0, EXIF, SOS)));
  assert.ok(got);
  assert.equal(got.mime, 'image/jpeg');
  assert.ok(!Buffer.from(got.bytes).includes(Buffer.from('GPS')), 'no GPS left');
});

test('no thumbnail in the form is no thumbnail, not an error', async () => {
  assert.equal(await checkedThumb(null), null);
});

test('a thumbnail that is not a clean picture is refused', async () => {
  await assert.rejects(checkedThumb('text'), /photos\.err\.picture_type/);
  await assert.rejects(checkedThumb(file(bytes('<svg onload="alert(1)"/>'), 'image/svg+xml')), /photos\.err\.picture_type/);
  await assert.rejects(checkedThumb(file(bytes('not a jpeg at all'))), /photos\.err\.not_picture/, 'the first bytes must agree with the type');
  await assert.rejects(checkedThumb(file(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))), /photos\.err\.not_picture/, 'a PNG called a JPEG');
  await assert.rejects(checkedThumb(file(bytes([0xff, 0xd8, 0xff, 0xe1, 0x00]))), /photos\.err\.not_picture/, 'a cut-off file is not passed on half-cleaned');
  await assert.rejects(checkedThumb(file(jpeg(APP0, SOS, new Uint8Array(THUMB_MAX_BYTES)))), /photos\.err\.picture_type/, 'too large for a thumbnail');
});

test('the photo keeps its own, larger limit', async () => {
  const big = jpeg(APP0, SOS, new Uint8Array(THUMB_MAX_BYTES));
  assert.equal((await checkedPicture(file(big), 12_000_000)).mime, 'image/jpeg');
});
