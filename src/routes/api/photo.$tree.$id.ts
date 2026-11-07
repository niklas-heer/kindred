import { createFileRoute } from '@tanstack/react-router';

// Portraits are stored as BLOBs in the tree's SQLite file.
export const Route = createFileRoute('/api/photo/$tree/$id')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { photo } = await import('~/lib/db.server');
        const p = photo(params.tree, params.id);
        if (!p) return new Response('not found', { status: 404 });
        return new Response(p.data as unknown as BodyInit, { headers: { 'Content-Type': p.mime, 'Cache-Control': 'public, max-age=31536000, immutable' } });
      },
    },
  },
});
