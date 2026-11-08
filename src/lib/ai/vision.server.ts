// The three features that look at a picture or a name and return suggestions: faces in a photo, a
// portrait look from a photo, and arms from a surname. Each returns validated data and writes nothing;
// the caller decides what to keep (the reader's own role applies to every save).
import { db, media } from '../db.server';
import { checkMediaKey } from '../store/index.ts';
import { lookSchema, faceResultSchema, armsDesignSchema, type AiLocale, type ArmsDesign, type FaceResult } from './types';
import { AiError, type ImagePart, type JsonSchema } from './adapters';
import { copyFor } from './copy';
import { adapterForFeature, spend } from './settings.server';
import { SKIN_LABELS, HAIR_LABELS, EYE_LABELS } from '../../components/portrait/look';
import type { Look } from '../types';

const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
const MAX_PHOTO = 8_000_000;
const CANDIDATES = 12;
const CANDIDATE_BYTES = 4_000_000;

async function readImage(tree: string, key: string, mime?: string): Promise<ImagePart & { bytes: Uint8Array } | undefined> {
  checkMediaKey(tree, key);
  const obj = await media.get(tree, key);
  if (!obj) return undefined;
  const bytes = obj.body instanceof Uint8Array ? obj.body : new Uint8Array(await new Response(obj.body).arrayBuffer());
  const type = mime ?? obj.mime ?? MIME[key.split('.').pop()?.toLowerCase() ?? ''];
  if (!type || !/^image\/(jpeg|png|webp|gif)$/.test(type)) return undefined;
  return { mime: type, base64: b64(bytes), bytes };
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Reads a photo the reader names, or says why it can't be used. */
async function photoOrThrow(tree: string, key: string, locale: AiLocale) {
  const c = copyFor(locale);
  let img: Awaited<ReturnType<typeof readImage>>;
  try {
    img = await readImage(tree, key);
  } catch {
    throw new AiError('bad-input', c.errNoPhoto);
  }
  if (!img) throw new AiError('bad-input', c.errBadPhoto);
  if (img.bytes.length > MAX_PHOTO) throw new AiError('bad-input', c.errBadPhoto);
  return img;
}

const LANG = { en: 'English', de: 'German (du)' } as const;

// ---------- faces ----------

const FACES_JSON: JsonSchema = {
  type: 'object',
  properties: {
    faces: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          box: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } }, required: ['x', 'y', 'w', 'h'] },
          suggestions: {
            type: 'array',
            items: { type: 'object', properties: { personId: { type: 'string' }, confidence: { type: 'number' }, reason: { type: 'string' } }, required: ['personId', 'confidence', 'reason'] },
          },
        },
        required: ['box', 'suggestions'],
      },
    },
  },
  required: ['faces'],
};

/**
 * Finds the faces in a group photo and suggests, for each, which candidate it may be. Candidates are a
 * few people in the family who have a picture; they are shown as suggestions only.
 */
export async function findFaces(o: { tree: string; mediaKey: string; locale: AiLocale }): Promise<FaceResult> {
  const c = copyFor(o.locale);
  const { adapter } = await adapterForFeature(o.tree, 'faces', o.locale);
  const photo = await photoOrThrow(o.tree, o.mediaKey, o.locale);

  // Candidates come from the media model: pictures a person is confirmed in (with the box of their face in
  // it, so the model knows which face is theirs), and profile photos. Newest first, one picture per person.
  const rows = await db(o.tree).all<{ id: string; given: string; surname: string | null; key: string; mime: string; x: number | null; y: number | null; w: number | null; h: number | null }>(
    `SELECT id, given, surname, key, mime, x, y, w, h, at FROM (
       SELECT p.id, p.given, p.surname, m.key, m.mime, mp.x, mp.y, mp.w, mp.h, mp.at
         FROM media_person mp JOIN person p ON p.id = mp.person JOIN media m ON m.key = mp.media
        WHERE mp.confirmed = 1
       UNION ALL
       SELECT p.id, p.given, p.surname, ph.key, ph.mime, NULL, NULL, NULL, NULL, ph.at
         FROM photo ph JOIN person p ON p.id = ph.person
        WHERE ph.key IS NOT NULL
     ) ORDER BY at DESC LIMIT ?`, CANDIDATES * 4,
  );
  const parts: ImagePart[] = [photo];
  const lines: string[] = [];
  const ids: string[] = [];
  const seen = new Set<string>();
  let bytes = 0;
  for (const r of rows) {
    if (seen.has(r.id) || ids.length >= CANDIDATES) continue;
    const img = await readImage(o.tree, r.key, r.mime).catch(() => undefined);
    if (!img || bytes + img.bytes.length > CANDIDATE_BYTES) continue;
    bytes += img.bytes.length;
    seen.add(r.id);
    ids.push(r.id);
    parts.push(img);
    const where = r.x === null ? '' : ` Their face is at x ${r.x.toFixed(2)}, y ${r.y!.toFixed(2)}, width ${r.w!.toFixed(2)}, height ${r.h!.toFixed(2)} (fractions of the picture).`;
    lines.push(`Image ${parts.length} is ${[r.given, r.surname].filter(Boolean).join(' ')} (id ${r.id}).${where}`);
  }
  const system = [
    'You find the faces in the first image, a family photo. For each face, give its box as fractions of the whole image (x, y from the top left; w, h), and suggest which candidate person it may be, from the images after it.',
    'Only suggest a candidate when the faces look alike; confidence is 0 to 1 and an honest guess. Suggestions are only suggestions. Give each reason in ' + LANG[o.locale] + ', one short sentence.',
    'Do not name anyone who is not a candidate. Return an empty suggestions list when no candidate fits.',
  ].join('\n');
  const reply = await adapter.complete({
    system,
    messages: [{
      role: 'user',
      text: `The first image is the photo.\nCANDIDATES: ${ids.join(',')}\n${lines.join('\n') || 'No candidate has a picture.'}`,
      images: parts,
    }],
    json: { name: 'faces', schema: FACES_JSON },
    maxTokens: 2000,
    timeoutMs: 90_000,
  });
  await spend(o.tree, reply.tokens);
  const parsed = faceResultSchema.safeParse(reply.json);
  if (!parsed.success) throw new AiError('bad-output', c.errBadOutput);
  const known = new Set(ids);
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  const faces = parsed.data.faces
    .map((f) => ({
      box: { x: clamp(f.box.x), y: clamp(f.box.y), w: clamp(f.box.w), h: clamp(f.box.h) },
      suggestions: f.suggestions
        .filter((s) => known.has(s.personId))
        .map((s) => ({ personId: s.personId, confidence: clamp(s.confidence), reason: s.reason.slice(0, 200) })),
    }))
    .filter((f) => f.box.w > 0 && f.box.h > 0);
  return { faces };
}

// ---------- a portrait look ----------

const LOOK_JSON: JsonSchema = {
  type: 'object',
  properties: {
    skin: { type: 'integer', minimum: 0, maximum: 8, description: 'Skin tone index: ' + SKIN_LABELS.map((l, i) => `${i} ${l}`).join(', ') },
    hair: { type: 'integer', minimum: 0, maximum: 9, description: 'Hair colour index: ' + HAIR_LABELS.map((l, i) => `${i} ${l}`).join(', ') },
    eyes: { type: 'integer', minimum: 0, maximum: 6, description: 'Eye colour index: ' + EYE_LABELS.map((l, i) => `${i} ${l}`).join(', ') },
    hairStyle: { type: 'string' }, beardStyle: { type: 'string' }, moustache: { type: 'string' }, glasses: { type: 'string' },
    clothing: { type: 'string' }, headwear: { type: 'string' }, brows: { type: 'string' }, hairGreys: { type: 'boolean' },
    marks: { type: 'array', items: { type: 'string' } }, age: { type: 'integer' },
  },
  required: ['skin', 'hair', 'eyes'],
};

/** A portrait look for a person, from a photo. The style fields must come from the portrait's own lists (lookSchema). */
export async function avatarFromPhoto(o: { tree: string; personId: string; mediaKey: string; locale: AiLocale }): Promise<Look> {
  const c = copyFor(o.locale);
  const { adapter } = await adapterForFeature(o.tree, 'avatar', o.locale);
  if (!(await db(o.tree).get('SELECT id FROM person WHERE id = ?', o.personId))) throw new AiError('bad-input', c.errNoPerson);
  const photo = await photoOrThrow(o.tree, o.mediaKey, o.locale);
  const reply = await adapter.complete({
    system: 'You describe a person’s look for a flat illustration, from a photo. Choose each value from the lists given in the schema; leave out what you cannot see; never guess who the person is.',
    messages: [{ role: 'user', text: 'Describe the person in this photo.', images: [photo] }],
    json: { name: 'look', schema: LOOK_JSON },
    maxTokens: 800,
    timeoutMs: 60_000,
  });
  await spend(o.tree, reply.tokens);
  const parsed = lookSchema.safeParse(reply.json);
  if (!parsed.success) throw new AiError('bad-output', c.errBadOutput);
  return parsed.data as Look;
}

// ---------- arms from a name ----------

const TINCTURE = ['or', 'argent', 'gules', 'azure', 'vert', 'sable', 'purpure'];
const DIVISION = ['plain', 'per-pale', 'per-fess', 'per-bend', 'quarterly', 'chevron', 'paly', 'bendy', 'saltire', 'cross'];
const CHARGE = ['none', 'lion', 'eagle', 'tower', 'star', 'crescent', 'fleur', 'key', 'rose', 'boar', 'stag', 'sword'];
const ARMS_JSON: JsonSchema = {
  type: 'object',
  properties: {
    designs: {
      type: 'array', minItems: 3, maxItems: 5,
      items: {
        type: 'object',
        properties: {
          meaning: { type: 'string', description: 'One short sentence on what the arms may stand for.' },
          arms: {
            type: 'object',
            properties: {
              field: { type: 'string', enum: TINCTURE },
              field2: { type: 'string', enum: TINCTURE },
              division: { type: 'string', enum: DIVISION },
              charge: { type: 'string', enum: CHARGE },
              chargeTincture: { type: 'string', enum: TINCTURE },
            },
            required: ['field', 'division', 'charge', 'chargeTincture'],
          },
        },
        required: ['meaning', 'arms'],
      },
    },
  },
  required: ['designs'],
};

/** Three to five coats of arms for a surname, each with what it may mean. They are the v1 arms shape the house editor stores. */
export async function armsFromName(o: { tree: string; surname: string; country?: string; locale: AiLocale }): Promise<ArmsDesign[]> {
  const c = copyFor(o.locale);
  const { adapter } = await adapterForFeature(o.tree, 'arms', o.locale);
  const reply = await adapter.complete({
    system: [
      'You design heraldic arms for a family from its surname. Use only the tinctures, divisions and charges in the schema, in the classic style: few tinctures, a clear charge, a colour contrast (metal on colour).',
      'Give three to five different designs. Each meaning is one short sentence, in ' + LANG[o.locale] + ', and may play on the name only when that is plausible; never claim a real historic family.',
      o.country ? `The family is from ${o.country} (ISO code).` : '',
    ].filter(Boolean).join('\n'),
    messages: [{ role: 'user', text: `Surname: ${o.surname}` }],
    json: { name: 'arms', schema: ARMS_JSON },
    maxTokens: 1200,
    timeoutMs: 60_000,
  });
  await spend(o.tree, reply.tokens);
  const parsed = armsDesignSchema.safeParse(reply.json);
  if (!parsed.success) throw new AiError('bad-output', c.errBadOutput);
  return parsed.data.designs;
}
