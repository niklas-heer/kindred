import { createFileRoute } from '@tanstack/react-router';

// A recipe's picture: /api/recipe/<tree>/<uuid>.<ext> is recipe/<uuid>.<ext> in the family's media. These pictures are
// not the gallery's (docs/recipes.md): the gallery route does not serve them and the Gallery does not list them. Every
// reader of the family may fetch one, as they may read the recipe, and by the same rule: only a picture the family's
// database lists for a recipe that is there, and for a guest whose link protects living people none of a living person's
// recipe. A browser may keep its own copy (a picture never changes under its name); no shared cache may. With ?size=thumb
// it is a cover's small copy. An uploaded file never runs as a page: nosniff, and a CSP that lets it load nothing.
export const Route = createFileRoute('/api/recipe/$tree/$key')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const text = (body: string, status: number) => new Response(body, { status, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
        if (!/^[a-z0-9-]{1,64}$/.test(params.tree) || !/^[a-z0-9-]{1,80}\.(?:jpg|png|webp)$/.test(params.key)) return text('not found', 404);
        const [{ requireReader }, { AuthError }] = await Promise.all([import('~/lib/auth/guard.server'), import('~/lib/auth/errors')]);
        let protectLiving: boolean;
        try {
          protectLiving = (await requireReader(params.tree)).protectLiving;
        } catch (e) {
          if (e instanceof AuthError) return text(e.message, e.status);
          throw e;
        }
        const { recipePicture } = await import('~/lib/recipes/recipes.server');
        const picture = await recipePicture(params.tree, `recipe/${params.key}`, new URL(request.url).searchParams.get('size') === 'thumb', protectLiving);
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
            'Cross-Origin-Resource-Policy': 'same-origin',
            'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          },
        });
      },
    },
  },
});
