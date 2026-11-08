import { createFileRoute } from '@tanstack/react-router';

// A person's accepted painted portrait: /api/portrait/<tree>/<person>. The picture is in media storage (portrait/<uuid>.<ext>,
// on disk or R2), and the tree's row says which one is the person's. Only members of that family may see it. The address
// carries the picture's key (?v=) so a browser's copy changes with each new portrait; no shared cache may keep it.
export const Route = createFileRoute('/api/portrait/$tree/$id')({
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
        const { acceptedPortrait } = await import('~/lib/ai/portrait.server');
        const p = await acceptedPortrait(params.tree, params.id);
        if (!p) return text('not found', 404);
        const { media } = await import('~/lib/db.server');
        const stored = await media.get(params.tree, p.key);
        if (!stored) return text('not found', 404);
        return new Response(stored.body as BodyInit, {
          headers: {
            'Content-Type': p.mime,
            'Cache-Control': 'private, max-age=31536000, immutable',
            Vary: 'Cookie',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          },
        });
      },
    },
  },
});
