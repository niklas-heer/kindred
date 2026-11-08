// Painted portraits, on the server. The painter is a route (providers.server.ts): its provider and model are chosen in the AI
// settings' "What uses what" table, and only providers that paint are offered (PAINT_PROVIDERS). What is specific to portraits
// lives here: the switch (ai_portrait.enabled, off until a steward turns it on), the live list of image models, painting one
// portrait from a photo, and the review step that keeps a candidate until someone chooses it. Every change is a `once` plan
// (db.server.ts); every portrait call is booked against the family's monthly budget before it is sent and settled to what
// OpenRouter reports (settings.server.ts). The key is the painting provider's own, goes only to that provider, and never
// reaches a message, a log or the browser.
import { accounts } from '../auth/store.server';
import { db, guard, media, newMediaKey, once, personExists, q } from '../db.server';
import { AiError } from './adapters';
import { keyFor, resolveRoute } from './providers.server';
import { readSettings, reserve, settle, SINGLE_CALL_SHARE, TINY_BUDGET_MICROS, failureMicros } from './settings.server';
import { reportedMicros } from './prices';
import { tr, type Tr } from './labels';
import { PAINT_PROVIDERS, toAiLocale, type Provider } from './types';
import { RECOMMENDED_PORTRAIT } from './recommended';
import {
  MAX_SOURCE_BYTES,
  OPENROUTER_IMAGE_MODELS_URL,
  UNPRICED_USD,
  imageModels,
  ReplyError,
  parsePortraitReply,
  pickableImageModels,
  portraitRequest,
  sniffImage,
  usdToMicros,
  type ImageModel,
  type PaintedImage,
  type RawImageModel,
} from './portrait-rules.ts';
import { yearOfDate } from '../portrait-face.ts';

/** The fake provider (KINDRED_AI_FAKE=1, tests and the browser harness): no network. A painting is the photo itself. */
const fakeOn = () => process.env.KINDRED_AI_FAKE === '1';
const MODEL = /^[A-Za-z0-9._:/-]{1,120}$/;
const LIST_TTL = 60 * 60_000;
const IMAGE_TIMEOUT_MS = 150_000;

const FAKE_MODELS: ImageModel[] = imageModels([
  {
    id: 'openai/gpt-image-2.6-flare',
    name: 'GPT Image 2.6 Flare (test)',
    created: 3,
    architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] },
    pricing: { prompt: '0.000008', image_output: '0.00003' },
  },
  {
    id: 'black-forest-labs/flux-3-image-klein',
    name: 'FLUX 3 Image Klein (test)',
    created: 4,
    architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] },
    pricing: { image: '0.015' },
  },
  {
    id: 'openai/gpt-image-2',
    name: 'GPT Image 2 (test)',
    created: 1,
    architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] },
    pricing: { prompt: '0.000008', image_output: '0.00003' },
  },
  {
    id: 'google/gemini-3-pro-image',
    name: 'Gemini 3 Pro Image (test)',
    created: 2,
    architecture: { input_modalities: ['text', 'image'], output_modalities: ['image', 'text'] },
    pricing: { prompt: '0.000002', completion: '0.000012', image_output: '0.000012' },
  },
]);

// ---------- the list of image models ----------

let listCache: { at: number; models: ImageModel[] } | undefined;

/**
 * OpenRouter's image-output models, cached for an hour. The list is public, so no key is sent to read it. Throws AiError
 * when it cannot be read.
 */
export async function imageModelList(): Promise<ImageModel[]> {
  if (fakeOn()) return FAKE_MODELS;
  if (listCache && Date.now() - listCache.at < LIST_TTL) return listCache.models;
  let res: Response;
  try {
    res = await fetch(OPENROUTER_IMAGE_MODELS_URL, { headers: { accept: 'application/json', 'x-title': 'Kindred' }, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new AiError('unreachable', 'paint.err_list');
  }
  if (!res.ok) throw new AiError('provider', 'paint.err_list');
  let json: { data?: RawImageModel[] } | null = null;
  try {
    json = (await res.json()) as { data?: RawImageModel[] };
  } catch {
    throw new AiError('bad-output', 'paint.err_list');
  }
  const models = imageModels(json?.data ?? []);
  listCache = { at: Date.now(), models };
  return models;
}

/** The models the settings page offers: those that take an image in and give one out. */
export async function portraitModelChoices(): Promise<ImageModel[]> {
  return pickableImageModels(await imageModelList());
}

// ---------- settings ----------

interface Row {
  tree: string;
  enabled: number;
  updated: number;
  updated_by: string | null;
}

async function row(tree: string): Promise<Row | undefined> {
  return accounts().get<Row>('SELECT * FROM ai_portrait WHERE tree = ?', tree);
}

export interface PortraitSettings {
  enabled: boolean;
  /** The provider that paints, from the portrait route. Null until one is chosen. */
  provider: Provider | null;
  /** The image model, from the portrait route. Empty until one is picked. */
  model: string;
  /** The painting provider is connected, so the route can run. */
  connected: boolean;
}

/** The painting settings as the steward sees them. Never a key. */
export async function readPortraitSettings(tree: string): Promise<PortraitSettings> {
  const r = await row(tree);
  const route = await resolveRoute(tree, 'portrait');
  return {
    enabled: r?.enabled === 1,
    provider: route.effective?.provider ?? null,
    model: route.effective?.model ?? '',
    connected: route.connected,
  };
}

/**
 * A painting model must be one OpenRouter lists as taking an image in and giving one out. Empty is allowed: the route then
 * waits for a model (and painting stays off until one is picked).
 */
export async function checkPaintModel(model: string): Promise<void> {
  if (!model) return;
  if (!MODEL.test(model)) throw new AiError('bad-input', 'paint.err_model_unknown');
  const listed = (await imageModelList()).find((m) => m.id === model);
  if (!listed || !listed.takesImage || !listed.givesImage) throw new AiError('bad-input', 'paint.err_model_unknown');
}

/** Turns painting on or off. On needs a route that runs: a painting provider connected, and a model picked. */
export async function setPortraitEnabled(tree: string, by: string, enabled: boolean): Promise<void> {
  if (enabled) {
    const route = await resolveRoute(tree, 'portrait');
    if (!route.effective || !route.connected || !(PAINT_PROVIDERS as readonly string[]).includes(route.effective.provider)) throw new AiError('not-configured', 'paint.err_no_key');
    if (!route.effective.model) throw new AiError('bad-input', 'paint.err_model_needed');
  }
  await accounts().run(
    `INSERT INTO ai_portrait (tree, enabled, model, reuse_family_key, updated, updated_by) VALUES (?, ?, '', 0, ?, ?)
     ON CONFLICT(tree) DO UPDATE SET enabled = excluded.enabled, updated = excluded.updated, updated_by = excluded.updated_by`,
    tree, enabled ? 1 : 0, Date.now(), by,
  );
}

/**
 * The key a painting uses: the portrait route's provider's own key, and only a provider that paints. Throws paint.err_no_key
 * when the route has none, and paint.err_key_unreadable when the key cannot be opened.
 */
async function paintingKey(tree: string): Promise<string> {
  const route = await resolveRoute(tree, 'portrait');
  if (!route.effective || !route.connected || !(PAINT_PROVIDERS as readonly string[]).includes(route.effective.provider)) throw new AiError('not-configured', 'paint.err_no_key');
  try {
    return await keyFor(tree, route.effective.provider);
  } catch {
    throw new AiError('key-unreadable', 'paint.err_key_unreadable');
  }
}

// ---------- the budget ----------

/**
 * Books one portrait's estimate against the family's monthly budget, runs the call, then settles to what it cost: the
 * provider's reported USD cost, else the estimate. A failed call is charged what the budget rules say (failureMicros).
 */
async function bookedCall<T>(tree: string, usd: number, c: Tr, run: () => Promise<{ value: T; costUsd: number | null }>): Promise<T> {
  const fam = await readSettings(tree);
  if (fam.monthlyMicros <= 0) throw new AiError('budget', c('ai.errBudget'));
  const estimate = usdToMicros(usd);
  if (fam.monthlyMicros >= TINY_BUDGET_MICROS && estimate > fam.monthlyMicros * SINGLE_CALL_SHARE) throw new AiError('budget', c('ai.errBudgetShare'));
  const booked = await reserve(tree, fam.monthlyMicros, estimate, c);
  let actual = estimate;
  try {
    const r = await run();
    actual = r.costUsd !== null ? reportedMicros(r.costUsd) : estimate;
    return r.value;
  } catch (e) {
    actual = failureMicros(e, estimate);
    throw e;
  } finally {
    await settle(tree, booked, actual);
  }
}

// ---------- painting ----------

/** One POST to OpenRouter's image endpoint with the family's key. Errors never carry the key or the provider's text. */
async function postImages(url: string, key: string, body: Record<string, unknown>): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, 'x-title': 'Kindred' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    });
  } catch (e) {
    if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw new AiError('timeout', 'paint.err_timeout');
    throw new AiError('unreachable', 'ai.err_unreachable');
  }
  if (res.status === 401 || res.status === 403) throw new AiError('auth', 'paint.err_auth');
  if (res.status === 429) throw new AiError('rate-limited', 'paint.err_rate');
  if (res.status === 402) throw new AiError('provider', 'paint.err_credits');
  if (!res.ok) throw new AiError('provider', 'paint.err_provider');
  try {
    return await res.json();
  } catch {
    throw new AiError('bad-output', 'paint.err_not_image');
  }
}

/** The media key of a person's profile photo, when it is in media storage (older rows still hold the bytes only: not offered). */
export async function profilePhotoKey(tree: string, personId: string): Promise<string | null> {
  return (await db(tree).get<{ key: string | null }>('SELECT key FROM photo WHERE person = ?', personId))?.key ?? null;
}

/** A draft nobody chose in this long is taken to be abandoned (the tab was closed during review). */
export const DRAFT_TTL_MS = 60 * 60_000;

/**
 * Deletes a person's old unused drafts and their pictures. Only rows with accepted = 0 are touched, in the same statement,
 * so the portrait a person shows can never go. Returns how many it looked at.
 */
export async function sweepDrafts(tree: string, personId: string, olderThanMs = DRAFT_TTL_MS, now = Date.now()): Promise<number> {
  const cutoff = new Date(now - olderThanMs).toISOString();
  const old = await db(tree).all<{ key: string }>('SELECT key FROM portrait WHERE person = ? AND accepted = 0 AND created_at < ?', personId, cutoff);
  for (const { key } of old) {
    await once<void>(tree, undefined, 'sweepDraft', async () => ({
      writes: [q('DELETE FROM portrait WHERE key = ? AND person = ? AND accepted = 0', key, personId)],
      result: undefined,
      after: async () => {
        // The picture goes only when the row is gone (a draft accepted in the meantime keeps both).
        if (!(await db(tree).get('SELECT key FROM portrait WHERE key = ?', key))) await media.delete(tree, key).catch((e) => console.error('paint.err_delete', key, e));
      },
    }));
  }
  return old.length;
}

/** A candidate painting, waiting for the reader's choice. */
export interface Candidate {
  key: string;
  model: string;
  sourceYear: number | null;
  createdAt: string;
}

/**
 * Paints a portrait of a person from one of their photos (a gallery picture they are confirmed in, or their profile
 * photo). The picture is stored as a candidate: nothing the person shows changes until it is accepted.
 */
export async function createPortrait(tree: string, o: { by: string; personId: string; mediaKey: string; locale?: string }): Promise<Candidate> {
  const c = tr(toAiLocale(o.locale));
  const s = await readPortraitSettings(tree);
  if (!s.enabled) throw new AiError('not-configured', 'paint.err_off');
  const model = s.model;
  if (!model) throw new AiError('not-configured', 'paint.err_no_model');
  const d = db(tree);
  if (!(await d.get('SELECT id FROM person WHERE id = ?', o.personId))) throw new Error('photos.err.person_not_found');
  const tagged = o.mediaKey.startsWith('gallery/')
    ? await d.get<{ taken: string | null }>('SELECT m.taken FROM media m JOIN media_person mp ON mp.media = m.key WHERE m.key = ? AND mp.person = ? AND mp.confirmed = 1', o.mediaKey, o.personId)
    : undefined;
  const profile = o.mediaKey.startsWith('photo/') ? await d.get('SELECT key FROM photo WHERE person = ? AND key = ?', o.personId, o.mediaKey) : undefined;
  if (!tagged && !profile) throw new AiError('bad-input', 'paint.err_photo_not_person');
  const stored = await media.get(tree, o.mediaKey);
  if (!stored) throw new AiError('bad-input', 'paint.err_photo_missing');
  const bytes = new Uint8Array(await new Response(stored.body as BodyInit).arrayBuffer());
  if (bytes.length > MAX_SOURCE_BYTES) throw new AiError('bad-input', 'paint.err_source_big');
  const mime = sniffImage(bytes);
  if (!mime) throw new AiError('bad-input', 'paint.err_not_image');
  const sourceYear = tagged ? (yearOfDate(tagged.taken) ?? null) : null;
  const apiKey = await paintingKey(tree);
  const priced = (await imageModelList()).find((m) => m.id === model);
  const painted: PaintedImage = await bookedCall(tree, priced?.priceUsd ?? UNPRICED_USD, c, async () => {
    if (fakeOn()) return { value: { bytes, mime, costUsd: 0.04 }, costUsd: 0.04 };
    const req = portraitRequest(model, { mime, bytes });
    const json = await postImages(req.url, apiKey, req.body as Record<string, unknown>);
    let img: PaintedImage;
    try {
      img = parsePortraitReply(json);
    } catch (e) {
      if (e instanceof ReplyError) throw new AiError('bad-output', e.message);
      throw e;
    }
    return { value: img, costUsd: img.costUsd };
  });
  await sweepDrafts(tree, o.personId).catch((e) => console.error('paint.err_sweep', e));
  const key = newMediaKey('portrait', painted.mime);
  const at = new Date().toISOString();
  return once<Candidate>(tree, undefined, 'createPortrait', async () => {
    await media.put(tree, key, painted.bytes, painted.mime);
    return {
      writes: [
        personExists(o.personId),
        q('INSERT INTO portrait (key, person, mime, source, source_year, model, created_by, created_at, accepted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)',
          key, o.personId, painted.mime, o.mediaKey, sourceYear, model, o.by, at),
      ],
      result: { key, model, sourceYear, createdAt: at },
      abandon: () => media.delete(tree, key).catch(() => {}),
    };
  });
}

/** Chooses a candidate: it becomes the person's portrait, and the person shows it. The one it replaces is deleted. */
export function acceptPortrait(tree: string, personId: string, key: string, op?: { key: string; user: string; payload: unknown }) {
  return once<void>(tree, op, 'acceptPortrait', async (d) => {
    const cand = await d.get<{ accepted: number }>('SELECT accepted FROM portrait WHERE key = ? AND person = ?', key, personId);
    if (!cand) throw new Error('paint.err_candidate_gone');
    if (cand.accepted === 1) return { writes: [personExists(personId)], result: undefined };
    return {
      writes: [
        guard('EXISTS (SELECT 1 FROM portrait WHERE key = ? AND person = ? AND accepted = 0)', key, personId),
        personExists(personId),
        q('SELECT key FROM portrait WHERE person = ? AND accepted = 1', personId), // the one this replaces
        q('DELETE FROM portrait WHERE person = ? AND accepted = 1', personId),
        q('UPDATE portrait SET accepted = 1 WHERE key = ?', key),
        q('UPDATE person SET prefer_avatar = 0, prefer_portrait = 1 WHERE id = ?', personId),
      ],
      result: undefined,
      after: async (r) => {
        const old = (r[2]!.rows[0] as { key: string } | undefined)?.key;
        if (old && old !== key) await media.delete(tree, old).catch((e) => console.error('paint.err_delete', old, e));
      },
    };
  });
}

/** Throws the candidate away, and its picture with it. The portrait a person has accepted is not a candidate: use remove. */
export function discardPortrait(tree: string, personId: string, key: string, op?: { key: string; user: string; payload: unknown }) {
  return once<void>(tree, op, 'discardPortrait', async (d) => {
    const cand = await d.get<{ accepted: number }>('SELECT accepted FROM portrait WHERE key = ? AND person = ?', key, personId);
    if (!cand) throw new Error('paint.err_candidate_gone');
    if (cand.accepted === 1) throw new Error('paint.err_is_current');
    return {
      writes: [guard('EXISTS (SELECT 1 FROM portrait WHERE key = ? AND accepted = 0)', key), q('DELETE FROM portrait WHERE key = ?', key)],
      result: undefined,
      after: () => media.delete(tree, key).catch((e) => console.error('paint.err_delete', key, e)),
    };
  });
}

/** Removes the person's accepted portrait and its picture. The person shows their photo or drawing again. */
export function removePortrait(tree: string, personId: string, op?: { key: string; user: string; payload: unknown }) {
  return once<void>(tree, op, 'removePortrait', async (d) => {
    const cur = await d.get<{ key: string }>('SELECT key FROM portrait WHERE person = ? AND accepted = 1', personId);
    if (!cur) throw new Error('paint.err_none');
    return {
      writes: [
        guard('EXISTS (SELECT 1 FROM portrait WHERE person = ? AND accepted = 1 AND key = ?)', personId, cur.key),
        q('DELETE FROM portrait WHERE key = ?', cur.key),
        q('UPDATE person SET prefer_portrait = 0 WHERE id = ?', personId),
      ],
      result: undefined,
      after: () => media.delete(tree, cur.key).catch((e) => console.error('paint.err_delete', cur.key, e)),
    };
  });
}

/** What a person shows: the drawing, their photo, or the painted portrait (only once one is accepted). */
export type Display = 'drawing' | 'photo' | 'portrait';

/**
 * Sets what the person shows. `drawing` and `photo` are the two old choices (prefer_avatar and the photo); `portrait`
 * needs an accepted portrait. Exactly one of the two flags is ever set.
 */
export function setPersonDisplay(tree: string, personId: string, display: Display, op?: { key: string; user: string; payload: unknown }) {
  return once<void>(tree, op, 'setPersonDisplay', async (d) => {
    if (!(await d.get('SELECT id FROM person WHERE id = ?', personId))) throw new Error('photos.err.person_not_found');
    const writes = [personExists(personId)];
    if (display === 'portrait') writes.push(guard('EXISTS (SELECT 1 FROM portrait WHERE person = ? AND accepted = 1)', personId));
    writes.push(q('UPDATE person SET prefer_avatar = ?, prefer_portrait = ? WHERE id = ?', display === 'drawing' ? 1 : 0, display === 'portrait' ? 1 : 0, personId));
    return { writes, result: undefined };
  });
}

/** The accepted portrait of a person, for the picture route, or undefined. */
export async function acceptedPortrait(tree: string, personId: string): Promise<{ key: string; mime: string } | undefined> {
  return db(tree).get<{ key: string; mime: string }>('SELECT key, mime FROM portrait WHERE person = ? AND accepted = 1', personId);
}

/** A candidate or accepted portrait's row, for the review step (what it was painted from, and when). */
export async function portraitRow(tree: string, personId: string, key: string) {
  return db(tree).get<{ key: string; source: string; model: string; source_year: number | null; created_by: string; created_at: string; accepted: number }>(
    'SELECT key, source, model, source_year, created_by, created_at, accepted FROM portrait WHERE key = ? AND person = ?',
    key,
    personId,
  );
}

/** What the page shows about the portrait feature to someone who may see the person: on, configured, and the model. */
export async function portraitStatus(tree: string): Promise<{ enabled: boolean; configured: boolean; model: string; labName: string; usd: number | null; provider: Provider | null }> {
  const s = await readPortraitSettings(tree);
  const listed = s.model ? (await imageModelList().catch(() => [] as ImageModel[])).find((m) => m.id === s.model) : undefined;
  return {
    enabled: s.enabled,
    configured: s.connected,
    model: s.model,
    labName: listed?.labName ?? '',
    usd: RECOMMENDED_PORTRAIT.find((r) => r.model === s.model)?.usd ?? listed?.priceUsd ?? (s.model ? UNPRICED_USD : null),
    provider: s.provider,
  };
}
