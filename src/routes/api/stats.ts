import { createFileRoute } from '@tanstack/react-router';

// Where the browser's usage reports arrive (src/lib/stats/beacon.ts). Always answers 204: nobody is waiting for it, and a report that
// was refused, malformed or failed changes nothing a reader can see. The CSRF check in src/start.ts already refuses other sites.
const done = (setCookie?: string) => {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  if (setCookie) headers.append('Set-Cookie', setCookie);
  return new Response(null, { status: 204, headers });
};

export const Route = createFileRoute('/api/stats')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { headersRefuseTracking, MAX_BATCH_BYTES, parseBatch } = await import('~/lib/stats/shared');
          if (headersRefuseTracking(request.headers)) return done();
          // A demo collects nothing (and could store nothing). Neither does a steward's preview ("View as"): checked after the
          // session is known, below.
          if ((await import('~/lib/demo')).isDemo()) return done();
          const text = await request.text();
          if (text.length > MAX_BATCH_BYTES) return done();
          const raw = JSON.parse(text) as unknown;
          const batch = parseBatch(raw);
          if (!batch) return done();
          const [{ currentSession }, { membership }, stats] = await Promise.all([
            import('~/lib/auth/guard.server'), import('~/lib/auth/store.server'), import('~/lib/stats/store.server'),
          ]);
          const { user, guest, viewAs } = await currentSession();
          if (viewAs) return done();
          // A member is counted as a member, also with a guest cookie; a guest of this family only as one anonymous visit.
          const m = user && (await membership(user.id, batch.tree));
          if (user && m) await stats.recordMemberBatch(user.id, batch, Date.now(), m.role);
          else if (guest?.tree === batch.tree) {
            if (batch.visit) await stats.recordGuestVisit(batch.tree);
            // The guest browser's own usage, for a request to join (src/lib/auth/join.server.ts). It may set the visitor cookie.
            const [{ recordGuestUsage }, { parseGuestExtras }] = await Promise.all([import('~/lib/auth/join.server'), import('~/lib/auth/join-rules')]);
            return done(await recordGuestUsage(request, guest, batch, parseGuestExtras(raw)));
          }
        } catch {}
        return done();
      },
    },
  },
});
