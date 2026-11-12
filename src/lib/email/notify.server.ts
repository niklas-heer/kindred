// The emails Kindred sends about something that happened (docs/hosting-many-families.md, "Email"; docs/gdpr.md, "Email"):
//
// - security notices, to the account's VERIFIED address only, always while email is on (they cannot be unsubscribed): a
//   password changed or reset (with a link sent by email, a recovery code, or an operator's link), a new way in (a passkey, a
//   password, single sign-on), two-step codes turned off, and to the OLD verified address when the account's address changed;
// - an invitation, when its steward asks (the address they typed; the link is still theirs to copy), a few a day per account
//   and network (send.server.ts, SENDER_LIMITS);
// - the operators (verified addresses), about a new family request or data request, at most every ten minutes each;
// - a data request's receipt with its deadline, to the address typed into the form: the only email to an address nobody
//   verified besides a code, at most one a day to one address, and it carries nothing the requester wrote (no name, no
//   message) so it cannot carry spam;
// - a family's stewards (verified addresses), when the operator hands them a data request, and for a breach notice (a
//   `notice`, which cannot be unsubscribed, as the lifecycle's final notice: src/lib/notify/stewards.server.ts).
//
// The only words a reader chose that an email carries are names (an account's, a family's), cut to one short line (mailName).
// Every one goes through sendMail (send.server.ts): nothing in a demo or a preview, the limits, the unsubscribe, the language.
// None waits for the provider: they are sent after the answer (`sendLater`) and never fail what caused them.
import type { Locale } from '../i18n/languages.ts';
import { isLocale } from '../i18n/types.ts';
import { accounts, userById, type InviteRow } from '../auth/store.server.ts';
import { hashToken, safeEqual } from '../auth/tokens.server.ts';
import { AuthError } from '../auth/errors.ts';
import { mailDate, mailDay, mailName, sendLater, sendMail, type Body, type SendResult } from './send.server.ts';
import type { MailCategory } from './shared.ts';
import { q, type Query } from '../store/index.ts';
import type { Key } from '../i18n/dictionary.ts';
import type { Vars } from '../i18n/types.ts';

const localeOf = (l: unknown): Locale => (isLocale(l) ? l : 'en');

// ---------- security ----------

export type SecurityKind = 'password_changed' | 'password_reset' | 'recovery_reset' | 'operator_reset' | 'passkey_added' | 'password_added' | 'sso_added' | 'totp_off' | 'email_changed';

const SECURITY_KEY: Record<SecurityKind, Key> = {
  password_changed: 'email.mail.sec_password_changed', password_reset: 'email.mail.sec_password_reset', recovery_reset: 'email.mail.sec_recovery_reset',
  operator_reset: 'email.mail.sec_operator_reset', passkey_added: 'email.mail.sec_passkey_added', password_added: 'email.mail.sec_password_added',
  sso_added: 'email.mail.sec_sso_added', totp_off: 'email.mail.sec_totp_off', email_changed: 'email.mail.sec_email_changed',
};

type Holder = { name: string; locale: string | null };

/** Tells the account's holder about a change to its ways in, at its verified address. Sent later; never throws. */
export function securityNotice(user: string, kind: SecurityKind, request?: Request, vars: { provider?: string } = {}, at = Date.now()): void {
  sendLater(async () => {
    const u = await userById(user);
    if (!u?.email || u.email_verified !== 1) return;
    await securityMail(u.email, u, kind, request, vars, at);
  });
}

/** The same notice to an address the account had (its old verified address, after a change). Sent later; never throws. */
export function securityNoticeTo(address: string, holder: Holder, kind: SecurityKind, request?: Request, at = Date.now()): void {
  sendLater(() => securityMail(address, holder, kind, request, {}, at));
}

const securityMail = (to: string, u: Holder, kind: SecurityKind, request: Request | undefined, vars: { provider?: string }, at: number) => sendMail({
  to, locale: localeOf(u.locale), category: 'security', request,
  body: (t, { server }) => ({
    subject: t('email.mail.security_subject', { server }), greeting: t('email.mail.greeting', { name: mailName(u.name) }),
    paragraphs: [t(SECURITY_KEY[kind], { date: mailDate(at, localeOf(u.locale)), provider: mailName(vars.provider ?? '') }), t('email.mail.not_you')],
  }),
});

// ---------- invitations ----------

/**
 * Sends an invitation to the address its steward typed, with the link they hold (`token`, checked against the invitation's
 * hash: only who made or renewed the link has it). The steward's and the family's names are theirs: one short line each, and
 * escaped. `from` is the steward's account and network, counted against SENDER_LIMITS.
 */
export async function emailInvitation(request: Request, invite: InviteRow, token: string, inviterName: string, familyName: string, locale: Locale, from?: { user: string; network?: string }): Promise<SendResult> {
  const inviter = mailName(inviterName);
  const family = mailName(familyName);
  if (!invite.email || invite.used_at || invite.revoked_at || invite.expires <= Date.now()) throw new AuthError('invalid', 'email.err.invite');
  if (!(await safeEqual(await hashToken('invite', token), invite.hash))) throw new AuthError('invalid', 'email.err.invite');
  const { result } = await sendMail({
    to: invite.email, locale, category: 'invitation', request, from,
    body: (t, { server, origin }) => ({
      subject: t('email.mail.invite_subject', { inviter, family }),
      paragraphs: [t('email.mail.invite_body', { inviter, family, server, date: mailDay(invite.expires, locale) }), t('email.mail.invite_unknown', { inviter })],
      action: { label: t('email.mail.invite_action'), url: `${origin}/invite/${token}` },
    }),
  });
  return result;
}

// ---------- the operators ----------

/** The shortest time between two emails about new requests to one operator. */
export const OPERATOR_EMAIL_GAP_MS = 10 * 60_000;

/** Tells each operator with a verified address that a request is waiting: nothing of what was asked or by whom. */
export function emailOperators(kind: 'family' | 'data', request?: Request): void {
  sendLater(async () => {
    const ops = await accounts().all<{ email: string; name: string; locale: string | null }>('SELECT email, name, locale FROM user WHERE operator = 1 AND email_verified = 1 AND email IS NOT NULL');
    for (const op of ops) {
      await sendMail({
        to: op.email, locale: localeOf(op.locale), category: 'operator', request, gapMs: OPERATOR_EMAIL_GAP_MS,
        body: (t, { server, origin }) => ({
          subject: t('email.mail.operator_subject', { server }), greeting: t('email.mail.greeting', { name: mailName(op.name) }),
          paragraphs: [t(kind === 'family' ? 'email.mail.operator_family' : 'email.mail.operator_data')],
          action: { label: t('email.mail.operator_action'), url: `${origin}/operator?tab=${kind === 'family' ? 'requests' : 'data'}` },
        }),
      });
    }
  });
}

// ---------- the requester ----------

/** The shortest time between two receipts to one address: a form sent again and again sends one email a day. */
export const RECEIPT_GAP_MS = 24 * 60 * 60_000;

/** The receipt for a data request: when it came, and the date it must be answered by. Nothing the requester wrote. */
export function emailDataReceipt(to: string, created: number, deadline: number, locale: Locale, request?: Request): void {
  sendLater(() => sendMail({
    to, locale, category: 'receipt', request, gapMs: RECEIPT_GAP_MS,
    body: (t, { server }) => ({
      subject: t('email.mail.receipt_subject'),
      paragraphs: [t('email.mail.receipt_body', { server, date: mailDay(created, locale), deadline: mailDay(deadline, locale) }), t('email.mail.receipt_ignore')],
    }),
  }));
}

// ---------- a family's stewards ----------

type StewardWrite = (t: (key: Key, vars?: Vars) => string, ctx: { server: string; origin: string; family: string; locale: Locale }) => Body;
type StewardOptions = { request?: Request; category?: MailCategory };

/**
 * Emails each steward of `tree` with a verified address, in their language, and returns to how many it went out. `write` gets
 * the family's name. `category` 'family' (the default) carries the unsubscribe; 'notice' is for what they must get.
 */
export async function mailStewards(tree: string, write: StewardWrite, opts: StewardOptions = {}): Promise<number> {
  const stewards = await accounts().all<{ email: string; name: string; locale: string | null }>(
    "SELECT u.email, u.name, u.locale FROM membership m JOIN user u ON u.id = m.user WHERE m.tree = ? AND m.role = 'steward' AND u.email_verified = 1 AND u.email IS NOT NULL", tree);
  if (!stewards.length) return 0;
  const family = mailName(await familyName(tree));
  let delivered = 0;
  for (const s of stewards) {
    const locale = localeOf(s.locale);
    const { result } = await sendMail({
      to: s.email, locale, category: opts.category ?? 'family', request: opts.request,
      body: (t, ctx) => ({ greeting: t('email.mail.greeting', { name: mailName(s.name) }), ...write(t, { ...ctx, family, locale }) }),
    });
    if (result === 'sent') delivered++;
  }
  return delivered;
}

/** mailStewards after the answer: for a request that should not wait for the provider. Never throws. */
export function emailStewards(tree: string, write: StewardWrite, opts: StewardOptions = {}): void {
  sendLater(() => mailStewards(tree, write, opts));
}

async function familyName(tree: string): Promise<string> {
  try {
    const { family } = await import('../auth/trees.server.ts');
    return (await family(tree))?.name ?? tree;
  } catch {
    return tree;
  }
}

/** A data request handed to the family's stewards: that it waits on their Access page, and its deadline. */
export const emailStewardsDataRequest = (tree: string, deadline: number, request?: Request) =>
  emailStewards(tree, (t, { server, origin, family, locale }) => ({
    subject: t('email.mail.steward_data_subject', { family }),
    paragraphs: [t('email.mail.steward_data_body', { server, family, deadline: mailDay(deadline, locale) })],
    action: { label: t('email.mail.steward_data_action'), url: `${origin}/${tree}/access` },
  }), { request });

/**
 * Sets a breach's notice for the stewards of the families it affects (every family when `families` is null), one row each in
 * `breach_mail` (accounts migration 0057): a changed notice starts over, so each of them gets the new text. Call
 * deliverBreachNotices to send them.
 */
export function queueBreachNotice(breach: string, families: string[] | null, now = Date.now()): Query[] {
  return [
    q('DELETE FROM breach_mail WHERE breach = ?', breach),
    q(`INSERT INTO breach_mail (breach, user, family, at) SELECT DISTINCT ?, m.user, m.tree, ? FROM membership m
       WHERE m.role = 'steward' AND (? IS NULL OR m.tree IN (SELECT value FROM json_each(?)))`,
      breach, now, families ? 1 : null, JSON.stringify(families ?? [])),
  ];
}

/** How many times a breach notice is tried for one steward before the daily job gives up on it. */
export const BREACH_TRIES = 14;
/** Results that no later try changes. */
const FINAL: SendResult[] = ['invalid'];

/**
 * Sends the breach notices not sent yet (of one breach, or all), while their breach is open and its notice shown: the operator's
 * own words, which the law asks for, as a `notice` that cannot be unsubscribed. Each row is claimed before it is sent, so two
 * runs never send one twice. Records each result; returns how many went out and how many are left to try later (the daily
 * `breach-notices` job). Never throws for one steward.
 */
export async function deliverBreachNotices(now = Date.now(), breach?: string, request?: Request): Promise<{ sent: number; left: number }> {
  // A row still to try (`p` its table's alias and dot): not sent, tries left, no final result, its breach open and its notice shown.
  const open = (p: string) => `${p}sent_at IS NULL AND ${p}tries < ${BREACH_TRIES} AND (${p}result IS NULL OR ${p}result NOT IN (${FINAL.map((r) => `'${r}'`).join(', ')}))
    AND ${p}breach IN (SELECT id FROM breach WHERE notice <> '' AND closed_at IS NULL AND (notice_until IS NULL OR notice_until > ?))${breach ? ` AND ${p}breach = ?` : ''}`;
  const args = [now, ...(breach ? [breach] : [])];
  const rows = await accounts().all<{ breach: string; user: string; family: string; tries: number; notice: string; email: string | null; verified: number; name: string; locale: string | null }>(
    `SELECT bm.breach, bm.user, bm.family, bm.tries, b.notice, u.email, u.email_verified AS verified, u.name, u.locale
       FROM breach_mail bm JOIN breach b ON b.id = bm.breach JOIN user u ON u.id = bm.user
      WHERE ${open('bm.')}
      ORDER BY bm.at, bm.breach, bm.family, bm.user`, ...args);
  let sent = 0;
  const names = new Map<string, string>();
  for (const r of rows) {
    // Claimed: a parallel run finds the try counted and leaves the row alone.
    const claim = await accounts().batch([q('UPDATE breach_mail SET tries = tries + 1 WHERE breach = ? AND user = ? AND family = ? AND tries = ? AND sent_at IS NULL RETURNING tries', r.breach, r.user, r.family, r.tries)]);
    if (!(claim[0]?.rows as unknown[] | undefined)?.length) continue;
    let result: SendResult | 'no_address' = 'no_address';
    if (r.email && r.verified === 1) {
      if (!names.has(r.family)) names.set(r.family, mailName(await familyName(r.family)));
      const family = names.get(r.family)!;
      const tree = r.family;
      result = (await sendMail({
        to: r.email, locale: localeOf(r.locale), category: 'notice', request,
        body: (t, { server, origin }) => ({
          greeting: t('email.mail.greeting', { name: mailName(r.name) }),
          subject: t('email.mail.breach_subject', { family }),
          paragraphs: [t('email.mail.breach_body', { server, family })],
          quote: r.notice,
          action: { label: t('email.mail.breach_action'), url: `${origin}/${tree}` },
        }),
      }, now)).result;
    }
    await accounts().run('UPDATE breach_mail SET result = ?, sent_at = ? WHERE breach = ? AND user = ? AND family = ?', result, result === 'sent' ? now : null, r.breach, r.user, r.family);
    if (result === 'sent') sent++;
  }
  const left = await accounts().get<{ n: number }>(`SELECT count(*) AS n FROM breach_mail WHERE ${open('')}`, ...args);
  return { sent, left: Number(left?.n ?? 0) };
}

/** deliverBreachNotices for one breach after the answer. Never throws. */
export function emailBreachNotice(breach: string, now = Date.now(), request?: Request): void {
  sendLater(() => deliverBreachNotices(now, breach, request));
}
