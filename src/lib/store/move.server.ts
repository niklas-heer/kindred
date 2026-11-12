// Moving a family into its Durable Object on a running Worker (POST /api/move/<tree>, sent by scripts/import-to-do.ts). A
// Durable Object can only be reached through the Worker, so the script reads the family (a Node file, or a D1 database it
// exported) on its own machine and sends the rows here in steps:
//   begin    makes the family's Durable Object (store.durableTree) and refuses one that already holds a family, unless
//            `replace` (then it is emptied first). Replacing is refused once the object serves a family with members.
//   rows     one batch of INSERT statements, written in one transaction. Only INSERTs into the family's own tables.
//   finish   the number of rows in each named table, which the script compares with what it sent.
// While a TREE_<ID> D1 binding still serves the family, nothing reads the copy; once the counts agree, the binding is
// removed and the Worker deployed again, and from then on the Durable Object serves the family (docs/deploy-cloudflare.md,
// "Moving a family into a Durable Object"). Who may do this is checked by the route.
import { z } from 'zod';
import { emptyDatabase, q, store } from './index.ts';

const TABLE = /^[a-z_][a-z0-9_]*$/;
/** Wrangler's migration record and SQLite's and Cloudflare's own tables are the target's, never copied over. */
const NEVER = /^(sqlite_|_cf_|d1_migrations$)/;
const INSERT = /^INSERT(?: OR REPLACE)? INTO "?([a-z_][a-z0-9_]*)"? \(/;

export const moveStep = z.discriminatedUnion('step', [
  z.object({ step: z.literal('begin'), replace: z.boolean().optional() }),
  z.object({ step: z.literal('rows'), statements: z.array(z.string().max(100_000)).min(1).max(1000) }),
  z.object({ step: z.literal('finish'), tables: z.array(z.string().regex(TABLE)).min(1).max(200) }),
]);
export type MoveStep = z.infer<typeof moveStep>;

export class MoveError extends Error {}

/** The table an import statement writes, or an error for anything that is not a plain INSERT into a family table. */
export function insertTarget(sql: string): string {
  const table = INSERT.exec(sql)?.[1];
  if (!table || NEVER.test(table)) throw new MoveError(`Only INSERT statements into the family's tables can be sent: ${sql.slice(0, 80)}`);
  return table;
}

export async function move(tree: string, step: MoveStep): Promise<Record<string, unknown>> {
  if (!store.durableTree) throw new MoveError('This server keeps no families in Durable Objects: bind FAMILIES first (docs/deploy-cloudflare.md).');
  const { db, serving } = await store.durableTree(tree);
  if (step.step === 'begin') {
    const [[meta], [people]] = (await db.readBatch([q('SELECT count(*) AS n FROM meta'), q('SELECT count(*) AS n FROM person')])) as [{ n: number }[], { n: number }[]];
    const holds = (meta?.n ?? 0) > 0 || (people?.n ?? 0) > 0;
    if (holds && !step.replace) throw new MoveError(`The Durable Object of ${tree} already holds a family; send replace to empty it first.`);
    if (holds) {
      const members = await store.accounts().get<{ n: number }>('SELECT count(*) AS n FROM membership WHERE tree = ?', tree);
      if (serving && (members?.n ?? 0) > 0) throw new MoveError(`${tree} is served from its Durable Object and has members: it is not replaced. Delete the family first if you mean it.`);
      await emptyDatabase(db);
    }
    return { ok: true, serving };
  }
  if (step.step === 'rows') {
    for (const sql of step.statements) insertTarget(sql);
    await db.batch(step.statements.map((sql) => q(sql)));
    return { ok: true, written: step.statements.length };
  }
  const present = new Set((await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map((r) => r.name));
  const missing = step.tables.filter((t) => !present.has(t));
  if (missing.length) throw new MoveError(`The Durable Object has no table ${missing.join(', ')}: is the Worker older than the family's schema?`);
  const counts = await db.readBatch(step.tables.map((t) => q(`SELECT count(*) AS n FROM "${t}"`)));
  return { ok: true, serving, counts: Object.fromEntries(step.tables.map((t, i) => [t, (counts[i]![0] as { n: number }).n])) };
}
