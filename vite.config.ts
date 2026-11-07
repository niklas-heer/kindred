import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 4517 },
  resolve: { tsconfigPaths: true },
  // node:sqlite is built into Node; keep it out of the bundle.
  ssr: { external: ['node:sqlite'] },
  plugins: [tanstackStart(), viteReact()],
});
