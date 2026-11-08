// Painted portraits, as pure rules: the prompt (fixed rules, the family's style, a person's tweaks), the OpenRouter image request and reply, which models
// are offered and which are benchmarked, what a portrait costs to reserve, and when a painted portrait is shown.
// No I/O: the server (portrait.server.ts), the bake-off script and the Portrait component all use these, so the
// request a test checks is the request that is sent. Reply shapes and cost figures are OpenRouter's (see below).
import { can, type Role } from '../roles.ts';

/**
 * A reply that cannot be read as a painted portrait. The server turns it into an AiError (bad-output), so the budget
 * charges it as the reply may have billed. Kept here, not in adapters.ts, so this module loads without the adapters.
 */
export class ReplyError extends Error {
  code: 'bad-output';
  constructor(message: string) {
    super(message);
    this.code = 'bad-output';
    this.name = 'ReplyError';
  }
}

/** The most characters a family style may have, and a personal note. */
export const MAX_STYLE_CHARS = 800;
export const MAX_NOTE_CHARS = 140;
/** The most portraits a person keeps, the one they show included. */
export const MAX_KEPT_PORTRAITS = 6;

/** The look every portrait in a family shares, until a steward writes their own. Look only: see the fixed rules below. */
export const DEFAULT_FAMILY_STYLE =
  'A hand-painted character portrait in the manner of a grand-strategy game, clearly an oil painting and not a filtered photograph: visible, rich brushwork and a restrained palette. Flattering soft studio light comes from high on the left, as in a classic Rembrandt portrait: the viewer’s-left side of the face is warmly lit, and the opposite cheek is clearly darker, with soft natural shadow beside the nose, under the chin and on the neck. The face has real depth, and no flat frontal light or camera flash remains. They wear dignified, formal period dress instead of their everyday clothes, against a plain dark painted background.';

// The rules a family style and a personal tweak can never change. They frame for the app's circle and keep the person.
const FRAMING =
  'Make a square head-and-shoulders portrait of the person in this photo, centred and facing the viewer. It will be shown cropped to a circle, so the whole head must sit well inside the circle: leave clear empty background above the hair, with the top of the hair about one fifth of the way down the image, and clear space on both sides of the head. The head takes up about two fifths of the image height, with the neck and the top of the shoulders showing below it. If the photo is cropped tightly or badly framed, never zoom in and never cut off the head: paint the rest of the hair, the ears, the shoulders, the clothing and the background beyond the edges of the photo so that the portrait is complete.';
const LIKENESS =
  'Keep this exact person: their real face shape, eyes, nose, mouth, hairline, facial hair, glasses and marks, so that they are plainly recognisable as the person in the photo. Keep their apparent age as in the photo. Do not change, age or de-age them, and do not slim them or turn them into someone more conventionally handsome.';
const TOUCH_UP =
  'Make the best of the photo, as a kind portrait retoucher would: correct harsh flash and poor light, and gently soften tiredness, dark under-eye shadows and blotchy skin so that they look rested and at ease. Keep natural skin texture and soft shadow on the face. This is a light touch-up only.';
const LIMITS =
  'The family style sets only the look of the painting. Any personal adjustment is small and must not replace the family style, change who the person is or their age, or cut off the head. No text, no lettering, no frame or border, no signature, no watermark.';

/** A person's own small adjustments. Fixed choices, and a short note; none of them replaces the family style. */
export interface PortraitTweak {
  framing?: 'closer' | 'farther';
  warmth?: 'warmer' | 'cooler';
  smile?: boolean;
  note?: string;
}

const FRAMING_TWEAK = {
  closer: 'Frame a little closer: the head may take up to half of the image height, still with background above the hair and the whole head inside the circle.',
  farther: 'Frame a little wider: the head takes about one third of the image height, with more of the shoulders and background.',
} as const;
const WARMTH_TWEAK = {
  warmer: 'Make the light and colours slightly warmer.',
  cooler: 'Make the light and colours slightly cooler.',
} as const;

/** Text as it may go into a prompt: one line, no control characters or quotation marks, no longer than `max`. */
export function cleanPromptText(text: string, max: number): string {
  return text.replace(/[\p{Cc}\p{Cf}"“”„«»]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

/** The family style as it is stored: cleaned, and empty when it is the default, so a later better default reaches the family. */
export const storedFamilyStyle = (text: string): string => {
  const clean = cleanPromptText(text, MAX_STYLE_CHARS);
  return clean === DEFAULT_FAMILY_STYLE ? '' : clean;
};

/** A tweak with only what is allowed in it, so what is sent and what is saved are the same. Undefined when nothing is left. */
export function cleanTweak(t: PortraitTweak | null | undefined): PortraitTweak | undefined {
  const out: PortraitTweak = {};
  if (t?.framing === 'closer' || t?.framing === 'farther') out.framing = t.framing;
  if (t?.warmth === 'warmer' || t?.warmth === 'cooler') out.warmth = t.warmth;
  if (t?.smile === true) out.smile = true;
  const note = t?.note ? cleanPromptText(t.note, MAX_NOTE_CHARS) : '';
  if (note) out.note = note;
  return Object.keys(out).length ? out : undefined;
}

/**
 * The whole prompt: the fixed framing, likeness and touch-up, the family's style, the person's small adjustments, and the
 * fixed limits last. The family style is always there, and a tweak only adds to it. It holds nothing about the person.
 */
export function portraitPrompt(style?: string | null, tweak?: PortraitTweak | null): string {
  const t = cleanTweak(tweak);
  const adjust = [
    t?.framing ? FRAMING_TWEAK[t.framing] : '',
    t?.warmth ? WARMTH_TWEAK[t.warmth] : '',
    t?.smile ? 'Give them a gentle, natural, closed-mouth smile in their own features.' : '',
    t?.note ? `A small personal note, to follow only where it fits the rest: "${t.note}"` : '',
  ].filter(Boolean);
  return [
    FRAMING,
    LIKENESS,
    TOUCH_UP,
    `The family style: ${cleanPromptText(style ?? '', MAX_STYLE_CHARS) || DEFAULT_FAMILY_STYLE}`,
    ...(adjust.length ? [`Personal adjustments: ${adjust.join(' ')}`] : []),
    LIMITS,
  ].join('\n\n');
}

/** The prompt with the default style and no tweak. */
export const PORTRAIT_PROMPT = portraitPrompt();

/** The parts of a membership that decide who may paint. */
export interface PainterLink { role: Role | null | undefined; person: string | null | undefined; personConfirmed: boolean }

/** Who may paint and tweak a person's portrait: an editor, or the member linked to that person once a steward has confirmed the link. */
export const mayPaintPerson = (m: PainterLink | null | undefined, personId: string): boolean =>
  !!m && (can(m.role, 'edit-person') || (!!m.role && !!personId && m.person === personId && m.personConfirmed));

/** This member says they are this person, and painting through that waits for a steward. */
export const awaitsLinkConfirmation = (m: PainterLink | null | undefined, personId: string): boolean =>
  !!m && !!m.role && !can(m.role, 'edit-person') && !!personId && m.person === personId && !m.personConfirmed;

/**
 * Which kept portraits go when a person has more than the cap: the oldest first, never the one shown and never those named
 * in `protect` (the one just kept, and the one it just replaced).
 */
export function overCapKeys(kept: { key: string; createdAt: string; shown: boolean }[], protect: readonly string[] = [], cap = MAX_KEPT_PORTRAITS): string[] {
  const spare = kept
    .filter((k) => !k.shown && !protect.includes(k.key))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.key.localeCompare(b.key));
  return spare.slice(0, Math.max(0, kept.length - cap)).map((k) => k.key);
}

/** OpenRouter's image generation endpoint: POST, JSON, the model's id, a prompt and reference images as data URLs. */
export const OPENROUTER_IMAGES_URL = 'https://openrouter.ai/api/v1/images';
/** The public list of image-output models. It needs no key. */
export const OPENROUTER_IMAGE_MODELS_URL = 'https://openrouter.ai/api/v1/models?output_modalities=image';


export const MAX_SOURCE_BYTES = 12_000_000;
export const MAX_IMAGE_BYTES = 8_000_000;

// The reservation for one portrait. It is deliberately high: the budget is settled to the provider's reported cost.
/** Input tokens assumed for the photo and the prompt. */
const INPUT_TOKENS = 3000;
/** Output tokens assumed for one painted image. */
const OUTPUT_TOKENS = 4096;
/** The margin over the listed prices, so a price that moves a little still fits. */
const MARGIN = 1.5;
/** The least a portrait is reserved at. */
const FLOOR_USD = 0.02;
/** Reserved for a model whose price OpenRouter does not list. */
export const UNPRICED_USD = 0.25;

const LABS: Record<string, string> = {
  openai: 'OpenAI',
  'black-forest-labs': 'Black Forest Labs',
  google: 'Google',
  sourceful: 'Sourceful',
  qwen: 'Qwen (Alibaba)',
  krea: 'Krea',
  tencent: 'Tencent',
  'bytedance-seed': 'ByteDance Seed',
  recraft: 'Recraft',
  microsoft: 'Microsoft',
  meta: 'Meta',
  'x-ai': 'xAI',
  openrouter: 'OpenRouter',
};

/** A model from OpenRouter's list, as the server and the bake-off see it. */
export interface ImageModel {
  id: string;
  name: string;
  lab: string;
  labName: string;
  /** Unix seconds, from the list. */
  created: number;
  /** The model takes an image in (so it can paint from a photo). */
  takesImage: boolean;
  /** The model gives an image out. */
  givesImage: boolean;
  /** A vector-only model (SVG or vector output). The bake-off leaves these out. */
  vectorOnly: boolean;
  /** OpenRouter's router (openrouter/auto and friends): it picks a model per request, so it has no fixed price. */
  router: boolean;
  /** The estimate, in USD, that one portrait is reserved at; null when the list has no price. */
  priceUsd: number | null;
}

/** One entry of OpenRouter's list, as it arrives (the fields the rules read). */
export interface RawImageModel {
  id: string;
  name?: string;
  created?: number;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  pricing?: Record<string, unknown>;
}

const num = (v: unknown): number | null => {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * What one portrait is reserved at, in USD, from the list's prices: the photo and prompt as input, one painted image as
 * output (its image price per token, or its completion price, whichever is dearer), and a price per image where the list
 * gives one. Null when the list gives no price at all.
 */
export function estimateUsd(pricing: Record<string, unknown> | undefined): number | null {
  const prompt = num(pricing?.prompt);
  const completion = num(pricing?.completion);
  const imageOutput = num(pricing?.image_output);
  const perImage = num(pricing?.image);
  if (prompt === null && completion === null && imageOutput === null && perImage === null) return null;
  const tokens = INPUT_TOKENS * (prompt ?? 0) + OUTPUT_TOKENS * Math.max(imageOutput ?? 0, completion ?? 0);
  return Math.max(FLOOR_USD, Math.max(tokens, perImage ?? 0) * MARGIN);
}

/** The lab (the id's first part), named for people. Unknown labs are shown as their id. */
export const labName = (lab: string): string => LABS[lab] ?? lab;

/** Turns OpenRouter's list into models with their flags. Entries without an id are skipped. */
export function imageModels(raw: RawImageModel[]): ImageModel[] {
  const out: ImageModel[] = [];
  for (const m of raw) {
    if (!m || typeof m.id !== 'string' || !m.id.includes('/')) continue;
    const lab = m.id.split('/')[0]!;
    const input = m.architecture?.input_modalities ?? [];
    const output = m.architecture?.output_modalities ?? [];
    out.push({
      id: m.id,
      name: m.name || m.id,
      lab,
      labName: labName(lab),
      created: typeof m.created === 'number' ? m.created : 0,
      takesImage: input.includes('image'),
      givesImage: output.includes('image'),
      vectorOnly: /vector/i.test(m.id),
      router: lab === 'openrouter',
      priceUsd: estimateUsd(m.pricing),
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The models the settings page offers: those that take an image in and give one out. OpenRouter's routers are left
 * out, since they choose a model per request and so have no price to show.
 */
export function pickableImageModels(list: ImageModel[]): ImageModel[] {
  return list.filter((m) => m.takesImage && m.givesImage && !m.router);
}

/**
 * The models the bake-off runs when none are named: per lab, the newest `perLab` that take an image in and give one out,
 * skipping vector-only models and routers. "Newest" is the list's `created` date; the owner can name models instead.
 */
export function benchModels(list: ImageModel[], perLab = 2): ImageModel[] {
  const byLab = new Map<string, ImageModel[]>();
  for (const m of list) {
    if (!m.takesImage || !m.givesImage || m.vectorOnly || m.router) continue;
    byLab.set(m.lab, [...(byLab.get(m.lab) ?? []), m]);
  }
  return [...byLab.keys()].sort().flatMap((lab) =>
    byLab.get(lab)!.sort((a, b) => b.created - a.created || a.id.localeCompare(b.id)).slice(0, perLab),
  );
}

/** The first bytes of a picture: jpeg, png or webp, or null. A renamed or non-image file is refused. */
export function sniffImage(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  const at = (i: number, ...b: number[]) => b.every((x, j) => bytes[i + j] === x);
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return null;
}

/** Base64 of bytes, without Buffer, so it runs on Workers as well as Node. */
export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * The request for one portrait: the prompt, and the photo as a reference image (a data URL). Returned as plain data, so the
 * caller sends it with its own key.
 */
export function portraitRequest(
  model: string,
  photo: { mime: string; bytes: Uint8Array },
  look?: { style?: string | null; tweak?: PortraitTweak | null },
): { url: string; body: Record<string, unknown> } {
  return {
    url: OPENROUTER_IMAGES_URL,
    body: {
      model,
      prompt: portraitPrompt(look?.style, look?.tweak),
      aspect_ratio: '1:1', // the app shows a portrait in a circle; every image model tried takes this, and some refuse pixel sizes
      input_references: [{ type: 'image_url', image_url: { url: `data:${photo.mime};base64,${toBase64(photo.bytes)}` } }],
    },
  };
}

/** A painted image as the reply gave it, checked. `costUsd` is what OpenRouter reported; null when it did not say. */
export interface PaintedImage {
  bytes: Uint8Array;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  costUsd: number | null;
}

const DATA_URL = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i;

/** Decodes base64 (a data URL's part or an `b64_json`). Returns null when it is not valid base64. */
function decode(b64: string): Uint8Array | null {
  const clean = b64.replace(/\s+/g, '');
  if (!clean || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return null;
  try {
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Where a reply's images are: the Image API's `data[].b64_json`, or chat-style `message.images[]` and content parts as data URLs. */
function imageParts(json: any): { b64: string | null; dataUrl: string | null }[] {
  const parts: { b64: string | null; dataUrl: string | null }[] = [];
  for (const d of Array.isArray(json?.data) ? json.data : []) if (typeof d?.b64_json === 'string') parts.push({ b64: d.b64_json, dataUrl: null });
  const msg = json?.choices?.[0]?.message;
  for (const im of Array.isArray(msg?.images) ? msg.images : []) if (typeof im?.image_url?.url === 'string') parts.push({ b64: null, dataUrl: im.image_url.url });
  if (Array.isArray(msg?.content)) {
    for (const c of msg.content) if (c?.type === 'image_url' && typeof c.image_url?.url === 'string') parts.push({ b64: null, dataUrl: c.image_url.url });
  }
  return parts;
}

/**
 * The painted image in a reply, checked: it must be a raster (jpeg, png or webp by its first bytes), no larger than
 * MAX_IMAGE_BYTES. A reply with no image, or with something that is not one, is refused (a ReplyError, which the server reports as AiError
 * bad-output, so the budget still charges it as spent: the provider may have billed for it). OpenRouter's cost in USD comes back as `costUsd`.
 */
export function parsePortraitReply(json: unknown): PaintedImage {
  const parts = imageParts(json);
  if (!parts.length) throw new ReplyError('paint.err_no_image');
  const first = parts[0]!;
  let bytes: Uint8Array | null = null;
  if (first.b64) bytes = decode(first.b64);
  else if (first.dataUrl) {
    const m = DATA_URL.exec(first.dataUrl);
    bytes = m ? decode(m[2]!) : null;
  }
  if (!bytes) throw new ReplyError('paint.err_not_image');
  const mime = sniffImage(bytes);
  if (!mime) throw new ReplyError('paint.err_not_image');
  if (bytes.length > MAX_IMAGE_BYTES) throw new ReplyError('paint.err_too_big');
  const cost = (json as { usage?: { cost?: unknown } })?.usage?.cost;
  return { bytes, mime, costUsd: typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null };
}

/** Micro-dollars for a USD reservation (1 USD = 1,000,000), rounded up. */
export const usdToMicros = (usd: number): number => Math.ceil(Math.max(0, usd) * 1_000_000);
