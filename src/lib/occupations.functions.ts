// Server functions for occupations. The vocabulary itself is plain data in occupations.ts (no server call needed).
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { LOCALES } from './i18n/types.ts';

const tree = z.string().regex(/^[a-z0-9-]+$/).max(64);

/**
 * A reader asks for the German, English or Afrikaans form of an occupation the family wrote. Contributors and up:
 * it spends the family's AI budget and writes to the tree's cache, so a viewer may not ask. The text must be
 * someone's occupation in this tree (occupations.server.ts).
 */
export const translateOccupation = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, text: z.string().trim().min(1).max(200), locale: z.enum(LOCALES) }))
  .handler(async ({ data }) => {
    const { requireCan } = await import('./auth/guard.server');
    // Contributors and up may write text into the tree; this is the same level.
    await requireCan(data.tree, 'add-story');
    return (await import('./occupations.server')).translateOccupation(data.tree, data.text, data.locale);
  });
