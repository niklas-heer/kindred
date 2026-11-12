// Server functions for the ways into an account: what the sign-in pages may offer, the reader's own password and two-step
// codes (the account menu), the operator's sign-in tab and reset links, and the reset page. Server-only code is imported
// inside each handler. The sign-in forms themselves post to /api/auth (src/routes/api/auth/$action.ts), which sets cookies.
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { MySignIn } from './my-signin.server';
import { SIGN_IN_METHODS, type SignInMethod, type SignInSettings } from './methods';

const guard = () => import('./guard.server');
const mine = () => import('./my-signin.server');

/** An AuthError as a failed call with its status; anything else as it is. */
async function failing<T>(work: () => Promise<T>): Promise<T> {
  const [{ fail }, { AuthError }] = await Promise.all([guard(), import('./errors')]);
  try {
    return await work();
  } catch (e) {
    throw e instanceof AuthError ? fail(e) : e;
  }
}

/** The ways in the sign-in, setup, invitation and join pages may offer. Empty under Cloudflare Access. Anyone may ask. */
export const fetchSignInMethods = createServerFn({ method: 'GET' }).handler(async (): Promise<{ methods: SignInMethod[] }> => {
  const [{ enabledMethods }, { isDemo }] = await Promise.all([import('./methods.server'), import('../demo')]);
  return { methods: isDemo() ? [] : await enabledMethods() };
});
export const signInMethodsQuery = queryOptions({ queryKey: ['signin-methods'], queryFn: () => fetchSignInMethods(), staleTime: 60_000 });

// ---------- the reader's own ways in ----------

export const fetchMySignIn = createServerFn({ method: 'GET' }).handler(async (): Promise<MySignIn> => {
  const [{ requireUser }, m, { getRequest }] = await Promise.all([guard(), mine(), import('@tanstack/react-start/server')]);
  return m.mySignIn(getRequest(), await requireUser());
});
export const mySignInQuery = queryOptions({ queryKey: ['session', 'signin'], queryFn: () => fetchMySignIn() });

/** Sets the reader's password (their first one chooses the username). Needs a fresh proof. */
export const setMyPassword = createServerFn({ method: 'POST' })
  .validator(z.object({ username: z.string().max(200).optional(), password: z.string().max(2000) }))
  .handler(async ({ data }) => {
    const [{ requireUser }, m, { getRequest }] = await Promise.all([guard(), mine(), import('@tanstack/react-start/server')]);
    const user = await requireUser();
    return failing(() => m.setMyPassword(getRequest(), user, data));
  });

/** Removes the reader's password; `signedOut` when this session was a password's. Needs a fresh proof. */
export const removeMyPassword = createServerFn({ method: 'POST' }).handler(async (): Promise<{ signedOut: boolean }> => {
  const [{ requireUser }, m, { getRequest }, { sessionStillOpen }] = await Promise.all([guard(), mine(), import('@tanstack/react-start/server'), import('./session.server')]);
  const user = await requireUser();
  await failing(() => m.removeMyPassword(getRequest(), user));
  return { signedOut: !(await sessionStillOpen(getRequest())) };
});

export const startMyTotp = createServerFn({ method: 'POST' }).handler(async () => {
  const [{ requireUser }, m, { getRequest }] = await Promise.all([guard(), mine(), import('@tanstack/react-start/server')]);
  const user = await requireUser();
  return failing(() => m.startMyTotp(getRequest(), user));
});

export const confirmMyTotp = createServerFn({ method: 'POST' })
  .validator(z.object({ code: z.string().max(20) }))
  .handler(async ({ data }) => {
    const [{ requireUser }, m, { getRequest }] = await Promise.all([guard(), mine(), import('@tanstack/react-start/server')]);
    const user = await requireUser();
    return failing(() => m.confirmMyTotp(getRequest(), user, data.code));
  });

export const stopMyTotp = createServerFn({ method: 'POST' }).handler(async () => {
  const [{ requireUser }, m, { getRequest }] = await Promise.all([guard(), mine(), import('@tanstack/react-start/server')]);
  const user = await requireUser();
  await failing(() => m.stopMyTotp(getRequest(), user));
  return { ok: true as const };
});

export const renewMyRecoveryCodes = createServerFn({ method: 'POST' }).handler(async () => {
  const [{ requireUser }, m, { getRequest }] = await Promise.all([guard(), mine(), import('@tanstack/react-start/server')]);
  const user = await requireUser();
  return failing(() => m.renewMyRecoveryCodes(getRequest(), user));
});

// ---------- the operator ----------

/** The operator, for a change: refused in a demo and in a preview, and only with a fresh proof on this session. */
async function operatorWithProof() {
  const [{ requireOperator }, { refuseReadOnly }, { requireFreshProof }, { getRequest }] = await Promise.all([
    guard(), import('../read-only'), import('./proof.server'), import('@tanstack/react-start/server'),
  ]);
  const op = await requireOperator();
  await failing(async () => {
    refuseReadOnly();
    await requireFreshProof(getRequest(), op);
  });
  return op;
}

export const fetchSignInSettings = createServerFn({ method: 'GET' }).handler(async (): Promise<SignInSettings> => {
  const { requireOperator } = await guard();
  await requireOperator();
  return (await import('../operator/signin.server')).signInSettings();
});
export const signInSettingsQuery = queryOptions({ queryKey: ['operator', 'signin'], queryFn: () => fetchSignInSettings() });

const methodList = z.array(z.enum(SIGN_IN_METHODS)).max(SIGN_IN_METHODS.length);

/** What a change would do, before it is saved: which methods go and how many accounts would be left with no way in. */
export const previewSignInMethods = createServerFn({ method: 'POST' })
  .validator(z.object({ methods: methodList }))
  .handler(async ({ data }) => {
    const { requireOperator } = await guard();
    await requireOperator();
    return (await import('../operator/signin.server')).previewMethods(data.methods);
  });

export const saveSignInMethods = createServerFn({ method: 'POST' })
  .validator(z.object({ methods: methodList }))
  .handler(async ({ data }) => {
    const op = await operatorWithProof();
    return failing(async () => (await import('../operator/signin.server')).setSignInMethods(op, data.methods));
  });

export const makeResetLink = createServerFn({ method: 'POST' })
  .validator(z.object({ who: z.string().min(1).max(254), clearTotp: z.boolean() }))
  .handler(async ({ data }) => {
    const op = await operatorWithProof();
    return failing(async () => (await import('../operator/signin.server')).resetLinkFor(op, data.who, data.clearTotp));
  });

// ---------- the reset page ----------

/** Whether a reset link holds, and for whom. POST, so the token never lands in a log. */
export const fetchResetLink = createServerFn({ method: 'POST' })
  .validator(z.object({ token: z.string().max(100) }))
  .handler(async ({ data }) => {
    const [{ resetLinkInfo }, { allow, clientIP }] = await Promise.all([import('./password.server'), import('./throttle.server')]);
    if (!allow(`reset-check:${clientIP()}`, 30, 10 * 60_000)) return { ok: false as const };
    return resetLinkInfo(data.token);
  });
