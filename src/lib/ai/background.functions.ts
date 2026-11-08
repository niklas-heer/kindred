// Server functions for background AI tasks. Stewards only (manage-access, the same check the AI settings page uses), except
// the translated stories, which every member of the family may read, as they read the Chronicle. Each handler starts with the
// server's role check.
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { LOCALES } from '../i18n/types';
import { saveSchema, TASKS } from './background';

const tree = z.string().regex(/^[a-z0-9-]{1,64}$/);
const guard = () => import('../auth/guard.server');
const bg = () => import('./background.server');
const tasks = () => import('./background-tasks.server');

/** What the AI activity page and the settings' background section show: the settings, each task's state, the runs and what waits. */
export const aiActivity = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    await (await guard()).requireCan(data.tree, 'manage-access');
    return (await bg()).activity(data.tree);
  });

export const aiActivityQuery = (t: string) => queryOptions({ queryKey: ['ai-activity', t], queryFn: () => aiActivity({ data: { tree: t } }) });

/** Saves the steward's background settings (switches, schedules, the cap, the languages). Nothing runs at save. */
export const aiSaveBackground = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, input: saveSchema }))
  .handler(async ({ data }) => {
    const { user } = await (await guard()).requireCan(data.tree, 'manage-access');
    return (await bg()).saveBackground(data.tree, user.id, data.input);
  });

/** "Run now": one batch of one task, now. The task must be switched on and the family's AI ready, as for the schedule. */
export const aiRunTask = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, task: z.enum(TASKS) }))
  .handler(async ({ data }) => {
    await (await guard()).requireCan(data.tree, 'manage-access');
    return (await bg()).runTask(data.tree, data.task, { source: 'manual' });
  });

/** The quiet badge: how many things want a steward's attention. Zero for members who are not stewards (they see no badge). */
export const aiAttention = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    const { can } = await import('../roles');
    const m = await (await guard()).requireMember(data.tree);
    if (!can(m.role, 'manage-access')) return 0;
    return (await bg()).attention(data.tree);
  });

export const aiAttentionQuery = (t: string) => queryOptions({ queryKey: ['ai-attention', t], queryFn: () => aiAttention({ data: { tree: t } }), staleTime: 60_000 });

/** The translated stories for one reader's language (the Chronicle shows them beside the originals). Every member may read them. */
export const storyTranslations = createServerFn({ method: 'GET' })
  .validator(z.object({ tree, locale: z.enum(LOCALES) }))
  .handler(async ({ data }) => {
    await (await guard()).requireReader(data.tree);
    return (await tasks()).storyTranslations(data.tree, data.locale);
  });

export const storyTranslationsQuery = (t: string, locale: string) =>
  queryOptions({
    queryKey: ['story-translations', t, locale],
    queryFn: () => storyTranslations({ data: { tree: t, locale: locale as (typeof LOCALES)[number] } }),
    staleTime: 60_000,
  });
