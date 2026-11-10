import { createFileRoute } from '@tanstack/react-router';

// A research document's file: /api/research/<tree>/<uuid>.<ext> is research/<uuid>.<ext> in the family's media. Only members
// of that family may fetch it, only a document the reader may see is served, and a private one is 404 for everyone else.
// An uploaded file must never run as a page, whatever is in it: nosniff keeps it the type its bytes were checked to be, the
// CSP lets it load nothing, and a picture is sandboxed as the gallery's are. A PDF's CSP has no `sandbox`, because browsers
// refuse to show a PDF in a sandboxed frame; application/pdf with nosniff already cannot run as a document of this origin.
export const Route = createFileRoute('/api/research/$tree/$key')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const text = (body: string, status: number) => new Response(body, { status, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
        if (!/^[a-z0-9-]{1,64}$/.test(params.tree) || !/^[a-z0-9-]{1,80}\.(?:pdf|jpg|png|webp)$/.test(params.key)) return text('not found', 404);
        const [{ requireReader }, { AuthError }] = await Promise.all([import('~/lib/auth/guard.server'), import('~/lib/auth/errors')]);
        let reader;
        try {
          reader = await requireReader(params.tree);
        } catch (e) {
          if (e instanceof AuthError) return text(e.message, e.status);
          throw e;
        }
        const [{ documentFile }, { media }, { documentFileName, isPdf }] = await Promise.all([import('~/lib/research.server'), import('~/lib/db.server'), import('~/lib/research')]);
        const key = `research/${params.key}`;
        const doc = await documentFile(params.tree, key, reader.role, reader.protectLiving);
        if (!doc) return text('not found', 404);
        const stored = await media.get(params.tree, key);
        if (!stored) return text('not found', 404);
        const download = new URL(request.url).searchParams.get('download') === '1';
        const name = documentFileName(doc.title, doc.mime);
        const pdf = isPdf(doc.mime);
        return new Response(stored.body as BodyInit, {
          headers: {
            'Content-Type': doc.mime,
            'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${name.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
            // A private document never stays in a browser's cache; a shared one may for a while, for the reader alone.
            'Cache-Control': doc.private ? 'private, no-store' : 'private, max-age=3600',
            Vary: 'Cookie',
            'X-Content-Type-Options': 'nosniff',
            'Cross-Origin-Resource-Policy': 'same-origin',
            'Content-Security-Policy': pdf ? "default-src 'none'; style-src 'unsafe-inline'; object-src 'self'; frame-ancestors 'self'" : "default-src 'none'; style-src 'unsafe-inline'; sandbox",
            'X-Frame-Options': pdf ? 'SAMEORIGIN' : 'DENY',
          },
        });
      },
    },
  },
});
