import { createFileRoute } from '@tanstack/react-router';
import { SOURCE_FILE_KEY } from '~/lib/suggestions/types';

// A source's file: /api/source-file/<tree>/<uuid>.<ext> is source/<uuid>.<ext> in the family's media, as `source_file` lists it
// (an approved suggestion's file). Sources are for members: a share-link guest gets none (docs/roles-and-privacy.md), so to
// them it is not there (src/lib/suggestions/reads.server.ts). It is served as the type its bytes were checked to be, never as
// a page; the reader's own browser may keep it for a while, no shared cache may. ?download=1 saves it.
export const Route = createFileRoute('/api/source-file/$tree/$key')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const text = (body: string, status: number) => new Response(body, { status, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
        if (!/^[a-z0-9-]{1,64}$/.test(params.tree) || !SOURCE_FILE_KEY.test(params.key)) return text('not found', 404);
        const [{ requireReader }, { AuthError }] = await Promise.all([import('~/lib/auth/guard.server'), import('~/lib/auth/errors')]);
        let reader;
        try {
          reader = await requireReader(params.tree);
        } catch (e) {
          if (e instanceof AuthError) return text(e.message, e.status);
          throw e;
        }
        const [{ sourceFile, fileHeaders }, { media }] = await Promise.all([import('~/lib/suggestions/reads.server'), import('~/lib/db.server')]);
        const who = { id: reader.user?.id ?? '', name: reader.user?.name ?? '', role: reader.role, guest: reader.guest };
        const file = await sourceFile(params.tree, who, params.key);
        if (!file) return text('not found', 404);
        const stored = await media.get(params.tree, file.key);
        if (!stored) return text('not found', 404);
        const download = new URL(request.url).searchParams.get('download') === '1';
        return new Response(stored.body as BodyInit, { headers: fileHeaders(file, { download, keep: true }) });
      },
    },
  },
});
