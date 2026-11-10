// Server functions for the change history and "What's new" (history.server.ts). Each handler starts with the role check
// (src/lib/auth/guard.server.ts). Members read what their level allows; a share-link guest reads no history at all: every
// one of these refuses them, as anything new is closed to guests (the components ask only for members).
//   member: the History page, a person's history, "What's new", the dot
//   edit-person (editor): put a person's fact back to a value from the history
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { HISTORY_FILTER_NAMES, RESTORABLE_FIELDS, type HistoryFilter, type HistoryPage, type WhatsNew } from './history';
import { audienceOf } from './visibility';

const tree = z.string().regex(/^[a-z0-9-]+$/).max(64);
const opKey = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/).optional();
const guard = () => import('./auth/guard.server');
const server = () => import('./history.server');

const pageInput = z.object({
  tree,
  person: z.string().min(1).max(120).optional(),
  filter: z.enum(HISTORY_FILTER_NAMES as [string, ...string[]]).optional(),
  author: z.string().regex(/^(?:[0-9a-f]{16}|kindred)$/).optional(),
  before: z.number().int().positive().optional(),
});
export type HistoryPageInput = z.infer<typeof pageInput>;

/** A page of the family's history, newest first. Opening its first page counts as having seen the news (the dot clears). */
export const getHistory = createServerFn({ method: 'GET' })
  .validator(pageInput)
  .handler(async ({ data }): Promise<HistoryPage> => {
    const m = await (await guard()).requireMember(data.tree);
    const h = await server();
    const { db } = await import('./db.server');
    const page = await h.historyPage(data.tree, db(data.tree), audienceOf(m), { ...data, filter: data.filter as HistoryFilter | undefined });
    if (!data.before && !data.person) {
      await h.noteVisit(m.user.id, data.tree).catch(() => {});
      await h.markShown(m.user.id, data.tree).catch(() => {});
    }
    return page;
  });
export const historyQuery = (t: string, o: Omit<HistoryPageInput, 'tree' | 'before'> = {}) =>
  queryOptions({ queryKey: ['history', t, o], queryFn: () => getHistory({ data: { tree: t, ...o } }) });

/**
 * "What's new" since the reader's last visit (history.server.ts `noteVisit` says how the marker moves).
 * Fetching it counts as having been shown the news.
 */
export const getWhatsNew = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }): Promise<WhatsNew> => {
    const r = await (await guard()).requireMember(data.tree);
    const h = await server();
    const { db } = await import('./db.server');
    const now = Date.now();
    await h.noteVisit(r.user.id, data.tree, now).catch(() => {});
    const visit = await h.visitOf(r.user.id, data.tree);
    const news = await h.whatsNew(db(data.tree), audienceOf(r), h.newsSince(visit, now), !visit || visit.shown === null);
    await h.markShown(r.user.id, data.tree, now).catch(() => {});
    return news;
  });
export const whatsNewQuery = (t: string) => queryOptions({ queryKey: ['whats-new', t], queryFn: () => getWhatsNew({ data: { tree: t } }) });

/** How many changes the reader has not been shown yet (at most 99): the dot by History in the account menu. */
export const getNewsCount = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }): Promise<number> => {
    const r = await (await guard()).requireMember(data.tree);
    const h = await server();
    const { db } = await import('./db.server');
    const visit = await h.visitOf(r.user.id, data.tree);
    if (!visit) return 0;
    return h.newsCount(db(data.tree), audienceOf(r), Math.max(visit.shown ?? visit.since, h.newsSince(visit)));
  });
export const newsCountQuery = (t: string) => queryOptions({ queryKey: ['news-count', t], queryFn: () => getNewsCount({ data: { tree: t } }), staleTime: 60_000 });

/**
 * Puts a person's fact back to its value before one history row's change. Editors only, and only a fact of the person's own
 * (their names, dates, places, sex, title, occupation, biography) whose earlier value the row kept whole. It is an ordinary
 * save: guarded, and written to the history itself.
 */
export const restoreHistoryValue = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: z.number().int().positive(), field: z.enum(RESTORABLE_FIELDS), opKey }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireCan(data.tree, 'edit-person');
    const h = await server();
    const { db } = await import('./db.server');
    const a = audienceOf(m);
    const row = await h.historyRow(db(data.tree), a, data.id);
    if (!row) throw new Error('history.err.gone');
    const item = await h.itemOf(data.tree, a, row);
    const f = item.fields.find((x) => x.name === data.field);
    if (!item.person || !f || !item.restorable.includes(data.field)) throw new Error('history.err.cannot_restore');
    const { opKey: key, ...payload } = data;
    await (await import('./person.server')).restorePersonValue(data.tree, item.person, data.field, f.before, key ? { key, user: m.user.id, payload } : undefined);
    return { person: item.person };
  });
