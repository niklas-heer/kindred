// Drops what a picture says about where, when and with what it was taken, on the server, for every upload: the browser
// already re-encodes pictures through a canvas (src/components/photos/image.ts), which keeps no metadata, but an upload that
// did not come through that code (a script, another client, a browser whose re-encode failed) must not put a family's GPS
// positions and camera details in front of every member and guest. Pure and byte-level, no image library: the pixels are
// never decoded or touched, and a kept part is copied byte for byte.
//   JPEG  drops APP1 (EXIF, XMP), APP13 (IPTC, Photoshop), COM, and the other APPn segments except APP0 (JFIF), APP14
//         (Adobe colour transform) and APP2 ICC_PROFILE, which decoding needs; drops anything after the image's end
//         (MPF secondary images carry their own EXIF). The camera's orientation is kept as a minimal EXIF holding only
//         that tag: an upright picture from the browser has none, and a picture from elsewhere would otherwise show on
//         its side.
//   PNG   drops eXIf, tEXt, iTXt, zTXt and tIME chunks, and anything after IEND. Kept chunks keep their own CRCs.
//   WebP  drops the EXIF and XMP chunks, clears their flags in VP8X, and writes the RIFF size again.
// A file it cannot walk to its end is not passed on half-cleaned: the result is null, and the upload is refused.
// PDFs are left alone (their Info dictionary and XMP may sit in compressed object streams that would have to be rewritten).

export type CleanableMime = 'image/jpeg' | 'image/png' | 'image/webp';

/** The picture without its metadata; the same bytes for a type this does not clean; null when the file is malformed. */
export function stripMetadata(bytes: Uint8Array, mime: string): Uint8Array | null {
  if (mime === 'image/jpeg') return stripJpeg(bytes);
  if (mime === 'image/png') return stripPng(bytes);
  if (mime === 'image/webp') return stripWebp(bytes);
  return bytes;
}

function join(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const startsWith = (bytes: Uint8Array, at: number, text: string) => {
  if (at + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i++) if (bytes[at + i] !== text.charCodeAt(i)) return false;
  return true;
};

// ---------- JPEG ----------

/** The orientation tag (2–8) of an EXIF APP1 body starting at `at` (after its length), or null for none, 1 or unreadable. */
function exifOrientation(bytes: Uint8Array, at: number, end: number): number | null {
  const tiff = at + 6; // "Exif\0\0"
  if (tiff + 8 > end) return null;
  const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
  if (!little && !(bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d)) return null;
  const u16 = (o: number) => (little ? bytes[o] | (bytes[o + 1] << 8) : (bytes[o] << 8) | bytes[o + 1]);
  const u32 = (o: number) => (little ? (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16)) + bytes[o + 3] * 2 ** 24 : bytes[o] * 2 ** 24 + ((bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]));
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return null;
  const n = u16(ifd);
  for (let i = 0; i < n; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return null;
    if (u16(entry) === 0x0112 && u16(entry + 2) === 3) {
      const value = u16(entry + 8);
      return value >= 2 && value <= 8 ? value : null;
    }
  }
  return null;
}

/** An APP1 segment holding EXIF with only the orientation tag: big-endian TIFF, one IFD, one entry. */
function orientationSegment(orientation: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xe1, 0x00, 0x22, // APP1, length 34
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // "MM", 42, IFD0 at 8
    0x00, 0x01, // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, // Orientation, SHORT, 1, value
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ]);
}

function keepJpegSegment(marker: number, bytes: Uint8Array, body: number): boolean {
  if (marker === 0xe0 || marker === 0xee) return true; // APP0 JFIF, APP14 Adobe
  if (marker === 0xe2) return startsWith(bytes, body, 'ICC_PROFILE\0');
  if (marker >= 0xe0 && marker <= 0xef) return false; // every other APPn: EXIF, XMP, MPF, IPTC, vendor data
  if (marker === 0xfe) return false; // COM
  return true; // tables, frame and scan headers, restart interval…
}

function stripJpeg(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let orientationKept = false;
  let i = 2;
  for (;;) {
    if (i >= bytes.length || bytes[i] !== 0xff) return null;
    while (bytes[i] === 0xff) i++; // fill bytes before a marker
    if (i >= bytes.length) return null;
    const marker = bytes[i];
    const at = i - 1;
    i++;
    if (marker === 0xd9) { // the end of the image: whatever follows is dropped
      parts.push(new Uint8Array([0xff, 0xd9]));
      return join(parts);
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { // markers without a length
      parts.push(bytes.subarray(at, i));
      continue;
    }
    if (i + 2 > bytes.length) return null;
    const length = (bytes[i] << 8) | bytes[i + 1];
    const end = i + length;
    if (length < 2 || end > bytes.length) return null;
    if (marker === 0xe1 && !orientationKept && startsWith(bytes, i + 2, 'Exif\0\0')) {
      const orientation = exifOrientation(bytes, i + 2, end);
      if (orientation) {
        parts.push(orientationSegment(orientation));
        orientationKept = true;
      }
    } else if (keepJpegSegment(marker, bytes, i + 2)) {
      parts.push(bytes.subarray(at, end));
    }
    i = end;
    if (marker === 0xda) {
      // A scan's coded data runs to the next marker that is not a stuffed 0xFF00 or a restart marker.
      let j = i;
      while (j + 1 < bytes.length && !(bytes[j] === 0xff && bytes[j + 1] !== 0x00 && !(bytes[j + 1] >= 0xd0 && bytes[j + 1] <= 0xd7) && bytes[j + 1] !== 0xff)) j++;
      if (j + 1 >= bytes.length) return null;
      parts.push(bytes.subarray(i, j));
      i = j;
    }
  }
}

// ---------- PNG ----------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_DROPPED = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME']);

function stripPng(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 8 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) return null;
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= bytes.length) {
    const length = bytes[i] * 2 ** 24 + ((bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]);
    const end = i + 12 + length;
    if (end > bytes.length) return null;
    const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
    if (!PNG_DROPPED.has(type)) parts.push(bytes.subarray(i, end));
    if (type === 'IEND') return join(parts);
    i = end;
  }
  return null;
}

// ---------- WebP ----------

const VP8X_EXIF = 0x08;
const VP8X_XMP = 0x04;

function stripWebp(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 12 || !startsWith(bytes, 0, 'RIFF') || !startsWith(bytes, 8, 'WEBP')) return null;
  const size = bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] * 2 ** 24);
  const total = 8 + size;
  if (size % 2 !== 0 || total > bytes.length) return null;
  const chunks: Uint8Array[] = [];
  let i = 12;
  while (i < total) {
    if (i + 8 > total) return null;
    const length = bytes[i + 4] | (bytes[i + 5] << 8) | (bytes[i + 6] << 16) | (bytes[i + 7] * 2 ** 24);
    const end = i + 8 + length + (length % 2);
    if (end > total) return null;
    const type = String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]);
    if (type === 'VP8X') {
      if (length < 10) return null;
      const chunk = bytes.slice(i, end); // a copy: its flags change
      chunk[8] &= ~(VP8X_EXIF | VP8X_XMP);
      chunks.push(chunk);
    } else if (type !== 'EXIF' && type !== 'XMP ') {
      chunks.push(bytes.subarray(i, end));
    }
    i = end;
  }
  const body = chunks.reduce((n, c) => n + c.length, 0);
  const header = bytes.slice(0, 12);
  const riff = 4 + body;
  header[4] = riff & 0xff;
  header[5] = (riff >>> 8) & 0xff;
  header[6] = (riff >>> 16) & 0xff;
  header[7] = (riff >>> 24) & 0xff;
  return join([header, ...chunks]);
}
