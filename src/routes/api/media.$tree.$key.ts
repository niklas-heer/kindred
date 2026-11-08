import { createFileRoute } from '@tanstack/react-router';

// A gallery picture: /api/media/<tree>/<uuid>.<ext> is gallery/<uuid>.<ext> in the family's media. Only
// members of that family may see it, and only pictures the family's database lists are served. A browser
// may keep its own copy (a picture never changes under its name); no shared cache may.
export const Route = createFileRoute('/api/media/$tree/$key')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const text = (body: string, status: number) => new Response(body, { status, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
        if (!/^[a-z0-9-]{1,64}$/.test(params.tree) || !/^[a-z0-9-]{1,80}\.[a-z]{2,4}$/.test(params.key)) return text('not found', 404);
        const [{ requireReader }, { AuthError }] = await Promise.all([import('~/lib/auth/guard.server'), import('~/lib/auth/errors')]);
        try {
          await requireReader(params.tree);
        } catch (e) {
          if (e instanceof AuthError) return text(e.message, e.status);
          throw e;
        }
        const { pictureMime } = await import('~/lib/photos.server');
        const key = `gallery/${params.key}`;
        const mime = await pictureMime(params.tree, key);
        if (!mime) return text('not found', 404);
        const { media } = await import('~/lib/db.server');
        const stored = await media.get(params.tree, key);
        if (!stored) return text('not found', 404);
        return new Response(stored.body as BodyInit, {
          headers: {
            'Content-Type': mime,
            'Cache-Control': 'private, max-age=86400',
            Vary: 'Cookie',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          },
        });
      },
    },
  },
});
