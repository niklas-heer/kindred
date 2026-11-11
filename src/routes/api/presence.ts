import { createFileRoute } from '@tanstack/react-router';

// Where a closing tab says it has gone (src/components/presence/PresenceHost.tsx), with sendBeacon, which a server function
// cannot receive. Always 204: nobody waits for it, and a tab that was never noted, a guest or a preview change nothing (the
// row would expire within a minute anyway). The CSRF check in src/start.ts already refuses other sites.
const done = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

export const Route = createFileRoute('/api/presence')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const text = await request.text();
          if (text.length > 512) return done();
          const raw = JSON.parse(text) as { tree?: unknown; tab?: unknown };
          const { TAB } = await import('~/lib/presence/shared');
          if (typeof raw.tree !== 'string' || !/^[a-z0-9-]{1,64}$/.test(raw.tree) || typeof raw.tab !== 'string' || !TAB.test(raw.tab)) return done();
          const [{ requireMember }, { leave }] = await Promise.all([import('~/lib/auth/guard.server'), import('~/lib/presence/presence.server')]);
          const { user } = await requireMember(raw.tree);
          await leave(raw.tree, user.id, raw.tab);
        } catch {}
        return done();
      },
    },
  },
});
