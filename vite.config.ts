import { cloudflare } from '@cloudflare/vite-plugin';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { precompress } from './server/compress.ts';
import { migrationFilesOf, migrationsModule, MIGRATIONS_MODULE } from './src/lib/store/migrations-bundle.ts';
import { areaFiles, browserTable, localeOfId, tableModule } from './src/lib/i18n/browser-tables.ts';

/** The commit this build is made from: KINDRED_COMMIT (the Docker build has no .git), else git, else 'unknown'. Shown in a steward's feedback report. */
function buildCommit(): string {
  if (process.env.KINDRED_COMMIT) return process.env.KINDRED_COMMIT;
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'unknown'; }
}

// Two targets from one codebase (src/lib/store picks the driver):
//   Node + SQLite        `vite dev` (mise run dev), or `KINDRED_TARGET=node vite build`
//   Cloudflare Workers   `vite build` (mise run build/deploy), and `CLOUDFLARE_ENV=local vite dev`
//                        (mise run dev:cf: workerd with local D1 and R2, see wrangler.jsonc)
/**
 * For the Node target: brotli and gzip copies of the built client's text files, which server/static.ts serves. Workers
 * need none (Cloudflare compresses), and they would only be uploaded as more static files.
 */
const precompressClient = (): Plugin => ({
  name: 'kindred:precompress',
  apply: 'build',
  applyToEnvironment: (environment) => environment.name === 'client',
  async writeBundle(options) {
    if (options.dir) await precompress(options.dir);
  },
});

/**
 * The browser gets one language at a time (finding 3 of the performance review): in the client build the dictionary's
 * catalog of every area in every language becomes catalog.client.ts, which ships English and imports the reader's other
 * language as a generated table, one chunk per language (src/lib/i18n/locales/<locale>/). The server and the test runner
 * keep the full catalog.ts.
 */
const i18nTables = (): Plugin => {
  const dir = fileURLToPath(new URL('./src/lib/i18n/', import.meta.url));
  return {
    name: 'kindred:i18n-tables',
    enforce: 'pre',
    applyToEnvironment: (environment) => environment.config.consumer === 'client',
    resolveId(source, importer) {
      if (localeOfId(source)) return `\0${source}`;
      if (source === './catalog.ts' && importer?.split('?')[0].endsWith('/src/lib/i18n/dictionary.ts')) return `${dir}catalog.client.ts`;
      return undefined;
    },
    async load(id) {
      const locale = localeOfId(id);
      if (!locale || !id.startsWith('\0')) return;
      for (const file of areaFiles(dir, locale)) this.addWatchFile(file);
      return tableModule(await browserTable(dir, locale));
    },
  };
};

/** The migration files, bundled for the Durable Objects that apply them to themselves (src/lib/store/durable.ts). */
const migrations = (): Plugin => {
  const root = fileURLToPath(new URL('./migrations/', import.meta.url));
  return {
    name: 'kindred:migrations',
    resolveId: (source) => (source === MIGRATIONS_MODULE ? `\0${MIGRATIONS_MODULE}` : undefined),
    load(id) {
      if (id !== `\0${MIGRATIONS_MODULE}`) return;
      for (const file of migrationFilesOf(root)) this.addWatchFile(file);
      return migrationsModule(root);
    },
  };
};

export default defineConfig(({ command }) => {
  const workers = process.env.KINDRED_TARGET !== 'node' && (command === 'build' || !!process.env.CLOUDFLARE_ENV || process.env.KINDRED_TARGET === 'cloudflare');
  return {
    server: { port: 4517 },
    define: {
      __KINDRED_COMMIT__: JSON.stringify(buildCommit()),
      __KINDRED_VERSION__: JSON.stringify((JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version),
    },
    // One copy of React for the app and its libraries. Two copies (one pre-bundled again after a dependency was
    // re-optimised in a running dev server) make hooks fail with "Invalid hook call".
    resolve: { tsconfigPaths: true, dedupe: ['react', 'react-dom'] },
    // Pre-bundled at start, so a dev server does not find it late (and re-optimise, which is when the second copy appears).
    optimizeDeps: { include: ['@tanstack/react-virtual', 'modern-screenshot'] },
    // node:sqlite is built into Node; keep it out of the bundle.
    ssr: workers ? undefined : { external: ['node:sqlite'] },
    plugins: [
      // KINDRED_WRANGLER_CONFIG builds against another Worker's configuration, such as the demo's (deploy/demo/wrangler.jsonc).
      ...(workers ? [cloudflare({ viteEnvironment: { name: 'ssr' }, inspectorPort: false, configPath: process.env.KINDRED_WRANGLER_CONFIG?.trim() || undefined })] : []),
      i18nTables(),
      migrations(),
      tanstackStart(),
      viteReact(),
      ...(workers ? [] : [precompressClient()]),
    ],
  };
});
