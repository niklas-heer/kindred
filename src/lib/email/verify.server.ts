// Proving an email address (docs/hosting-many-families.md, "Email"; accounts migration 0053, `email_token`):
//
// - "Your email" in the account menu sends a one-time link, good for 24 hours, to the address typed. Opening it (and pressing
//   Confirm: a link checker that only fetches the page proves nothing) while signed in to the SAME account makes that address
//   the account's, verified (`user.email_verified`, which single sign-on's trusted emails and a password reset by email rely
//   on). A guest, someone signed out or another account is refused: the page asks them to sign in first, so nobody can attach
//   an address to an account they are not signed in to. The address changes only then, so a typo or someone else's address
//   never becomes the account's. Setting or changing the address needs a fresh proof on the session, as the address can reset
//   the password, and the old verified address is told of a change. One account and one network send a few links a day
//   (send.server.ts, SENDER_LIMITS).
// - At sign-up, a six-digit code to the address typed into the form, good for 15 minutes and five tries. The right code gives
//   the form a proof it sends with the sign-up; the batch that makes the account spends it, so a sign-up with a proved address
//   starts its family at once even while unverified sign-ups wait (src/lib/signup/signup.server.ts).
//
// Only hashes of links, codes and proofs are stored. An invitation's typed address is never verified by any of this.
import { AuthError } from '../auth/errors.ts';
import { authMethod } from '../auth/method.server.ts';
import { accounts, guard, isGuardError, now, q, userByEmail, userById, type UserRow } from '../auth/store.server.ts';
import { hashToken, randomToken, safeEqual } from '../auth/tokens.server.ts';
import { isUniqueError } from '../store/index.ts';
import { refuseReadOnly } from '../read-only.ts';
import type { Locale } from '../i18n/languages.ts';
import { securityNoticeTo } from './notify.server.ts';
import { emailOn, mailName, mailOrigin, sendMail } from './send.server.ts';
import { isMailAddress, SIGNUP_CODE_MS, SIGNUP_CODE_TRIES, VERIFY_LINK_MS } from './shared.ts';

const invalid = (key: string) => new AuthError('invalid', key);
const throttled = () => new AuthError('throttled', 'email.err.throttled');
/** How long a proved sign-up code may wait for its sign-up. */
export const PROOF_MS = 60 * 60_000;

/** An address as Kindred keeps it: trimmed, lower case, one plain mailbox. */
export function cleanAddress(typed: unknown): string {
  const email = typeof typed === 'string' ? typed.trim().toLowerCase() : '';
  if (!isMailAddress(email)) throw invalid('email.err.address');
  return email;
}

/** What a failed send means to the person waiting for it. */
function sendRefusal(result: string): AuthError | null {
  if (result === 'sent') return null;
  if (result === 'throttled') return throttled();
  if (result === 'off' || result === 'read-only') return invalid('email.err.off');
  if (result === 'invalid') return invalid('email.err.address');
  return invalid('email.err.failed');
}

// ---------- the account's own address ----------

/**
 * Sends a confirmation link for `typed` to the reader's account. `proof` checks a fresh proof on the session (proof.server.ts):
 * setting an address and changing it both need one. `ip` is the network it came from, counted with the account (SENDER_LIMITS).
 */
export async function startVerification(request: Request, user: UserRow, typed: unknown, proof: () => Promise<void>, ip?: string): Promise<{ email: string }> {
  if (authMethod() !== 'kindred') throw invalid('email.err.method');
  refuseReadOnly();
  const email = cleanAddress(typed);
  if (!(await emailOn(request))) throw invalid('email.err.off');
  await proof();
  const token = randomToken(32);
  const id = crypto.randomUUID();
  const t = now();
  await accounts().batch([
    q('DELETE FROM email_token WHERE expires < ? OR (purpose = ? AND user = ? AND used_at IS NULL)', t - PROOF_MS, 'verify', user.id),
    q('INSERT INTO email_token (id, purpose, user, email, secret, created, expires) VALUES (?, ?, ?, ?, ?, ?, ?)', id, 'verify', user.id, email, await hashToken('email-verify', token), t, t + VERIFY_LINK_MS),
  ]);
  const { result } = await sendMail({
    to: email, locale: (user.locale as Locale | null) ?? 'en', category: 'verify', request, from: { user: user.id, network: ip },
    body: (tr, { server, origin }) => ({
      subject: tr('email.mail.verify_subject'), greeting: tr('email.mail.greeting', { name: mailName(user.name) }),
      paragraphs: [tr('email.mail.verify_body', { email, server }), tr('email.mail.ignore')],
      action: { label: tr('email.mail.verify_action'), url: `${origin}/verify-email/${token}` },
    }),
  });
  const refusal = sendRefusal(result);
  if (refusal) {
    await accounts().run('DELETE FROM email_token WHERE id = ?', id);
    throw refusal;
  }
  return { email };
}

interface TokenRow { id: string; user: string | null; email: string; expires: number; used_at: number | null }

async function verifyRow(token: unknown): Promise<TokenRow | undefined> {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
  const row = await accounts().get<TokenRow>("SELECT id, user, email, expires, used_at FROM email_token WHERE secret = ? AND purpose = 'verify'", await hashToken('email-verify', token));
  return row && !row.used_at && row.expires > now() && row.user ? row : undefined;
}

/** Who is reading the confirmation page: the account the link is for, someone signed out (or a guest), or another account. */
export type VerifyReader = 'mine' | 'signed-out' | 'other';

/** What the confirmation page shows: whether the link holds, the address it confirms, and whether this reader may confirm it. */
export async function verificationInfo(token: unknown, reader: string | null): Promise<{ ok: false } | { ok: true; email: string; who: VerifyReader }> {
  const row = await verifyRow(token);
  if (!row) return { ok: false };
  return { ok: true, email: row.email, who: !reader ? 'signed-out' : reader === row.user ? 'mine' : 'other' };
}

/**
 * Confirms the address for `reader`, the signed-in account, which must be the one the link was made for: once (using the link
 * is the batch's first statement and its check), and only while no other account has the address. The account's address
 * becomes this one, verified; its other links go; a verified address it had before is told of the change.
 */
export async function redeemVerification(token: unknown, reader: string): Promise<{ email: string }> {
  refuseReadOnly();
  const gone = invalid('email.verify_gone');
  const row = await verifyRow(token);
  if (!row) throw gone;
  if (row.user !== reader) throw new AuthError('forbidden', 'email.err.other_account');
  const before = await userById(row.user!);
  const t = now();
  try {
    await accounts().batch([
      q('UPDATE email_token SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires > ?', t, row.id, t),
      guard('EXISTS (SELECT 1 FROM email_token WHERE id = ? AND used_at = ?)', row.id, t),
      guard('NOT EXISTS (SELECT 1 FROM user WHERE email = ? AND id <> ?)', row.email, row.user),
      guard('EXISTS (SELECT 1 FROM user WHERE id = ? AND retiring IS NULL)', row.user),
      q('UPDATE user SET email = ?, email_verified = 1 WHERE id = ?', row.email, row.user),
      q("DELETE FROM email_token WHERE purpose = 'verify' AND user = ? AND used_at IS NULL", row.user),
      // Codes to sign in that were emailed to the address it had, and the two-step tickets they opened, end with the change
      // (src/lib/auth/email-code.server.ts). Voided, not deleted: they still count against the account's codes this hour.
      q('UPDATE email_signin SET secret = NULL WHERE user = ?', row.user),
      q("DELETE FROM signin_step WHERE user = ? AND method = 'email-code'", row.user),
    ]);
  } catch (e) {
    if (isUniqueError(e)) throw invalid('email.err.taken');
    if (isGuardError(e)) {
      const other = await userByEmail(row.email);
      throw other && other.id !== row.user ? invalid('email.err.taken') : gone;
    }
    throw e;
  }
  // The address it had, if verified and another, hears of the change (without the new one): it could reset the password until now.
  if (before?.email && before.email_verified === 1 && before.email.toLowerCase() !== row.email) securityNoticeTo(before.email, before, 'email_changed');
  return { email: row.email };
}

// ---------- a code at sign-up ----------

/** Six random digits, every one as likely as another. */
export function sixDigits(): string {
  const limit = 4_294_000_000; // a multiple of 1,000,000 below 2^32: no digit is likelier
  for (;;) {
    const [n] = crypto.getRandomValues(new Uint32Array(1));
    if (n! < limit) return String(n! % 1_000_000).padStart(6, '0');
  }
}

const codeSecret = (ticket: string, code: string) => hashToken('email-code', `${ticket}:${code}`);

/**
 * Emails a code for the sign-up form. `allowed` says sign-up is open; `network` counts this network's try first
 * (../auth/attempts.server.ts, beginNetwork), so one place cannot send codes to a list of addresses. The code's email carries
 * nothing the form typed but the address. Returns the ticket the form sends back with the code.
 */
export async function sendSignupCode(request: Request, typed: unknown, locale: Locale, network: () => Promise<boolean>): Promise<{ ticket: string; email: string }> {
  refuseReadOnly();
  const email = cleanAddress(typed);
  if (!(await emailOn(request)) || !mailOrigin(request)) throw invalid('email.err.off');
  if (await network()) throw throttled();
  const code = sixDigits();
  const ticket = crypto.randomUUID();
  const t = now();
  await accounts().batch([
    q('DELETE FROM email_token WHERE expires < ?', t - PROOF_MS),
    q('INSERT INTO email_token (id, purpose, email, secret, created, expires) VALUES (?, ?, ?, ?, ?, ?)', ticket, 'signup', email, await codeSecret(ticket, code), t, t + SIGNUP_CODE_MS),
  ]);
  const { result } = await sendMail({
    to: email, locale, category: 'signup', request,
    body: (tr, { server }) => ({ subject: tr('email.mail.code_subject', { server }), paragraphs: [tr('email.mail.code_body'), tr('email.mail.ignore')], code }),
  });
  const refusal = sendRefusal(result);
  if (refusal) {
    await accounts().run('DELETE FROM email_token WHERE id = ?', ticket);
    throw refusal;
  }
  return { ticket, email };
}

/**
 * Checks a code. Every try is counted before the code is compared, and the sixth ends the ticket. The right code returns the
 * proof the sign-up sends; a ticket gives one proof.
 */
export async function checkSignupCode(ticket: unknown, code: unknown): Promise<{ proof: string; email: string }> {
  refuseReadOnly();
  const wrong = invalid('email.err.code');
  if (typeof ticket !== 'string' || !/^[0-9a-f-]{36}$/.test(ticket) || typeof code !== 'string') throw wrong;
  const typed = code.replace(/\s+/g, '');
  const t = now();
  const row = await accounts().get<{ secret: string; email: string; tries: number }>(
    "UPDATE email_token SET tries = tries + 1 WHERE id = ? AND purpose = 'signup' AND proved_at IS NULL AND expires > ? AND tries < ? RETURNING secret, email, tries", ticket, t, SIGNUP_CODE_TRIES);
  if (!row || !/^\d{6}$/.test(typed) || !(await safeEqual(await codeSecret(ticket, typed), row.secret))) throw wrong;
  const proof = randomToken(32);
  const claimed = await accounts().run("UPDATE email_token SET proof = ?, proved_at = ?, expires = ? WHERE id = ? AND proved_at IS NULL", await hashToken('email-proof', proof), t, t + PROOF_MS, ticket);
  if (claimed.changes !== 1) throw wrong;
  return { proof, email: row.email };
}

/** The proved code behind a sign-up's proof, when it proves this address and has not been used. */
export async function signupProof(email: string, proof: unknown): Promise<{ id: string } | undefined> {
  if (typeof proof !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(proof)) return undefined;
  const row = await accounts().get<{ id: string; email: string }>(
    "SELECT id, email FROM email_token WHERE proof = ? AND purpose = 'signup' AND proved_at IS NOT NULL AND used_at IS NULL AND expires > ?", await hashToken('email-proof', proof), now());
  return row && row.email === email.trim().toLowerCase() ? { id: row.id } : undefined;
}

/** The statements that spend a proof, for the batch that makes the account: the sign-up fails if another used it first. */
export const spendProof = (id: string, at: number) => [
  q('UPDATE email_token SET used_at = ? WHERE id = ? AND used_at IS NULL', at, id),
  guard('EXISTS (SELECT 1 FROM email_token WHERE id = ? AND used_at = ?)', id, at),
];
