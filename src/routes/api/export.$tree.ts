import { createFileRoute } from '@tanstack/react-router';

// A family's export as a download: GEDCOM 5.5.1 text (`?format=gedcom`) or the Markdown archive as a ZIP
// (`?format=markdown`). Editors and stewards only: an export carries the whole record (names, dates, places, links and
// biographies), which viewers and contributors may read in the app but not take away (see docs/roles-and-privacy.md). The file is built in full before the
// response starts, and it is never cached: it is one family's data.
export const Route = createFileRoute('/api/export/$tree')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const text = (body: string, status: number) =>
          new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
        if (!/^[a-z0-9-]{1,64}$/.test(params.tree)) return text('not found', 404);
        const format = new URL(request.url).searchParams.get('format');
        if (format !== 'gedcom' && format !== 'markdown') return text('Choose format=gedcom or format=markdown.', 400);

        const [{ requireCan }, { AuthError }] = await Promise.all([import('~/lib/auth/guard.server'), import('~/lib/auth/errors')]);
        try {
          // Only a read: a read-only family's stewards download it too (before its deletion, src/lib/lifecycle/).
          await requireCan(params.tree, 'edit-person', { read: true });
        } catch (e) {
          if (e instanceof AuthError) return text(e.message, e.status);
          throw e;
        }

        const { gedcomExport, markdownExport } = await import('~/lib/exchange/export.server');
        const file = format === 'gedcom' ? await gedcomExport(params.tree) : await markdownExport(params.tree);
        return new Response(file.body as BodyInit, {
          headers: {
            'Content-Type': file.contentType,
            'Content-Disposition': `attachment; filename="${file.filename}"`,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      },
    },
  },
});
