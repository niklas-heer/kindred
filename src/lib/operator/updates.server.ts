// "Am I up to date?" (docs/hosting-many-families.md, "Updates"). The server asks GitHub's releases API which Kindred release
// is the latest, at most once a day, and keeps the answer in the accounts table `update_check` (migration 0038). Nothing is
// asked until an operator agrees to it in the console (instance setting `update_check` = 'on'), and KINDRED_UPDATE_CHECK=off
// turns it off for good. The request carries a generic User-Agent and nothing that identifies this server; a fork points
// elsewhere with KINDRED_UPDATE_REPO. What GitHub returns is untrusted: versions must look like versions, addresses must be
// GitHub's, and notes are kept as text that the console renders through the safe Markdown renderer (src/lib/markdown.ts).
import { appCommit, appVersion } from '../version.ts';
import { q, store } from '../store/index.ts';
import { cleanVersion, compareVersions, DEFAULT_UPDATE_REPO, type ReleaseInfo, type UpdateStatus } from './updates-shared.ts';

const accounts = () => store.accounts();
const DAY = 86_400_000;
const API = 'https://api.github.com';
const NOTES_MAX = 20_000;
const RELEASES_MAX = 20;
const TIMEOUT = 10_000;
export const SETTING = 'update_check';

type Fetch = typeof fetch;
// Kept on globalThis so a test's module graph and the server's agree on the fake.
const g = globalThis as unknown as { __kindredUpdateFetch?: Fetch };
/** Tests replace the network with a fake; undefined restores fetch. */
export function setUpdateFetch(f: Fetch | undefined): void {
  g.__kindredUpdateFetch = f;
}

const env = (name: string) => {
  const v = process.env[name];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
};

/** Turned off for good by the server's setting. */
export const envOff = () => /^(off|0|false|no)$/i.test(env('KINDRED_UPDATE_CHECK') ?? '');

/** The repository to ask: KINDRED_UPDATE_REPO when it is "owner/name", else Kindred's own. */
export function updateRepo(): string {
  const r = env('KINDRED_UPDATE_REPO');
  return r && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/.test(r) ? r : DEFAULT_UPDATE_REPO;
}

/** Whether an operator agreed to the check (off until then). */
export async function agreed(): Promise<boolean> {
  return (await accounts().get<{ value: string }>('SELECT value FROM instance_setting WHERE key = ?', SETTING))?.value === 'on';
}

/** The statement that records the operator's answer. */
export const setAgreed = (on: boolean, by: string, at = Date.now()) => q(
  'INSERT INTO instance_setting (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
  SETTING, on ? 'on' : 'off', at, by,
);

interface Cached { repo: string; checked_at: number; etag: string | null; latest: string | null; releases: string; error: string | null }
const cached = () => accounts().get<Cached>('SELECT repo, checked_at, etag, latest, releases, error FROM update_check WHERE id = 1');

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/** One release from GitHub's answer, or null when it is a draft, a pre-release or not a version. */
export function toRelease(raw: unknown, repo: string): ReleaseInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.draft === true || r.prerelease === true) return null;
  const version = cleanVersion(r.tag_name);
  if (!version) return null;
  const html = text(r.html_url, 500);
  const url = html.startsWith(`https://github.com/${repo}/`) ? html : `https://github.com/${repo}/releases/tag/v${version}`;
  const date = typeof r.published_at === 'string' && !Number.isNaN(Date.parse(r.published_at)) ? new Date(r.published_at).toISOString() : null;
  return { version, name: text(r.name, 200).replace(/[\u0000-\u001f]/g, ' ').trim() || version, date, url, notes: text(r.body, NOTES_MAX) };
}

async function get(path: string, etag?: string | null): Promise<Response> {
  const f = g.__kindredUpdateFetch ?? fetch;
  return f(API + path, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      // Generic: no version, no address, nothing that tells one server from another.
      'User-Agent': 'Kindred',
      ...(etag ? { 'If-None-Match': etag } : {}),
    },
    signal: AbortSignal.timeout(TIMEOUT),
  });
}

/**
 * Asks GitHub when the last answer is a day old (or for another repository), once agreed and not turned off. Two calls: the
 * latest release, and the list for the notes of those in between. A 304 to the ETag keeps the list. A failure is kept with
 * its time, so the next try waits a day too. Returns whether it asked.
 */
export async function checkForUpdate(now = Date.now()): Promise<boolean> {
  if (envOff() || !(await agreed())) return false;
  const repo = updateRepo();
  const prev = await cached();
  if (prev && prev.repo === repo && now - prev.checked_at < DAY) return false;
  const path = `/repos/${repo.split('/').map(encodeURIComponent).join('/')}`;
  let latest: string | null = null, releases: ReleaseInfo[] = [], etag: string | null = null, error: string | null = null;
  try {
    const res = await get(`${path}/releases/latest`);
    if (res.status === 404) latest = null;
    else if (!res.ok) throw new Error(`http ${res.status}`);
    else latest = toRelease(await res.json(), repo)?.version ?? null;
    const sameRepo = prev?.repo === repo;
    const list = await get(`${path}/releases?per_page=30`, sameRepo ? prev?.etag : null);
    if (list.status === 304 && sameRepo) {
      releases = parseStored(prev!.releases);
      etag = prev!.etag;
    } else if (list.ok) {
      const body: unknown = await list.json();
      releases = (Array.isArray(body) ? body : []).map((r) => toRelease(r, repo)).filter((r): r is ReleaseInfo => !!r)
        .sort((a, b) => compareVersions(b.version, a.version)).slice(0, RELEASES_MAX);
      etag = text(list.headers.get('etag'), 200) || null;
    } else if (list.status !== 404) throw new Error(`http ${list.status}`);
  } catch (e) {
    // A short code, not a sentence: 'http 503', 'timeout', or the network's own message.
    error = e instanceof Error ? (e.name === 'TimeoutError' ? 'timeout' : e.message).slice(0, 200) : 'failed';
  }
  await accounts().batch([q(
    `INSERT INTO update_check (id, repo, checked_at, etag, latest, releases, error) VALUES (1, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET repo = excluded.repo, checked_at = excluded.checked_at, etag = excluded.etag, latest = excluded.latest, releases = excluded.releases, error = excluded.error`,
    // A failed check keeps what the last good one knew, so the console still shows it, with "last checked".
    repo, now, error ? prev?.etag ?? null : etag, error ? prev?.latest ?? null : latest, error ? prev?.releases ?? '[]' : JSON.stringify(releases), error,
  )]);
  return true;
}

function parseStored(json: string): ReleaseInfo[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((r): r is ReleaseInfo => !!r && typeof r === 'object' && !!cleanVersion((r as ReleaseInfo).version)) : [];
  } catch {
    return [];
  }
}

/** What the console shows. Reads the cache only; `version` is for tests (a test build has none). */
export async function updateStatus(opts: { version?: string | null; commit?: string | null } = {}): Promise<UpdateStatus> {
  const version = opts.version !== undefined ? opts.version : appVersion();
  const commit = opts.commit !== undefined ? opts.commit : appCommit();
  const repo = updateRepo();
  const off = envOff();
  const [on, row] = await Promise.all([agreed(), cached()]);
  const fresh = row && row.repo === repo ? row : undefined;
  const newer = version && fresh ? parseStored(fresh.releases).filter((r) => compareVersions(r.version, version) > 0) : [];
  const latest = fresh?.latest ?? null;
  return {
    version, commit, enabled: !off && on, envOff: off, asked: on || !!(await accounts().get('SELECT 1 AS x FROM instance_setting WHERE key = ?', SETTING)),
    repo, checkedAt: fresh?.checked_at ?? null, latest, newer, error: fresh?.error ?? null,
    updateAvailable: !off && on && !!version && !!latest && compareVersions(latest, version) > 0,
  };
}

/** Whether to put a dot on the console's link: an update is known (cheap, cached only). */
export async function updateAvailable(): Promise<boolean> {
  const version = appVersion();
  if (!version || envOff()) return false;
  const [on, row] = await Promise.all([agreed(), cached()]);
  return on && !!row && row.repo === updateRepo() && !!row.latest && compareVersions(row.latest, version) > 0;
}
