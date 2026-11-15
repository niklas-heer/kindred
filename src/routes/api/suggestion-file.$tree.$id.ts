import { createFileRoute } from '@tanstack/react-router';

// A pending file of a suggestion: /api/suggestion-file/<tree>/<id>, the `suggestion_file` row's id. Only an editor or a steward
// may fetch it, or its own suggester while the suggestion waits (a share-link guest by their `kindred_voter` cookie); for
// everyone else it is not there (src/lib/suggestions/reads.server.ts). It is served as the type its bytes were checked to be,
// never as a page, and kept by no cache: it may be declined and deleted at any time. ?download=1 saves it.
export const Route = createFileRoute('/api/suggestion-file/$tree/$id')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const text = (body: string, status: number) => new Response(body, { status, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
        if (!/^[a-z0-9-]{1,64}$/.test(params.tree) || !/^[0-9a-f-]{36}$/.test(params.id)) return text('not found', 404);
        const [{ requireReader }, { AuthError }] = await Promise.all([import('~/lib/auth/guard.server'), import('~/lib/auth/errors')]);
        let reader;
        try {
          reader = await requireReader(params.tree);
        } catch (e) {
          if (e instanceof AuthError) return text(e.message, e.status);
          throw e;
        }
        const [{ pendingFile, fileHeaders }, { media }, { guestVoterKey }] = await Promise.all([
          import('~/lib/suggestions/reads.server'), import('~/lib/db.server'), import('~/lib/votes/guest-voter.server'),
        ]);
        const by = reader.guest
          ? { kind: 'guest' as const, key: (await guestVoterKey(request, params.tree)) ?? '', protectLiving: reader.protectLiving }
          : { kind: 'member' as const, who: { id: reader.user?.id ?? '', name: reader.user?.name ?? '', role: reader.role } };
        const file = await pendingFile(params.tree, by, params.id);
        if (!file) return text('not found', 404);
        const stored = await media.get(params.tree, file.key);
        if (!stored) return text('not found', 404);
        const download = new URL(request.url).searchParams.get('download') === '1';
        return new Response(stored.body as BodyInit, { headers: fileHeaders(file, { download, keep: false }) });
      },
    },
  },
});
