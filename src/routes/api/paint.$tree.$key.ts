import { createFileRoute } from '@tanstack/react-router';

// A painting waiting for the reader's choice: /api/paint/<tree>/<uuid>.<ext> is portrait/<uuid>.<ext> in the family's media.
// Only editors and the member linked to that person with a steward's confirmation may see one, and only a picture the family's database lists. Nothing is cached:
// a candidate is discarded or kept, and a browser must not keep either.
export const Route = createFileRoute('/api/paint/$tree/$key')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const text = (body: string, status: number) => new Response(body, { status, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
        if (!/^[a-z0-9-]{1,64}$/.test(params.tree) || !/^[a-z0-9-]{1,80}\.[a-z]{2,4}$/.test(params.key)) return text('not found', 404);
        const [{ requireMember }, { AuthError, forbidden }, { db, media }, { mayPaintPerson }, { needs }] = await Promise.all([
          import('~/lib/auth/guard.server'),
          import('~/lib/auth/errors'),
          import('~/lib/db.server'),
          import('~/lib/ai/portrait-rules'),
          import('~/lib/roles'),
        ]);
        const key = `portrait/${params.key}`;
        let row: { mime: string; person: string } | undefined;
        try {
          const m = await requireMember(params.tree);
          row = await db(params.tree).get<{ mime: string; person: string }>('SELECT mime, person FROM portrait WHERE key = ?', key);
          if (!mayPaintPerson(m, row?.person ?? '')) throw forbidden('edit-person', needs('edit-person'));
        } catch (e) {
          if (e instanceof AuthError) return text(e.message, e.status);
          throw e;
        }
        if (!row) return text('not found', 404);
        const stored = await media.get(params.tree, key);
        if (!stored) return text('not found', 404);
        return new Response(stored.body as BodyInit, {
          headers: {
            'Content-Type': row.mime,
            'Cache-Control': 'private, no-store',
            Vary: 'Cookie',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          },
        });
      },
    },
  },
});
