import { createFileRoute } from '@tanstack/react-router';

// Where the browser's usage reports arrive (src/lib/stats/beacon.ts). Always answers 204: nobody is waiting for it, and a report that
// was refused, malformed or failed changes nothing a reader can see. The CSRF check in src/start.ts already refuses other sites.
const done = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

export const Route = createFileRoute('/api/stats')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { headersRefuseTracking, MAX_BATCH_BYTES, parseBatch } = await import('~/lib/stats/shared');
          if (headersRefuseTracking(request.headers)) return done();
          const text = await request.text();
          if (text.length > MAX_BATCH_BYTES) return done();
          const batch = parseBatch(JSON.parse(text));
          if (!batch) return done();
          const [{ currentSession }, { membership }, stats] = await Promise.all([
            import('~/lib/auth/guard.server'), import('~/lib/auth/store.server'), import('~/lib/stats/store.server'),
          ]);
          const { user, guest } = await currentSession();
          // A member is counted as a member, also with a guest cookie; a guest of this family only as one anonymous visit.
          const m = user && (await membership(user.id, batch.tree));
          if (user && m) await stats.recordMemberBatch(user.id, batch, Date.now(), m.role);
          else if (guest?.tree === batch.tree && batch.visit) await stats.recordGuestVisit(batch.tree);
        } catch {}
        return done();
      },
    },
  },
});
