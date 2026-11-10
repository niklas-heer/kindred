// The server entry for both targets. TanStack Start uses this file (src/server.ts) instead of its default entry, so one
// module carries the request handler and the daily job runner:
//   Cloudflare Workers   the Worker's `main` (wrangler.jsonc). Its cron trigger (06:00 UTC) calls `scheduled`.
//   Node                 dist/server/server.js, which server/node.ts imports. Its daily timer (06:00 UTC) calls `runJobs`.
// Jobs run once a day for every family (src/lib/jobs). KINDRED_JOBS=off turns them off on Node (docs/self-host.md).
import startEntry from '@tanstack/react-start/server-entry';
import { guestHostAllows } from './lib/auth/guest-host.ts';
import { onGuestHost } from './lib/auth/origin.ts';
import { runJobs, workerSetting } from './lib/jobs/run.server.ts';
import { demoProblem, isDemo } from './lib/demo.ts';

export default {
  // The TanStack Start request handler. The guest host answers only what a guest needs (src/lib/auth/guest-host.ts).
  fetch(request: Request, ...rest: unknown[]) {
    if (onGuestHost(request) && !guestHostAllows(new URL(request.url).pathname)) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
    return (startEntry.fetch as (r: Request, ...a: unknown[]) => Response | Promise<Response>)(request, ...rest);
  },

  /** Cloudflare's cron trigger. The run continues after the response, so the cron is not held open by it. */
  scheduled(controller: { scheduledTime: number }, env: unknown, ctx: { waitUntil(promise: Promise<unknown>): void }) {
    ctx.waitUntil(runJobs(new Date(controller.scheduledTime), workerSetting(env)));
  },

  /** Node's daily timer (server/node.ts) calls this with the time of the run and its own settings. */
  runJobs,

  /** What server/node.ts checks before it listens: a setting that must stop the server, and whether it is a demo. */
  startup: () => ({ problem: demoProblem(), demo: isDemo() }),
};
