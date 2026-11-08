// Painted portraits, the server functions. Each one checks the reader's role first (requireMember for reads,
// requireCan for changes, with the same Action the browser asks useCan() about), then calls ai/portrait.server.ts.
//   getPortraitStatus    (member):   whether painted portraits are on here, and the model
//   getPortraitSettings  (steward):  the switch, the painter's route and the image models it may use
//   savePortraitSettings (steward):  the switch. The painter's provider and model are saved with the AI routes (ai.functions)
//   savePortraitStyle    (steward):  the family's style, which every portrait uses
//   getPortraitVersions, aiCreatePortrait, acceptPortrait, keepPortrait, discardPortrait, removePortrait
//                        (an editor, or the member linked to that person with a steward's confirmation): the portraits they kept, painting, review and removal
//   setPersonDisplay     (editor):   drawing, photo or the painted portrait
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { MAX_NOTE_CHARS, awaitsLinkConfirmation, mayPaintPerson } from './ai/portrait-rules';
import { needs, type Action } from './roles';

const tree = z.string().regex(/^[a-z0-9-]{1,64}$/);
const id = z.string().min(1).max(120);
const opKey = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/).optional();
const locale = z.string().max(8).optional();
/** A gallery picture or a profile photo: the keys the server makes. */
const sourceKey = z.string().regex(/^(gallery|photo)\/[a-z0-9-]{1,80}\.[a-z]{2,4}$/);
/** A painted portrait's key, as the server makes it. */
const portraitKey = z.string().regex(/^portrait\/[a-z0-9-]{1,80}\.[a-z]{2,4}$/);
/** A person's own small adjustments. Strict: nothing else can come along, so the family style cannot be replaced from here. */
const tweak = z.object({
  framing: z.enum(['closer', 'farther']).optional(),
  warmth: z.enum(['warmer', 'cooler']).optional(),
  smile: z.boolean().optional(),
  note: z.string().max(MAX_NOTE_CHARS).optional(),
}).strict().optional();
const guard = () => import('./auth/guard.server');
const server = () => import('./ai/portrait.server');
const requireMember = async (t: string) => (await guard()).requireMember(t);
const requireCan = async (t: string, action: Action) => (await guard()).requireCan(t, action);
/** An editor, or the member linked to this person once a steward has confirmed the link. */
async function requirePainter(t: string, personId: string) {
  const [g, { AuthError, forbidden }] = await Promise.all([guard(), import('./auth/errors')]);
  const m = await g.requireMember(t);
  if (awaitsLinkConfirmation(m, personId)) throw g.fail(new AuthError('forbidden', 'paint.err_link_unconfirmed'));
  if (!mayPaintPerson(m, personId)) throw g.fail(forbidden('edit-person', needs('edit-person')));
  return m;
}

/** The retry key for a change, bound to who sends it and to everything else they sent (see db.server.ts `once`). */
function opOf<D extends { opKey?: string }>(user: string, data: D) {
  if (!data.opKey) return undefined;
  const { opKey: key, ...payload } = data;
  return { key, user, payload };
}

// ---------- reads ----------

export const getPortraitStatus = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    await requireMember(data.tree);
    return (await server()).portraitStatus(data.tree);
  });
export const portraitStatusQuery = (t: string) => queryOptions({ queryKey: ['portrait-status', t], queryFn: () => getPortraitStatus({ data: { tree: t } }), staleTime: 60_000 });

export const getPortraitSettings = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    await requireCan(data.tree, 'manage-access');
    const s = await server();
    const [settings, choices] = await Promise.all([s.readPortraitSettings(data.tree), s.portraitModelChoices()]);
    return { settings, choices };
  });
export const portraitSettingsQuery = (t: string) => queryOptions({ queryKey: ['portrait-settings', t], queryFn: () => getPortraitSettings({ data: { tree: t } }) });

/** The key of a person's profile photo, which can be painted from like a gallery picture; null when there is none. */
export const getProfilePhotoKey = createServerFn({ method: 'GET' })
  .validator(z.object({ tree, personId: id }))
  .handler(async ({ data }) => {
    await requirePainter(data.tree, data.personId);
    return (await server()).profilePhotoKey(data.tree, data.personId);
  });
/** The portraits a person has kept, for choosing which one is shown. */
export const getPortraitVersions = createServerFn({ method: 'GET' })
  .validator(z.object({ tree, personId: id }))
  .handler(async ({ data }) => {
    await requirePainter(data.tree, data.personId);
    return (await server()).portraitVersions(data.tree, data.personId);
  });
export const portraitVersionsQuery = (t: string, personId: string) =>
  queryOptions({ queryKey: ['portrait-versions', t, personId], queryFn: () => getPortraitVersions({ data: { tree: t, personId } }) });

export const profilePhotoKeyQuery = (t: string, personId: string, version?: string) =>
  queryOptions({ queryKey: ['portrait-profile-key', t, personId, version ?? ''], queryFn: () => getProfilePhotoKey({ data: { tree: t, personId } }), staleTime: 60_000 });

// ---------- settings (stewards) ----------

export const savePortraitSettings = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, enabled: z.boolean() }))
  .handler(async ({ data }) => {
    const m = await requireCan(data.tree, 'manage-access');
    await (await server()).setPortraitEnabled(data.tree, m.user.id, data.enabled);
  });

/** The family's style, which every portrait uses. Empty goes back to the default. */
export const savePortraitStyle = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, style: z.string().max(4000) }))
  .handler(async ({ data }) => {
    const m = await requireCan(data.tree, 'manage-access');
    await (await server()).setPortraitStyle(data.tree, m.user.id, data.style);
  });

// ---------- painting and the review step (an editor, or the member linked to the person) ----------

/** Paints a candidate portrait of a person from one of their photos. Nothing the person shows changes until it is accepted. */
export const aiCreatePortrait = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, personId: id, mediaKey: sourceKey, locale, tweak }))
  .handler(async ({ data }) => {
    const m = await requirePainter(data.tree, data.personId);
    return (await server()).createPortrait(data.tree, { by: m.user.id, personId: data.personId, mediaKey: data.mediaKey, locale: data.locale, tweak: data.tweak });
  });

export const acceptPortrait = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, personId: id, key: portraitKey, opKey }))
  .handler(async ({ data }) => {
    const m = await requirePainter(data.tree, data.personId);
    return (await server()).acceptPortrait(data.tree, data.personId, data.key, opOf(m.user.id, data));
  });

/** Keeps a draft as a version without showing it. */
export const keepPortrait = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, personId: id, key: portraitKey, opKey }))
  .handler(async ({ data }) => {
    const m = await requirePainter(data.tree, data.personId);
    return (await server()).keepPortrait(data.tree, data.personId, data.key, opOf(m.user.id, data));
  });

export const discardPortrait = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, personId: id, key: portraitKey, opKey }))
  .handler(async ({ data }) => {
    const m = await requirePainter(data.tree, data.personId);
    return (await server()).discardPortrait(data.tree, data.personId, data.key, opOf(m.user.id, data));
  });

export const removePortrait = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, personId: id, opKey }))
  .handler(async ({ data }) => {
    const m = await requirePainter(data.tree, data.personId);
    return (await server()).removePortrait(data.tree, data.personId, opOf(m.user.id, data));
  });

/** What the person shows: the drawing, their photo, or their accepted painted portrait. */
export const setPersonDisplay = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id, display: z.enum(['drawing', 'photo', 'portrait']), opKey }))
  .handler(async ({ data }) => {
    const m = await requireCan(data.tree, 'edit-person');
    return (await server()).setPersonDisplay(data.tree, data.id, data.display, opOf(m.user.id, data));
  });
