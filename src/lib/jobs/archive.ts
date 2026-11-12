// The nightly archive. Each family that has it configured gets its Markdown archive (the v1 format) and its GEDCOM
// file committed to a private GitHub repository, so a readable copy exists outside the database. The database is
// the source of truth: this job only writes out, and reads nothing back. Settings per family, from the environment
// (docs/exchange.md, "The nightly archive"); <ID> is the family id in capitals, with "-" written as "_":
//   KINDRED_ARCHIVE_<ID>_REPO    owner/name of a PRIVATE repository
//   KINDRED_ARCHIVE_<ID>_TOKEN   a fine-grained token: contents read and write, on that one repository
//   KINDRED_ARCHIVE_<ID>_BRANCH  the branch to commit to (default main)
//   KINDRED_ARCHIVE_<ID>_PATH    the folder the archive owns (default archive); nothing outside it is touched
import { familySnapshot, type FamilySnapshot } from '../exchange/export.server.ts';
import { markdownArchive, type ArchiveFile } from '../exchange/markdown.ts';
import { writeGedcom } from '../exchange/gedcom.ts';
import {
  createCommit,
  GitHubError,
  gitBlobSha,
  isPrivate,
  moveBranch,
  readBlob,
  readBranch,
  readFolder,
  writeBlob,
  type GitHubClient,
  type Repo,
  type TreeChange,
} from './github.ts';
import type { DailyJob, JobContext } from './types.ts';

/** The file that says which family a folder belongs to, and the date its exports were written with. */
export const MARKER = '.kindred-archive';
const AUTHOR = { name: 'Kindred', email: 'kindred@users.noreply.github.com' };
const DEFAULT_BRANCH = 'main';
const DEFAULT_FOLDER = 'archive';
/** A folder segment: no leading dot, so the archive never writes into .github or another hidden folder. */
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
/** A branch that moved under us (a push during the run) is read again this many times at most. */
const MAX_ATTEMPTS = 3;

export interface ArchiveConfig {
  tree: string;
  repo: Repo;
  branch: string;
  folder: string;
  token: string;
}

export interface Changes {
  added: string[];
  changed: string[];
  removed: string[];
}

export type ArchiveStatus = 'unconfigured' | 'unchanged' | 'committed' | 'planned' | 'failed';

export interface ArchiveResult {
  tree: string;
  status: ArchiveStatus;
  /** The paths (relative to the folder) that were or would be added, changed or removed. */
  changes?: Changes;
  commit?: string;
  /** Why it failed, with the token taken out. */
  error?: string;
}

export interface ArchiveOptions {
  /** Work out and report the changes, but write nothing. Still reads the repository. */
  dryRun?: boolean;
  /** The fetch to use. Defaults to the global one, which is what Workers and Node provide. */
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Where a family's data comes from. Defaults to its database. */
  read?: (tree: string) => Promise<FamilySnapshot>;
}

/** The environment names a family's archive settings use. */
export function archiveEnvPrefix(tree: string): string {
  return `KINDRED_ARCHIVE_${tree.toUpperCase().replace(/-/g, '_')}`;
}

/**
 * A family's archive settings, or null when it has none (then it is skipped quietly). A family with only one of
 * the two required settings is a mistake, and throws so that it is reported.
 */
export function archiveConfig(tree: string, env: JobContext['env']): ArchiveConfig | null {
  const key = archiveEnvPrefix(tree);
  const repoText = env(`${key}_REPO`);
  const token = env(`${key}_TOKEN`);
  if (!repoText && !token) return null;
  if (!repoText || !token) throw new Error(`set both ${key}_REPO and ${key}_TOKEN, or neither`);
  const m = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(repoText);
  if (!m || [m[1], m[2]].some((s) => s === '.' || s === '..')) throw new Error(`${key}_REPO must be owner/name, for example family/archive`);
  const branch = env(`${key}_BRANCH`) ?? DEFAULT_BRANCH;
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes('..') || branch.startsWith('/') || branch.endsWith('/')) {
    throw new Error(`${key}_BRANCH is not a branch name`);
  }
  const folder = (env(`${key}_PATH`) ?? DEFAULT_FOLDER).replace(/^\/+|\/+$/g, '');
  if (!folder || !folder.split('/').every((s) => SEGMENT.test(s))) {
    throw new Error(`${key}_PATH must be a folder inside the repository, such as archive`);
  }
  return { tree, repo: { owner: m[1], name: m[2] }, branch, folder, token };
}

/**
 * The archive's files for a family on `date` (YYYY-MM-DD): the GEDCOM file, the v1 notes and README, the portraits,
 * and the marker. Both exporters print the date they were written on, so the date is a parameter: the same data on
 * the same date gives the same bytes.
 */
export function renderFamily(tree: string, snap: FamilySnapshot, date: string): ArchiveFile[] {
  const when = new Date(`${date}T00:00:00Z`);
  const { files } = markdownArchive(snap.tree, new Set(snap.portraits.map((p) => p.path)), when);
  return [
    { path: `${tree}.ged`, data: writeGedcom(snap.tree, when).text },
    ...files,
    ...snap.portraits,
    ...(snap.research ?? []),
    { path: MARKER, data: `family ${tree}\nexported ${date}\n` },
  ];
}

interface Rendered {
  bytes: Uint8Array;
  sha: string;
}

async function hashed(files: ArchiveFile[]): Promise<Map<string, Rendered>> {
  const out = new Map<string, Rendered>();
  for (const f of files) {
    const bytes = typeof f.data === 'string' ? new TextEncoder().encode(f.data) : f.data;
    out.set(f.path, { bytes, sha: await gitBlobSha(bytes) });
  }
  return out;
}

/** Compares the rendered files with the folder's blob ids: what is new, what differs, and what is no longer exported. */
function compare(rendered: Map<string, Rendered>, existing: Map<string, string>): Changes {
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  for (const [path, r] of rendered) {
    const was = existing.get(path);
    if (was === undefined) added.push(path);
    else if (was !== r.sha) changed.push(path);
  }
  for (const path of existing.keys()) if (!rendered.has(path)) removed.push(path);
  return { added: added.sort(), changed: changed.sort(), removed: removed.sort() };
}

const total = (c: Changes) => c.added.length + c.changed.length + c.removed.length;
const summary = (c: Changes) => `${c.added.length} added, ${c.changed.length} changed, ${c.removed.length} removed`;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The export date the folder was last written with, from its marker, or null when there is none yet. Refuses a
 * folder that belongs to another family: two families in one folder would delete each other's files. Refuses a folder
 * that has files but no marker: the archive did not write them, and a run would delete them as "no longer exported".
 * An empty or missing folder is fine: that is where a first run starts.
 */
async function markerDate(gh: GitHubClient, cfg: ArchiveConfig, existing: Map<string, string>): Promise<string | null> {
  const sha = existing.get(MARKER);
  if (!sha) {
    if (existing.size > 0) {
      throw new Error(
        `${cfg.folder} is not empty and has no ${MARKER} file, so the archive did not write its ${existing.size} file(s) and a run would delete them. `
          + `Empty the folder, or choose an empty one with ${archiveEnvPrefix(cfg.tree)}_PATH`,
      );
    }
    return null;
  }
  const text = new TextDecoder().decode(await readBlob(gh, cfg.repo, sha));
  const family = /^family (.+)$/m.exec(text)?.[1]?.trim();
  if (!family) throw new Error(`${cfg.folder}/${MARKER} is not one the archive wrote; choose another folder or remove it by hand`);
  if (family !== cfg.tree) throw new Error(`${cfg.folder} belongs to the family "${family}" in this repository; give each family its own folder`);
  const date = /^exported (\d{4}-\d{2}-\d{2})$/m.exec(text)?.[1];
  if (!date) throw new Error(`${cfg.folder}/${MARKER} has no export date; choose another folder`);
  return date;
}

interface Run {
  gh: GitHubClient;
  dryRun: boolean;
  read: (tree: string) => Promise<FamilySnapshot>;
  now: Date;
}

/** One family, end to end: read the branch and the folder, compare, and commit only what differs. */
async function archiveFamily(cfg: ArchiveConfig, run: Run): Promise<{ status: 'unchanged' | 'committed' | 'planned'; changes: Changes; commit?: string }> {
  const { gh, now } = run;
  const today = now.toISOString().slice(0, 10);
  if (!(await isPrivate(gh, cfg.repo))) {
    throw new Error(`${cfg.repo.owner}/${cfg.repo.name} is not private; the archive holds private family data, so it needs a private repository`);
  }
  const snapshot = await run.read(cfg.tree);
  for (let attempt = 1; ; attempt++) {
    const { head, root } = await readBranch(gh, cfg.repo, cfg.branch);
    const existing = await readFolder(gh, cfg.repo, root, cfg.folder);
    // Unchanged data is compared on the date of the last commit, so a new night alone writes nothing. Only a real
    // change moves the date on to today.
    const kept = await markerDate(gh, cfg, existing);
    let date = kept ?? today;
    let rendered = await hashed(renderFamily(cfg.tree, snapshot, date));
    let changes = compare(rendered, existing);
    if (total(changes) === 0) return { status: 'unchanged', changes };
    if (date !== today) {
      date = today;
      rendered = await hashed(renderFamily(cfg.tree, snapshot, date));
      changes = compare(rendered, existing);
    }
    if (run.dryRun) return { status: 'planned', changes };

    const prefix = `${cfg.folder}/`;
    const edits: TreeChange[] = [];
    for (const path of [...changes.added, ...changes.changed]) {
      const want = rendered.get(path)!;
      const got = await writeBlob(gh, cfg.repo, want.bytes);
      // The log names no file: a path can carry a person's name.
      if (got !== want.sha) throw new Error('GitHub stored a file under an id that git does not compute');
      edits.push({ path: prefix + path, sha: got });
    }
    for (const path of changes.removed) edits.push({ path: prefix + path, sha: null });

    const commit = await createCommit(gh, cfg.repo, {
      root,
      head,
      changes: edits,
      message: `archive: nightly export of ${cfg.tree}, ${today}\n\n${summary(changes)}.`,
      author: AUTHOR,
      date: now.toISOString(),
    });
    try {
      await moveBranch(gh, cfg.repo, cfg.branch, commit);
    } catch (e) {
      // Someone pushed while this run worked: read the branch again and commit on top of what is there.
      if (e instanceof GitHubError && e.status === 422 && attempt < MAX_ATTEMPTS) continue;
      throw e;
    }
    return { status: 'committed', changes, commit };
  }
}

/**
 * Runs the archive for each family in turn. A family without settings is skipped without a word. A failure is
 * logged and the next family runs: nothing here throws, so one family cannot stop another. Every line logged or
 * returned has the token taken out.
 */
export async function archiveTrees(trees: string[], ctx: Pick<JobContext, 'env' | 'now' | 'log'>, opts: ArchiveOptions = {}): Promise<ArchiveResult[]> {
  const results: ArchiveResult[] = [];
  for (const tree of trees) {
    let cfg: ArchiveConfig | null;
    try {
      cfg = archiveConfig(tree, ctx.env);
    } catch (e) {
      const error = message(e);
      ctx.log(`${tree}: archive not run: ${error}`);
      results.push({ tree, status: 'failed', error });
      continue;
    }
    if (!cfg) {
      results.push({ tree, status: 'unconfigured' });
      continue;
    }
    const token = cfg.token;
    const clean = (s: string) => s.split(token).join('[token]');
    const gh: GitHubClient = {
      token,
      fetch: opts.fetch ?? ((input, init) => globalThis.fetch(input, init)),
      sleep: opts.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    };
    try {
      const out = await archiveFamily(cfg, { gh, dryRun: !!opts.dryRun, read: opts.read ?? familySnapshot, now: ctx.now });
      if (out.status === 'committed') ctx.log(clean(`${tree}: committed ${out.commit!.slice(0, 7)} to ${cfg.repo.name}: ${summary(out.changes)}`));
      else if (out.status === 'planned') ctx.log(clean(`${tree}: would commit: ${summary(out.changes)}`));
      else ctx.log(`${tree}: nothing changed`);
      results.push({ tree, status: out.status, changes: out.changes, commit: out.commit });
    } catch (e) {
      const error = clean(message(e));
      ctx.log(`${tree}: archive failed: ${error}`);
      results.push({ tree, status: 'failed', error });
    }
  }
  return results;
}

/**
 * The daily job: every family the deployment serves, archived in turn. Once all have run, a failure for any of them fails the
 * job, so the operator's Health tab shows it (the reasons are in the log, not here).
 */
export const archiveJob: DailyJob = {
  name: 'archive',
  run: async (ctx) => {
    const failed = (await archiveTrees(ctx.trees, ctx)).filter((r) => r.status === 'failed').map((r) => r.tree);
    if (failed.length) throw new Error(`no archive for ${failed.join(', ')}`);
  },
};
