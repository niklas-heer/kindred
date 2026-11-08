import { createFileRoute } from '@tanstack/react-router';

// Where browsers report a Content-Security-Policy violation (src/lib/auth/security-headers.ts). One log line each, so a
// steward can tell the policy is safe to enforce. Anyone can post here, so the size and the rate of logging are capped.
const MAX_BYTES = 8192;
const MAX_LINES_PER_MINUTE = 30;
const LINE_TEXT = /[^\x20-\x7e]/g;
let minute = 0;
let lines = 0;

const empty = () => new Response(null, { status: 204 });
const short = (v: unknown) => (typeof v === 'string' ? v.replace(LINE_TEXT, '?').slice(0, 200) : '-');

export const Route = createFileRoute('/api/csp-report')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (Number(request.headers.get('Content-Length') ?? 0) > MAX_BYTES) return empty();
        const text = await request.text().catch(() => '');
        if (text.length > MAX_BYTES) return empty();
        const now = Math.floor(Date.now() / 60_000);
        if (now !== minute) { minute = now; lines = 0; }
        if (++lines > MAX_LINES_PER_MINUTE) return empty();
        try {
          const report = (JSON.parse(text) as { 'csp-report'?: Record<string, unknown> })['csp-report'];
          if (report) console.warn(`[kindred] content policy would block: ${short(report['effective-directive'] ?? report['violated-directive'])} ${short(report['blocked-uri'])} on ${short(report['source-file'])}`);
        } catch {}
        return empty();
      },
    },
  },
});
