import { createFileRoute } from '@tanstack/react-router';

// Where a single sign-on provider sends the browser back (src/lib/auth/oidc.server.ts): exactly
// /api/auth/oidc/<provider>/callback, the redirect URI registered at the provider. A GET, as the provider makes it; it changes
// something only for the browser that started the flow (its flow cookie) and only once (the state's row is deleted first).
// It always answers with a redirect to a path on this site: the page that was asked for, or the sign-in page saying what failed.
export const Route = createFileRoute('/api/auth/oidc/$provider/callback')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const [{ finishOidc }, { allow, clientIP }] = await Promise.all([import('~/lib/auth/oidc.server'), import('~/lib/auth/throttle.server')]);
        const headers = new Headers({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
        if (!allow(`oidc-callback:${clientIP()}`, 30, 60_000)) {
          headers.set('Location', '/signin?oidc_error=throttled');
          return new Response(null, { status: 303, headers });
        }
        const { location, cookies } = await finishOidc(request, params.provider);
        headers.set('Location', location);
        for (const c of cookies) headers.append('Set-Cookie', c);
        return new Response(null, { status: 303, headers });
      },
    },
  },
});
