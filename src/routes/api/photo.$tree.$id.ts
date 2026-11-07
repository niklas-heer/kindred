import { createFileRoute } from '@tanstack/react-router';

// Portraits are stored as BLOBs in the tree's SQLite file. Only members of that family may see them,
// so a browser may keep a copy (the URL changes with each new photo) but no shared cache may.
export const Route = createFileRoute('/api/photo/$tree/$id')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const text = (body: string, status: number) => new Response(body, { status, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
        if (!/^[a-z0-9-]{1,64}$/.test(params.tree)) return text('not found', 404);
        const [{ requireMember }, { AuthError }] = await Promise.all([import('~/lib/auth/guard.server'), import('~/lib/auth/errors')]);
        try {
          await requireMember(params.tree);
        } catch (e) {
          if (e instanceof AuthError) return text(e.message, e.status);
          throw e;
        }
        const { photo } = await import('~/lib/db.server');
        const p = photo(params.tree, params.id);
        if (!p) return text('not found', 404);
        return new Response(p.data as unknown as BodyInit, {
          headers: {
            'Content-Type': p.mime,
            'Cache-Control': 'private, max-age=31536000, immutable',
            Vary: 'Cookie',
            // A picture, never a page: an uploaded SVG opened on its own runs no script.
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          },
        });
      },
    },
  },
});
