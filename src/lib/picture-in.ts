// An uploaded picture, checked before anything stores it: its declared type, its first bytes, its size, and without its
// metadata (strip-metadata.ts). The gallery's photo and its thumbnail both come from the browser and are trusted alike,
// which is to say not at all. Pure, so the test runner loads it.
import { stripMetadata } from './strip-metadata.ts';

/** The first bytes of a picture, so the stored type is the real one (a renamed file is refused). */
export function sniff(bytes: Uint8Array): string | null {
  const at = (i: number, ...b: number[]) => b.every((x, j) => bytes[i + j] === x);
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return null;
}

export interface CheckedPicture { file: File; bytes: Uint8Array; mime: string }

/**
 * A form's picture, or an error code: a JPEG, PNG or WebP of at most `max` bytes whose first bytes agree with its type,
 * cleaned of its metadata. A picture too damaged to clean is refused.
 */
export async function checkedPicture(entry: FormDataEntryValue | null, max: number): Promise<CheckedPicture> {
  if (!(entry instanceof File) || !/^image\/(jpeg|png|webp)$/.test(entry.type) || entry.size > max) throw new Error('photos.err.picture_type');
  const raw = new Uint8Array(await entry.arrayBuffer());
  if (sniff(raw) !== entry.type) throw new Error('photos.err.not_picture');
  const bytes = stripMetadata(raw, entry.type);
  if (!bytes) throw new Error('photos.err.not_picture');
  return { file: entry, bytes, mime: entry.type };
}

/** A thumbnail is about 400 pixels on its long side, some 30 kB; this leaves room for a busy picture and no more. */
export const THUMB_MAX_BYTES = 300_000;

/**
 * The small copy the browser made of a gallery photo, for tiles and peeks, or null when the form has none (an older
 * client, a script). One that is there but not a clean picture refuses the whole upload, as the photo itself would.
 */
export async function checkedThumb(entry: FormDataEntryValue | null): Promise<CheckedPicture | null> {
  if (entry === null) return null;
  return checkedPicture(entry, THUMB_MAX_BYTES);
}
