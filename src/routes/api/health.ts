import { createFileRoute } from '@tanstack/react-router';

// Liveness for the Docker HEALTHCHECK and for load balancers: 200 while the server answers. It reads no
// data, not even the accounts (src/start.ts leaves this path out of the setup notice).
export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: () => new Response('ok\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } }),
    },
  },
});
