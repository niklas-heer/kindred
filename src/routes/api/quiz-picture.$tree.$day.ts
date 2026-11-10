import { createFileRoute } from '@tanstack/react-router';

// The face in today's quiz: /api/quiz-picture/<tree>/<day>. "Who is this?" must not say who, so the picture has an
// address of its own that names the day and nobody: the server looks up whose face the day's question shows, and sends
// the family's photo of them, or their drawn portrait when they have died and no photo is shown. Members only (a
// share-link guest has no quiz), and only for today's question.
export const Route = createFileRoute('/api/quiz-picture/$tree/$day')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const text = (body: string, status: number) => new Response(body, { status, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
        if (!/^[a-z0-9-]{1,64}$/.test(params.tree) || !/^\d{4}-\d{2}-\d{2}$/.test(params.day)) return text('not found', 404);
        const [{ requireMember }, { AuthError }] = await Promise.all([import('~/lib/auth/guard.server'), import('~/lib/auth/errors')]);
        try {
          await requireMember(params.tree);
        } catch (e) {
          if (e instanceof AuthError) return text(e.message, e.status);
          throw e;
        }
        const shown = await (await import('~/lib/today/today.server')).quizPicture(params.tree, params.day);
        if (!shown) return text('not found', 404);
        const headers = {
          // The day's picture for the day: a browser may keep it for an hour, no shared cache at all.
          'Cache-Control': 'private, max-age=3600',
          Vary: 'Cookie',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        };
        const { photo, media, graph } = await import('~/lib/db.server');
        if (shown.photo) {
          const p = await photo(params.tree, shown.person);
          const stored = p?.key ? await media.get(params.tree, p.key) : p?.data ? { body: new Uint8Array(p.data) } : undefined;
          if (p && stored) return new Response(stored.body as BodyInit, { headers: { ...headers, 'Content-Type': p.mime } });
        }
        // The drawn portrait, as the tree shows it: made here, so the page never learns whose it is.
        const g = await graph(params.tree);
        const person = g.people.find((x) => x.id === shown.person);
        if (!person) return text('not found', 404);
        const [{ avatarSvg }, { hash, resolveAppearance }, { dressOf }] = await Promise.all([
          import('~/components/portrait/avatar'), import('~/lib/portrait-look'), import('~/components/portrait/palette'),
        ]);
        const svg = avatarSvg(resolveAppearance(person, new Date().getFullYear()), dressOf(g.houses.find((h) => h.id === person.house), hash(`${person.id}:dress`)), 'lg');
        return new Response(svg, { headers: { ...headers, 'Content-Type': 'image/svg+xml; charset=utf-8' } });
      },
    },
  },
});
