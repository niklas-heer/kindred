// The Worker smoke test (mise run smoke:worker): builds the Worker into a scratch folder, applies the migrations to
// its local D1 databases and starts it with `wrangler dev --local` (workerd, local D1 and R2) on an empty state folder.
// Then it checks what a deployment must do and stops the Worker again. Nothing here reaches Cloudflare: the build,
// the local databases and the dev server run on this machine, the Cloudflare credentials are removed from their
// environment, and the proxy variables point at a closed port, so any request to the network fails rather than leaves.
// The checks cover the failure that took the whole site down on Cloudflare (every route answered 500, while the type
// check, the tests and the build all passed), so they go beyond the health check:
//   /api/health        200, "ok", with the security headers
//   /                  a redirect to /setup while no account exists
//   /setup             200 HTML, every inline script carrying the Content-Security-Policy nonce; /signin redirects to /setup while no account exists
//   POST /api/auth/signout from another site   403, refused by the CSRF check
//   POST /api/auth/signout from this site      not 403 (the control: the check refuses cross-site only)
//   POST /api/ai-chat/<family>                 403 cross-site, 401 signed out; signed in (a session and a family written into
//                                              the local D1, the fake AI provider) it streams a reply in pieces and stores it,
//                                              and a reply cut off mid-way frees its chat for the next message
// Exit status 0 when every check passes; 1 otherwise, with the Worker's own log tail on stderr. WORKER_SMOKE_LOG=1 prints
// that log tail even when everything passes.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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
    const policy = setup.headers.get('content-security-policy-report-only') ?? '';
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

  } finally {
    await stop(child, port).catch((e: Error) => {
      failures.push(e.message);
      console.error(e.message);
    });
    if (failures.length || process.env.WORKER_SMOKE_LOG) console.error(`\nthe Worker's log (last part):\n${log.join('').slice(-3000)}`);
  }
  return failures.length === 0;
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
