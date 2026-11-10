// The server functions for reactions and comments (docs/responses.md). Each one checks the reader first: `requireMember` for
// reads and for removing your own comment, `requireCan` with the same Action the browser asks `useCan()` about for the rest,
// so a share-link guest, who has no account, is refused by every one of them. responses.server.ts checks again.
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { MAX_COMMENT, REACTIONS, TARGET_KINDS } from './responses';
import type { Action } from './roles';

const tree = z.string().regex(/^[a-z0-9-]+$/).max(64);
const opKey = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/).optional();
const kind = z.enum(TARGET_KINDS);
/** A story id or a media key (`gallery/<uuid>.<ext>`). */
const target = z.string().min(1).max(120);
const commentId = z.string().regex(/^[0-9a-f-]{36}$/);
// A little room over the limit for line endings the server folds; the server holds the limit itself.
const body = z.string().max(MAX_COMMENT * 2);

const server = () => import('./responses.server');
const guard = () => import('./auth/guard.server');

async function who(t: string, action?: Action) {
  const g = await guard();
  const m = action ? await g.requireCan(t, action) : await g.requireMember(t);
  return { id: m.user.id, name: m.user.name, role: m.role };
}

/** The retry key for a change, bound to who sends it and to everything else they sent (see db.server.ts `once`). */
function opOf<D extends { opKey?: string }>(user: string, data: D) {
  if (!data.opKey) return undefined;
  const { opKey: key, ...payload } = data;
  return { key, user, payload };
}

/** Tells the author, after the answer is sent: the page does not wait for the push. */
async function tell(t: string, r: import('./responses.server').Response) {
  const [{ notifyAuthor }, { store }] = await Promise.all([server(), import('./db.server')]);
  store.keepAlive(notifyAuthor(t, r));
}

export const getResponseCounts = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => (await server()).responseCounts(data.tree, await who(data.tree)));
export const responseCountsQuery = (t: string) =>
  queryOptions({ queryKey: ['responses', t], queryFn: () => getResponseCounts({ data: { tree: t } }), staleTime: 30_000 });

export const getThread = createServerFn({ method: 'GET' })
  .validator(z.object({ tree, kind, target }))
  .handler(async ({ data }) => (await server()).thread(data.tree, await who(data.tree), data.kind, data.target));
export const threadQuery = (t: string, k: (typeof TARGET_KINDS)[number], id: string) =>
  queryOptions({ queryKey: ['responses', t, 'thread', k, id], queryFn: () => getThread({ data: { tree: t, kind: k, target: id } }) });

export const setReaction = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, kind, target, reaction: z.enum(REACTIONS), on: z.boolean(), opKey }))
  .handler(async ({ data }) => {
    const me = await who(data.tree, 'react');
    const result = await (await server()).react(data.tree, me, data.kind, data.target, data.reaction, data.on, opOf(me.id, data));
    if (result.added) await tell(data.tree, { kind: data.kind, target: data.target, by: me, what: 'reaction', reaction: data.reaction });
    return result;
  });

export const addComment = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, kind, target, body, opKey }))
  .handler(async ({ data }) => {
    const me = await who(data.tree, 'comment');
    const result = await (await server()).addComment(data.tree, me, data.kind, data.target, data.body, opOf(me.id, data));
    await tell(data.tree, { kind: data.kind, target: data.target, by: me, what: 'comment' });
    return result;
  });

export const editComment = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: commentId, body, opKey }))
  .handler(async ({ data }) => {
    const me = await who(data.tree, 'comment');
    await (await server()).editComment(data.tree, me, data.id, data.body, opOf(me.id, data));
  });

export const removeComment = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: commentId, opKey }))
  .handler(async ({ data }) => {
    const me = await who(data.tree);
    return (await server()).removeComment(data.tree, me, data.id, opOf(me.id, data));
  });

export const getResponsePush = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => ({ on: await (await server()).responsePush(data.tree, await who(data.tree)) }));
export const responsePushQuery = (t: string) => queryOptions({ queryKey: ['responses', t, 'push'], queryFn: () => getResponsePush({ data: { tree: t } }) });

export const setResponsePush = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, on: z.boolean() }))
  .handler(async ({ data }) => {
    await (await server()).setResponsePush(data.tree, await who(data.tree), data.on);
    return { on: data.on };
  });
