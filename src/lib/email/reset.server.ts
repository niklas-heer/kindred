// "Forgot your password?" by email (docs/self-host.md, "Ways in"; docs/hosting-many-families.md, "Email"). Someone types an
// address on the sign-in page; Kindred answers the same, at once, whether or not an account has it, and only then, in the
// background, looks for an account whose VERIFIED address it is and that has a password. That account gets a one-hour,
// single-use link (a row of password_reset with `via` 'email', accounts migration 0054), and the reset page works as for an
// operator's link: a new password, the two-step code when those are on, every other session ended, and the lasting notice
// (password.server.ts). Each request is a try counted against the address and the network (../auth/attempts.server.ts) before
// anything else, so nobody can flood an inbox or probe addresses from one place.
import { attemptKeys, begin } from '../auth/attempts.server.ts';
import { AuthError } from '../auth/errors.ts';
import { makeResetLink, passwordAllowed, passwordOf } from '../auth/password.server.ts';
import { accounts, userByEmail } from '../auth/store.server.ts';
import { totpOn } from '../auth/totp.server.ts';
import type { Locale } from '../i18n/languages.ts';
import { emailOn, sendLater, sendMail } from './send.server.ts';
import { isMailAddress } from './shared.ts';

/**
 * Asks for a reset link. Resolves with nothing the caller could tell apart: the same answer for an unknown address, an
 * unverified one, an account without a password and a real one. The work happens after the answer (tests wait with settleSends).
 */
export async function requestPasswordReset(request: Request, typed: unknown, ip: string): Promise<{ ok: true }> {
  await passwordAllowed(request);
  if (!(await emailOn())) throw new AuthError('invalid', 'email.err.off');
  const email = typeof typed === 'string' ? typed.trim().toLowerCase() : '';
  if (!isMailAddress(email)) throw new AuthError('invalid', 'email.err.address');
  // Counted like a sign-in try of the address, from this network: over the limit is the same refusal for every address.
  const verdict = await begin(await attemptKeys(`mail:${email}`, ip));
  if (verdict.locked) throw new AuthError('throttled', 'pw.err.throttled');
  sendLater(() => sendResetLink(email, request));
  return { ok: true };
}

/** The work behind the answer: a link to an account that qualifies, and to no other. */
async function sendResetLink(email: string, request: Request): Promise<void> {
  const user = await userByEmail(email);
  if (!user || user.email_verified !== 1 || !user.username || user.retiring || !(await passwordOf(user.id))) return;
  if (user.email?.toLowerCase() !== email) return;
  const { token, writes } = await makeResetLink(user.id, null, false, 'email');
  await accounts().batch(writes);
  const twoStep = await totpOn(user.id);
  await sendMail({
    to: email, locale: (user.locale as Locale | null) ?? 'en', category: 'reset', request,
    body: (t, { server, origin }) => ({
      subject: t('email.mail.reset_subject'), greeting: t('email.mail.greeting', { name: user.name }),
      paragraphs: [t('email.mail.reset_body', { username: user.username!, server }), ...(twoStep ? [t('email.mail.reset_totp')] : []), t('email.mail.ignore')],
      action: { label: t('email.mail.reset_action'), url: `${origin}/reset/${token}` },
    }),
  });
}
