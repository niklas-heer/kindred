// Global middleware for every request Start handles: pages, server routes and server functions.
import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start';
import { originAllowed } from './lib/auth/origin';
import { addSecurityHeaders, newCspNonce } from './lib/auth/security-headers';
import { publicError } from './lib/server-errors';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

// Security headers (src/lib/auth/security-headers.ts) on every response Start returns, Node and Workers alike. Added
// only where a route has not set its own header, so the media route's Content-Security-Policy stays as it is. Placed
// first, so it also sees the 403 that the CSRF check below returns. A production build also gets a nonce per request:
// src/router.tsx reads it from this context and puts it on every inline script. (The dev server's own inline scripts have none.)
const securityHeaders = createMiddleware().server(async ({ next, request }) => {
  const cspNonce = import.meta.env.PROD ? newCspNonce() : undefined;
  const result = await next({ context: { cspNonce } });
  const options = { cspNonce, requestUrl: request.url };
  try {
    addSecurityHeaders(result.response.headers, options);
    return result;
  } catch {
    // Some responses have immutable headers: send an equivalent response that can take them.
    const headers = new Headers(result.response.headers);
    addSecurityHeaders(headers, options);
    return { ...result, response: new Response(result.response.body, { status: result.response.status, statusText: result.response.statusText, headers }) };
  }
});

// CSRF: a request that changes something must come from our own pages. Browsers say where a request
// came from (Sec-Fetch-Site, else Origin, else Referer); anything cross-site gets a 403. Server
// functions are checked whatever their method, server routes (like /api/auth) when they change state.
// Session cookies are also SameSite=Lax, so other sites' requests don't carry them in the first place.
// Behind a proxy the request's own address is not the site's, so the Origin is compared with KINDRED_ORIGIN when it is set.
const csrf = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn' || !SAFE.has(ctx.request.method),
  origin: (value, ctx) => originAllowed(value, ctx.request),
  // A function, not a Response: workerd refuses to create a Response while the module loads, which would fail every route.
  failureResponse: () =>
    new Response(JSON.stringify({ error: 'This request came from another site and was refused.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    }),
});

// A sign-in setting Kindred cannot use (src/lib/auth/method.server.ts) replaces the site with a page that says which one, before
// anything else runs. The health check stays up: it says the server answers, and the log says what to fix.
const authSettingGate = createMiddleware().server(async ({ next, request }) => {
  if (new URL(request.url).pathname === '/api/health') return next();
  const { authRefusal } = await import('./lib/auth/method.server');
  return authRefusal(request) ?? next();
});

// In code-protected mode, announce the setup code once while no account exists. Without a code, warn
// once when that setup is open on a public address (the first visitor would become the steward).
// Setup counts as public when either the configured origin or the address the request arrived at is public.
// A request arriving at another host than KINDRED_ORIGIN's is logged once: passkeys follow KINDRED_ORIGIN.
// The health check (/api/health) is left alone: it must not open the accounts database.
const setupNotice = createMiddleware().server(async ({ next, request }) => {
  if (new URL(request.url).pathname === '/api/health') return next();
  const { onGuestHost } = await import('./lib/auth/origin');
  if (onGuestHost(request)) return next();
  const { announceSetup, arrivedAt, logOriginMismatch, warnOpenSetup } = await import('./lib/auth/setup.server');
  const { siteOrigin } = await import('./lib/auth/session.server');
  try {
    const arrived = arrivedAt(request);
    logOriginMismatch(process.env.KINDRED_ORIGIN, arrived);
    const origin = siteOrigin(request);
    // The request is passed along so that, before the first account exists, it asks the accounts database only once.
    announceSetup(origin.origin, false, request);
    void warnOpenSetup(origin, arrived, request);
  } catch {}
  return next();
});

// Every server function, first in line so it also sees a failed validator: Start sends a thrown error's message to the
// browser and logs nothing, so an internal failure is logged here and replaced before it leaves (src/lib/server-errors.ts).
const serverFunctionErrors = createMiddleware({ type: 'function' }).server(async ({ next, serverFnMeta, data }) => {
  try {
    return await next();
  } catch (e) {
    throw publicError(e, { fn: serverFnMeta.name, data });
  }
});

export const startInstance = createStart(() => ({
  requestMiddleware: [securityHeaders, authSettingGate, csrf, setupNotice],
  functionMiddleware: [serverFunctionErrors],
}));
