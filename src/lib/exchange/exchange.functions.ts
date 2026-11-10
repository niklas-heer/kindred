// Server functions for the exchange page: who may import or export, what an export leaves out, and the import
// preview and apply. Every handler starts with the permission check (guard.server.ts), as in api.ts: export
// needs an editor (it carries private fields), import needs a steward (it changes the whole family).
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

const tree = z.string().regex(/^[a-z0-9-]+$/).max(64);
/** A GEDCOM file larger than this is refused before it is parsed (a family's file is a few hundred kilobytes). */
export const MAX_GEDCOM_BYTES = 5_000_000;

const guard = () => import('../auth/guard.server');
/** The reader's language: the title a source without one gets ("Untitled source"). */
const locale = z.enum(['en', 'de', 'af']).default('en');
const untitledIn = async (l: 'en' | 'de' | 'af') => (await import('../i18n/dictionary.ts')).translate(l, 'exchange.untitled_source');

/** The reader's role in a family, and what they may do with the exchange. */
export const exchangeContext = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireMember(data.tree);
    const { can } = await import('../roles.ts');
    const { db } = await import('../db.server.ts');
    const people = (await db(data.tree).get<{ n: number }>('SELECT count(*) AS n FROM person'))?.n ?? 0;
    return { role: m.role, people, canExport: can(m.role, 'edit-person'), canImport: can(m.role, 'manage-access') };
  });

/** What an export leaves out, shown before the download. */
export const exportReport = createServerFn({ method: 'GET' })
  .validator(z.object({ tree, format: z.enum(['gedcom', 'markdown']) }))
  .handler(async ({ data }) => {
    await (await guard()).requireCan(data.tree, 'edit-person');
    const { exportLosses } = await import('./export.server.ts');
    return exportLosses(data.tree, data.format);
  });

/** The import preview: what the file would add, match and conflict with. Writes nothing. */
export const previewImportFile = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, text: z.string().max(MAX_GEDCOM_BYTES), locale }))
  .handler(async ({ data }) => {
    await (await guard()).requireCan(data.tree, 'manage-access');
    const { previewImport } = await import('./import.server.ts');
    return previewImport(data.tree, data.text, await untitledIn(data.locale));
  });

/**
 * Writes the import. `allowExisting` is the explicit choice to add to a family that already has people; the
 * server refuses without it. `opKey` makes a retry after a lost response write nothing twice.
 */
export const applyImportFile = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, text: z.string().max(MAX_GEDCOM_BYTES), allowExisting: z.boolean(), opKey: z.string().min(8).max(64), locale }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireCan(data.tree, 'manage-access');
    const { applyImport } = await import('./import.server.ts');
    return applyImport(
      data.tree,
      data.text,
      { key: data.opKey, user: m.user.id, payload: { text: data.text, allowExisting: data.allowExisting } },
      data.allowExisting,
      await untitledIn(data.locale),
    );
  });
