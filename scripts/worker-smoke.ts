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
// Exit status 0 when every check passes; 1 otherwise, with the Worker's own log tail on stderr. WORKER_SMOKE_LOG=1 prints
// that log tail even when everything passes.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
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
  const child = spawn(process.execPath, [wranglerBin, 'dev', '-c', config, '--local', '--persist-to', state, '--ip', '127.0.0.1', '--port', String(port), '--log-level', 'info'], {
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
