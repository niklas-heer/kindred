// Server functions for the ways into an account: what the sign-in pages may offer, the reader's own password and two-step
// codes (the account menu), the operator's sign-in tab and reset links, and the reset page. Server-only code is imported
// inside each handler. The sign-in forms themselves post to /api/auth (src/routes/api/auth/$action.ts), which sets cookies.
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { MySignIn } from './my-signin.server';
import { SIGN_IN_METHODS, type SignInMethod, type SignInSettings } from './methods';
import { OIDC_KINDS, type ProviderView, type PublicProvider } from './oidc';
import type { MyProvider } from './oidc.server';

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

/**
 * The ways in the sign-in, setup, invitation and join pages may offer, and the single sign-on providers' buttons. Empty under
 * Cloudflare Access and in a demo. Anyone may ask.
 */
export const fetchSignInMethods = createServerFn({ method: 'GET' }).handler(async (): Promise<{ methods: SignInMethod[]; providers: PublicProvider[] }> => {
  const [{ enabledMethods }, { isDemo }, { signInProviders }] = await Promise.all([import('./methods.server'), import('../demo'), import('./oidc.server')]);
  if (isDemo()) return { methods: [], providers: [] };
  return { methods: await enabledMethods(), providers: await signInProviders() };
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

/** The single sign-on providers this server offers, and which the reader's account uses. */
export const fetchMyProviders = createServerFn({ method: 'GET' }).handler(async (): Promise<MyProvider[]> => {
  const [{ requireUser }, { myProviders }] = await Promise.all([guard(), import('./oidc.server')]);
  return myProviders(await requireUser());
});
export const myProvidersQuery = queryOptions({ queryKey: ['session', 'signin', 'oidc'], queryFn: () => fetchMyProviders() });

/** Removes a single sign-on provider from the reader's account. Needs a fresh proof; refused for the last way in. */
export const unlinkMyProvider = createServerFn({ method: 'POST' })
  .validator(z.object({ provider: z.string().max(40) }))
  .handler(async ({ data }): Promise<{ signedOut: boolean }> => {
    const [{ requireUser }, { unlinkMine }, { getRequest }, { sessionStillOpen }] = await Promise.all([guard(), import('./oidc.server'), import('@tanstack/react-start/server'), import('./session.server')]);
    const user = await requireUser();
    await failing(() => unlinkMine(getRequest(), user, data.provider));
    return { signedOut: !(await sessionStillOpen(getRequest())) };
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

/** The single sign-on providers, and the site's origin the redirect URIs start with. */
export const fetchProviders = createServerFn({ method: 'GET' }).handler(async (): Promise<{ origin: string; providers: ProviderView[] }> => {
  const [{ requireOperator }, { getRequest }, { siteOrigin }] = await Promise.all([guard(), import('@tanstack/react-start/server'), import('./origin')]);
  await requireOperator();
  return { origin: siteOrigin(getRequest()).origin, providers: await (await import('../operator/signin.server')).listProviders() };
});
export const providersQuery = queryOptions({ queryKey: ['operator', 'signin', 'providers'], queryFn: () => fetchProviders() });

const providerInput = z.object({
  id: z.string().max(40), kind: z.enum(OIDC_KINDS), label: z.string().max(200), issuer: z.string().max(500), clientId: z.string().max(500),
  secret: z.string().max(2000).optional(), scopes: z.string().max(1000), trustEmail: z.boolean(), enabled: z.boolean(),
});

export const saveProvider = createServerFn({ method: 'POST' })
  .validator(providerInput)
  .handler(async ({ data }) => {
    const op = await operatorWithProof();
    await failing(async () => (await import('../operator/signin.server')).setProvider(op, data));
    return { ok: true as const };
  });

export const deleteProvider = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().max(40) }))
  .handler(async ({ data }) => {
    const op = await operatorWithProof();
    await failing(async () => (await import('../operator/signin.server')).removeProvider(op, data.id));
    return { ok: true as const };
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

// ---------- the notice after an operator's reset link ----------

/** When an operator's reset link was used on the reader's account, and whether this session may dismiss it; null otherwise. */
export const fetchResetNotice = createServerFn({ method: 'GET' }).handler(async (): Promise<{ at: number; dismissible: boolean } | null> => {
  const [{ currentSession, requireUser }, { resetNoticeOf }, { isDemo }] = await Promise.all([guard(), import('./password.server'), import('../demo')]);
  const user = await requireUser();
  const s = await currentSession();
  if (s.via !== 'passkey' || s.viewAs || isDemo()) return null;
  return resetNoticeOf(user.id, s.method ?? 'passkey');
});
export const resetNoticeQuery = queryOptions({ queryKey: ['session', 'reset-notice'], queryFn: () => fetchResetNotice(), staleTime: 5 * 60_000 });

/** Dismisses that notice (refused from a password session, and in a preview or a demo, which write nothing). */
export const dismissResetNotice = createServerFn({ method: 'POST' }).handler(async (): Promise<void> => {
  const [{ currentSession, requireUser }, p, { refuseReadOnly }] = await Promise.all([guard(), import('./password.server'), import('../read-only')]);
  const user = await requireUser();
  const s = await currentSession();
  await failing(async () => {
    refuseReadOnly();
    await p.dismissResetNotice(user.id, s.method ?? 'passkey');
  });
});
