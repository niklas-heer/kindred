// Pictures in the browser: read the date a camera wrote, scale a picture down and drop its EXIF and GPS
// (a canvas re-encode keeps no metadata), and cut a square for a profile picture. No packages.
import { validDate } from '~/lib/dates';

// ---------- the date a camera wrote ----------

const TAG_EXIF_IFD = 0x8769;
const TAG_DATE_ORIGINAL = 0x9003;
const TAG_DATE_DIGITIZED = 0x9004;
const TAG_DATE_TIME = 0x0132;

/**
 * The capture date from a JPEG's EXIF (DateTimeOriginal, else DateTimeDigitized or DateTime), as a
 * partial date "1985-06-14". Reads only the start of the file. Null when there is none or it is unreadable.
 */
export async function exifDate(file: Blob): Promise<string | null> {
  try {
    const view = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
    let off = 2;
    while (off + 4 <= view.byteLength) {
      const marker = view.getUint16(off);
      if ((marker & 0xff00) !== 0xff00) return null;
      if (marker === 0xffda) return null; // start of the image data: the metadata came before it
      const len = view.getUint16(off + 2);
      if (marker === 0xffe1 && view.getUint32(off + 4) === 0x45786966 /* "Exif" */) {
        return dateInTiff(view, off + 10);
      }
      off += 2 + len;
    }
    return null;
  } catch {
    return null;
  }
}

function dateInTiff(view: DataView, tiff: number): string | null {
  const little = view.getUint16(tiff) === 0x4949;
  const u16 = (o: number) => view.getUint16(o, little);
  const u32 = (o: number) => view.getUint32(o, little);
  const entries = (ifd: number) => {
    const map = new Map<number, number>();
    const n = u16(tiff + ifd);
    for (let i = 0; i < n; i++) map.set(u16(tiff + ifd + 2 + i * 12), tiff + ifd + 2 + i * 12);
    return map;
  };
  const ascii = (entry: number): string => {
    const count = u32(entry + 4);
    const at = count <= 4 ? entry + 8 : tiff + u32(entry + 8);
    let s = '';
    for (let i = 0; i < count; i++) {
      const c = view.getUint8(at + i);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  const ifd0 = entries(u32(tiff + 4));
  const exif = ifd0.get(TAG_EXIF_IFD);
  const exifIfd = exif ? entries(u32(exif + 8)) : new Map<number, number>();
  const pick = (m: Map<number, number>, tag: number) => {
    const e = m.get(tag);
    return e ? ascii(e) : '';
  };
  const raw = pick(exifIfd, TAG_DATE_ORIGINAL) || pick(exifIfd, TAG_DATE_DIGITIZED) || pick(ifd0, TAG_DATE_TIME);
  // "1985:06:14 18:03:00" → "1985-06-14"; a camera with no clock writes 0000 for the year.
  const m = /^(\d{4}):(\d{2}):(\d{2})/.exec(raw);
  if (!m || m[1] === '0000') return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  return validDate(date) ? date : null;
}

// ---------- scaling ----------

export interface Scaled {
  blob: Blob;
  width: number;
  height: number;
  mime: 'image/jpeg';
}

/**
 * Scales a picture so its longer side is at most `max` pixels, and re-encodes it as JPEG. The canvas
 * drops EXIF and GPS. Orientation from the camera is applied first. Transparent areas become white.
 */
export async function scaledPicture(file: Blob, max = 2400, quality = 0.85): Promise<Scaled> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('unreadable');
  }
  try {
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('up.err_canvas');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await toBlob(canvas, quality);
    return { blob, width, height, mime: 'image/jpeg' };
  } finally {
    bitmap.close();
  }
}

/** A square crop of a loaded picture, as a JPEG of `size` pixels. `box` is in the picture's own pixels. */
export async function squareCrop(source: CanvasImageSource, box: { x: number; y: number; size: number }, size = 512): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('up.err_canvas');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, box.x, box.y, box.size, box.size, 0, 0, size, size);
  return toBlob(canvas, 0.9);
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('up.err_encode'))), 'image/jpeg', quality),
  );
}
