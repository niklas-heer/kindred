// The console's Update button (docs/hosting-many-families.md, "Updates"), for an install made by the Deploy to Cloudflare
// button and deployed by Workers Builds (KINDRED_UPDATE_VIA=github-actions). The operator stores the install's repository and
// a fine-grained GitHub token (Actions: write on that one repository); the token is sealed with KINDRED_SECRET
// (src/lib/ai/secret.server.ts) and never leaves the server again. "Update to vX" runs the copy's
// `.github/workflows/update.yml` with the tag, through GitHub's API; the workflow puts the release's files into the copy and
// pushes, and Workers Builds deploys. The console then follows the run, asking GitHub at most every POLL_MS.
//
// Nothing here runs by itself: an update starts only when an operator asks, with a fresh proof (the server function), for a
// release the update check found, and never over a release that needs a step by hand. Everything said to GitHub is fixed
// here (the repository's form, the workflow's file, the tag's form); what GitHub answers is untrusted and checked.
import { AuthError } from '../auth/errors.ts';
import { translate, type Key } from '../i18n/dictionary.ts';
import { onWorkers, q, store } from '../store/index.ts';
import { audit, type AuditActor } from './settings.server.ts';
import { INSTALL_KINDS, REPO, releaseFlags, releasesUpTo, runActive, TAG, type InstallKind, type SelfUpdate, type UpdateRun } from './self-update-shared.ts';
import { cleanVersion, compareVersions } from './updates-shared.ts';
import { updateRepo, updateStatus } from './updates.server.ts';

const accounts = () => store.accounts();
const API = 'https://api.github.com';
const WORKFLOW = 'update.yml';
const TIMEOUT = 10_000;
/** The console asks GitHub about a run at most this often. */
export const POLL_MS = 10_000;
const PURPOSE = 'github-update';

const invalid = (key: Key) => new AuthError('invalid', translate('en', key));

const env = (name: string) => {
  const v = process.env[name];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
};

/** How this install is updated: KINDRED_UPDATE_VIA when it names a way, else Cloudflare by hand on Workers and Node elsewhere. */
export function installKind(): InstallKind {
  const v = env('KINDRED_UPDATE_VIA')?.toLowerCase();
  if (v && (INSTALL_KINDS as readonly string[]).includes(v)) return v as InstallKind;
  return onWorkers ? 'cloudflare' : 'node';
}

type Fetch = typeof fetch;
// The same fake as the update check's (updates.server.ts, setUpdateFetch): tests replace GitHub once for both.
const g = globalThis as unknown as { __kindredUpdateFetch?: Fetch };

/** One call to GitHub's API with the token. The token goes in the header only, never in an address or a log line. */
async function github(token: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> {
  const f = g.__kindredUpdateFetch ?? fetch;
  try {
    return await f(API + path, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Kindred',
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT),
    });
  } catch {
    throw invalid('update.err.github_unreachable');
  }
}

const repoPath = (repo: string) => `/repos/${repo.split('/').map(encodeURIComponent).join('/')}`;

interface Row {
  repo: string; branch: string; token: string; token_tail: string; set_at: number;
  run_tag: string | null; run_started_at: number | null; run_id: number | null; run_url: string | null;
  run_status: string | null; run_conclusion: string | null; run_polled_at: number | null;
}
const row = () => accounts().get<Row>('SELECT * FROM update_github WHERE id = 1');

const runOf = (r: Row | undefined): UpdateRun | null => r?.run_tag && r.run_started_at ? {
  tag: r.run_tag, startedAt: r.run_started_at, id: r.run_id, url: r.run_url, status: r.run_status, conclusion: r.run_conclusion,
} : null;

/** What the console shows: never the token, only its last four characters. */
export async function selfUpdate(): Promise<SelfUpdate> {
  const r = await row();
  return {
    install: installKind(), repo: r?.repo ?? null, branch: r?.branch ?? null, tokenTail: r?.token_tail ?? null, setAt: r?.set_at ?? null,
    run: runOf(r), image: `ghcr.io/${updateRepo().toLowerCase()}`,
  };
}

const isGitHubRunUrl = (url: unknown, repo: string): url is string =>
  typeof url === 'string' && url.length < 300 && url.startsWith(`https://github.com/${repo}/actions/runs/`);

/**
 * Stores the repository and the token, after asking GitHub whether the token reaches the repository and its update workflow
 * (and which branch is its default, where the workflow runs). Logged without the token.
 */
export async function saveToken(by: AuditActor, repoIn: string, tokenIn: string, now = Date.now()): Promise<void> {
  if (installKind() !== 'github-actions') throw invalid('update.err.not_button');
  const repo = repoIn.trim();
  const token = tokenIn.trim();
  if (!REPO.test(repo)) throw invalid('update.err.repo');
  if (!/^[A-Za-z0-9_]{20,255}$/.test(token)) throw invalid('update.err.token');
  const info = await github(token, 'GET', repoPath(repo));
  if (info.status === 401) throw invalid('update.err.token_refused');
  if (!info.ok) throw invalid('update.err.repo_unreachable');
  const branch = (await info.json().catch(() => null) as { default_branch?: unknown } | null)?.default_branch;
  if (typeof branch !== 'string' || !/^[\w./-]{1,200}$/.test(branch)) throw invalid('update.err.repo_unreachable');
  const wf = await github(token, 'GET', `${repoPath(repo)}/actions/workflows/${WORKFLOW}`);
  if (!wf.ok) throw invalid('update.err.no_workflow');
  const { sealSecret } = await import('../ai/secret.server.ts');
  const sealed = await sealSecret(PURPOSE, token);
  await accounts().batch([
    q(`INSERT INTO update_github (id, repo, branch, token, token_tail, set_at, set_by) VALUES (1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET repo = excluded.repo, branch = excluded.branch, token = excluded.token, token_tail = excluded.token_tail,
       set_at = excluded.set_at, set_by = excluded.set_by`, repo, branch, sealed, token.slice(-4), now, by.id),
    audit(by, 'update.token', null, { repo }, now),
  ]);
}

/** Forgets the token (and the repository). Logged. */
export async function forgetToken(by: AuditActor, now = Date.now()): Promise<void> {
  await accounts().batch([q('DELETE FROM update_github WHERE id = 1'), audit(by, 'update.token_removed', null, undefined, now)]);
}

/** What the console offers for `tag`: the releases from this one up to it, each with its flags. */
export async function plan(tag: string) {
  const status = await updateStatus();
  const version = cleanVersion(tag);
  if (!TAG.test(tag) || !version) throw invalid('update.err.tag');
  if (!status.version) throw invalid('update.err.no_version');
  if (compareVersions(version, status.version) <= 0) throw invalid('update.err.not_newer');
  if (!status.newer.some((r) => r.version === version)) throw invalid('update.err.unknown_release');
  return releasesUpTo(status.newer, version).map((r) => ({ version: r.version, ...releaseFlags(r) }));
}

/**
 * Runs the install's update workflow for `tag`. Refused unless this is a Deploy-button install with a token, the release is
 * one the check found newer than this one, no release up to it needs a step by hand, and no update is running. The caller
 * (the server function) has checked the operator and a fresh proof, and refused in a demo or a preview.
 */
export async function startUpdate(by: AuditActor, tag: string, now = Date.now()): Promise<UpdateRun> {
  if (installKind() !== 'github-actions') throw invalid('update.err.not_button');
  const r = await row();
  if (!r) throw invalid('update.err.no_token');
  const between = await plan(tag);
  if (between.some((x) => x.manual)) throw invalid('update.err.manual');
  if (runActive(runOf(r), now)) throw invalid('update.err.running');
  const { openSecret } = await import('../ai/secret.server.ts');
  let token: string;
  try {
    token = await openSecret(PURPOSE, r.token);
  } catch {
    throw invalid('update.err.token_unreadable');
  }
  const res = await github(token, 'POST', `${repoPath(r.repo)}/actions/workflows/${WORKFLOW}/dispatches`, { ref: r.branch, inputs: { tag } });
  if (res.status === 401) throw invalid('update.err.token_refused');
  if (res.status === 403 || res.status === 404) throw invalid('update.err.dispatch_refused');
  if (!res.ok) throw invalid('update.err.github_unreachable');
  await accounts().batch([
    q(`UPDATE update_github SET run_tag = ?, run_started_at = ?, run_id = NULL, run_url = NULL, run_status = 'requested', run_conclusion = NULL,
       run_polled_at = NULL WHERE id = 1`, tag, now),
    audit(by, 'update.start', null, { tag, repo: r.repo, manual: false, security: between.some((x) => x.security) }, now),
  ]);
  return { tag, startedAt: now, id: null, url: null, status: 'requested', conclusion: null };
}

/**
 * The last update's run, asking GitHub when the last answer is POLL_MS old and the run is not done: first which run it is
 * (the newest dispatch on the branch since it was asked for), then its status. A failed answer keeps what was known.
 */
export async function pollRun(now = Date.now()): Promise<UpdateRun | null> {
  const r = await row();
  const run = runOf(r);
  if (!r || !run || run.status === 'completed' || (r.run_polled_at && now - r.run_polled_at < POLL_MS)) return run;
  if (!run.id && now - run.startedAt > 60 * 60_000) return run;
  let token: string;
  try {
    token = await (await import('../ai/secret.server.ts')).openSecret(PURPOSE, r.token);
  } catch {
    return run;
  }
  let next = { ...run };
  try {
    if (!next.id) {
      const res = await github(token, 'GET', `${repoPath(r.repo)}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&branch=${encodeURIComponent(r.branch)}&per_page=5`);
      const body = res.ok ? await res.json().catch(() => null) as { workflow_runs?: unknown } | null : null;
      const runs = Array.isArray(body?.workflow_runs) ? body.workflow_runs as Record<string, unknown>[] : [];
      // GitHub's clock and ours may differ by a little: a run made up to a minute before the request counts.
      const found = runs.find((x) => typeof x.id === 'number' && typeof x.created_at === 'string' && Date.parse(x.created_at) >= run.startedAt - 60_000);
      if (found) next = { ...next, id: found.id as number, url: isGitHubRunUrl(found.html_url, r.repo) ? found.html_url : null, status: str(found.status), conclusion: str(found.conclusion) };
    } else {
      const res = await github(token, 'GET', `${repoPath(r.repo)}/actions/runs/${next.id}`);
      if (res.ok) {
        const x = await res.json().catch(() => null) as Record<string, unknown> | null;
        if (x) next = { ...next, url: isGitHubRunUrl(x.html_url, r.repo) ? x.html_url : next.url, status: str(x.status), conclusion: str(x.conclusion) };
      }
    }
  } catch {
    // Unreachable: asked again on the next poll.
  }
  try {
    await accounts().run('UPDATE update_github SET run_id = ?, run_url = ?, run_status = ?, run_conclusion = ?, run_polled_at = ? WHERE id = 1 AND run_started_at = ?',
      next.id, next.url, next.status, next.conclusion, now, run.startedAt);
  } catch {
    // Read-only (a preview): shown, not kept.
  }
  return next;
}

/** One of GitHub's status words, or null: short, lower-case letters and underscores only. */
const str = (v: unknown): string | null => (typeof v === 'string' && /^[a-z_]{1,30}$/.test(v) ? v : null);
