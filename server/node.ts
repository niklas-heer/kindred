// The production server for the Node target. Build it with `mise run build:node` (npm run build:node), then
// run it with `mise run start` (npm start). It serves the built client (dist/client) and passes every other
// request to the server bundle (dist/server). Settings are environment variables (docs/self-host.md):
//   PORT              4901
//   HOST              127.0.0.1 (use 0.0.0.0 to accept connections from other machines; the Docker image does)
//   KINDRED_ORIGIN    the public address, e.g. https://family.example.org (passkeys and cookies depend on it)
//   KINDRED_DATA_DIR  the families, media, accounts and secret (default: data/ in this folder)
// SIGTERM and SIGINT stop new connections, let requests in progress finish, close the SQLite files and exit.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { serve } from 'srvx/node';
import { staticResponse } from './static.ts';

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

// The server bundle registers its close function under this name (src/lib/store/node.ts).
const CLOSE_DATABASES = Symbol.for('kindred.closeDatabases');
const closeDatabases = () => (globalThis as unknown as Record<symbol, (() => void) | undefined>)[CLOSE_DATABASES]?.();

const { default: app } = (await import(pathToFileURL(bundle).href)) as { default: { fetch: (req: Request) => Response | Promise<Response> } };

const server = serve({
  port,
  hostname,
  silent: true,
  fetch: async (req: Request) => (await staticResponse(clientDir, req)) ?? app.fetch(req),
});
await server.ready();

const dataDir = process.env.KINDRED_DATA_DIR ? resolve(process.env.KINDRED_DATA_DIR) : join(root, 'data');
console.log(`[kindred] listening on http://${hostname}:${port}${origin ? ` as ${origin.origin}` : ''}; data in ${dataDir}`);

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
  await server.close();
  clearTimeout(forced);
  closeDatabases();
  console.log('[kindred] databases closed; bye');
  process.exit(0);
}
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
