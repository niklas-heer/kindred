// Approving an assistant's family draft: the card's people and links go here, and every step runs under the
// approver's own role (ai/family.server.ts). Each row carries its own retry key, so a repeated approval replays what
// already happened. Members only: the role is checked row by row inside the plan.
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { familyLinkSchema, familyPersonSchema } from './ai/types';

const tree = z.string().regex(/^[a-z0-9-]{1,64}$/);
const retryKey = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/);

export const applyFamilyBatch = createServerFn({ method: 'POST' })
  .validator(z.object({
    tree,
    // `existing`: the card says this row is someone already in the tree, so only their new details are added.
    people: z.array(familyPersonSchema.extend({ key: retryKey, existing: z.string().min(1).max(100).optional() })).max(40),
    links: z.array(familyLinkSchema.extend({ key: retryKey })).max(80),
    locale: z.string().max(8).optional(),
  }))
  .handler(async ({ data }) => {
    const m = await (await import('./auth/guard.server')).requireMember(data.tree);
    return (await import('./ai/family.server')).applyFamilyBatch({
      tree: data.tree, user: m.user.id, author: m.user.name, me: m.person, role: m.role, locale: data.locale, batch: { people: data.people, links: data.links },
    });
  });
