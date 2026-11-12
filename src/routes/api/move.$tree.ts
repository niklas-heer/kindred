import { createFileRoute } from '@tanstack/react-router';

// Moving a family into its Durable Object on Cloudflare, one step per request (src/lib/store/move.server.ts), sent by
// scripts/import-to-do.ts with the session of the person doing it (docs/deploy-cloudflare.md, "Moving a family into a
// Durable Object"). A family with stewards may be moved by them; one without by whoever may make families (mayCreate),
// who becomes its steward when the move finishes, as when they make a family. Refused in a demo and in a "View as" preview.
export const Route = createFileRoute('/api/move/$tree')({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
        if (!/^[a-z0-9-]{1,64}$/.test(params.tree)) return json({ error: 'not found' }, 404);
        const [{ requireUser, myRealMemberships }, { AuthError }, { refuseReadOnly }, fam, mv, { NOT_TREES }, { upsertMembership, accounts }] = await Promise.all([
          import('~/lib/auth/guard.server'),
          import('~/lib/auth/errors'),
          import('~/lib/read-only'),
          import('~/lib/families.server'),
          import('~/lib/store/move.server'),
          import('~/lib/store/index'),
          import('~/lib/auth/store.server'),
        ]);
        try {
          const user = await requireUser();
          refuseReadOnly();
          if (NOT_TREES.has(params.tree)) return json({ error: 'not found' }, 404);
          // TODO(operator): once the operator role exists, requireOperator() decides this instead of the family's stewards.
          // A family with stewards is theirs to move; one without (new here, or half-moved) whoever may make families.
          const memberships = await myRealMemberships();
          const stewarded = !!(await accounts().get("SELECT 1 FROM membership WHERE tree = ? AND role = 'steward'", params.tree));
          const steward = memberships.some((m) => m.tree === params.tree && m.role === 'steward');
          if (stewarded ? !steward : !(await fam.mayCreate(user, memberships))) throw fam.notAllowed();

          const parsed = mv.moveStep.safeParse(await request.json().catch(() => null));
          if (!parsed.success) return json({ error: 'Send one step: begin, rows or finish.' }, 400);
          const result = await mv.move(params.tree, parsed.data);
          // A family brought in from elsewhere has no members here yet: the person who moved it becomes its steward.
          if (parsed.data.step === 'finish' && !(await accounts().get('SELECT 1 FROM membership WHERE tree = ?', params.tree))) {
            await accounts().batch([upsertMembership(user.id, params.tree, 'steward')]);
          }
          return json(result);
        } catch (e) {
          if (e instanceof AuthError) return json({ error: e.message }, e.status);
          if (e instanceof mv.MoveError) return json({ error: e.message }, 409);
          throw e;
        }
      },
    },
  },
});
