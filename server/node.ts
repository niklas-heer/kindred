// The production server for the Node target. Build it with `mise run build:node` (npm run build:node), then
// run it with `mise run start` (npm start). It serves the built client (dist/client) and passes every other
// request to the server bundle (dist/server). Settings are environment variables (docs/self-host.md):
//   PORT              4901
//   HOST              127.0.0.1 (use 0.0.0.0 to accept connections from other machines; the Docker image does)
//   KINDRED_ORIGIN    the public address, e.g. https://family.example.org (passkeys and cookies depend on it)
//   KINDRED_DATA_DIR  the families, media, accounts and secret (default: data/ in this folder)
//   KINDRED_JOBS      the daily jobs (reminders) run at 06:00 UTC; "off" turns them off
//   NODE_ENV          production, unless set otherwise
//   KINDRED_TRUSTED_PROXIES  how many reverse proxies stand in front (Caddy alone: 1), so rate limits count each visitor
// SIGTERM and SIGINT stop new connections, let requests in progress finish, close the SQLite files and exit.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { serve } from 'srvx/node';
import { scheduleDailyJobs } from './jobs.ts';
import { compressResponse } from './compress.ts';
import { staticResponse } from './static.ts';

// This is the production server: without NODE_ENV, React would load its development build, which is about 10% slower
// to render and warns in the log. Set before the bundle is imported below, so React reads it; a value given is kept.
if (!process.env.NODE_ENV) process.env.NODE_ENV = 'production';

// migrations/ and the default data/ folder resolve from the app folder, wherever this is started from.
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
process.chdir(root);

const clientDir = join(root, 'dist', 'client');
const bundle = join(root, 'dist', 'server', 'server.js');
if (!existsSync(bundle)) {
  console.error(`[kindred] no server build at ${bundle}. Run: mise run build:node`);
  process.exit(1);
}

const port = Number(process.env.PORT || 4901);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`[kindred] PORT must be a port number, not "${process.env.PORT}"`);
  process.exit(1);
}
const hostname = process.env.HOST || '127.0.0.1';

// Checked here, so a typo stops the server at start instead of failing every request.
const configuredOrigin = process.env.KINDRED_ORIGIN?.trim();
let origin: URL | undefined;
if (configuredOrigin) {
  try {
    origin = new URL(configuredOrigin);
  } catch {
    console.error(`[kindred] KINDRED_ORIGIN is not a web address: "${configuredOrigin}"`);
    process.exit(1);
  }
  if (origin.protocol !== 'https:' && !/^(localhost|127\.|\[::1\]|::1$)/.test(origin.hostname)) {
    console.warn(`[kindred] KINDRED_ORIGIN is ${origin.origin}: passkeys need https on a public address. See docs/self-host.md.`);
  }
}

// The same rule as trustedProxies() in src/lib/auth/client-address.ts, which the bundle uses (and which trusts nothing
// for a bad value); checked here so a typo stops the server at start. src/ is not in the Docker image, so not imported.
const trustedProxiesSetting = process.env.KINDRED_TRUSTED_PROXIES?.trim() ?? '';
if (trustedProxiesSetting && !/^[0-5]$/.test(trustedProxiesSetting)) {
  console.error(`[kindred] KINDRED_TRUSTED_PROXIES must be the number of reverse proxies in front of the server, 0 to 5, not "${trustedProxiesSetting}"`);
  process.exit(1);
}
const trustsProxies = Number(trustedProxiesSetting || 0) > 0;
const behindAccess = process.env.KINDRED_AUTH?.trim().toLowerCase() === 'cloudflare-access';
let warnedForwarded = false;
/** Requests that came through a proxy the server was not told about share one rate limit: say so, once. */
function noticeForwarded(req: Request) {
  if (warnedForwarded || trustsProxies || !req.headers.has('x-forwarded-for')) return;
  // Behind Cloudflare Access the limits already use Cloudflare's own header.
  if (behindAccess && req.headers.has('cf-connecting-ip')) return;
  warnedForwarded = true;
  console.warn(
    '[kindred] Requests arrive through a reverse proxy (they carry X-Forwarded-For), but KINDRED_TRUSTED_PROXIES is not set, ' +
      'so every visitor counts as the proxy and shares one rate limit for signing in and share links. Set it to the number ' +
      'of proxies in front (1 for Caddy alone). See docs/self-host.md.',
  );
}

// The server bundle registers its close function under this name (src/lib/store/node.ts).
const CLOSE_DATABASES = Symbol.for('kindred.closeDatabases');
const closeDatabases = () => (globalThis as unknown as Record<symbol, (() => void) | undefined>)[CLOSE_DATABASES]?.();

type Server = {
  fetch: (req: Request) => Response | Promise<Response>;
  runJobs?: (now: Date, env: (name: string) => string | undefined) => Promise<void>;
  startup?: () => { problem?: string; demo: boolean };
};
const { default: app } = (await import(pathToFileURL(bundle).href)) as { default: Server };

// A setting that must not run at all (a demo beside accounts or push, say: src/lib/demo.ts) stops the server here.
const startup = app.startup?.();
if (startup?.problem) {
  console.error(`[kindred] ${startup.problem} See docs/self-host.md, "A public demo".`);
  process.exit(1);
}
if (startup?.demo) console.log('[kindred] demo mode (KINDRED_DEMO=1): no sign-in, read-only, every write is refused');

const server = serve({
  port,
  hostname,
  silent: true,
  // Built files come compressed from the build; the application's answers are compressed as they stream (server/compress.ts).
  fetch: async (req: Request) => {
    noticeForwarded(req);
    return (await staticResponse(clientDir, req)) ?? compressResponse(req, await app.fetch(req));
  },
});
await server.ready();

const dataDir = process.env.KINDRED_DATA_DIR ? resolve(process.env.KINDRED_DATA_DIR) : join(root, 'data');
console.log(`[kindred] listening on http://${hostname}:${port}${origin ? ` as ${origin.origin}` : ''}; data in ${dataDir}`);

// The daily jobs (src/lib/jobs) run at 06:00 UTC, never at startup. KINDRED_JOBS=off turns them off (docs/self-host.md).
const jobsOff = process.env.KINDRED_JOBS?.trim().toLowerCase() === 'off';
const stopJobs = jobsOff || !app.runJobs
  ? undefined
  : scheduleDailyJobs((now) => app.runJobs!(now, (name) => process.env[name]?.trim() || undefined));
console.log(stopJobs ? '[kindred] daily jobs run at 06:00 UTC' : '[kindred] daily jobs are off (KINDRED_JOBS=off)');

let stopping = false;
async function shutdown(signal: NodeJS.Signals) {
  if (stopping) return;
  stopping = true;
  console.log(`[kindred] ${signal}: no new connections; finishing the requests in progress`);
  // Requests that outlast this are cut off; the SQLite files are closed either way.
  const forced = setTimeout(() => {
    console.error('[kindred] requests still running after 15 s; closing the databases and exiting');
    closeDatabases();
    process.exit(1);
  }, 15_000);
  stopJobs?.();
  await server.close();
  clearTimeout(forced);
  closeDatabases();
  console.log('[kindred] databases closed; bye');
  process.exit(0);
}
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
