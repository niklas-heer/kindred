// The Worker smoke test (mise run smoke:worker): builds the Worker into a scratch folder, applies the migrations to
// its local D1 databases and starts it with `wrangler dev --local` (workerd, local D1 and R2) on an empty state folder.
// Then it checks what a deployment must do and stops the Worker again. Nothing here reaches Cloudflare: the build,
// the local databases and the dev server run on this machine, the Cloudflare credentials are removed from their
// environment, and the proxy variables point at a closed port, so any request to the network fails rather than leaves.
// The checks cover the failure that took the whole site down on Cloudflare (every route answered 500, while the type
// check, the tests and the build all passed), so they go beyond the health check:
//   /api/health        200, "ok", with the security headers
//   /                  a redirect to /setup while no account exists
//   /setup             200 HTML under an enforced Content-Security-Policy, never cached, every inline script carrying its nonce; /signin redirects to /setup while no account exists
//   POST /api/auth/signout from another site   403, refused by the CSRF check
//   POST /api/auth/signout from this site      not 403 (the control: the check refuses cross-site only)
//   POST /api/ai-chat/<family>                 403 cross-site, 401 signed out; signed in (a session and a family written into
//                                              the local D1, the fake AI provider) it streams a reply in pieces and stores it,
//                                              and a reply cut off mid-way frees its chat for the next message
//   password sign-up and sign-in               with passwords turned on (the console's setting, written into the local D1), an
//                                              invitation is taken with a username and password, a wrong password and an unknown
//                                              username get the same answer, and the right one signs in with a new session each
//                                              time; the times are printed (the hash is 600,000 PBKDF2 iterations on workerd)
// Then the same Worker again with KINDRED_DEMO=1 (a public demo, src/lib/demo.ts), on the databases the checks above filled:
//   /                  opens the one family; /setup and /signin go back to /
//   /<family>          200 HTML with the demo's bar, the same Content-Security-Policy and no-store, and no cookie set
//   POST /api/auth/signin-options              refused with the demo's 403 (the store refuses the write it needs)
//   POST /api/ai-chat/<family>                 no reply, even with a steward's session and the AI set up
// Then the first Worker again, on the same state, for scripts/import-to-do.ts end to end: an invented family from a file, sent
// as that steward into a new Durable Object family, is published at the end and served, with them its steward; a second import
// of the same id is refused.
// Then the same build once more with no D1 database at all, as a new install (and the Deploy button) has it: the families
// and the accounts in Durable Objects (src/lib/store/durable.ts), on an empty state folder:
//   /api/health        200
//   /                  a redirect to /setup: the accounts Durable Object made itself and migrated, and no family is listed
//   /setup             200 HTML
// Exit status 0 when every check passes; 1 otherwise, with the Worker's own log tail on stderr. WORKER_SMOKE_LOG=1 prints
// that log tail even when everything passes.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { offlineEnv, wranglerBindings } from './lib/wrangler.ts';

const root = join(import.meta.dirname, '..');
process.chdir(root); // wrangler.jsonc and the migrations are read relative to the repository
const work = mkdtempSync(join(tmpdir(), 'kindred-worker-smoke-'));
const built = join(work, 'dist');
const state = join(work, 'state');
// The project's own tools, by path: the scratch folder has no node_modules, and `npx` there would download a copy.
const wranglerBin = join(root, 'node_modules/wrangler/bin/wrangler.js');
const viteBin = join(root, 'node_modules/vite/bin/vite.js');

/** The environment for every child: no Cloudflare credentials, no telemetry, and no route to the network. */
const childEnv = offlineEnv;

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

function run(args: string[], label: string) {
  const r = spawnSync(process.execPath, [wranglerBin, ...args], { cwd: root, env: childEnv(), encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${label} failed (exit ${r.status}):\n${(r.stdout ?? '').slice(-2000)}\n${(r.stderr ?? '').slice(-2000)}`);
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => resolve(port));
    });
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const SMOKE_SECRET = 'worker-smoke-secret';

/** A provider key sealed as src/lib/ai/secret.server.ts seals one (v2), under the secret this Worker is started with. */
async function sealedKey(tree: string, provider: string, key: string): Promise<string> {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(SMOKE_SECRET), 'HKDF', false, ['deriveKey']);
  const aes = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('kindred-ai-keys/v1'), info: enc.encode(`tree:${tree}|provider:${provider}`) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, enc.encode(key)));
  return `v2.${Buffer.from(iv).toString('base64')}.${Buffer.from(ct).toString('base64')}`;
}

const sqlText = (s: string) => `'${s.replaceAll("'", "''")}'`;

/** Writes a reader, a family and its AI setup straight into the local databases, once the checks for "no account yet" are done. Returns the session cookie. */
async function seedSignedInReader(state: string, tree: string, conv: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(`kindred:session:${token}`).digest('base64url');
  const now = Date.now();
  const execute = (db: string, sql: string) => run(['d1', 'execute', db, '--local', '--env', 'local', '--persist-to', state, '--command', sql], `seeding ${db}`);
  execute('kindred-local-accounts', [
    `INSERT INTO user (id, name, handle, created) VALUES ('smoke', 'Smoke', 'smoke-handle', ${now})`,
    `INSERT INTO session (hash, user, created, expires, refreshed) VALUES (${sqlText(hash)}, 'smoke', ${now}, ${now + 3_600_000}, ${now})`,
    `INSERT INTO membership (user, tree, role, created) VALUES ('smoke', ${sqlText(tree)}, 'steward', ${now})`,
    `INSERT INTO ai_settings (tree, features, web_search, monthly_micros, custom_prices, updated, updated_by) VALUES (${sqlText(tree)}, '{"assistant":true}', 0, 5000000, '{}', ${now}, 'smoke')`,
    `INSERT INTO ai_provider (tree, provider, key_sealed, key_tail, updated, updated_by) VALUES (${sqlText(tree)}, 'anthropic', ${sqlText(await sealedKey(tree, 'anthropic', 'sk-smoke-never-sent'))}, 'sent', ${now}, 'smoke')`,
    `INSERT INTO ai_route (tree, route, provider, model, updated) VALUES (${sqlText(tree)}, 'assistant', 'anthropic', 'claude-haiku-4-5', ${now})`,
    `INSERT INTO ai_thread (tree, user, conv, created, updated) VALUES (${sqlText(tree)}, 'smoke', ${sqlText(conv)}, ${now}, ${now})`,
  ].join('; '));
  execute(`kindred-local-${tree}`, `INSERT INTO meta (key, value) VALUES ('id', ${sqlText(tree)}), ('name', 'Smoke'), ('tagline', ''), ('theme', 'codex'), ('focus', 'a'); INSERT INTO person (id, given, surname) VALUES ('a', 'Ada', 'Example')`);
  return `kindred_session=${token}`;
}

/** Each `data:` event of a stream; `stopAfter` cuts the connection after that many, as a reader's Stop does. */
async function chatEvents(res: Response, ac?: AbortController, stopAfter?: number): Promise<any[]> {
  const out: any[] = [];
  const decoder = new TextDecoder();
  let buffer = '';
  const reader = res.body!.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (let i = buffer.indexOf('\n\n'); i >= 0; i = buffer.indexOf('\n\n')) {
        const part = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (part.startsWith('data: ')) out.push(JSON.parse(part.slice(6)));
      }
      if (stopAfter !== undefined && out.length >= stopAfter) {
        ac?.abort();
        return out;
      }
    }
  } catch (e) {
    if (!ac?.signal.aborted) throw e;
  }
  return out;
}

/** Stops the dev server and everything it started (its process group), then waits until the port is closed. */
async function stop(child: ChildProcess | undefined, port: number) {
  if (child?.pid && child.exitCode === null) {
    try { process.kill(-child.pid, 'SIGINT'); } catch {}
    const exited = await Promise.race([new Promise((resolve) => child.once('exit', resolve)), sleep(10_000).then(() => false)]);
    if (exited === false) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }
  }
  for (let i = 0; i < 50; i++) {
    const open = await fetch(`http://127.0.0.1:${port}/api/health`).then(() => true, () => false);
    if (!open) return;
    await sleep(200);
  }
  throw new Error(`the Worker is still answering on port ${port} after it was stopped`);
}

/** The steward's session the checks above wrote, for the import check after the demo. */
let stewardCookie = '';

async function main(): Promise<boolean> {
  // 1. Build the Worker (the Cloudflare plugin's output: dist/server/index.js, its wrangler.json, dist/client).
  const build = spawnSync(process.execPath, [viteBin, 'build', '--outDir', built], { cwd: root, env: { ...childEnv(), CLOUDFLARE_ENV: 'local' }, encoding: 'utf8' });
  if (build.status !== 0) throw new Error(`vite build failed (exit ${build.status}):\n${build.stdout.slice(-2000)}\n${build.stderr.slice(-2000)}`);
  const config = join(built, 'server', 'wrangler.json');
  if (!existsSync(config) || !existsSync(join(built, 'server', 'index.js'))) throw new Error('the build did not produce dist/server/index.js and its wrangler.json');
  console.log('built the Worker into a scratch folder');

  // 2. Empty local state: every local D1 database of the `local` environment gets the migrations, as `cf:migrate` does.
  mkdirSync(state, { recursive: true });
  for (const db of wranglerBindings('local').d1) {
    if (!db.migrations_dir) continue;
    run(['d1', 'migrations', 'apply', db.database_name, '--local', '--env', 'local', '--persist-to', state], `migrations for ${db.database_name}`);
  }
  console.log('applied the migrations to empty local D1 databases');

  // 3. Start the Worker on a free local port.
  const port = await freePort();
  const log: string[] = [];
  const child = spawn(process.execPath, [wranglerBin, 'dev', '-c', config, '--local', '--persist-to', state, '--ip', '127.0.0.1', '--port', String(port), '--log-level', 'info', '--var', 'KINDRED_AI_FAKE:1', '--var', `KINDRED_SECRET:${SMOKE_SECRET}`], {
    cwd: work,
    env: childEnv(),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const collect = (chunk: Buffer) => log.push(chunk.toString());
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);

  try {
    // 4. Wait until it answers, or fail with its log.
    const deadline = Date.now() + 90_000;
    let up = false;
    while (!up && Date.now() < deadline) {
      if (child.exitCode !== null) break;
      up = await fetch(`http://127.0.0.1:${port}/api/health`).then((r) => r.status === 200, () => false);
      if (!up) await sleep(500);
    }
    if (!up) throw new Error(`the Worker did not answer on port ${port}:\n${log.join('').slice(-3000)}`);
    console.log(`the Worker answers on 127.0.0.1:${port}`);

    // 5. The checks.
    const health = await fetch(`http://127.0.0.1:${port}/api/health`, { redirect: 'manual' });
    check(health.status === 200 && (await health.text()).trim() === 'ok', '/api/health answers 200 "ok"');
    check(health.headers.get('x-frame-options') === 'DENY', 'security header X-Frame-Options: DENY');
    check(health.headers.get('x-content-type-options') === 'nosniff', 'security header X-Content-Type-Options: nosniff');
    check(health.headers.get('referrer-policy') === 'strict-origin-when-cross-origin', 'security header Referrer-Policy');

    const home = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual' });
    await home.body?.cancel();
    check([301, 302, 307, 308].includes(home.status) && (home.headers.get('location') ?? '').endsWith('/setup'), `/ redirects to /setup while no account exists (got ${home.status})`);

    // /setup renders; /signin has no account to sign in to yet, so it sends the visitor to /setup (both are page renders).
    const setup = await fetch(`http://127.0.0.1:${port}/setup`, { redirect: 'manual' });
    const setupType = setup.headers.get('content-type') ?? '';
    const setupHtml = await setup.text();
    check(setup.status === 200 && setupType.startsWith('text/html'), `/setup renders (200 text/html, got ${setup.status} ${setupType.split(';')[0]})`);
    // The policy's nonce has to reach the inline scripts on Workers too, or the page would stop working once it is enforced.
    const policy = setup.headers.get('content-security-policy') ?? '';
    check(setup.headers.get('content-security-policy-report-only') === null && /script-src 'self' 'nonce-/.test(policy), '/setup sends an enforced Content-Security-Policy');
    check(setup.headers.get('cache-control') === 'private, no-store', `/setup is never stored by a cache (got ${setup.headers.get('cache-control')})`);
    check(setup.headers.get('cross-origin-opener-policy') === 'same-origin' && !!setup.headers.get('permissions-policy'), '/setup sends Cross-Origin-Opener-Policy and Permissions-Policy');
    const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
    const inlineScripts = [...setupHtml.matchAll(/<script\b([^>]*)>/g)].filter(([, attrs]) => !/\bsrc=/.test(attrs));
    check(!!nonce && inlineScripts.length > 0 && inlineScripts.every(([, attrs]) => attrs.includes(`nonce="${nonce}"`)), `every inline script on /setup carries the policy's nonce (${inlineScripts.length} scripts)`);
    const signin = await fetch(`http://127.0.0.1:${port}/signin`, { redirect: 'manual' });
    await signin.body?.cancel();
    check([301, 302, 307, 308].includes(signin.status) && (signin.headers.get('location') ?? '').endsWith('/setup'), `/signin sends a visitor with no account to /setup (got ${signin.status})`);

    const signout = (site: string) =>
      fetch(`http://127.0.0.1:${port}/api/auth/signout`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': site, Origin: site === 'cross-site' ? 'https://elsewhere.invalid' : `http://127.0.0.1:${port}` },
        body: '{}',
      });
    const cross = await signout('cross-site');
    const crossBody = await cross.text();
    check(cross.status === 403 && crossBody.includes('another site'), `a cross-site POST is refused with 403 (got ${cross.status})`);
    const same = await signout('same-origin');
    await same.body?.cancel();
    check(same.status !== 403, `a same-site POST is not refused by the CSRF check (got ${same.status})`);

    // The streaming chat route: the same refusals as any write, then a real streamed reply on workerd.
    const tree = 'modern';
    const conv = randomUUID();
    const chatUrl = `http://127.0.0.1:${port}/api/ai-chat/${tree}`;
    const say = (body: object, headers: Record<string, string> = {}, signal?: AbortSignal) => fetch(chatUrl, { method: 'POST', redirect: 'manual', signal, headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', Origin: `http://127.0.0.1:${port}`, ...headers }, body: JSON.stringify(body) });
    const message = (text: string) => ({ kind: 'message', conv, turnId: randomUUID(), text, locale: 'en' });
    const crossChat = await say(message('hello'), { 'Sec-Fetch-Site': 'cross-site', Origin: 'https://elsewhere.invalid' });
    await crossChat.body?.cancel();
    check(crossChat.status === 403, `a cross-site chat message is refused with 403 (got ${crossChat.status})`);
    const anon = await say(message('hello'));
    await anon.body?.cancel();
    check(anon.status === 401, `a signed-out chat message is refused with 401 (got ${anon.status})`);

    const cookie = await seedSignedInReader(state, tree, conv);
    const streamed = await say(message('Hello from the smoke test, a reply long enough to arrive in pieces'), { Cookie: cookie });
    check(streamed.status === 200 && (streamed.headers.get('content-type') ?? '').startsWith('text/event-stream'), `the chat route streams (got ${streamed.status} ${streamed.headers.get('content-type')})`);
    const events = await chatEvents(streamed);
    const pieces = events.filter((e) => e.type === 'delta');
    const last = events.at(-1);
    check(pieces.length > 1, `the reply arrives in pieces (${pieces.length})`);
    check(last?.type === 'done' && last.items?.[1]?.text === pieces.map((e) => e.text).join(''), `the pieces add up to the stored reply (last event: ${JSON.stringify(last)?.slice(0, 120)})`);

    // A reply cut off part way ends on the server too: the chat is free for the next message, well before its lease would run out.
    const ac = new AbortController();
    const slow = await say(message('FAKE-SLOW a reply that is stopped part way through'), { Cookie: cookie }, ac.signal);
    await chatEvents(slow, ac, 1);
    let freed = false;
    for (let i = 0; i < 20 && !freed; i++) {
      await sleep(250);
      const next = await say(message('the next message'), { Cookie: cookie });
      const after = await chatEvents(next);
      freed = after.at(-1)?.type === 'done';
    }
    check(freed, 'a stopped reply frees its chat for the next message');

    stewardCookie = cookie;

    await passwordChecks(state, port);

  } finally {
    await stop(child, port).catch((e: Error) => {
      failures.push(e.message);
      console.error(e.message);
    });
    if (failures.length || process.env.WORKER_SMOKE_LOG) console.error(`\nthe Worker's log (last part):\n${log.join('').slice(-3000)}`);
  }
  await demoChecks(config, 'modern');
  // After the demo, which expects the one family: the import adds another.
  if (stewardCookie) await importChecks(config, stewardCookie);
  await durableChecks(config);
  return failures.length === 0;
}

/**
 * Username and password on workerd (src/lib/auth/password.server.ts): turns passwords on as the console would, takes an invitation
 * with a password, then signs in. Prints how long each answer took, which is mostly the 600,000-iteration hash.
 */
async function passwordChecks(state: string, port: number) {
  const execute = (sql: string) => run(['d1', 'execute', 'kindred-local-accounts', '--local', '--env', 'local', '--persist-to', state, '--command', sql], 'seeding the password check');
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(`kindred:invite:${token}`).digest('base64url');
  const now = Date.now();
  execute([
    `INSERT INTO instance_setting (key, value, updated_at) VALUES ('auth_methods', '["passkey","password"]', ${now}) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    `INSERT INTO invite (id, hash, tree, role, expires, created) VALUES ('${randomUUID()}', ${sqlText(hash)}, 'modern', 'viewer', ${now + 3_600_000}, ${now})`,
  ].join('; '));
  const post = async (action: string, body: object) => {
    const t = performance.now();
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/${action}`, {
      method: 'POST', redirect: 'manual', body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', Origin: `http://127.0.0.1:${port}` },
    });
    const ms = performance.now() - t;
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    return { status: res.status, json, ms, cookie: /kindred_session=([^;]*)/.exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '' };
  };
  const password = 'a smoke test evening by the river';
  const joined = await post('password-invite', { token, name: 'Smoke Password', username: 'smoke.pw', password });
  check(joined.status === 200 && joined.cookie.length === 43, `an invitation is taken with a username and password on workerd (got ${joined.status} ${joined.json.error ?? ''}, ${joined.ms.toFixed(0)} ms)`);
  const wrong = await post('password-signin', { username: 'smoke.pw', password: 'not the right password' });
  const unknown = await post('password-signin', { username: 'nobody.here', password: 'not the right password' });
  check(wrong.status === 400 && unknown.status === 400 && wrong.json.error === 'pw.err.wrong' && unknown.json.error === wrong.json.error,
    `a wrong password and an unknown username get the same answer (${wrong.json.error} / ${unknown.json.error})`);
  const signIns = [];
  for (let i = 0; i < 3; i++) signIns.push(await post('password-signin', { username: 'SMOKE.PW', password }));
  check(signIns.every((r) => r.status === 200 && r.cookie.length === 43), `the right password signs in (got ${signIns.map((r) => r.status).join(', ')})`);
  check(new Set(signIns.map((r) => r.cookie)).size === signIns.length, 'every sign-in is a new session');
  const ms = signIns.map((r) => r.ms).sort((a, b) => a - b);
  console.log(`     password timings on workerd: sign-in ${ms.map((m) => m.toFixed(0)).join(' / ')} ms, wrong password ${wrong.ms.toFixed(0)} ms, unknown username ${unknown.ms.toFixed(0)} ms, sign-up ${joined.ms.toFixed(0)} ms`);
}

/** Waits until a dev server answers its health check, or throws with its log. */
async function waitUp(child: ChildProcess, port: number, log: string[], what: string) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    if (await fetch(`http://127.0.0.1:${port}/api/health`).then((r) => r.status === 200, () => false)) return;
    await sleep(500);
  }
  throw new Error(`${what} did not answer on port ${port}:\n${log.join('').slice(-3000)}`);
}

/** scripts/import-to-do.ts end to end, on the state the checks above left, as their steward (a new family in a Durable Object). */
async function importChecks(config: string, cookie: string) {
  const port = await freePort();
  const log: string[] = [];
  const child = spawn(process.execPath, [wranglerBin, 'dev', '-c', config, '--local', '--persist-to', state, '--ip', '127.0.0.1', '--port', String(port), '--log-level', 'info', '--var', 'KINDRED_AI_FAKE:1', '--var', `KINDRED_SECRET:${SMOKE_SECRET}`], {
    cwd: work, env: childEnv(), detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const collect = (chunk: Buffer) => log.push(chunk.toString());
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);
  const base = `http://127.0.0.1:${port}`;
  const failedBefore = failures.length;
  try {
    await waitUp(child, port, log, 'the Worker for the import');
    // scripts/import-to-do.ts, end to end: an invented family from a file into a new Durable Object family, as the steward.
    const importId = 'smoke-import';
    const source = join(work, 'import-source', `${importId}.db`);
    const { openSqlite } = await import('../src/lib/store/node.ts');
    const src = openSqlite(source, 'tree', { create: true });
    src.exec(`INSERT INTO meta (key, value) VALUES ('id', '${importId}'), ('name', 'The Importers'), ('tagline', ''), ('theme', 'codex'), ('focus', 'i1');
      INSERT INTO person (id, given, surname) VALUES ('i1', 'Ida', 'Importer'), ('i2', 'Ivo', 'Importer');
      INSERT INTO parent (child, parent) VALUES ('i2', 'i1');`);
    src.close();
    const importRun = (extra: string[] = []) => spawnSync(process.execPath, [join(root, 'scripts/import-to-do.ts'), importId, '--from', source, '--url', `${base}`, '--env', 'local', ...extra], {
      cwd: root, env: { ...childEnv(), KINDRED_SESSION: cookie.split('=')[1]!, NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1' }, encoding: 'utf8',
    });
    const imported = importRun();
    check(imported.status === 0 && /the import is published/.test(imported.stdout), `scripts/import-to-do.ts imports a family from a file (exit ${imported.status}: ${(imported.stdout + imported.stderr).trim().split('\n').slice(-2).join(' / ').slice(0, 300)})`);
    const page = await fetch(`${base}/${importId}`, { redirect: 'manual', headers: { Cookie: cookie } });
    const pageHtml = await page.text();
    check(page.status === 200 && pageHtml.includes('The Importers'), `the imported family is served to its new steward (got ${page.status})`);
    const again = importRun();
    check(again.status !== 0 && /a family on this server already/.test(again.stderr), `a second import of a family that is served is refused (exit ${again.status})`);
  } catch (e) {
    failures.push(e instanceof Error ? e.message : String(e));
    console.error(e);
  } finally {
    await stop(child, port).catch((e: Error) => {
      failures.push(e.message);
      console.error(e.message);
    });
    if (failures.length > failedBefore || process.env.WORKER_SMOKE_LOG) console.error(`\nthe import Worker's log (last part):\n${log.join('').slice(-3000)}`);
  }
}

/** The same build with no D1 at all: the families and the accounts in Durable Objects, on empty state (a new install). */
async function durableChecks(config: string) {
  const durableConfig = join(built, 'server', 'wrangler.durable.json');
  const c = JSON.parse(readFileSync(config, 'utf8')) as Record<string, unknown>;
  delete c.d1_databases;
  writeFileSync(durableConfig, JSON.stringify(c));
  const durableState = join(work, 'durable-state');
  const port = await freePort();
  const log: string[] = [];
  const child = spawn(process.execPath, [wranglerBin, 'dev', '-c', durableConfig, '--local', '--persist-to', durableState, '--ip', '127.0.0.1', '--port', String(port), '--log-level', 'info', '--var', 'KINDRED_AI_FAKE:1', '--var', `KINDRED_SECRET:${SMOKE_SECRET}`], {
    cwd: work, env: childEnv(), detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const collect = (chunk: Buffer) => log.push(chunk.toString());
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);
  const base = `http://127.0.0.1:${port}`;
  const failedBefore = failures.length;
  try {
    await waitUp(child, port, log, 'the Durable Objects Worker');
    const health = await fetch(`${base}/api/health`);
    check(health.status === 200 && (await health.text()).trim() === 'ok', 'durable objects: /api/health answers 200 "ok"');
    const home = await fetch(`${base}/`, { redirect: 'manual' });
    await home.body?.cancel();
    check([301, 302, 307, 308].includes(home.status) && (home.headers.get('location') ?? '').endsWith('/setup'), `durable objects: / redirects to /setup on a new install (got ${home.status} ${home.headers.get('location')})`);
    const setup = await fetch(`${base}/setup`, { redirect: 'manual' });
    const setupHtml = await setup.text();
    check(setup.status === 200 && (setup.headers.get('content-type') ?? '').startsWith('text/html') && !/no ACCOUNTS database|no tree/i.test(setupHtml), `durable objects: /setup renders (got ${setup.status})`);
  } catch (e) {
    failures.push(e instanceof Error ? e.message : String(e));
    console.error(e);
  } finally {
    await stop(child, port).catch((e: Error) => {
      failures.push(e.message);
      console.error(e.message);
    });
    if (failures.length > failedBefore || process.env.WORKER_SMOKE_LOG) console.error(`\nthe Durable Objects Worker's log (last part):\n${log.join('').slice(-3000)}`);
  }
}

/** The same Worker as a public demo (KINDRED_DEMO=1), on the state the checks above left: a family, a steward and their AI. */
async function demoChecks(config: string, tree: string) {
  const port = await freePort();
  const log: string[] = [];
  const child = spawn(process.execPath, [wranglerBin, 'dev', '-c', config, '--local', '--persist-to', state, '--ip', '127.0.0.1', '--port', String(port), '--log-level', 'info', '--var', 'KINDRED_DEMO:1', '--var', 'KINDRED_AI_FAKE:1', '--var', `KINDRED_SECRET:${SMOKE_SECRET}`], {
    cwd: work, env: childEnv(), detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const collect = (chunk: Buffer) => log.push(chunk.toString());
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);
  const base = `http://127.0.0.1:${port}`;
  const failedBefore = failures.length;
  try {
    const deadline = Date.now() + 90_000;
    let up = false;
    while (!up && Date.now() < deadline) {
      if (child.exitCode !== null) break;
      up = await fetch(`${base}/api/health`).then((r) => r.status === 200, () => false);
      if (!up) await sleep(500);
    }
    if (!up) throw new Error(`the demo Worker did not answer on port ${port}:\n${log.join('').slice(-3000)}`);

    const home = await fetch(`${base}/`, { redirect: 'manual' });
    await home.body?.cancel();
    check([301, 302, 307, 308].includes(home.status) && (home.headers.get('location') ?? '').endsWith(`/${tree}`), `demo: / opens the one family (got ${home.status} ${home.headers.get('location')})`);
    for (const path of ['/setup', '/signin']) {
      const r = await fetch(`${base}${path}`, { redirect: 'manual' });
      await r.body?.cancel();
      check([301, 302, 307, 308].includes(r.status) && new URL(r.headers.get('location') ?? '/x', base).pathname === '/', `demo: ${path} goes back to / (got ${r.status})`);
    }
    const page = await fetch(`${base}/${tree}`, { redirect: 'manual' });
    const html = await page.text();
    check(page.status === 200 && html.includes('class="demo-bar"') && html.includes('data-demo=""'), `demo: /${tree} renders with the demo's bar (got ${page.status})`);
    check(/script-src 'self' 'nonce-/.test(page.headers.get('content-security-policy') ?? '') && page.headers.get('cache-control') === 'private, no-store', 'demo: the page keeps its Content-Security-Policy and no-store');
    check(page.headers.get('set-cookie') === null, 'demo: no cookie is set');

    // Today, with the family's feed: its page of reads runs on D1 (one batch over posts, stories, media, history and the
    // Campaign's seasons of old), and a demo's visitor is told why they cannot write.
    const today = await fetch(`${base}/${tree}/today`, { redirect: 'manual' });
    const todayHtml = await today.text();
    check(today.status === 200 && todayHtml.includes('From the family'), `demo: /${tree}/today renders with the feed (got ${today.status})`);
    check(!todayHtml.includes('could not be loaded') && (todayHtml.includes('It is quiet here, for now') || todayHtml.includes('chr-item') || todayHtml.includes('fd-quiet')), 'demo: the feed was read from D1 (its entries, or its empty state)');
    check(todayHtml.includes('This is a demo, so nothing can be changed or saved here.') && !todayHtml.includes('fd-compose-prompt'), 'demo: the feed offers nothing to write with, and says why');

    const post = (path: string, body: object, headers: Record<string, string> = {}) =>
      fetch(`${base}${path}`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', Origin: base, ...headers }, body: JSON.stringify(body) });
    const signin = await post('/api/auth/signin-options', {});
    const refusal = await signin.text();
    check(signin.status === 403 && refusal.includes('This is a demo'), `demo: a write is refused with the demo's 403 (got ${signin.status} ${refusal.slice(0, 80)})`);
    // The steward's session from above is not looked at, and the family's AI is off in a demo.
    const chat = await post(`/api/ai-chat/${tree}`, { kind: 'message', conv: randomUUID(), turnId: randomUUID(), text: 'hello', locale: 'en' }, { Cookie: `kindred_session=${'a'.repeat(43)}` });
    const chatBody = await chat.text();
    check(!chatBody.includes('"type":"delta"'), `demo: the assistant sends no reply (got ${chat.status})`);
  } catch (e) {
    failures.push(e instanceof Error ? e.message : String(e));
    console.error(e);
  } finally {
    await stop(child, port).catch((e: Error) => {
      failures.push(e.message);
      console.error(e.message);
    });
    if (failures.length > failedBefore || process.env.WORKER_SMOKE_LOG) console.error(`\nthe demo Worker's log (last part):\n${log.join('').slice(-3000)}`);
  }
}

try {
  const ok = await main();
  console.log(ok ? '\nworker smoke: all checks passed' : `\nworker smoke: ${failures.length} check(s) failed`);
  process.exitCode = ok ? 0 : 1;
} catch (e) {
  console.error(`worker smoke: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
