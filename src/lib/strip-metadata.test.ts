// node --test src/lib/strip-metadata.test.ts — uploads lose their EXIF, GPS, XMP and IPTC on the server, byte by byte:
// tiny hand-built JPEG, PNG and WebP files, clean ones, and cut-off ones. Pure: no image library, no server.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crc32 } from 'node:zlib';
import { stripMetadata } from './strip-metadata.ts';

const bytes = (...parts: (number[] | string | Uint8Array)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : [...p])));
const has = (hay: Uint8Array, text: string) => Buffer.from(hay).includes(Buffer.from(text, 'latin1'));

// ---------- JPEG ----------

const segment = (marker: number, body: Uint8Array) => bytes([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff], body);
/** EXIF with the orientation tag and a GPS pointer, little-endian as most phones write it. */
const exifBody = (orientation: number) =>
  bytes('Exif\0\0', 'II', [0x2a, 0, 8, 0, 0, 0], [2, 0], [0x12, 0x01, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0], [0x25, 0x88, 4, 0, 1, 0, 0, 0, 0x26, 0, 0, 0], [0, 0, 0, 0], 'GPS 52.5200N 13.4050E Testcam X1');
const APP0 = segment(0xe0, bytes('JFIF\0', [1, 1, 0, 0, 1, 0, 1, 0, 0]));
const ICC = segment(0xe2, bytes('ICC_PROFILE\0', [1, 1], 'profile'));
const DQT = segment(0xdb, bytes([0], new Array(64).fill(1)));
const SOF = segment(0xc0, bytes([8, 0, 1, 0, 1, 1, 1, 0x11, 0]));
const SOS = segment(0xda, bytes([1, 1, 0, 0, 0x3f, 0]));
// Coded data with a stuffed 0xFF00 and a restart marker, which are not the end of the scan.
const SCAN = bytes([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]);
const SOI = bytes([0xff, 0xd8]);
const EOI = bytes([0xff, 0xd9]);
const cleanJpeg = bytes(SOI, APP0, ICC, DQT, SOF, SOS, SCAN, EOI);

test('a JPEG loses EXIF, GPS, XMP, IPTC, comments and what follows its end, and keeps JFIF, ICC and the image', () => {
  const dirty = bytes(
    SOI, APP0,
    segment(0xe1, exifBody(1)),
    segment(0xe1, bytes('http://ns.adobe.com/xap/1.0/\0', '<x:xmpmeta>GPSLatitude Testcam</x:xmpmeta>')),
    ICC,
    segment(0xe2, bytes('MPF\0', 'Testcam')),
    segment(0xed, bytes('Photoshop 3.0\0', '8BIM IPTC byline Testcam')),
    segment(0xfe, bytes('Testcam comment')),
    DQT, SOF, SOS, SCAN, EOI,
    bytes(SOI, segment(0xe1, exifBody(1)), EOI), // an MPF second image after the first one ends
  );
  const out = stripMetadata(dirty, 'image/jpeg')!;
  assert.deepEqual(out, cleanJpeg);
  assert.ok(!has(out, 'Testcam') && !has(out, 'GPS') && !has(out, 'Exif'));
});

test('a JPEG keeps its orientation as a minimal EXIF, so a sideways camera picture still shows upright', () => {
  const dirty = bytes(SOI, APP0, segment(0xe1, exifBody(6)), DQT, SOF, SOS, SCAN, EOI);
  const out = stripMetadata(dirty, 'image/jpeg')!;
  assert.ok(!has(out, 'GPS') && !has(out, 'Testcam'));
  const exif = segment(0xe1, bytes('Exif\0\0', 'MM', [0, 0x2a, 0, 0, 0, 8], [0, 1], [0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0], [0, 0, 0, 0]));
  assert.deepEqual(out, bytes(SOI, APP0, exif, DQT, SOF, SOS, SCAN, EOI));
});

test('a clean JPEG comes back byte for byte, as the browser’s own re-encoded pictures do', () => {
  assert.deepEqual(stripMetadata(cleanJpeg, 'image/jpeg'), cleanJpeg);
  const progressive = bytes(SOI, APP0, DQT, SOF, SOS, SCAN, segment(0xc4, bytes([0, 1])), SOS, SCAN, EOI);
  assert.deepEqual(stripMetadata(progressive, 'image/jpeg'), progressive, 'several scans with tables between them');
});

test('a cut-off or malformed JPEG is refused, never passed on half-cleaned', () => {
  const dirty = bytes(SOI, APP0, segment(0xe1, exifBody(1)), DQT, SOF, SOS, SCAN, EOI);
  for (const cut of [4, 10, 30, dirty.length - 2, dirty.length - 1]) assert.equal(stripMetadata(dirty.subarray(0, cut), 'image/jpeg'), null, `cut at ${cut}`);
  assert.equal(stripMetadata(bytes(SOI, [0xff, 0xe1, 0xff, 0xff], 'x'), 'image/jpeg'), null, 'a length past the end');
  assert.equal(stripMetadata(bytes(SOI, [0x00, 0x00]), 'image/jpeg'), null, 'no marker where one must be');
  assert.equal(stripMetadata(bytes('not a jpeg'), 'image/jpeg'), null);
});

// ---------- PNG ----------

const chunk = (type: string, data: Uint8Array) => {
  const body = bytes(type, data);
  const crc = crc32(body);
  return bytes([data.length >>> 24, (data.length >>> 16) & 0xff, (data.length >>> 8) & 0xff, data.length & 0xff], body, [crc >>> 24, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff]);
};
const SIGNATURE = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IHDR = chunk('IHDR', bytes([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]));
const ICCP = chunk('iCCP', bytes('sRGB\0\0', [1, 2, 3]));
const IDAT = chunk('IDAT', bytes([0x78, 0x9c, 0x63, 0, 0, 0, 2, 0, 1]));
const IEND = chunk('IEND', new Uint8Array());
const cleanPng = bytes(SIGNATURE, IHDR, ICCP, IDAT, IEND);

test('a PNG loses eXIf, text and time chunks, and keeps every other chunk with its own CRC', () => {
  const dirty = bytes(
    SIGNATURE, IHDR, ICCP,
    chunk('eXIf', exifBody(1).subarray(6)),
    chunk('tEXt', bytes('Author\0Testcam')),
    chunk('iTXt', bytes('XML:com.adobe.xmp\0\0\0\0\0', 'GPSLatitude')),
    chunk('zTXt', bytes('Comment\0\0', [0x78, 0x9c])),
    chunk('tIME', bytes([7, 0xd0, 1, 1, 0, 0, 0])),
    IDAT, IEND, 'trailing Testcam',
  );
  const out = stripMetadata(dirty, 'image/png')!;
  assert.deepEqual(out, cleanPng);
  assert.ok(!has(out, 'Testcam') && !has(out, 'GPS'));
});

test('a clean PNG comes back byte for byte; a cut-off one is refused', () => {
  assert.deepEqual(stripMetadata(cleanPng, 'image/png'), cleanPng);
  for (const cut of [8, 20, cleanPng.length - 1, cleanPng.length - 12]) assert.equal(stripMetadata(cleanPng.subarray(0, cut), 'image/png'), null, `cut at ${cut}`);
  assert.equal(stripMetadata(bytes(SIGNATURE, [0x7f, 0xff, 0xff, 0xff], 'IDAT'), 'image/png'), null, 'a length past the end');
});

// ---------- WebP ----------

const riff = (...chunks: Uint8Array[]) => {
  const body = bytes('WEBP', ...chunks);
  return bytes('RIFF', [body.length & 0xff, (body.length >>> 8) & 0xff, (body.length >>> 16) & 0xff, body.length >>> 24], body);
};
const webpChunk = (type: string, data: Uint8Array) =>
  bytes(type, [data.length & 0xff, (data.length >>> 8) & 0xff, (data.length >>> 16) & 0xff, data.length >>> 24], data, data.length % 2 ? [0] : []);
const vp8x = (flags: number) => webpChunk('VP8X', bytes([flags, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
const VP8L = webpChunk('VP8L', bytes([0x2f, 0, 0, 0, 0x10, 0x07]));
const ICCP_WEBP = webpChunk('ICCP', bytes('profile'));

test('a WebP loses its EXIF and XMP chunks, their flags and its old size; ICC, alpha and the image stay', () => {
  const ICC = 0x20, ALPHA = 0x10, EXIF = 0x08, XMP = 0x04;
  const dirty = riff(vp8x(ICC | ALPHA | EXIF | XMP), ICCP_WEBP, VP8L, webpChunk('EXIF', exifBody(1).subarray(6)), webpChunk('XMP ', bytes('<x:xmpmeta>Testcam</x:xmpmeta>')));
  const out = stripMetadata(dirty, 'image/webp')!;
  assert.deepEqual(out, riff(vp8x(ICC | ALPHA), ICCP_WEBP, VP8L));
  assert.ok(!has(out, 'Testcam') && !has(out, 'GPS'));
});

test('a clean WebP comes back byte for byte; a cut-off one is refused', () => {
  const simple = riff(VP8L);
  assert.deepEqual(stripMetadata(simple, 'image/webp'), simple);
  const extended = riff(vp8x(0x20), ICCP_WEBP, VP8L);
  assert.deepEqual(stripMetadata(extended, 'image/webp'), extended);
  for (const cut of [11, 16, extended.length - 1]) assert.equal(stripMetadata(extended.subarray(0, cut), 'image/webp'), null, `cut at ${cut}`);
  const lying = extended.slice();
  lying[4] = 0xff; // a RIFF size past the end of the file
  assert.equal(stripMetadata(lying, 'image/webp'), null);
});

test('a type it does not clean passes through untouched', () => {
  const gif = bytes('GIF89a', [1, 0, 1, 0]);
  assert.equal(stripMetadata(gif, 'image/gif'), gif);
  const pdf = bytes('%PDF-1.4\n/Author (Testcam)\n%%EOF\n');
  assert.equal(stripMetadata(pdf, 'application/pdf'), pdf, 'PDFs are left as they are');
});
