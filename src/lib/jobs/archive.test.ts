// node --test src/lib/jobs/archive.test.ts — the nightly archive against an in-memory GitHub (no network). Each test
// has its own scratch family under a temporary KINDRED_DATA_DIR (never data/). Covers: a first commit, an unchanged
// night, a changed and a removed note, a family left alone, the token in logs, errors, rate limits, a folder that
// belongs to another family, a public repository, a dry run, and a branch that moves during the run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'kindred-archive-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
test.after(() => rmSync(dir, { recursive: true, force: true }));

const { openSqlite } = await import('../store/node.ts');
const { archiveTrees, archiveConfig, archiveJob, MARKER } = await import('./archive.ts');

const TOKEN = 'github_pat_TEST_ONLY_0123456789';
const REPO = 'acme/archive';
const noSleep = async () => {};

// ---------- a family in a scratch database ----------

let families = 0;
interface Person {
  id: string;
  given: string;
  born?: string;
}

/** A new scratch family with these people. Returns its id. */
function family(people: Person[]): string {
  const id = `fam-${++families}`;
  const d = openSqlite(join(dir, `${id}.db`), 'tree', { create: true });
  d.exec(`INSERT INTO meta (key, value) VALUES ('id', '${id}'), ('name', 'Family ${families}'), ('tagline', ''), ('theme', 'codex'), ('focus', '')`);
  for (const p of people) d.exec(`INSERT INTO person (id, given, born, living) VALUES ('${p.id}', '${p.given}', ${p.born ? `'${p.born}'` : 'NULL'}, 1)`);
  d.close();
  return id;
}

/** Changes a family's rows, as the app would between two nights. */
function edit(id: string, sql: string[]) {
  const d = openSqlite(join(dir, `${id}.db`), 'tree');
  for (const s of sql) d.exec(s);
  d.close();
}

/** The settings a family gets from the environment, with optional extra ones. */
function settings(id: string, extra: Record<string, string> = {}): Record<string, string> {
  const key = `KINDRED_ARCHIVE_${id.toUpperCase().replace(/-/g, '_')}`;
  return { [`${key}_REPO`]: REPO, [`${key}_TOKEN`]: TOKEN, ...extra };
}

// ---------- an in-memory GitHub, with real git blob ids ----------

interface Entry {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
}

const sha1 = (...parts: (string | Uint8Array)[]) => {
  const h = createHash('sha1');
  for (const p of parts) h.update(p);
  return h.digest('hex');
};

class FakeGitHub {
  readonly blobs = new Map<string, Uint8Array>();
  readonly trees = new Map<string, Entry[]>();
  readonly commits = new Map<string, { tree: string; parents: string[]; message: string; author: any }>();
  readonly branches = new Map<string, string>();
  /** Every request, with the Authorization header it carried. */
  readonly calls: { method: string; path: string; auth: string | undefined }[] = [];
  isPrivate = true;
  private seq = 0;
  /** Asked before each request: return a Response to answer it, or undefined to let the fake answer. */
  override: (method: string, path: string) => Response | undefined = () => undefined;

  /** Starts a repository on `main` with these files. */
  seed(files: Record<string, string>) {
    const flat = new Map<string, string>();
    for (const [p, text] of Object.entries(files)) flat.set(p, this.putBlob(new TextEncoder().encode(text)));
    this.branches.set('main', this.commit(this.build(flat), [], 'initial', null));
  }

  /** Another writer commits a file to `main`. */
  advance(path: string, text: string) {
    const head = this.head();
    const flat = this.flat(this.commits.get(head)!.tree);
    flat.set(path, this.putBlob(new TextEncoder().encode(text)));
    this.branches.set('main', this.commit(this.build(flat), [head], 'elsewhere', null));
  }

  head = () => this.branches.get('main')!;
  shaAt = (path: string) => this.flat(this.commits.get(this.head())!.tree).get(path);
  /** The files on `main`, as text. */
  files(): Map<string, string> {
    const out = new Map<string, string>();
    for (const [p, sha] of this.flat(this.commits.get(this.head())!.tree)) out.set(p, Buffer.from(this.blobs.get(sha)!).toString('utf8'));
    return out;
  }
  writes = () => this.calls.filter((c) => c.method !== 'GET');

  private putBlob(bytes: Uint8Array): string {
    const sha = sha1(`blob ${bytes.length}\0`, bytes);
    this.blobs.set(sha, bytes);
    return sha;
  }

  private flat(sha: string, prefix = '', out = new Map<string, string>()): Map<string, string> {
    for (const e of this.trees.get(sha) ?? []) {
      if (e.type === 'tree') this.flat(e.sha, `${prefix}${e.path}/`, out);
      else out.set(prefix + e.path, e.sha);
    }
    return out;
  }

  private build(files: Map<string, string>): string {
    const entries: Entry[] = [];
    const groups = new Map<string, Map<string, string>>();
    for (const [p, sha] of files) {
      const i = p.indexOf('/');
      if (i < 0) entries.push({ path: p, mode: '100644', type: 'blob', sha });
      else {
        const name = p.slice(0, i);
        if (!groups.has(name)) groups.set(name, new Map());
        groups.get(name)!.set(p.slice(i + 1), sha);
      }
    }
    for (const [name, sub] of groups) entries.push({ path: name, mode: '040000', type: 'tree', sha: this.build(sub) });
    entries.sort((a, b) => (a.path < b.path ? -1 : 1));
    const sha = sha1('tree', JSON.stringify(entries));
    this.trees.set(sha, entries);
    return sha;
  }

  private commit(tree: string, parents: string[], message: string, author: unknown): string {
    const sha = sha1('commit', String(++this.seq), JSON.stringify({ tree, parents, message }));
    this.commits.set(sha, { tree, parents, message, author });
    return sha;
  }

  private recursive(sha: string, prefix = ''): Entry[] {
    return (this.trees.get(sha) ?? []).flatMap((e) => {
      const here = { ...e, path: prefix + e.path };
      return e.type === 'tree' ? [here, ...this.recursive(e.sha, `${prefix}${e.path}/`)] : [here];
    });
  }

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    this.calls.push({ method, path: url.pathname + url.search, auth });
    const answered = this.override(method, url.pathname);
    if (answered) return answered;
    return this.route(method, url, typeof init?.body === 'string' ? JSON.parse(init.body) : undefined);
  };

  private route(method: string, url: URL, body: any): Response {
    const json = (status: number, data: unknown, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
    const notFound = () => json(404, { message: 'Not Found' });
    const base = `/repos/${REPO}`;
    if (!url.pathname.startsWith(base)) return notFound();
    const rest = url.pathname.slice(base.length);
    let m: RegExpExecArray | null;
    if (method === 'GET' && rest === '') return json(200, { private: this.isPrivate });
    if (method === 'GET' && (m = /^\/git\/ref\/heads\/(.+)$/.exec(rest))) {
      const head = this.branches.get(m[1]);
      return head ? json(200, { ref: `refs/heads/${m[1]}`, object: { sha: head, type: 'commit' } }) : notFound();
    }
    if (method === 'PATCH' && (m = /^\/git\/refs\/heads\/(.+)$/.exec(rest))) {
      const head = this.branches.get(m[1]);
      if (!head) return notFound();
      if (this.commits.get(body.sha)?.parents[0] !== head) return json(422, { message: 'Update is not a fast forward' });
      this.branches.set(m[1], body.sha);
      return json(200, { ref: `refs/heads/${m[1]}`, object: { sha: body.sha, type: 'commit' } });
    }
    if (method === 'GET' && (m = /^\/git\/commits\/([0-9a-f]+)$/.exec(rest))) {
      const c = this.commits.get(m[1]);
      return c ? json(200, { sha: m[1], tree: { sha: c.tree } }) : notFound();
    }
    if (method === 'GET' && (m = /^\/git\/trees\/([0-9a-f]+)$/.exec(rest))) {
      if (!this.trees.has(m[1])) return notFound();
      const recursive = url.searchParams.get('recursive') === '1';
      return json(200, { sha: m[1], tree: recursive ? this.recursive(m[1]) : this.trees.get(m[1]), truncated: false });
    }
    if (method === 'GET' && (m = /^\/git\/blobs\/([0-9a-f]+)$/.exec(rest))) {
      const bytes = this.blobs.get(m[1]);
      return bytes ? json(200, { sha: m[1], content: Buffer.from(bytes).toString('base64'), encoding: 'base64' }) : notFound();
    }
    if (method === 'POST' && rest === '/git/blobs') {
      return json(201, { sha: this.putBlob(Buffer.from(body.content, 'base64')) });
    }
    if (method === 'POST' && rest === '/git/trees') {
      const flat = body.base_tree ? this.flat(body.base_tree) : new Map<string, string>();
      for (const e of body.tree) {
        if (e.sha === null) flat.delete(e.path);
        else flat.set(e.path, e.sha);
      }
      return json(201, { sha: this.build(flat) });
    }
    if (method === 'POST' && rest === '/git/commits') {
      return json(201, { sha: this.commit(body.tree, body.parents, body.message, body.author) });
    }
    return notFound();
  }
}

// ---------- running it ----------

async function run(tree: string, fake: FakeGitHub, env: Record<string, string>, now: string, extra: { dryRun?: boolean; sleep?: (ms: number) => Promise<void> } = {}) {
  const logs: string[] = [];
  const [result] = await archiveTrees([tree], { env: (n) => env[n] || undefined, now: new Date(now), log: (m) => logs.push(m) }, {
    fetch: fake.fetch,
    sleep: extra.sleep ?? noSleep,
    dryRun: extra.dryRun,
  });
  return { result, logs, text: logs.join('\n') };
}

const SEED = { 'README.md': 'the family\n', 'other/keep.txt': 'untouched\n' };

// ---------- the flow ----------

test('the first night commits the archive; the same data on a later night writes nothing', async () => {
  const tree = family([
    { id: 'ada', given: 'Ada', born: '1950' },
    { id: 'grace', given: 'Grace', born: '1906' },
  ]);
  const fake = new FakeGitHub();
  fake.seed({ ...SEED, 'archive/old.md': 'stale\n' });
  const env = settings(tree);

  const first = await run(tree, fake, env, '2026-11-08T03:00:00Z');
  assert.equal(first.result.status, 'committed', first.text);
  assert.deepEqual(first.result.changes!.removed, ['old.md']);

  const files = fake.files();
  assert.ok(files.has(`archive/${tree}.ged`));
  assert.ok(files.has('archive/people/ada.md'));
  assert.ok(files.has('archive/people/grace.md'));
  assert.ok(files.has(`archive/${MARKER}`));
  assert.equal(files.has('archive/old.md'), false);
  assert.equal(files.get('README.md'), SEED['README.md'], 'nothing outside the folder is rewritten');
  assert.equal(files.get('other/keep.txt'), SEED['other/keep.txt']);

  const commit = fake.commits.get(fake.head())!;
  assert.equal(commit.message.split('\n')[0], `archive: nightly export of ${tree}, 2026-11-08`);
  assert.equal(commit.author.name, 'Kindred');
  assert.equal(commit.author.email, 'kindred@users.noreply.github.com');

  // The same night again, then a later night with the same data: the exporters' date does not make a change.
  const writesAfterFirst = fake.writes().length;
  const again = await run(tree, fake, env, '2026-11-08T03:00:00Z');
  const later = await run(tree, fake, env, '2026-11-09T03:00:00Z');
  assert.equal(again.result.status, 'unchanged');
  assert.equal(later.result.status, 'unchanged');
  assert.equal(fake.commits.size, 2, 'the seed and one archive commit, nothing more');
  assert.equal(fake.writes().length, writesAfterFirst, 'an unchanged night makes no write request');
});

test('a changed note is written, a removed one is deleted, and nothing outside the folder moves', async () => {
  const tree = family([
    { id: 'ada', given: 'Ada', born: '1950' },
    { id: 'grace', given: 'Grace', born: '1906' },
  ]);
  const fake = new FakeGitHub();
  fake.seed(SEED);
  const env = settings(tree);
  await run(tree, fake, env, '2026-11-08T03:00:00Z');
  const before = fake.head();

  edit(tree, [
    `UPDATE person SET given = 'Ada Lovelace' WHERE id = 'ada'`,
    `DELETE FROM person WHERE id = 'grace'`,
    `INSERT INTO person (id, given, living) VALUES ('linus', 'Linus', 1)`,
  ]);
  const keep = fake.shaAt('other/keep.txt');
  const readme = fake.shaAt('README.md');
  const r = await run(tree, fake, env, '2026-11-10T03:00:00Z');

  assert.equal(r.result.status, 'committed', r.text);
  assert.deepEqual(r.result.changes!.added, ['people/linus.md']);
  assert.deepEqual(r.result.changes!.removed, ['people/grace.md']);
  assert.ok(r.result.changes!.changed.includes('people/ada.md'));
  const files = fake.files();
  assert.equal(files.has('archive/people/grace.md'), false);
  assert.match(files.get('archive/people/ada.md')!, /Ada Lovelace/);
  assert.ok(files.has('archive/people/linus.md'));
  assert.equal(fake.shaAt('other/keep.txt'), keep);
  assert.equal(fake.shaAt('README.md'), readme);
  assert.equal(fake.commits.get(fake.head())!.parents[0], before);
  assert.match(fake.commits.get(fake.head())!.message, /1 added, \d+ changed, 1 removed\./);
});

// ---------- secrets, failures and limits ----------

test('the token never reaches a log or a result, even when the failure carries it', async () => {
  const tree = family([{ id: 'ada', given: 'Ada' }]);
  const fake = new FakeGitHub();
  fake.seed(SEED);
  fake.override = (method, path) => {
    if (method === 'POST' && path.endsWith('/git/blobs')) throw new Error(`socket reset while sending Bearer ${TOKEN}`);
    return undefined;
  };
  const r = await run(tree, fake, settings(tree), '2026-11-08T03:00:00Z');

  assert.equal(r.result.status, 'failed');
  assert.match(r.logs.join('\n'), /archive failed/);
  assert.equal(r.text.includes(TOKEN), false);
  assert.equal(JSON.stringify(r.result).includes(TOKEN), false);
  assert.match(r.result.error!, /\[token\]/);
  assert.ok(fake.calls.every((c) => c.auth === `Bearer ${TOKEN}`), 'the token is sent in the Authorization header only');
  assert.equal(fake.commits.size, 1, 'no commit was made');
});

test('a family without settings is skipped quietly, and makes no request', async () => {
  const configured = family([{ id: 'ada', given: 'Ada' }]);
  const plain = family([{ id: 'grace', given: 'Grace' }]);
  const fake = new FakeGitHub();
  fake.seed(SEED);
  const env = settings(configured);
  const logs: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = fake.fetch as typeof fetch;
  try {
    await archiveJob.run({ trees: [plain, configured], now: new Date('2026-11-08T03:00:00Z'), env: (n) => env[n] || undefined, log: (m) => logs.push(m) });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(logs.filter((l) => l.startsWith(`${plain}:`)), [], 'the plain family says nothing');
  assert.ok(logs.some((l) => l.startsWith(`${configured}: committed`)), logs.join('\n'));
  assert.ok(fake.calls.every((c) => c.auth === `Bearer ${TOKEN}`), 'every request is for the configured family');
  assert.ok(fake.calls.length > 0, 'the configured family was written');
});

test('an error is caught and logged, and the next family still runs', async () => {
  const broken = family([{ id: 'ada', given: 'Ada' }]);
  const fine = family([{ id: 'grace', given: 'Grace' }]);
  const fake = new FakeGitHub();
  fake.seed(SEED);
  const env = { ...settings(broken, { [`KINDRED_ARCHIVE_${broken.toUpperCase().replace(/-/g, '_')}_BRANCH`]: 'nope' }), ...settings(fine) };
  const logs: string[] = [];
  const results = await archiveTrees([broken, fine], { env: (n) => env[n] || undefined, now: new Date('2026-11-08T03:00:00Z'), log: (m) => logs.push(m) }, {
    fetch: fake.fetch,
    sleep: noSleep,
  });

  assert.equal(results[0].status, 'failed');
  assert.match(results[0].error!, /branch "nope" was not found/);
  assert.match(logs.join('\n'), new RegExp(`${broken}: archive failed: .*branch "nope"`));
  assert.equal(results[1].status, 'committed');
});

test('a repository that is not private is refused, and nothing is written', async () => {
  const tree = family([{ id: 'ada', given: 'Ada' }]);
  const fake = new FakeGitHub();
  fake.isPrivate = false;
  fake.seed(SEED);
  const r = await run(tree, fake, settings(tree), '2026-11-08T03:00:00Z');
  assert.equal(r.result.status, 'failed');
  assert.match(r.result.error!, /not private/);
  assert.equal(fake.writes().length, 0);
});

test('a primary rate limit is logged, not retried, and nothing is written', async () => {
  const tree = family([{ id: 'ada', given: 'Ada' }]);
  const fake = new FakeGitHub();
  fake.seed(SEED);
  fake.override = (method, path) =>
    method === 'GET' && path.endsWith('/git/ref/heads/main')
      ? new Response(JSON.stringify({ message: 'API rate limit exceeded' }), { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1793000000' } })
      : undefined;
  const r = await run(tree, fake, settings(tree), '2026-11-08T03:00:00Z');
  assert.equal(r.result.status, 'failed');
  assert.match(r.result.error!, /rate limit is used up/);
  assert.equal(fake.calls.filter((c) => c.path.endsWith('/git/ref/heads/main')).length, 1, 'not retried');
  assert.equal(fake.writes().length, 0);
});

test('a secondary rate limit is waited out, and the write goes on', async () => {
  const tree = family([{ id: 'ada', given: 'Ada' }]);
  const fake = new FakeGitHub();
  fake.seed(SEED);
  let limited = false;
  fake.override = (method, path) => {
    if (method !== 'POST' || !path.endsWith('/git/blobs') || limited) return undefined;
    limited = true;
    return new Response(JSON.stringify({ message: 'You have exceeded a secondary rate limit.' }), { status: 403, headers: { 'retry-after': '7' } });
  };
  const waits: number[] = [];
  const r = await run(tree, fake, settings(tree), '2026-11-08T03:00:00Z', { sleep: async (ms) => void waits.push(ms) });
  assert.equal(r.result.status, 'committed', r.text);
  assert.ok(waits.includes(7000));
});

test('a folder that belongs to another family is refused, and nothing is deleted', async () => {
  const tree = family([{ id: 'ada', given: 'Ada' }]);
  const fake = new FakeGitHub();
  fake.seed({ ...SEED, [`archive/${MARKER}`]: 'family other-family\nexported 2026-11-01\n', 'archive/other-family.ged': 'theirs\n' });
  const r = await run(tree, fake, settings(tree), '2026-11-08T03:00:00Z');
  assert.equal(r.result.status, 'failed');
  assert.match(r.result.error!, /belongs to the family "other-family"/);
  assert.equal(fake.writes().length, 0);
  assert.equal(fake.files().get('archive/other-family.ged'), 'theirs\n');
});

test('a dry run plans the change and writes nothing', async () => {
  const tree = family([{ id: 'ada', given: 'Ada' }]);
  const fake = new FakeGitHub();
  fake.seed({ ...SEED, 'archive/old.md': 'stale\n' });
  const before = fake.head();
  const r = await run(tree, fake, settings(tree), '2026-11-08T03:00:00Z', { dryRun: true });
  assert.equal(r.result.status, 'planned');
  assert.deepEqual(r.result.changes!.removed, ['old.md']);
  assert.ok(r.result.changes!.added.includes('people/ada.md'));
  assert.equal(fake.writes().length, 0);
  assert.equal(fake.head(), before);
});

test('a branch that moves during the run is read again, and the commit goes on top of it', async () => {
  const tree = family([{ id: 'ada', given: 'Ada' }]);
  const fake = new FakeGitHub();
  fake.seed(SEED);
  let moved = false;
  fake.override = (method) => {
    if (method === 'PATCH' && !moved) {
      moved = true;
      fake.advance('elsewhere.txt', 'someone else\n');
    }
    return undefined;
  };
  const r = await run(tree, fake, settings(tree), '2026-11-08T03:00:00Z');
  assert.equal(r.result.status, 'committed', r.text);
  const head = fake.commits.get(fake.head())!;
  assert.equal(fake.commits.get(head.parents[0])!.message, 'elsewhere');
  assert.equal(fake.files().get('elsewhere.txt'), 'someone else\n');
  assert.ok(fake.files().has(`archive/${tree}.ged`));
});

// ---------- the settings ----------

test('the settings: defaults, a family id with dashes, and the mistakes that are refused', () => {
  const env = (vars: Record<string, string>) => (n: string) => vars[n];
  assert.equal(archiveConfig('realm', env({})), null, 'no settings is not a mistake');

  const ok = archiveConfig('my-family', env({ KINDRED_ARCHIVE_MY_FAMILY_REPO: 'acme/archive', KINDRED_ARCHIVE_MY_FAMILY_TOKEN: TOKEN }));
  assert.deepEqual(ok, { tree: 'my-family', repo: { owner: 'acme', name: 'archive' }, branch: 'main', folder: 'archive', token: TOKEN });

  const base = { KINDRED_ARCHIVE_X_REPO: 'acme/archive', KINDRED_ARCHIVE_X_TOKEN: TOKEN };
  assert.throws(() => archiveConfig('x', env({ KINDRED_ARCHIVE_X_REPO: 'acme/archive' })), /set both/);
  assert.throws(() => archiveConfig('x', env({ ...base, KINDRED_ARCHIVE_X_REPO: 'acme' })), /owner\/name/);
  assert.throws(() => archiveConfig('x', env({ ...base, KINDRED_ARCHIVE_X_PATH: '/' })), /folder inside the repository/);
  assert.throws(() => archiveConfig('x', env({ ...base, KINDRED_ARCHIVE_X_PATH: '../secrets' })), /folder inside the repository/);
  assert.throws(() => archiveConfig('x', env({ ...base, KINDRED_ARCHIVE_X_PATH: '.github' })), /folder inside the repository/);
  assert.throws(() => archiveConfig('x', env({ ...base, KINDRED_ARCHIVE_X_BRANCH: 'a..b' })), /not a branch name/);
  assert.equal(archiveConfig('x', env({ ...base, KINDRED_ARCHIVE_X_PATH: '/family/archive/' }))!.folder, 'family/archive');
});
