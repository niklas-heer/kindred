// Painted portraits, the server functions. Each one checks the reader's role first (requireMember for reads,
// requireCan for changes, with the same Action the browser asks useCan() about), then calls ai/portrait.server.ts.
//   getPortraitStatus    (member):   whether painted portraits are on here, and the model
//   getPortraitSettings  (steward):  the switch, the model choices and the key's last four characters
//   savePortraitSettings (steward):  the switch, the model, a key (sealed) or the family's OpenRouter key
//   aiCreatePortrait     (editor):   paint a candidate from one of the person's photos (budgeted, not yet kept)
//   acceptPortrait / discardPortrait / removePortrait (editor): the review step and removal
//   setPersonDisplay     (editor):   drawing, photo or the painted portrait
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { Action } from './roles';

const tree = z.string().regex(/^[a-z0-9-]{1,64}$/);
const id = z.string().min(1).max(120);
const opKey = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/).optional();
const locale = z.string().max(8).optional();
/** A gallery picture or a profile photo: the keys the server makes. */
const sourceKey = z.string().regex(/^(gallery|photo)\/[a-z0-9-]{1,80}\.[a-z]{2,4}$/);
/** A painted portrait's key, as the server makes it. */
const portraitKey = z.string().regex(/^portrait\/[a-z0-9-]{1,80}\.[a-z]{2,4}$/);
const guard = () => import('./auth/guard.server');
const server = () => import('./ai/portrait.server');
const requireMember = async (t: string) => (await guard()).requireMember(t);
const requireCan = async (t: string, action: Action) => (await guard()).requireCan(t, action);

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

// ---------- settings (stewards) ----------

export const savePortraitSettings = createServerFn({ method: 'POST' })
  .validator(z.object({
    tree,
    enabled: z.boolean(),
    model: z.string().max(120),
    reuseFamilyKey: z.boolean(),
    apiKey: z.string().max(400).optional(),
    clearKey: z.boolean().optional(),
  }))
  .handler(async ({ data }) => {
    const m = await requireCan(data.tree, 'manage-access');
    await (await server()).savePortraitSettings(data.tree, m.user.id, data);
  });

// ---------- painting and the review step (editors) ----------

/** Paints a candidate portrait of a person from one of their photos. Nothing the person shows changes until it is accepted. */
export const aiCreatePortrait = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, personId: id, mediaKey: sourceKey, locale }))
  .handler(async ({ data }) => {
    const m = await requireCan(data.tree, 'edit-person');
    return (await server()).createPortrait(data.tree, { by: m.user.id, personId: data.personId, mediaKey: data.mediaKey, locale: data.locale });
  });

export const acceptPortrait = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, personId: id, key: portraitKey, opKey }))
  .handler(async ({ data }) => {
    const m = await requireCan(data.tree, 'edit-person');
    return (await server()).acceptPortrait(data.tree, data.personId, data.key, opOf(m.user.id, data));
  });

export const discardPortrait = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, personId: id, key: portraitKey, opKey }))
  .handler(async ({ data }) => {
    const m = await requireCan(data.tree, 'edit-person');
    return (await server()).discardPortrait(data.tree, data.personId, data.key, opOf(m.user.id, data));
  });

export const removePortrait = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, personId: id, opKey }))
  .handler(async ({ data }) => {
    const m = await requireCan(data.tree, 'edit-person');
    return (await server()).removePortrait(data.tree, data.personId, opOf(m.user.id, data));
  });

/** What the person shows: the drawing, their photo, or their accepted painted portrait. */
export const setPersonDisplay = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id, display: z.enum(['drawing', 'photo', 'portrait']), opKey }))
  .handler(async ({ data }) => {
    const m = await requireCan(data.tree, 'edit-person');
    return (await server()).setPersonDisplay(data.tree, data.id, data.display, opOf(m.user.id, data));
  });
