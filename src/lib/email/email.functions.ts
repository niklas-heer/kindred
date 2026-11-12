// Server functions for email (docs/hosting-many-families.md, "Email"): whether the server sends email (anyone may ask), the
// console's Email tab and its Health line (operators; a change needs a fresh proof and refuses in a demo or a preview), the
// reader's own address (account menu), the confirmation page, the code at sign-up, "Forgot your password?", an invitation sent
// by email (stewards), and unsubscribing. Server-only code is imported inside each handler.
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { MAIL_PROVIDERS, MAILGUN_REGIONS, PER_HOUR_MAX, SMTP_SECURITY, type MailHealth, type MailSettingsView } from './shared';

const guard = () => import('../auth/guard.server');
const startServer = () => import('@tanstack/react-start/server');

/** An AuthError (or a key thrown as an Error) as a failed call with its status; anything else as it is. */
async function failing<T>(work: () => Promise<T>): Promise<T> {
  const [{ fail }, { AuthError }] = await Promise.all([guard(), import('../auth/errors')]);
  try {
    return await work();
  } catch (e) {
    if (e instanceof AuthError) throw fail(e);
    if (e instanceof Error && /^email\.err\.[a-z_]+$/.test(e.message)) throw fail(new AuthError('invalid', e.message));
    throw e;
  }
}

// ---------- anyone ----------

/** Whether this server sends email now: the pages offer what needs it only then. Never in a demo. */
export const fetchMailOn = createServerFn({ method: 'GET' }).handler(async (): Promise<boolean> => {
  const [{ isDemo }, { emailOn }] = await Promise.all([import('../demo'), import('./send.server')]);
  return !isDemo() && (await emailOn());
});
export const mailOnQuery = queryOptions({ queryKey: ['instance', 'mail-on'], queryFn: () => fetchMailOn(), staleTime: 60_000 });

// ---------- the operator ----------

async function operatorWithProof() {
  const [{ requireOperator }, { refuseReadOnly }, { requireFreshProof }, { getRequest }] = await Promise.all([
    guard(), import('../read-only'), import('../auth/proof.server'), startServer(),
  ]);
  const op = await requireOperator();
  await failing(async () => {
    refuseReadOnly();
    await requireFreshProof(getRequest(), op);
  });
  return op;
}

export const fetchMailSettings = createServerFn({ method: 'GET' }).handler(async (): Promise<MailSettingsView> => {
  const { requireOperator } = await guard();
  await requireOperator();
  const [{ mailSettingsView }, { getRequest }] = await Promise.all([import('./settings.server'), startServer()]);
  return mailSettingsView(process.env, getRequest());
});
export const mailSettingsQuery = queryOptions({ queryKey: ['operator', 'mail'], queryFn: () => fetchMailSettings() });

const settingsInput = z.object({
  provider: z.enum(MAIL_PROVIDERS), fromName: z.string().max(200), fromAddress: z.string().max(300), replyTo: z.string().max(300),
  mailgunDomain: z.string().max(300), mailgunRegion: z.enum(MAILGUN_REGIONS), smtpHost: z.string().max(300), smtpPort: z.number().int().min(1).max(65535),
  smtpSecurity: z.enum(SMTP_SECURITY), smtpUser: z.string().max(300), perHour: z.number().int().min(1).max(PER_HOUR_MAX), secret: z.string().max(2000).optional(),
});

/** Saves the settings. The key is never sent back; logged without it. */
export const saveMailSettings = createServerFn({ method: 'POST' })
  .validator(settingsInput)
  .handler(async ({ data }) => {
    const op = await operatorWithProof();
    await failing(async () => {
      const [{ mailSettingsWrites }, { audit }, { store }, { mailOrigin }, { getRequest }] = await Promise.all([
        import('./settings.server'), import('../operator/settings.server'), import('../store/index'), import('./origin'), startServer(),
      ]);
      const writes = await mailSettingsWrites(data, op.id, Date.now(), mailOrigin(getRequest()));
      await store.accounts().batch([...writes, audit({ id: op.id, name: op.name }, 'mail.settings', null, { provider: data.provider, key: data.secret === undefined ? 'kept' : data.secret ? 'new' : 'removed' })]);
    });
    return { ok: true as const };
  });

/** Sends a test email to the address the operator types: the provider's answer comes back when it fails. */
export const sendTestMail = createServerFn({ method: 'POST' })
  .validator(z.object({ to: z.string().max(300) }))
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    const op = await operatorWithProof();
    return failing(async () => {
      const [{ cleanAddress }, { sendMail }, { getRequest }] = await Promise.all([import('./verify.server'), import('./send.server'), startServer()]);
      const to = cleanAddress(data.to);
      const { result, error } = await sendMail({
        to, locale: (op.locale as never) ?? 'en', category: 'test', request: getRequest(),
        body: (t, { server }) => ({ subject: t('email.mail.test_subject', { server }), greeting: t('email.mail.greeting', { name: op.name }), paragraphs: [t('email.mail.test_body')] }),
      });
      if (result === 'sent') return { ok: true };
      if (result === 'throttled') return { ok: false, error: 'email.err.throttled' };
      if (result === 'off' || result === 'read-only') return { ok: false, error: 'email.err.off' };
      return { ok: false, error: error ?? 'error' };
    });
  });

/** The Health tab's line: the last day's sends and the latest failures. */
export const fetchMailHealth = createServerFn({ method: 'GET' }).handler(async (): Promise<MailHealth> => {
  const { requireOperator } = await guard();
  await requireOperator();
  return (await import('./health.server')).mailHealth();
});
export const mailHealthQuery = queryOptions({ queryKey: ['operator', 'mail', 'health'], queryFn: () => fetchMailHealth() });

// ---------- the reader's own address ----------

export const fetchMyEmail = createServerFn({ method: 'GET' }).handler(async (): Promise<{ email: string | null; verified: boolean }> => {
  const { requireUser } = await guard();
  const user = await requireUser();
  return { email: user.email, verified: user.email_verified === 1 };
});
export const myEmailQuery = queryOptions({ queryKey: ['session', 'email'], queryFn: () => fetchMyEmail() });

/** Sends a confirmation link. Setting or changing the address needs a fresh proof; the account and its network are counted. */
export const startEmailVerification = createServerFn({ method: 'POST' })
  .validator(z.object({ email: z.string().max(300) }))
  .handler(async ({ data }) => {
    const [{ requireUser }, { getRequest }, v, { requireFreshProof }, { clientIP }] = await Promise.all([
      guard(), startServer(), import('./verify.server'), import('../auth/proof.server'), import('../auth/throttle.server'),
    ]);
    const user = await requireUser();
    const request = getRequest();
    return failing(() => v.startVerification(request, user, data.email, () => requireFreshProof(request, user), clientIP()));
  });

/**
 * Whether a confirmation link holds, its address, and whether the reader is the account it is for (else the page asks them to
 * sign in to it). POST, so the token never lands in a log. Open to anyone: the token is the secret, and it reads no family.
 */
export const fetchVerification = createServerFn({ method: 'POST' })
  .validator(z.object({ token: z.string().max(100) }))
  .handler(async ({ data }) => {
    const [{ verificationInfo }, { allow, clientIP }, { currentSession }] = await Promise.all([import('./verify.server'), import('../auth/throttle.server'), guard()]);
    if (!allow(`verify-check:${clientIP()}`, 30, 10 * 60_000)) return { ok: false as const };
    const { user } = await currentSession();
    return verificationInfo(data.token, user?.id ?? null);
  });

/** Confirms the address: only the signed-in account the link was made for (never a guest, never another account). */
export const confirmEmail = createServerFn({ method: 'POST' })
  .validator(z.object({ token: z.string().max(100) }))
  .handler(async ({ data }) => {
    const { requireUser } = await guard();
    const user = await requireUser();
    return failing(async () => (await import('./verify.server')).redeemVerification(data.token, user.id));
  });

// ---------- sign-up ----------

/** Emails a code to the address typed into the sign-up form, while sign-up is open. */
export const sendSignupCode = createServerFn({ method: 'POST' })
  .validator(z.object({ email: z.string().max(400), code: z.string().max(64).optional() }))
  .handler(async ({ data }) => failing(async () => {
    const [v, { signupState }, { beginNetwork }, { clientIP }, { getRequest }, { guestLocale }, { closedError }] = await Promise.all([
      import('./verify.server'), import('../signup/settings.server'), import('../auth/attempts.server'), import('../auth/throttle.server'), startServer(),
      import('../auth/session.server'), import('../signup/signup.server'),
    ]);
    const state = await signupState(data.code);
    if (!state.open) throw closedError(state.reason);
    const request = getRequest();
    const ip = clientIP();
    const { ticket, email } = await v.sendSignupCode(request, data.email, guestLocale(request), () => beginNetwork(ip));
    return { ticket, email };
  }));

export const checkSignupCode = createServerFn({ method: 'POST' })
  .validator(z.object({ ticket: z.string().max(64), code: z.string().max(20) }))
  .handler(async ({ data }) => failing(async () => (await import('./verify.server')).checkSignupCode(data.ticket, data.code)));

// ---------- a forgotten password ----------

/** Asks for a reset link by email: the same answer for every address. */
export const requestResetEmail = createServerFn({ method: 'POST' })
  .validator(z.object({ email: z.string().max(400) }))
  .handler(async ({ data }) => failing(async () => {
    const [{ requestPasswordReset }, { clientIP }, { getRequest }] = await Promise.all([import('./reset.server'), import('../auth/throttle.server'), startServer()]);
    return requestPasswordReset(getRequest(), data.email, clientIP());
  }));

// ---------- invitations ----------

/** Sends an invitation by email to the address its steward typed, with the link they hold. */
export const emailInvite = createServerFn({ method: 'POST' })
  .validator(z.object({ tree: z.string().max(80), id: z.string().uuid(), token: z.string().max(100) }))
  .handler(async ({ data }) => {
    const [{ requireCan }, { getRequest }, { clientIP }] = await Promise.all([guard(), startServer(), import('../auth/throttle.server')]);
    const { user } = await requireCan(data.tree, 'manage-access');
    return failing(async () => {
      const [{ inviteById }, { family }, { emailInvitation }, { refuseReadOnly }, { AuthError }] = await Promise.all([
        import('../auth/store.server'), import('../auth/trees.server'), import('./notify.server'), import('../read-only'), import('../auth/errors'),
      ]);
      refuseReadOnly();
      const invite = await inviteById(data.id);
      const fam = await family(data.tree);
      if (!invite || invite.tree !== data.tree || !fam) throw new AuthError('invalid', 'email.err.invite');
      const result = await emailInvitation(getRequest(), invite, data.token, user.name, fam.name, (user.locale as never) ?? 'en', { user: user.id, network: clientIP() });
      if (result === 'sent') return { email: invite.email! };
      throw new AuthError(result === 'throttled' ? 'throttled' : 'invalid', result === 'throttled' ? 'email.err.throttled' : result === 'off' ? 'email.err.off' : result === 'unsubscribed' ? 'email.err.invite' : 'email.err.failed');
    });
  });

// ---------- unsubscribing ----------

export const unsubscribeMail = createServerFn({ method: 'POST' })
  .validator(z.object({ r: z.string().max(100), c: z.string().max(40), t: z.string().max(100) }))
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const [{ unsubscribe }, { readOnly }] = await Promise.all([import('./send.server'), import('../read-only')]);
    if (readOnly()) return { ok: false };
    return { ok: await unsubscribe(data.r, data.c, data.t) };
  });
