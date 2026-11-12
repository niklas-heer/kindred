// Server functions for the landing page, the sign-up page (/signup) and the console's Hosting tab. A new account signs up
// through the passkey ceremony (routes/api/auth/$action.ts); these are the rest: what anyone may know of the hosting side,
// someone signed in starting a family, the waiting list, and the operator's settings and codes. Every console function
// checks `requireOperator` on the server, and every change refuses while nothing may be written (a demo, a "View as" preview).
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { LOCALES } from '../i18n/languages';
import {
  DEMO_URL_MAX, INSTANCE_MODES, LANDING_TEXT_MAX, PER_ACCOUNT_MAX, PER_DAY_MAX, TOTAL_MAX, UNVERIFIED,
  type HostingSettings, type PublicHosting, type Readiness, type RecentSignup, type SignupCode,
} from './shared';

const guard = () => import('../auth/guard.server');
const work = () => import('./signup.server');

async function failed(e: unknown): Promise<unknown> {
  const [{ fail }, { AuthError }] = await Promise.all([guard(), import('../auth/errors')]);
  return e instanceof AuthError ? fail(e) : e;
}

async function operatorForChange() {
  const [{ requireOperator }, { refuseReadOnly }] = await Promise.all([guard(), import('../read-only')]);
  const op = await requireOperator();
  try {
    refuseReadOnly();
  } catch (e) {
    throw await failed(e);
  }
  return op;
}

// ---------- public ----------

/** The landing page's and the sign-up page's facts: the mode, the operator's paragraph, whether sign-up is open (with a code). */
export const fetchPublicHosting = createServerFn({ method: 'GET' })
  .validator(z.object({ code: z.string().max(64).optional() }))
  .handler(async ({ data }): Promise<PublicHosting> => (await import('./settings.server')).publicHosting(data.code));
export const publicHostingQuery = (code?: string) => queryOptions({
  queryKey: ['instance', 'hosting', code ?? ''], queryFn: () => fetchPublicHosting({ data: code ? { code } : {} }), staleTime: 60_000,
});

const form = {
  familyName: z.string().max(400), familyId: z.string().max(80), email: z.string().max(400), theme: z.enum(['codex', 'modern']).optional(),
  accept: z.boolean(), age16: z.boolean(), code: z.string().max(64).optional(), locale: z.enum(LOCALES).optional(),
  website: z.string().max(200).optional(), turnstile: z.string().max(2048).optional(),
};

/** Someone signed in starts a family with their own account, within the families each account may make by sign-up. */
export const signupSignedIn = createServerFn({ method: 'POST' })
  .validator(z.object(form))
  .handler(async ({ data }): Promise<{ tree: string }> => {
    const [{ requireUser }, { refuseReadOnly }, { clientIP }, w] = await Promise.all([guard(), import('../read-only'), import('../auth/throttle.server'), work()]);
    const user = await requireUser();
    try {
      refuseReadOnly();
      const clean = w.cleanForm(data, false);
      const checked = await w.precheck(clean, { ip: clientIP(), honeypot: data.website, turnstile: data.turnstile });
      if (!checked) throw w.closedError('closed');
      if (checked.state.waitlist) throw w.closedError('closed');
      return { tree: (await w.completeSignup({ kind: 'existing', user }, clean, checked.network)).tree };
    } catch (e) {
      throw await failed(e);
    }
  });

/** Unverified sign-ups wait (the operator's choice): the sign-up form sends a request to the waiting list instead. */
export const signupWaitlist = createServerFn({ method: 'POST' })
  .validator(z.object({ ...form, name: z.string().max(400) }))
  .handler(async ({ data }): Promise<{ email: string }> => {
    const [{ refuseReadOnly }, { clientIP }, w, s] = await Promise.all([import('../read-only'), import('../auth/throttle.server'), work(), import('./settings.server')]);
    try {
      refuseReadOnly();
      const clean = w.cleanForm(data, true);
      const state = await s.signupState(clean.code);
      if (!state.open || !state.waitlist) throw w.closedError(state.open ? 'closed' : state.reason);
      return await w.signupToWaitlist(clean, { ip: clientIP(), honeypot: data.website, turnstile: data.turnstile });
    } catch (e) {
      throw await failed(e);
    }
  });

// ---------- the console ----------

export interface HostingConsole {
  settings: HostingSettings;
  readiness: Readiness;
  counts: { day: number; total: number };
  codes: SignupCode[];
  recent: RecentSignup[];
}

export const fetchHostingConsole = createServerFn({ method: 'GET' }).handler(async (): Promise<HostingConsole> => {
  const { requireOperator } = await guard();
  await requireOperator();
  return (await work()).hostingConsole();
});
export const hostingConsoleQuery = queryOptions({ queryKey: ['operator', 'hosting'], queryFn: () => fetchHostingConsole() });

export const saveHostingSettings = createServerFn({ method: 'POST' })
  .validator(z.object({
    mode: z.enum(INSTANCE_MODES), perAccount: z.number().int().min(0).max(PER_ACCOUNT_MAX), perDay: z.number().int().min(0).max(PER_DAY_MAX),
    total: z.number().int().min(0).max(TOTAL_MAX).nullable(), unverified: z.enum(UNVERIFIED), landingText: z.string().max(LANDING_TEXT_MAX * 2),
    demoUrl: z.string().max(DEMO_URL_MAX), backups: z.boolean(),
  }))
  .handler(async ({ data }) => {
    const op = await operatorForChange();
    try {
      await (await work()).updateHosting(op, data);
    } catch (e) {
      throw await failed(e);
    }
    return { ok: true as const };
  });

/** Makes a sign-up code; the code comes back once. */
export const makeSignupCode = createServerFn({ method: 'POST' })
  .validator(z.object({ label: z.string().max(200), usesMax: z.number().int().min(1).max(10_000), expires: z.number().int().positive().nullable() }))
  .handler(async ({ data }) => {
    const op = await operatorForChange();
    try {
      return await (await work()).makeCode(op, data);
    } catch (e) {
      throw await failed(e);
    }
  });

export const revokeSignupCode = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const op = await operatorForChange();
    try {
      await (await work()).revokeCode(op, data.id);
    } catch (e) {
      throw await failed(e);
    }
    return { ok: true as const };
  });
