import { createFileRoute } from '@tanstack/react-router';

// A steward's backup of their family as one JSON file (src/lib/store/backup.server.ts; docs/deploy-cloudflare.md, "Backups").
// Stewards of the family only, by their own membership: not an operator (who may not read a family's records), not another
// role, and not a steward's "View as" preview, which answers as the previewed reader. Never cached: it is one family's data.
export const Route = createFileRoute('/api/backup/$tree')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const text = (body: string, status: number) =>
          new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
        if (!/^[a-z0-9-]{1,64}$/.test(params.tree)) return text('not found', 404);
        const [{ requireMember }, { AuthError }] = await Promise.all([import('~/lib/auth/guard.server'), import('~/lib/auth/errors')]);
        try {
          const m = await requireMember(params.tree);
          if (m.role !== 'steward') return text('Only a steward of this family may download its backup.', 403);
        } catch (e) {
          if (e instanceof AuthError) return text(e.message, e.status);
          throw e;
        }
        const { familyBackup } = await import('~/lib/store/backup.server');
        const backup = await familyBackup(params.tree);
        return new Response(JSON.stringify(backup), {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': `attachment; filename="${params.tree}-${backup.made.slice(0, 10)}.json"`,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      },
    },
  },
});
