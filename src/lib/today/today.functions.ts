// Today's server functions: the question of the week and the daily quiz. Members only: every call checks the membership
// on the server (`requireMember`), which refuses a share-link guest, so a guest gets no question, no quiz and no
// answers. A viewer may take the quiz and read the answers; writing an answer is adding a memory (`add-story`, a
// contributor's); this week's question and the quiz's switch are the stewards' (`manage-access`).
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { QuizView, WeekAnswer, WeekView } from './types.ts';
import { LOCALES } from '../i18n/languages';

const tree = z.string().regex(/^[a-z0-9-]{1,64}$/);
const opKey = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/);
const week = z.string().regex(/^\d{4}-W\d{2}$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const guard = () => import('../auth/guard.server');
const today = () => import('./today.server');

async function member(t: string) {
  const m = await (await guard()).requireMember(t);
  return { account: m.user.id, person: m.person };
}

// ---------- the question of the week ----------

export const getWeek = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }): Promise<WeekView> => {
    await member(data.tree);
    return (await today()).weekView(data.tree);
  });

export const weekQuery = (t: string) => queryOptions({ queryKey: ['today-week', t], queryFn: () => getWeek({ data: { tree: t } }), staleTime: 30_000 });

/** The answers to an earlier week's question. */
export const getWeekAnswers = createServerFn({ method: 'GET' })
  .validator(z.object({ tree, week }))
  .handler(async ({ data }): Promise<WeekAnswer[]> => {
    await member(data.tree);
    return (await today()).answersOf(data.tree, data.week);
  });

export const weekAnswersQuery = (t: string, w: string) => queryOptions({ queryKey: ['today-week', t, 'answers', w], queryFn: () => getWeekAnswers({ data: { tree: t, week: w } }), staleTime: 30_000 });

/** An answer, saved as a memory of the person it is about and signed with the writer's own account name. */
export const answerWeekQuestion = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, week, person: z.string().min(1).max(200), body: z.string().trim().min(1).max(20_000), locale: z.enum(LOCALES), opKey }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireCan(data.tree, 'add-story');
    const { opKey: key, ...payload } = data;
    return (await today()).answerWeek(data.tree, { week: data.week, person: data.person, body: data.body, author: m.user.name, locale: data.locale }, { key, user: m.user.id, payload });
  });

/** A steward's own question for this week, no question, or the curated one back. */
export const setWeekQuestion = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, change: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('custom'), text: z.string().trim().min(5).max(200) }),
    z.object({ mode: z.literal('skip') }),
    z.object({ mode: z.literal('curated') }),
  ]) }))
  .handler(async ({ data }) => {
    await (await guard()).requireCan(data.tree, 'manage-access');
    await (await today()).setWeek(data.tree, data.change);
  });

// ---------- the daily quiz ----------

/** Today's question for a member. A POST, because the first reader of a day draws the question and it is kept. */
export const getQuiz = createServerFn({ method: 'POST' })
  .validator(z.object({ tree }))
  .handler(async ({ data }): Promise<QuizView> => (await today()).quizView(data.tree, await member(data.tree)));

export const quizQuery = (t: string) => queryOptions({ queryKey: ['today-quiz', t], queryFn: () => getQuiz({ data: { tree: t } }), staleTime: 60_000 });

export const answerQuizQuestion = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, day, choice: z.string().regex(/^\d(,\d){0,5}$/) }))
  .handler(async ({ data }): Promise<QuizView> => (await today()).answerQuiz(data.tree, await member(data.tree), data.day, data.choice));

// ---------- the stewards' switch ----------

export const getTodaySettings = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    await (await guard()).requireCan(data.tree, 'manage-access');
    return (await today()).todaySettings(data.tree);
  });

export const todaySettingsQuery = (t: string) => queryOptions({ queryKey: ['today-settings', t], queryFn: () => getTodaySettings({ data: { tree: t } }) });

export const setQuizOn = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, on: z.boolean() }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireCan(data.tree, 'manage-access');
    await (await today()).setQuizEnabled(data.tree, data.on, m.user.id);
  });
