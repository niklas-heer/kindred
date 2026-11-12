// A steward's backup of their family (GET /api/backup/<tree>, docs/deploy-cloudflare.md "Backups"): the family's records as
// data, the same tables and rows a move to another install copies (./transfer.ts: no accounts, so no personal items, history
// or games' scores), with the schema they were read under. scripts/backup-do.ts saves it; scripts/import-to-do.ts
// --from-backup restores it as a new family. It works on every driver; on Cloudflare it is the way to hold a file of a family
// that lives in a Durable Object. The pictures are not in it: they are in the MEDIA bucket (or data/media/<tree>/).
import { store } from './index.ts';
import { COPIED_TABLES, COPY_ONLY, toCell, type FamilyBackup } from './transfer.ts';

export async function familyBackup(tree: string, now = new Date()): Promise<FamilyBackup> {
  const d = store.tree(tree);
  const present = new Set((await d.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map((r) => r.name));
  const schema = (await d.get<{ name: string | null }>('SELECT max(name) AS name FROM d1_migrations'))?.name ?? '';
  const tables: FamilyBackup['tables'] = [];
  for (const t of COPIED_TABLES) {
    if (!present.has(t)) continue;
    const rows = await d.all<Record<string, unknown>>(`SELECT * FROM "${t}"${COPY_ONLY[t] ? ` WHERE ${COPY_ONLY[t]}` : ''}`);
    // The pictures of the oldest families were kept in the database itself; they are in media storage now (photo.data is empty).
    const columns = rows.length ? Object.keys(rows[0]!).filter((c) => !(t === 'photo' && c === 'data')) : [];
    if (columns.length) tables.push({ table: t, columns, rows: rows.map((r) => columns.map((c) => toCell(r[c]))) });
  }
  return { kindred: 'family-backup', version: 1, tree, schema, made: now.toISOString(), tables };
}
