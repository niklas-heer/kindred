import { createFileRoute } from '@tanstack/react-router';

// Passkey ceremonies (src/lib/auth/passkeys.server.ts): JSON in and out, POST only, never cached.
// Each action checks its own setup code, invitation token, challenge or session, and is rate-limited.
// Cross-site requests are refused by the CSRF middleware in src/start.ts before they reach here.
const json = (body: unknown, status = 200, cookie?: string | string[]) => {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  for (const c of cookie === undefined ? [] : [cookie].flat()) headers.append('Set-Cookie', c);
  return new Response(JSON.stringify(body), { status, headers });
};

const ACTIONS = new Set([
  'setup-options', 'setup', 'invite-options', 'invite', 'signin-options', 'signin', 'add-options', 'add', 'confirm-options', 'confirm', 'signout',
  // Username and password (src/lib/auth/password.server.ts): each refuses unless the operator turned passwords on.
  'password-signin', 'password-second', 'password-setup', 'password-invite', 'password-recover', 'password-reset', 'proof-kinds', 'confirm-password',
  // Sign-up for a new family (src/lib/operator/signup.server.ts), while the operator allows it.
  'signup-options', 'signup', 'signup-password',
  // Single sign-on (src/lib/auth/oidc.server.ts): starts a flow and answers with the provider's address to go to.
  'oidc-start',
  // A code by email (src/lib/auth/email-code.server.ts): asking sets this browser's cookie, which the code is bound to.
  'email-code-request', 'email-code', 'email-code-second',
]);

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
          ((action === 'invite-options' || action === 'password-invite') && !allow(`invite:${ip}`, 20, 10 * 60_000)) ||
          (action === 'password-setup' && (!allow(`setup:${ip}`, 5, 60_000) || !allow('setup:all', 20, 10 * 60_000))) ||
          ((action === 'signup-options' || action === 'signup-password') && !allow(`signup:${ip}`, 10, 10 * 60_000)) ||
          (action === 'oidc-start' && !allow(`oidc:${ip}`, 30, 10 * 60_000)) ||
          (action === 'email-code-request' && !allow(`email-code:${ip}`, 10, 10 * 60_000));
        if (limited) return json({ error: 'Too many attempts. Please wait a minute and try again.' }, 429);

        const body = (await request.json().catch(() => null)) as Record<string, any> | null;
        if (!body || typeof body !== 'object') return json({ error: 'Expected JSON' }, 400);
        const str = (v: unknown, max = 200) => (typeof v === 'string' && v.length <= max ? v : '');
        const pw = () => import('~/lib/auth/password.server');
        // Password tries are counted in the database before they are checked (src/lib/auth/attempts.server.ts); Turnstile joins
        // in when the whole server sees a flood of them, or one username many, and the server has its keys.
        const attempt = async () => {
          const [{ passesTurnstile }, { turnstileKeys }] = await Promise.all([import('~/lib/operator/turnstile.server'), import('~/lib/operator/settings.server')]);
          return { ip, turnstileOn: !!turnstileKeys(), turnstile: (token: string | undefined) => passesTurnstile(token, ip) };
        };
        /** A password sign-in that went all the way: the same checks as a passkey's, then a brand-new session. */
        const passwordSession = async (user: string) => {
          const allowed = await (await import('~/lib/auth/join.server')).signInAllowed(user);
          if (allowed !== 'ok') throw new AuthError('invalid', allowed === 'pending' ? 'join.err_signin_pending' : 'join.err_signin_expired');
          return json({ ok: true }, 200, await s.startSession(request, user, null, true, 'password'));
        };

        const code = () => import('~/lib/auth/email-code.server');
        /** A code's sign-in as the browser receives it: done, or a ticket for the two-step code. */
        const codeAnswer = (r: import('~/lib/auth/email-code.server').CodeSignIn) =>
          json(r.kind === 'second' ? { step: 'code', ticket: r.ticket } : { ok: true }, 200, r.cookies);

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
              return json(await p.inviteOptions(request, str(body.token), body.name, body.acceptTerms));
            case 'invite': {
              const { user, credential } = await p.finishInvite(request, str(body.token), body.challengeId, body.response, body.acceptTerms);
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
            // Starting a family on a server that takes sign-ups (src/lib/signup/): a new account, its passkey and the family.
            case 'signup-options':
              return json(await (await import('~/lib/signup/passkey.server')).signupOptions(request, body, ip, !!(await s.sessionOf(request))));
            case 'signup': {
              const { user, tree, credential } = await (await import('~/lib/signup/passkey.server')).finishSignup(request, body, ip);
              return json({ ok: true, tree }, 200, await s.startSession(request, user, credential));
            }
            // The same with a username and password, while the operator offers them: one step, as there is no device ceremony.
            case 'signup-password': {
              if (await s.sessionOf(request)) throw new AuthError('invalid', (await import('~/lib/i18n/dictionary')).translate('en', 'signup.err.signed_in'));
              const { user, tree } = await (await import('~/lib/signup/password.server')).signupWithPassword(request, body, ip);
              return json({ ok: true, tree }, 200, await s.startSession(request, user, null, true, 'password'));
            }
            case 'signout':
              return json({ ok: true }, 200, await s.endAllSessions(request));
            case 'password-signin': {
              const r = await (await pw()).passwordSignIn(request, body, await attempt());
              return r.kind === 'second' ? json({ step: 'code', ticket: r.ticket }) : passwordSession(r.user);
            }
            case 'password-second':
              return passwordSession((await (await pw()).passwordSecondStep(request, body, await attempt())).user);
            case 'password-recover':
              return passwordSession((await (await pw()).resetWithRecoveryCode(request, body, await attempt())).user);
            case 'password-reset':
              return passwordSession((await (await pw()).redeemResetLink(request, body, await attempt())).user);
            case 'password-setup': {
              const trees = (await families()).map((t) => t.id);
              const { user, tree } = await (await import('~/lib/auth/password-accounts.server')).setupWithPassword(request, body, trees);
              return json({ ok: true, tree }, 200, await s.startSession(request, user, null, true, 'password'));
            }
            case 'password-invite': {
              const { user } = await (await import('~/lib/auth/password-accounts.server')).inviteWithPassword(request, body, ip);
              return json({ ok: true }, 200, await s.startSession(request, user, null, true, 'password'));
            }
            // Which proof the signed-in reader can give (a passkey, or the password), and the password's own proof.
            case 'proof-kinds':
              return json(await (await proof()).proofKinds(await requireUser()));
            case 'confirm-password':
              await (await proof()).finishPasswordProof(request, await requireUser(), body, await attempt());
              return json({ ok: true });
            case 'email-code-request': {
              const { cookie } = await (await code()).requestSignInCode(request, body.email, ip);
              return json({ ok: true }, 200, cookie);
            }
            // An account with two-step codes still gives one (password.server.ts, stepTicket).
            case 'email-code':
              return codeAnswer(await (await code()).signInWithCode(request, body.code, ip));
            case 'email-code-second':
              return codeAnswer(await (await code()).signInCodeSecondStep(request, body, ip));
            case 'oidc-start': {
              // Adding a provider to the account, a fresh proof and the operator's test sign-in belong to the signed-in reader;
              // the guard also makes a "View as" preview's request read-only, which the start refuses.
              const user = body.purpose === 'link' || body.purpose === 'proof' || body.purpose === 'test' ? await requireUser() : undefined;
              if (body.purpose === 'signup' && !allow(`signup:${ip}`, 10, 10 * 60_000)) return json({ error: 'Too many attempts. Please wait a minute and try again.' }, 429);
              const { url, cookie } = await (await import('~/lib/auth/oidc.server')).startOidc(request, body, user, ip);
              return json({ url }, 200, cookie);
            }
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
