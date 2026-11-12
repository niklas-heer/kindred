// The two features that look at a picture and return suggestions: faces in a photo, and a portrait look
// from a photo. Each returns validated data and writes nothing; the caller decides what to keep (the
// reader's own role applies to every save). Arms from a name are in arms.server.ts.
import { db, media } from '../db.server';
import { checkMediaKey } from '../store/index.ts';
import { faceResultSchema, type AiLocale, type FaceResult } from './types';
import { AiError, type ImagePart, type JsonSchema } from './adapters';
import { tr } from './labels';
import { adapterForFeature } from './settings.server';
import { SKIN_LABELS, SKIN_NEUTRAL, HAIR_LABELS, EYE_LABELS, PHOTO_LOOK_FIELDS, sanitizeLook } from '../portrait-look';
import { translate } from '../i18n/dictionary';
import { AI_LANGUAGE } from '../i18n/languages';
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
  const c = tr(locale);
  let img: Awaited<ReturnType<typeof readImage>>;
  try {
    img = await readImage(tree, key);
  } catch {
    throw new AiError('bad-input', c('ai.errNoPhoto'));
  }
  if (!img) throw new AiError('bad-input', c('ai.errBadPhoto'));
  if (img.bytes.length > MAX_PHOTO) throw new AiError('bad-input', c('ai.errBadPhoto'));
  return img;
}

const LANG = AI_LANGUAGE;

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
 * few people in the family who have a picture; they are shown as suggestions only. `references` counts
 * those candidates: with none, nothing can be suggested and the model is not asked.
 */
export async function findFaces(o: { tree: string; mediaKey: string; locale: AiLocale }): Promise<{ faces: FaceResult['faces']; references: number }> {
  const c = tr(o.locale);
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
  // Without a confirmed tag or a profile photo there is no one to suggest: say so, and don't spend on a guess.
  if (!ids.length) return { faces: [], references: 0 };
  const system = [
    'You find the faces in the first image, a family photo. For each face, give its box as fractions of the whole image (x, y from the top left; w, h), and suggest which candidate person it may be, from the images after it.',
    'Only suggest a candidate when the faces look alike; confidence is 0 to 1 and an honest guess. Suggestions are only suggestions. Give each reason in ' + LANG[o.locale] + ', one short sentence.',
    'Do not name anyone who is not a candidate. Return an empty suggestions list when no candidate fits. Give at most five suggestions per face and at most forty faces.',
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
  const parsed = faceResultSchema.safeParse(reply.json);
  if (!parsed.success) throw new AiError('bad-output', c('ai.errBadOutput'));
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
  return { faces, references: ids.length };
}

// ---------- a portrait look ----------

const oneOf = (values: readonly string[]) => ({ type: 'string', enum: [...values] });

/** Only what a face shows (see PHOTO_LOOK_FIELDS): headwear, clothing and age follow the person's era and stay as they were. */
const LOOK_PROPERTIES = {
    // Every tone but "neutral", which means nobody has said: a photo always says.
    skin: { type: 'integer', minimum: 0, maximum: SKIN_LABELS.length - 1, description: 'Skin tone index: ' + SKIN_LABELS.map((l, i) => `${i} ${translate('en', l)}`).filter((_, i) => i !== SKIN_NEUTRAL).join(', ') },
    hair: { type: 'integer', minimum: 0, maximum: HAIR_LABELS.length - 1, description: 'Hair colour index: ' + HAIR_LABELS.map((l, i) => `${i} ${translate('en', l)}`).join(', ') },
    eyes: { type: 'integer', minimum: 0, maximum: EYE_LABELS.length - 1, description: 'Eye colour index: ' + EYE_LABELS.map((l, i) => `${i} ${translate('en', l)}`).join(', ') },
    hairStyle: oneOf(PHOTO_LOOK_FIELDS.hairStyle.of), beardStyle: oneOf(PHOTO_LOOK_FIELDS.beardStyle.of),
    beardLength: { type: 'integer', minimum: 0, maximum: 10, description: PHOTO_LOOK_FIELDS.beardLength.what },
    beardShape: { ...oneOf(PHOTO_LOOK_FIELDS.beardShape.of), description: PHOTO_LOOK_FIELDS.beardShape.what },
    moustache: oneOf(PHOTO_LOOK_FIELDS.moustache.of), glasses: oneOf(PHOTO_LOOK_FIELDS.glasses.of),
    brows: oneOf(PHOTO_LOOK_FIELDS.brows.of), hairGreys: { type: 'boolean' },
    marks: { type: 'array', items: oneOf(PHOTO_LOOK_FIELDS.marks.of) },
    face: { ...oneOf(PHOTO_LOOK_FIELDS.face.of), description: PHOTO_LOOK_FIELDS.face.what },
    noseShape: { ...oneOf(PHOTO_LOOK_FIELDS.noseShape.of), description: PHOTO_LOOK_FIELDS.noseShape.what },
    eyeShape: { ...oneOf(PHOTO_LOOK_FIELDS.eyeShape.of), description: PHOTO_LOOK_FIELDS.eyeShape.what },
    // The 0–10 measures: whole numbers, 5 the average. The description says what to look at.
    ...Object.fromEntries(
      (['jaw', 'noseSize', 'mouthWidth', 'mouthFullness', 'eyeSize', 'eyeSpacing', 'browHeight', 'earSize', 'hairline'] as const).map((k) => [
        k,
        { type: 'integer', minimum: 0, maximum: 10, description: PHOTO_LOOK_FIELDS[k].what },
      ]),
    ),
};

/**
 * Every field is required. With nineteen optional fields, Anthropic spent over two minutes compiling the schema and then
 * refused it as too complex; required, the same fields answer in about three seconds.
 */
export const LOOK_JSON: JsonSchema = { type: 'object', properties: LOOK_PROPERTIES, required: Object.keys(LOOK_PROPERTIES) };

/** A portrait look for a person, from a photo. Enum fields come from the portrait's own lists, and the result is `sanitizeLook`'s, so every face field the photo sets is kept. */
export async function avatarFromPhoto(o: { tree: string; personId: string; mediaKey: string; locale: AiLocale; signal?: AbortSignal }): Promise<Look> {
  const c = tr(o.locale);
  const { adapter } = await adapterForFeature(o.tree, 'avatar', o.locale);
  if (!(await db(o.tree).get('SELECT id FROM person WHERE id = ?', o.personId))) throw new AiError('bad-input', c('ai.errNoPerson'));
  const photo = await photoOrThrow(o.tree, o.mediaKey, o.locale);
  const reply = await adapter.complete({
    system: 'You describe a person’s face for a flat illustration, from a photo. Choose each value from the lists given in the schema. For the face shape, nose, eyes and the 0–10 measures, compare with an average face (5), and answer 5 for a measure the photo cannot show. Never guess who the person is. Describe the person, not the day: sunglasses are not glasses (use none unless clear glasses are worn), and a hat is not hair.',
    messages: [{ role: 'user', text: 'Describe the person in this photo.', images: [photo] }],
    json: { name: 'look', schema: LOOK_JSON },
    maxTokens: 800,
    timeoutMs: 60_000,
    ...(o.signal && { signal: o.signal }),
  });
  // One odd value must not cost the whole portrait: keep what is valid and let the rest stay automatic.
  // The colours are required; `sanitizeLook` keeps every field the portrait knows, so nothing is lost here
  // (lookSchema, the assistant's own check, would drop the face fields).
  const raw = reply.json as Record<string, unknown> | undefined;
  const look = sanitizeLook(reply.json);
  if (!look || !(['skin', 'hair', 'eyes'] as const).every((k) => typeof raw?.[k] === 'number')) throw new AiError('bad-output', c('ai.errBadOutput'));
  return look;
}
