// A couple's kind, start date and place, after they are linked. The form sets these once, when the link is made, and the
// assistant needs to correct them later ("they married in 1954"). Editors only, as the link and its end date are.
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { validDate } from './dates';

const nullableDate = z.string().trim().refine(validDate, 'Not a real date').nullable();

export const setPartnershipDetails = createServerFn({ method: 'POST' })
  .validator(z.object({
    tree: z.string().regex(/^[a-z0-9-]+$/).max(64),
    id: z.string().min(1).max(200),
    kind: z.enum(['marriage', 'partnership', 'betrothal', 'other']),
    start: nullableDate,
    place: z.string().trim().max(200).nullable(),
    opKey: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
  }))
  .handler(async ({ data }) => {
    const m = await (await import('./auth/guard.server')).requireCan(data.tree, 'edit-person');
    const { once, q, guard, change } = await import('./db.server');
    const { tree, opKey: key, ...payload } = data;
    await once(tree, { key, user: m.user.id, payload }, 'setPartnershipDetails', async (d) => {
      const had = await d.get<{ a: string; kind: string; start: string | null; place: string | null }>('SELECT a, kind, start, place FROM partnership WHERE id = ?', data.id);
      if (!had) throw new Error('chat.err.partnershipGone');
      return {
        writes: [
          guard('EXISTS (SELECT 1 FROM partnership WHERE id = ? AND kind = ? AND start IS ? AND place IS ?)', data.id, had.kind, had.start, had.place),
          q('UPDATE partnership SET kind = ?, start = ?, place = ? WHERE id = ?', data.kind, data.start, data.place || null, data.id),
        ],
        history: change('partnership', data.id, had, { kind: data.kind, start: data.start, place: data.place || null }, { person: had.a }),
        result: undefined,
      };
    });
  });
