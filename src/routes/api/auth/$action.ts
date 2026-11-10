import { createFileRoute } from '@tanstack/react-router';

// Passkey ceremonies (src/lib/auth/passkeys.server.ts): JSON in and out, POST only, never cached.
// Each action checks its own setup code, invitation token, challenge or session, and is rate-limited.
// Cross-site requests are refused by the CSRF middleware in src/start.ts before they reach here.
const json = (body: unknown, status = 200, cookie?: string | string[]) => {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  for (const c of cookie === undefined ? [] : [cookie].flat()) headers.append('Set-Cookie', c);
  return new Response(JSON.stringify(body), { status, headers });
};

const ACTIONS = new Set(['setup-options', 'setup', 'invite-options', 'invite', 'signin-options', 'signin', 'add-options', 'add', 'confirm-options', 'confirm', 'signout']);

export const Route = createFileRoute('/api/auth/$action')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const action = params.action;
        if (!ACTIONS.has(action)) return json({ error: 'Not found' }, 404);
        // A form or image on another site can't send JSON without a CORS preflight, which we never grant.
        if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) return json({ error: 'Expected JSON' }, 415);

        const [p, s, { allow, clientIP }, { AuthError }, { families }, { requireUser }] = await Promise.all([
          import('~/lib/auth/passkeys.server'),
          import('~/lib/auth/session.server'),
          import('~/lib/auth/throttle.server'),
          import('~/lib/auth/errors'),
          import('~/lib/auth/trees.server'),
          import('~/lib/auth/guard.server'),
        ]);
        const proof = () => import('~/lib/auth/proof.server');

        // Throttling: per address, and one global budget for guessing the setup code.
        const ip = clientIP();
        const limited =
          !allow(`auth:${ip}`, 40, 60_000) ||
          (action === 'setup-options' && (!allow(`setup:${ip}`, 5, 60_000) || !allow('setup:all', 20, 10 * 60_000))) ||
          (action === 'invite-options' && !allow(`invite:${ip}`, 20, 10 * 60_000));
        if (limited) return json({ error: 'Too many attempts. Please wait a minute and try again.' }, 429);

        const body = (await request.json().catch(() => null)) as Record<string, any> | null;
        if (!body || typeof body !== 'object') return json({ error: 'Expected JSON' }, 400);
        const str = (v: unknown, max = 200) => (typeof v === 'string' && v.length <= max ? v : '');

        try {
          switch (action) {
            case 'setup-options':
              return json(await p.setupOptions(request, str(body.code), body.name, body.familyName));
            case 'setup': {
              const trees = (await families()).map((t) => t.id);
              const { user, tree, credential } = await p.finishSetup(request, str(body.code), body.challengeId, body.response, trees, body.familyName);
              // `tree` is the family made for a new server, so the first-run step can add the steward to it.
              return json({ ok: true, tree }, 200, await s.startSession(request, user, credential));
            }
            case 'invite-options':
              return json(await p.inviteOptions(request, str(body.token), body.name));
            case 'invite': {
              const { user, credential } = await p.finishInvite(request, str(body.token), body.challengeId, body.response);
              return json({ ok: true }, 200, await s.startSession(request, user, credential));
            }
            case 'signin-options':
              return json(await p.signInOptions(request));
            case 'signin': {
              const { user, credential, verified } = await p.finishSignIn(request, body.challengeId, body.response);
              // A guest's account that a steward has not let in yet starts no session (src/lib/auth/join.server.ts).
              const allowed = await (await import('~/lib/auth/join.server')).signInAllowed(user);
              if (allowed !== 'ok') throw new AuthError('invalid', allowed === 'pending' ? 'join.err_signin_pending' : 'join.err_signin_expired');
              return json({ ok: true }, 200, await s.startSession(request, user, credential, verified));
            }
            case 'add-options':
              return json(await p.addOptions(request, await requireUser()));
            case 'add':
              await p.finishAdd(request, await requireUser(), body.challengeId, body.response);
              return json({ ok: true });
            // A fresh proof on this session, before adding a passkey or signing out everywhere else (proof.server.ts).
            case 'confirm-options':
              return json(await (await proof()).proofOptions(request, await requireUser()));
            case 'confirm':
              await (await proof()).finishProof(request, await requireUser(), body.challengeId, body.response);
              return json({ ok: true });
            case 'signout':
              return json({ ok: true }, 200, await s.endAllSessions(request));
          }
          return json({ error: 'Not found' }, 404);
        } catch (e) {
          if (e instanceof AuthError) return json({ error: e.message, code: e.code }, e.status);
          // Unexpected: log it on the server, tell the reader nothing technical.
          console.error('[auth]', action, e instanceof Error ? e.message : e);
          return json({ error: 'Something went wrong. Please try again.' }, 500);
        }
      },
    },
  },
});
