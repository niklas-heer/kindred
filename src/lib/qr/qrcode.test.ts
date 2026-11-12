// node --test src/lib/qr/qrcode.test.ts — the QR encoder (src/lib/qr/qrcode.ts). The symbols it draws were also read back
// with a real decoder (macOS Core Image) for versions 1 to 27 at every level while it was written; here, the standard's
// capacities, the fixed patterns and the format information, so a change that breaks the drawing fails without a camera.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dataCodewords, encodeText, svgPath } from './qrcode.ts';

test('capacities match the standard’s tables', () => {
  // Data codewords per version and level (ISO/IEC 18004, table 7).
  assert.deepEqual(['L', 'M', 'Q', 'H'].map((e) => dataCodewords(1, e as 'L')), [19, 16, 13, 9]);
  assert.deepEqual(['L', 'M', 'Q', 'H'].map((e) => dataCodewords(10, e as 'L')), [274, 216, 154, 122]);
  assert.deepEqual(['L', 'M', 'Q', 'H'].map((e) => dataCodewords(40, e as 'L')), [2956, 2334, 1666, 1276]);
});

test('an otpauth link: the smallest version that holds it, finder patterns in three corners, the dark module, format bits twice', () => {
  const uri = 'otpauth://totp/Kindred:ada.example?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Kindred';
  const qr = encodeText(uri);
  assert.equal(qr.size, qr.version * 4 + 17);
  assert.ok(dataCodewords(qr.version, 'M') >= uri.length + 2 && dataCodewords(qr.version - 1, 'M') < uri.length + 2);
  const m = qr.modules;
  const finderAt = (x: number, y: number) => {
    for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 7; dx++) {
      const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
      assert.equal(m[y + dy][x + dx], ring !== 2, `finder at ${x},${y}`);
    }
  };
  finderAt(0, 0);
  finderAt(qr.size - 7, 0);
  finderAt(0, qr.size - 7);
  assert.equal(m[qr.size - 8][8], true, 'the dark module');
  for (let i = 8; i < qr.size - 8; i++) assert.equal(m[6][i], i % 2 === 0, 'timing');
  // The two copies of the 15 format bits agree.
  const first = [0, 1, 2, 3, 4, 5, 7, 8].map((y) => m[y][8]).concat([7, 5, 4, 3, 2, 1, 0].map((x) => m[8][x]));
  const second = Array.from({ length: 8 }, (_, i) => m[8][qr.size - 1 - i]).concat(Array.from({ length: 7 }, (_, i) => m[qr.size - 7 + i][8]));
  assert.deepEqual(first, second);
  assert.deepEqual(encodeText(uri).modules, m, 'the same text draws the same code');
  assert.match(svgPath(qr), /^(M\d+ \d+h1v1h-1z)+$/);
});

test('too long for version 40 is refused', () => {
  assert.throws(() => encodeText('x'.repeat(3000), 'L'), /too long/);
  assert.equal(encodeText('x'.repeat(2900), 'L').version, 40);
});
