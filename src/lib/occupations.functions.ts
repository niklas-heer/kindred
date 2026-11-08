// Server functions for occupations. The vocabulary itself is plain data in occupations.ts (no server call needed).
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { LOCALES } from './i18n/types.ts';

const tree = z.string().regex(/^[a-z0-9-]+$/).max(64);

/** A reader asks for the German, English or Afrikaans form of a free-text occupation. Members only. */
export const translateOccupation = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, text: z.string().trim().min(1).max(200), locale: z.enum(LOCALES) }))
  .handler(async ({ data }) => {
    const { requireMember } = await import('./auth/guard.server');
    await requireMember(data.tree);
    return (await import('./occupations.server')).translateOccupation(data.tree, data.text, data.locale);
  });
