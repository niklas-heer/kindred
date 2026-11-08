// The server's check of pictures attached to a chat message. The browser has already scaled them down, but nothing it
// says is trusted: the limits are checked again here, and each picture's type comes from its own first bytes.
import type { ImagePart } from './adapters';
import { CHAT_IMAGE_BYTES, CHAT_IMAGE_COUNT } from './types';

/** The longest base64 text one picture may be: four characters for every three bytes, rounded up. */
export const CHAT_IMAGE_BASE64 = Math.ceil(CHAT_IMAGE_BYTES / 3) * 4;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** A picture's real type, from the first bytes of its base64 text. Null when they are not a JPEG, PNG, WebP or GIF. */
export function sniffImage(base64: string): ImagePart['mime'] | null {
  let head: string;
  try {
    head = atob(base64.slice(0, 24));
  } catch {
    return null;
  }
  const at = (i: number) => head.charCodeAt(i);
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (head.startsWith('\x89PNG\r\n\x1a\n')) return 'image/png';
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'image/gif';
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** The pictures as they go to the provider, or an error whose message is a translation key. */
export function checkChatImages(images: readonly { base64: string }[]): ImagePart[] {
  if (images.length > CHAT_IMAGE_COUNT) throw new Error('ai.err_image_many');
  return images.map(({ base64 }) => {
    if (base64.length > CHAT_IMAGE_BASE64) throw new Error('ai.err_image_big');
    const mime = BASE64.test(base64) ? sniffImage(base64) : null;
    if (!mime) throw new Error('ai.err_image_bad');
    return { mime, base64 };
  });
}
