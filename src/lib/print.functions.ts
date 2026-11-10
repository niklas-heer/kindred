// The server function behind the family book (src/routes/$tree/print.tsx). Members only: `requireMember` refuses a share-link
// guest, and print.server.ts refuses one again. The charts need no read of their own: they draw from the family graph.
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { readerOf } from './events.functions';

const tree = z.string().regex(/^[a-z0-9-]+$/).max(64);
const id = z.string().min(1).max(120);

/** The details the book prints of a batch of people (at most 40). `living` false withholds everything of the living. */
export const getPrintPeople = createServerFn({ method: 'GET' })
  .validator(z.object({ tree, ids: z.array(id).min(1).max(40), living: z.boolean(), photos: z.boolean() }))
  .handler(async ({ data }) => {
    const m = await (await import('./auth/guard.server')).requireMember(data.tree);
    return (await import('./print.server')).printPeople(data.tree, data.ids, { living: data.living, photos: data.photos }, readerOf(m));
  });
