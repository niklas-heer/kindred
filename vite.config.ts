import { cloudflare } from '@cloudflare/vite-plugin';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Two targets from one codebase (src/lib/store picks the driver):
//   Node + SQLite        `vite dev` (mise run dev), or `KINDRED_TARGET=node vite build`
//   Cloudflare Workers   `vite build` (mise run build/deploy), and `CLOUDFLARE_ENV=local vite dev`
//                        (mise run dev:cf: workerd with local D1 and R2, see wrangler.jsonc)
export default defineConfig(({ command }) => {
  const workers = process.env.KINDRED_TARGET !== 'node' && (command === 'build' || !!process.env.CLOUDFLARE_ENV || process.env.KINDRED_TARGET === 'cloudflare');
  return {
    server: { port: 4517 },
    resolve: { tsconfigPaths: true },
    // node:sqlite is built into Node; keep it out of the bundle.
    ssr: workers ? undefined : { external: ['node:sqlite'] },
    plugins: [
      ...(workers ? [cloudflare({ viteEnvironment: { name: 'ssr' }, inspectorPort: false })] : []),
      tanstackStart(),
      viteReact(),
    ],
  };
});
