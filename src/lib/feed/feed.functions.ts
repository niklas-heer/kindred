// The server functions of the family feed (docs/feed.md): a page of the feed, a person's posts, and writing, changing and
// removing a post. Each one checks the reader first: `requireMember` for the reads and for removing your own post,
// `requireCan` with the same Action the browser asks `useCan()` about for the rest. A share-link guest, who has no
// account, is refused by every one of them; posts.server.ts and feed.server.ts check again.
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { Action } from '../roles';
import { MAX_POST, MAX_POST_MEDIA, MAX_POST_PEOPLE, type FeedPage, type PostView } from './types';

const tree = z.string().regex(/^[a-z0-9-]+$/).max(64);
const opKey = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/).optional();
const postId = z.string().regex(/^[0-9a-f-]{36}$/);
const personId = z.string().min(1).max(200);
/** A gallery key as the server makes it: gallery/<uuid>.<ext>. */
const mediaKey = z.string().regex(/^gallery\/[a-z0-9-]{1,80}\.[a-z]{2,4}$/);
// A little room over the limit for line endings the server folds; the server holds the limit itself.
const body = z.string().max(MAX_POST * 2);
const people = z.array(personId).max(MAX_POST_PEOPLE);

const guard = () => import('../auth/guard.server');
const posts = () => import('./posts.server');

async function who(t: string, action?: Action) {
  const g = await guard();
  const m = action ? await g.requireCan(t, action) : await g.requireMember(t);
  return { id: m.user.id, name: m.user.name, role: m.role, person: m.person };
}

/** The retry key for a change, bound to who sends it and to everything else they sent (see db.server.ts `once`). */
function opOf<D extends { opKey?: string }>(user: string, data: D) {
  if (!data.opKey) return undefined;
  const { opKey: key, ...payload } = data;
  return { key, user, payload };
}

// ---------- reads ----------

export const getFeed = createServerFn({ method: 'GET' })
  .validator(z.object({ tree, cursor: z.string().max(300).nullish() }))
  .handler(async ({ data }): Promise<FeedPage> => {
    const me = await who(data.tree);
    return (await import('./feed.server')).feedPage(data.tree, me, data.cursor);
  });

/** The feed, a page at a time: each page's `next` is the cursor of the page after it. */
export const feedQuery = (t: string) =>
  infiniteQueryOptions({
    queryKey: ['feed', t],
    queryFn: ({ pageParam }) => getFeed({ data: { tree: t, cursor: pageParam } }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
    staleTime: 30_000,
  });

export const getPersonPosts = createServerFn({ method: 'GET' })
  .validator(z.object({ tree, id: personId }))
  .handler(async ({ data }): Promise<PostView[]> => {
    const me = await who(data.tree);
    return (await posts()).personPosts(data.tree, me, data.id);
  });

export const personPostsQuery = (t: string, id: string) =>
  queryOptions({ queryKey: ['feed', t, 'person', id], queryFn: () => getPersonPosts({ data: { tree: t, id } }), staleTime: 30_000 });

// ---------- changes ----------

/**
 * Writes a post. Its pictures are gallery pictures the writer uploaded just before for it (addGalleryPhoto in
 * photos.functions.ts, with `forPost`), named here by their keys. The devices that asked are told afterwards; the page does not wait.
 */
export const createPost = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, body, media: z.array(mediaKey).max(MAX_POST_MEDIA).default([]), people: people.default([]), opKey }))
  .handler(async ({ data }): Promise<{ id: string }> => {
    const me = await who(data.tree, 'post');
    const result = await (await posts()).createPost(data.tree, me, { body: data.body, media: data.media, people: data.people }, opOf(me.id, data));
    const [{ notifyPost }, { store }] = await Promise.all([import('./post-push.server'), import('../db.server')]);
    store.keepAlive(notifyPost(data.tree, me));
    return result;
  });

export const editPost = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: postId, body, people: people.optional(), opKey }))
  .handler(async ({ data }) => {
    const me = await who(data.tree, 'post');
    await (await posts()).editPost(data.tree, me, data.id, { body: data.body, people: data.people }, opOf(me.id, data));
  });

export const removePost = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: postId, opKey }))
  .handler(async ({ data }) => {
    const me = await who(data.tree);
    return (await posts()).removePost(data.tree, me, data.id, opOf(me.id, data));
  });

/**
 * Deletes the reader's own pictures uploaded for a post that is not being made: the composer calls it when the writer
 * cancels or the post is refused. Only pictures marked for a post, uploaded by this member and in no post go; the daily
 * job deletes any it missed after a day (posts.server.ts `sweepLeftovers`).
 */
export const discardPostPictures = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, media: z.array(mediaKey).min(1).max(MAX_POST_MEDIA), opKey }))
  .handler(async ({ data }) => {
    const me = await who(data.tree);
    return (await posts()).discardPictures(data.tree, me, data.media, opOf(me.id, data));
  });
