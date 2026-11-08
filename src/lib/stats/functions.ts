// The Statistics page's calls. Stewards only: the server checks the role on each one.
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { RangeDays } from './shared';

const tree = z.string().regex(/^[a-z0-9-]+$/).max(64);
const days = z.union([z.literal(7), z.literal(30), z.literal(90)]);

const guard = () => import('../auth/guard.server');
const stats = () => import('./store.server');

export const statsOverview = createServerFn({ method: 'GET' })
  .validator(z.object({ tree, days }))
  .handler(async ({ data }) => {
    await (await guard()).requireCan(data.tree, 'view-statistics');
    return (await stats()).readOverview(data.tree, data.days);
  });

export const statsOverviewQuery = (t: string, d: RangeDays) => queryOptions({ queryKey: ['statistics', t, d], queryFn: () => statsOverview({ data: { tree: t, days: d } }) });

export const setStatsCollecting = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, on: z.boolean() }))
  .handler(async ({ data }) => {
    await (await guard()).requireCan(data.tree, 'view-statistics');
    await (await stats()).setCollecting(data.tree, data.on);
  });
