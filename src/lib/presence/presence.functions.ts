// Live presence's calls (presence.server.ts). Members only: a share-link guest neither sends nor receives, and every call
// is refused to them by `requireMember`. The account is the guard's, never the browser's.
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { PRESENCE_ROUTES, TAB } from './shared';

const tree = z.string().regex(/^[a-z0-9-]+$/).max(64);
const tab = z.string().regex(TAB);
const person = z.string().min(1).max(80);

const guard = () => import('../auth/guard.server');
const presence = () => import('./presence.server');

/** A tab's heartbeat: where it is and, when its reader shares it, whom it has selected. Answers who else is here. */
export const presenceBeat = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, tab, route: z.enum(PRESENCE_ROUTES), focus: person.nullable(), editing: z.boolean(), shadows: z.boolean() }))
  .handler(async ({ data }) => {
    const { user } = await (await guard()).requireMember(data.tree);
    const { tree: t, ...b } = data;
    return (await presence()).beat(t, user.id, b);
  });

/** Who else is in the family now. */
export const presenceRoster = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    const { user } = await (await guard()).requireMember(data.tree);
    return (await presence()).roster(data.tree, user.id);
  });

/** The tab is gone. */
export const presenceLeave = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, tab }))
  .handler(async ({ data }) => {
    const { user } = await (await guard()).requireMember(data.tree);
    await (await presence()).leave(data.tree, user.id, data.tab);
  });

export const presenceQuery = (t: string) => queryOptions({ queryKey: ['presence', t], queryFn: () => presenceRoster({ data: { tree: t } }) });
