import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, storeZip } from './zip.ts';

const u32 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset).getUint32(at, true);
const u16 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset).getUint16(at, true);

test('the CRC-32 of "123456789" is the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('a stored ZIP has local entries, a central directory and an end record that point at them', () => {
  const files = [
    { path: 'people/anna.md', data: '---\nversion: 1\n---\n' as string | Uint8Array },
    { path: 'attachments/ü.bin', data: new Uint8Array([0, 1, 2, 255]) },
  ];
  const zip = storeZip(files, new Date('2026-11-08T12:00:00Z'));
  assert.equal(u32(zip, 0), 0x04034b50, 'starts with a local file header');
  const end = zip.length - 22;
  assert.equal(u32(zip, end), 0x06054b50, 'ends with an end-of-central-directory record');
  assert.equal(u16(zip, end + 8), 2, 'two entries');
  const cdAt = u32(zip, end + 16);
  assert.equal(u32(zip, cdAt), 0x02014b50, 'the central directory starts where the record says');
  // The first entry's local header sits at offset 0, and its data follows the name.
  const nameLen = u16(zip, 26);
  const size = u32(zip, 18);
  assert.equal(size, (files[0].data as string).length);
  const text = new TextDecoder().decode(zip.subarray(30 + nameLen, 30 + nameLen + size));
  assert.equal(text, files[0].data);
  assert.equal(u32(zip, 14), crc32(new TextEncoder().encode(files[0].data as string)));
});
