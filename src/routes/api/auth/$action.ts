import { createFileRoute } from '@tanstack/react-router';

// Passkey ceremonies (src/lib/auth/passkeys.server.ts): JSON in and out, POST only, never cached.
// Each action checks its own setup code, invitation token, challenge or session, and is rate-limited.
// Cross-site requests are refused by the CSRF middleware in src/start.ts before they reach here.
const json = (body: unknown, status = 200, cookie?: string) => {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  if (cookie) headers.append('Set-Cookie', cookie);
  return new Response(JSON.stringify(body), { status, headers });
};

const ACTIONS = new Set(['setup-options', 'setup', 'invite-options', 'invite', 'signin-options', 'signin', 'add-options', 'add', 'signout']);

export const Route = createFileRoute('/api/auth/$action')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const action = params.action;
        if (!ACTIONS.has(action)) return json({ error: 'Not found' }, 404);
        // A form or image on another site can't send JSON without a CORS preflight, which we never grant.
        if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) return json({ error: 'Expected JSON' }, 415);

        const [{ getRequestIP }, p, s, { allow }, { AuthError }, { families }, { requireUser }] = await Promise.all([
          import('@tanstack/react-start/server'),
          import('~/lib/auth/passkeys.server'),
          import('~/lib/auth/session.server'),
          import('~/lib/auth/throttle.server'),
          import('~/lib/auth/errors'),
          import('~/lib/auth/trees.server'),
          import('~/lib/auth/guard.server'),
        ]);

        // Throttling: per address, and one global budget for guessing the setup code.
        const ip = (process.env.CF_ACCESS_AUD && request.headers.get('cf-connecting-ip')) || getRequestIP() || 'unknown';
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
              return json(await p.setupOptions(request, str(body.code), body.name));
            case 'setup': {
              const trees = (await families()).map((t) => t.id);
              const user = await p.finishSetup(request, str(body.code), body.challengeId, body.response, trees);
              return json({ ok: true }, 200, s.startSession(request, user));
            }
            case 'invite-options':
              return json(await p.inviteOptions(request, str(body.token), body.name));
            case 'invite': {
              const user = await p.finishInvite(request, str(body.token), body.challengeId, body.response);
              return json({ ok: true }, 200, s.startSession(request, user));
            }
            case 'signin-options':
              return json(await p.signInOptions(request));
            case 'signin': {
              const user = await p.finishSignIn(request, body.challengeId, body.response);
              return json({ ok: true }, 200, s.startSession(request, user));
            }
            case 'add-options':
              return json(await p.addOptions(request, await requireUser()));
            case 'add':
              await p.finishAdd(request, await requireUser(), body.challengeId, body.response);
              return json({ ok: true });
            case 'signout':
              return json({ ok: true }, 200, s.endSession(request));
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
