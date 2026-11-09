import { cloudflare } from '@cloudflare/vite-plugin';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import { precompress } from './server/compress.ts';

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
      ...(workers ? [cloudflare({ viteEnvironment: { name: 'ssr' }, inspectorPort: false })] : []),
      tanstackStart(),
      viteReact(),
      ...(workers ? [] : [precompressClient()]),
    ],
  };
});
