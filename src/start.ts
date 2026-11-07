// Global middleware for every request Start handles: pages, server routes and server functions.
import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

// CSRF: a request that changes something must come from our own pages. Browsers say where a request
// came from (Sec-Fetch-Site, else Origin, else Referer); anything cross-site gets a 403. Server
// functions are checked whatever their method, server routes (like /api/auth) when they change state.
// Session cookies are also SameSite=Lax, so other sites' requests don't carry them in the first place.
const csrf = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn' || !SAFE.has(ctx.request.method),
  failureResponse: new Response(JSON.stringify({ error: 'This request came from another site and was refused.' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  }),
});

// In code-protected mode, announce the setup code once while no account exists.
const setupNotice = createMiddleware().server(async ({ next, request }) => {
  const { announceSetup } = await import('./lib/auth/setup.server');
  const { siteOrigin } = await import('./lib/auth/session.server');
  try { announceSetup(siteOrigin(request).origin); } catch {}
  return next();
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrf, setupNotice],
}));
