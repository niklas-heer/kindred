// The GitHub REST Git Data API, through fetch, so it runs the same on Workers and Node. Only what the nightly
// archive needs: read a branch and a folder of it, write blobs, a tree and a commit, and move the branch.
// The token goes in the Authorization header and nowhere else; errors carry the status and GitHub's message.

const API = 'https://api.github.com';
const RETRIES = 2;
/** How many secondary-rate-limit waits one call may take before it gives up. */
const MAX_WAITS = 5;

export interface GitHubClient {
  token: string;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}

export interface Repo {
  owner: string;
  name: string;
}

export class GitHubError extends Error {
  /** The HTTP status, or 0 when GitHub could not be reached. */
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

/** The primary rate limit is used up, or GitHub kept asking to slow down: the run gives up and logs it. */
export class RateLimitError extends GitHubError {
  constructor(message: string, status: number) {
    super(message, status);
    this.name = 'RateLimitError';
  }
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** The id git gives a file with these bytes: SHA-1 of "blob <length>\0" followed by the bytes. */
export async function gitBlobSha(bytes: Uint8Array): Promise<string> {
  const head = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(head.length + bytes.length);
  all.set(head);
  all.set(bytes, head.length);
  return hex(await crypto.subtle.digest('SHA-1', all));
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text.replace(/\s/g, '')), (c) => c.charCodeAt(0));
}

const repoPath = (r: Repo) => `/repos/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.name)}`;
const refPath = (branch: string) => branch.split('/').map(encodeURIComponent).join('/');

/**
 * One call to the API, returning the parsed JSON. Network errors and 5xx answers are retried a few times.
 * A secondary rate limit (retry-after, or a 429) is waited out, up to MAX_WAITS times. A primary rate limit
 * (remaining 0) is not waited out: the run fails and the next night tries again.
 */
export async function call<T = any>(gh: GitHubClient, method: string, path: string, body?: unknown): Promise<T> {
  for (let attempt = 1, waits = 0; ; attempt++) {
    let res: Response;
    try {
      res = await gh.fetch(API + path, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${gh.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'kindred-archive',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      if (attempt <= RETRIES) {
        await gh.sleep(1000 * attempt);
        continue;
      }
      throw new GitHubError(`GitHub could not be reached for ${method} ${path}: ${e instanceof Error ? e.message : String(e)}`, 0);
    }
    const text = await res.text();
    if (res.ok) return (text ? JSON.parse(text) : undefined) as T;

    let message = '';
    try {
      message = JSON.parse(text).message ?? '';
    } catch {
      // Not JSON: the status alone says what happened.
    }
    const label = `GitHub answered ${res.status} to ${method} ${path}${message ? `: ${message}` : ''}`;
    if (res.headers.get('x-ratelimit-remaining') === '0') {
      const reset = Number(res.headers.get('x-ratelimit-reset'));
      const when = Number.isFinite(reset) && reset > 0 ? `until ${new Date(reset * 1000).toISOString()}` : 'until its reset';
      throw new RateLimitError(`${label}. The rate limit is used up ${when}; the next run will try again`, res.status);
    }
    const retryAfter = res.headers.get('retry-after');
    if (res.status === 429 || retryAfter !== null || /secondary rate limit/i.test(message)) {
      const seconds = retryAfter !== null && Number.isFinite(Number(retryAfter)) ? Number(retryAfter) : 60;
      if (waits < MAX_WAITS) {
        waits++;
        await gh.sleep(seconds * 1000);
        continue;
      }
      throw new RateLimitError(`${label}. GitHub kept asking to slow down`, res.status);
    }
    if (res.status >= 500 && attempt <= RETRIES) {
      await gh.sleep(1000 * attempt);
      continue;
    }
    throw new GitHubError(label, res.status);
  }
}

/** The repository's visibility. An archive holds private family data, so only a private repository may take it. */
export async function isPrivate(gh: GitHubClient, repo: Repo): Promise<boolean> {
  return (await call<{ private?: boolean }>(gh, 'GET', repoPath(repo))).private === true;
}

/** The commit a branch points at, and the root tree of that commit. A missing branch is said plainly. */
export async function readBranch(gh: GitHubClient, repo: Repo, branch: string): Promise<{ head: string; root: string }> {
  let head: string;
  try {
    head = (await call(gh, 'GET', `${repoPath(repo)}/git/ref/heads/${refPath(branch)}`)).object.sha;
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) {
      throw new Error(`branch "${branch}" was not found in ${repo.owner}/${repo.name}; create it first (the repository needs at least one commit)`);
    }
    throw e;
  }
  const commit = await call(gh, 'GET', `${repoPath(repo)}/git/commits/${head}`);
  return { head, root: commit.tree.sha };
}

/**
 * The files under `folder` in the tree `root`: each path relative to the folder, with its blob id. A folder that
 * does not exist is an empty map. Walks down one level at a time, so nothing outside the folder is listed.
 */
export async function readFolder(gh: GitHubClient, repo: Repo, root: string, folder: string): Promise<Map<string, string>> {
  let dir = root;
  for (const part of folder.split('/')) {
    const listing = await call(gh, 'GET', `${repoPath(repo)}/git/trees/${dir}`);
    const next = (listing.tree as { path: string; type: string; sha: string }[]).find((e) => e.type === 'tree' && e.path === part)?.sha;
    if (!next) return new Map();
    dir = next;
  }
  const listing = await call(gh, 'GET', `${repoPath(repo)}/git/trees/${dir}?recursive=1`);
  if (listing.truncated) throw new Error(`the folder ${folder} is too large to read in one request`);
  const files = new Map<string, string>();
  for (const e of listing.tree as { path: string; type: string; sha: string }[]) if (e.type === 'blob') files.set(e.path, e.sha);
  return files;
}

export async function readBlob(gh: GitHubClient, repo: Repo, sha: string): Promise<Uint8Array> {
  return fromBase64((await call(gh, 'GET', `${repoPath(repo)}/git/blobs/${sha}`)).content);
}

/** Stores bytes as a blob and returns its id, which the caller checks against gitBlobSha. */
export async function writeBlob(gh: GitHubClient, repo: Repo, bytes: Uint8Array): Promise<string> {
  return (await call(gh, 'POST', `${repoPath(repo)}/git/blobs`, { content: toBase64(bytes), encoding: 'base64' })).sha;
}

/** A change to one path: its blob id, or null to delete it. Paths are whole paths from the repository root. */
export interface TreeChange {
  path: string;
  sha: string | null;
}

/** A tree from `root` with the changes applied, then a commit on top of `head`. Returns the commit's id. */
export async function createCommit(
  gh: GitHubClient,
  repo: Repo,
  opts: { root: string; head: string; changes: TreeChange[]; message: string; author: { name: string; email: string }; date: string },
): Promise<string> {
  const tree = await call(gh, 'POST', `${repoPath(repo)}/git/trees`, {
    base_tree: opts.root,
    tree: opts.changes.map((c) => ({ path: c.path, mode: '100644', type: 'blob', sha: c.sha })),
  });
  const author = { ...opts.author, date: opts.date };
  const commit = await call(gh, 'POST', `${repoPath(repo)}/git/commits`, {
    message: opts.message,
    tree: tree.sha,
    parents: [opts.head],
    author,
    committer: author,
  });
  return commit.sha;
}

/** Moves the branch to `sha`, only if that commit builds on the branch's current head (no force). */
export async function moveBranch(gh: GitHubClient, repo: Repo, branch: string, sha: string): Promise<void> {
  await call(gh, 'PATCH', `${repoPath(repo)}/git/refs/heads/${refPath(branch)}`, { sha, force: false });
}
