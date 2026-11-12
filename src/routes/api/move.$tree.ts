import { createFileRoute } from '@tanstack/react-router';

// Importing a family into its Durable Object on Cloudflare, one step per request (src/lib/store/move.server.ts), sent by
// scripts/import-to-do.ts with the session of the person doing it (docs/deploy-cloudflare.md, "Moving a family into a
// Durable Object"). A new family: whoever may make families (mayCreate, within their limit and with the server's terms
// accepted), who becomes its steward once the import is
// published. A copy of a family a D1 binding serves: its stewards only. An operator's role gives no more: an operator may
// not read or change a family's records. Refused in a demo and in a "View as" preview.
export const Route = createFileRoute('/api/move/$tree')({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
        if (!/^[a-z0-9-]{1,64}$/.test(params.tree)) return json({ error: 'not found' }, 404);
        const [{ requireUser, myRealMemberships }, { refuseReadOnly }, fam, mv, { NOT_TREES }] = await Promise.all([
          import('~/lib/auth/guard.server'),
          import('~/lib/read-only'),
          import('~/lib/families.server'),
          import('~/lib/store/move.server'),
          import('~/lib/store/index'),
        ]);
        try {
          const user = await requireUser();
          refuseReadOnly();
          if (NOT_TREES.has(params.tree)) return json({ error: 'not found' }, 404);
          const parsed = mv.moveStep.safeParse(await request.json().catch(() => null));
          if (!parsed.success) return json({ error: 'Send one step: begin, rows or finish.' }, 400);
          const memberships = await myRealMemberships();
          const steward = memberships.some((m) => m.tree === params.tree && m.role === 'steward');
          return json(await mv.move(params.tree, parsed.data, { id: user.id, operator: user.operator === 1, steward, mayCreate: () => fam.mayCreate(user, memberships) }));
        } catch (e) {
          const status = mv.moveErrorStatus(e);
          if (status) return json({ error: (e as Error).message }, status);
          throw e;
        }
      },
    },
  },
});
