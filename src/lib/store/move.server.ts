// Importing a family into its Durable Object on a running Worker (POST /api/move/<tree>, sent by scripts/import-to-do.ts).
// A Durable Object can only be reached through the Worker, so the script reads the family (a Node file, a D1 database it
// exported, or a steward's backup) on its own machine and sends its rows here in steps:
//   begin    announces the rows of each table and the schema they were read under, and stages the family's object: emptied,
//            migrated, and serving nothing (./durable.ts). It opens an import, recorded in the accounts database
//            (`family_import`, accounts migration 0036) and bound to the account that began it: every later step names the
//            import's id and is refused from anyone else, or after a day.
//   rows     some rows of one table, as data: the table and column names are checked against the staged schema and the
//            values are bound as parameters (./transfer.ts). No SQL is sent, so an import writes values and never reads or
//            changes anything else.
//   finish   counts every announced table in the staged object; only when each count matches, the schema is the one
//            announced and the rows name this family, the family is published: listed in `family_store`, and for a new
//            family its importer made its steward, in one guarded batch. Then the object serves.
// Two kinds of import:
//   new   a family this server does not have: not listed, no members, no open invitation (a family that waits for the
//         steward it invited is not free to take). Whoever may make families may import one, and becomes its steward.
//   copy  a family a TREE_<ID> D1 binding serves, copied into its object by one of its stewards (never by an operator,
//         who may not change a family's records). D1 keeps serving it until the binding is removed and the Worker deployed
//         again (docs/deploy-cloudflare.md, "Moving a family into a Durable Object").
// A family its Durable Object serves already is never imported into: delete it first. The route checks who is asking.
import { z } from 'zod';
import { AuthError } from '../auth/errors.ts';
import { upsertMembership } from '../auth/store.server.ts';
import { instanceSettings } from '../operator/settings.server.ts';
import { guard, isGuardError, q, store, type ImportTarget } from './index.ts';
import { NAME } from './transfer.ts';

/** An import left open longer than this is over: its steps are refused, and anyone who may begins again. */
export const IMPORT_MS = 24 * 3600_000;
const IMPORT_ID = /^[a-f0-9-]{36}$/;
const MIGRATION = /^\d{4}_[\w-]{1,120}\.sql$/;

export const moveStep = z.discriminatedUnion('step', [
  z.object({
    step: z.literal('begin'),
    replace: z.boolean().optional(),
    /** The server's terms accepted, for an import that makes a new family while the server has terms (`--accept-terms`). */
    acceptTerms: z.boolean().optional(),
    schema: z.string().regex(MIGRATION),
    tables: z.record(z.string().regex(NAME), z.number().int().min(0).max(100_000_000)).refine((t) => Object.keys(t).length >= 1 && Object.keys(t).length <= 200, 'between 1 and 200 tables'),
  }),
  z.object({
    step: z.literal('rows'),
    import: z.string().regex(IMPORT_ID),
    table: z.string().regex(NAME),
    columns: z.array(z.string().regex(NAME)).min(1).max(100),
    rows: z.array(z.array(z.unknown()).max(100)).min(1).max(1000),
  }),
  z.object({ step: z.literal('finish'), import: z.string().regex(IMPORT_ID) }),
]);
export type MoveStep = z.infer<typeof moveStep>;

/** Who is importing, as the route found them: their account, whether they steward the family, whether they may make families. */
export interface Importer { id: string; operator: boolean; steward: boolean; mayCreate: () => Promise<boolean> }

export class MoveError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

interface ImportRow { tree: string; id: string; user: string; mode: 'new' | 'copy'; schema: string; expected: string; started_at: number; finished_at: number | null }

const accounts = () => store.accounts();
const OPEN_INVITE = 'SELECT 1 FROM invite WHERE tree = ? AND used_at IS NULL AND revoked_at IS NULL AND expires > ?';

function target(tree: string): ImportTarget {
  if (!store.importTarget) throw new MoveError('This server keeps no families in Durable Objects: bind FAMILIES first (docs/deploy-cloudflare.md).');
  return store.importTarget(tree);
}

/** Why `tree` cannot be imported as a new family now, or null when it can. */
async function notNew(tree: string, now: number): Promise<string | null> {
  const [[members], [invited]] = (await accounts().readBatch([
    q('SELECT count(*) AS n FROM membership WHERE tree = ?', tree),
    q(`SELECT count(*) AS n FROM (${OPEN_INVITE})`, tree, now),
  ])) as unknown as [[{ n: number }], [{ n: number }]];
  if ((await store.treeIds()).includes(tree) || members!.n > 0) return `${tree} is a family on this server already: an import makes a new family only. Delete the family first if you mean to replace it.`;
  if (invited!.n > 0) return `${tree} waits for the steward it invited: it is not free to import into.`;
  return null;
}

/**
 * Whether this account may make a new family by importing it: the one decision about "a new family is made by this account",
 * so the rules for making a family apply to an import as they do to Manage families.
 */
async function mayMakeNewFamily(who: Importer): Promise<boolean> {
  if (!(await who.mayCreate())) return false;
  // Within the number of families an account may make (the terms are asked when the import begins).
  const { familyLimit } = await import('../families.server.ts');
  const limit = await familyLimit({ id: who.id, operator: who.operator ? 1 : 0 });
  if (limit && limit.made >= limit.max) throw new MoveError(`You have made ${limit.made} families, as many as an account may make on this server.`, 403);
  return true;
}

/** Who may do what: a new family, whoever may make families; a copy of a D1 family, its stewards. */
async function mayImport(tree: string, t: ImportTarget, who: Importer, now: number): Promise<'new' | 'copy'> {
  if (!t.serving) {
    if (!who.steward) throw new MoveError(`Only a steward of ${tree} may copy it into its Durable Object.`, 403);
    return 'copy';
  }
  const why = await notNew(tree, now);
  if (why) throw new MoveError(why);
  if (!(await mayMakeNewFamily(who))) throw new MoveError('You may not make families on this server.', 403);
  return 'new';
}

/** The open import `id` of `tree`, begun by `who`; refused otherwise. */
async function openImport(tree: string, id: string, who: Importer, now: number): Promise<ImportRow> {
  const row = await accounts().get<ImportRow>('SELECT * FROM family_import WHERE tree = ? AND id = ?', tree, id);
  if (!row || row.user !== who.id || row.started_at < now - IMPORT_MS) throw new MoveError(`No import of ${tree} by you is open: begin again.`, 403);
  return row;
}

export async function move(tree: string, step: MoveStep, who: Importer, now = Date.now()): Promise<Record<string, unknown>> {
  const t = target(tree);

  if (step.step === 'begin') {
    const mode = await mayImport(tree, t, who, now);
    const other = await accounts().get<ImportRow>('SELECT * FROM family_import WHERE tree = ?', tree);
    if (other && other.user !== who.id && !other.finished_at && other.started_at >= now - IMPORT_MS) throw new MoveError(`Someone else is importing ${tree} now.`);
    const state = await t.state();
    if (state.kind === 'accounts') throw new MoveError(`${tree} cannot be imported into.`);
    if (state.holds && !step.replace) throw new MoveError(`The Durable Object of ${tree} already holds a copy; send replace to empty it first.`);
    if (mode === 'new') {
      // Nothing a family of this id left behind (a deletion that stopped part-way) is inherited: its accounts rows and files.
      const { forgetInAccounts } = await import('../families.server.ts');
      await accounts().batch(await forgetInAccounts(tree));
      await store.media.deleteTree(tree);
    }
    const migrations = await t.stage();
    const schema = migrations.at(-1) ?? '';
    if (schema !== step.schema) throw new MoveError(`The rows were read under the schema ${step.schema}, and this Worker has ${schema}: run the same Kindred version on both sides.`);
    const tables = new Map(await t.schema());
    const unknown = Object.keys(step.tables).filter((name) => !tables.has(name));
    if (unknown.length) throw new MoveError(`The family's database has no table ${unknown.join(', ')}.`);
    // A new family is made by this account: the server's terms, as when making one in Manage families (recorded now).
    const { acceptance } = await import('../operator/terms.server.ts');
    const terms = mode === 'new' ? await acceptance({ id: who.id, operator: who.operator ? 1 : 0 }, step.acceptTerms, 'family.create', tree, now) : [];
    const id = crypto.randomUUID();
    await accounts().batch([
      ...terms,
      q('DELETE FROM family_import WHERE tree = ?', tree),
      q('INSERT INTO family_import (tree, id, user, mode, schema, expected, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)', tree, id, who.id, mode, schema, JSON.stringify(step.tables), now),
    ]);
    return { ok: true, import: id, mode, serving: t.serving };
  }

  const imp = await openImport(tree, step.import, who, now);
  const expected = JSON.parse(imp.expected) as Record<string, number>;

  if (step.step === 'rows') {
    if (imp.finished_at) throw new MoveError(`The import of ${tree} is finished: begin again.`);
    // What made the import allowed must still hold: a family made or claimed meanwhile is not written into.
    if ((await mayImport(tree, t, who, now)) !== imp.mode) throw new MoveError(`${tree} changed while it was imported: begin again.`);
    if (!Object.hasOwn(expected, step.table)) throw new MoveError(`${step.table} was not announced when the import began.`);
    for (const r of step.rows) if (r.length !== step.columns.length) throw new MoveError(`${step.table}: a row has ${r.length} values for ${step.columns.length} columns.`, 400);
    try {
      return { ok: true, written: await t.rows(step.table, step.columns, step.rows) };
    } catch (e) {
      if (/kindred:not-staged/.test(String(e))) throw new MoveError(`The Durable Object of ${tree} is no longer staged for this import: begin again.`);
      throw new MoveError(e instanceof Error ? e.message : String(e), 400);
    }
  }

  // finish
  if (!imp.finished_at) {
    let found: Awaited<ReturnType<ImportTarget['counts']>>;
    try {
      found = await t.counts(Object.keys(expected));
    } catch (e) {
      if (/kindred:not-staged/.test(String(e))) throw new MoveError(`The Durable Object of ${tree} is no longer staged for this import: begin again.`);
      throw e;
    }
    const wrong = Object.entries(expected).filter(([name, n]) => found.counts[name] !== n).map(([name, n]) => `${name}: announced ${n}, holds ${found.counts[name]}`);
    if (wrong.length) throw new MoveError(`The import of ${tree} is incomplete (${wrong.join('; ')}). Nothing is published; begin again.`);
    if (found.id !== tree) throw new MoveError(`The rows are not the family ${tree} (its details name ${found.id ?? 'no family'}). Nothing is published.`);
    const state = await t.state();
    if (state.migrations.at(-1) !== imp.schema) throw new MoveError(`The schema changed during the import (${imp.schema}, now ${state.migrations.at(-1)}): begin again.`);
    const steward = imp.mode === 'new'
      ? [
        guard('NOT EXISTS (SELECT 1 FROM membership WHERE tree = ?)', tree),
        guard(`NOT EXISTS (${OPEN_INVITE})`, tree, now),
        guard('NOT EXISTS (SELECT 1 FROM family_store WHERE tree = ?)', tree),
        upsertMembership(imp.user, tree, 'steward'),
        q(`INSERT INTO family_admin (tree, cap_bytes, created_at, created_by) VALUES (?, ?, ?, ?)
           ON CONFLICT(tree) DO UPDATE SET created_at = excluded.created_at, created_by = excluded.created_by`, tree, (await instanceSettings()).defaultCapBytes, now, imp.user),
      ]
      : [];
    try {
      await accounts().batch([
        guard('EXISTS (SELECT 1 FROM family_import WHERE tree = ? AND id = ? AND finished_at IS NULL)', tree, imp.id),
        ...steward,
        t.register,
        q('UPDATE family_import SET finished_at = ? WHERE tree = ? AND id = ?', now, tree, imp.id),
      ]);
    } catch (e) {
      if (isGuardError(e)) throw new MoveError(`${tree} changed while it was imported: nothing is published; begin again.`);
      throw e;
    }
  }
  // Published last: a finish that stopped here is finished by sending it again.
  await t.publish();
  return { ok: true, mode: imp.mode, serving: t.serving, counts: expected };
}

/** The route's answer for an error of the move. */
export const moveErrorStatus = (e: unknown) => (e instanceof MoveError ? e.status : e instanceof AuthError ? e.status : null);
