import { createFileRoute } from '@tanstack/react-router';

// A feedback report's picture of the screen: /api/feedback/<tree>/<uuid>.jpg is feedback/<uuid>.jpg in the family's media.
// Stewards only, like the reports themselves, and only a key that belongs to a report in this family. It may show family
// details, so it is never cached, and like every stored picture it can never run as a page.
export const Route = createFileRoute('/api/feedback/$tree/$key')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const text = (body: string, status: number) => new Response(body, { status, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
        if (!/^[a-z0-9-]{1,64}$/.test(params.tree) || !/^[a-z0-9-]{1,64}\.jpg$/.test(params.key)) return text('not found', 404);
        const [{ requireCan }, { AuthError }] = await Promise.all([import('~/lib/auth/guard.server'), import('~/lib/auth/errors')]);
        try {
          await requireCan(params.tree, 'manage-access');
        } catch (e) {
          if (e instanceof AuthError) return text(e.message, e.status);
          throw e;
        }
        const [{ feedbackPictureExists }, { media }] = await Promise.all([import('~/lib/feedback.server'), import('~/lib/db.server')]);
        const key = `feedback/${params.key}`;
        if (!(await feedbackPictureExists(params.tree, key))) return text('not found', 404);
        const stored = await media.get(params.tree, key);
        if (!stored) return text('not found', 404);
        const download = new URL(request.url).searchParams.get('download') === '1';
        return new Response(stored.body as BodyInit, {
          headers: {
            'Content-Type': 'image/jpeg',
            'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="kindred-feedback.jpg"`,
            'Cache-Control': 'private, no-store',
            Vary: 'Cookie',
            'X-Content-Type-Options': 'nosniff',
            'Cross-Origin-Resource-Policy': 'same-origin',
            'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
            'X-Frame-Options': 'DENY',
          },
        });
      },
    },
  },
});
