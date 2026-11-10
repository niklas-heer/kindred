import { createFileRoute } from '@tanstack/react-router';

// A gallery picture: /api/media/<tree>/<uuid>.<ext> is gallery/<uuid>.<ext> in the family's media. Only
// members of that family may see it, and only pictures the family's database lists are served. A browser
// may keep its own copy (a picture never changes under its name); no shared cache may. With ?size=thumb it is the
// picture's small copy (migration 0023), or the picture itself when it has none. A share-link guest is a reader of the
// gallery, but not of the family's feed: a picture that came with a post is not served to them (docs/feed.md).
export const Route = createFileRoute('/api/media/$tree/$key')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const text = (body: string, status: number) => new Response(body, { status, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
        if (!/^[a-z0-9-]{1,64}$/.test(params.tree) || !/^[a-z0-9-]{1,80}\.[a-z]{2,4}$/.test(params.key)) return text('not found', 404);
        const [{ requireReader }, { AuthError }] = await Promise.all([import('~/lib/auth/guard.server'), import('~/lib/auth/errors')]);
        let guest: boolean;
        try {
          guest = (await requireReader(params.tree)).guest;
        } catch (e) {
          if (e instanceof AuthError) return text(e.message, e.status);
          throw e;
        }
        const { pictureFor } = await import('~/lib/photos.server');
        const picture = await pictureFor(params.tree, `gallery/${params.key}`, new URL(request.url).searchParams.get('size') === 'thumb', guest);
        if (!picture) return text('not found', 404);
        const { media } = await import('~/lib/db.server');
        const stored = await media.get(params.tree, picture.key);
        if (!stored) return text('not found', 404);
        return new Response(stored.body as BodyInit, {
          headers: {
            'Content-Type': picture.mime,
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
