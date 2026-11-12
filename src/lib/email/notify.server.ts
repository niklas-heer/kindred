// The emails Kindred sends about something that happened (docs/hosting-many-families.md, "Email"; docs/gdpr.md, "Email"):
//
// - security notices, to the account's VERIFIED address only, always while email is on (they cannot be unsubscribed): a
//   password changed or reset (with a link sent by email, a recovery code, or an operator's link), a new way in (a passkey, a
//   password, single sign-on), two-step codes turned off;
// - an invitation, when its steward asks (the address they typed; the link is still theirs to copy);
// - the operators (verified addresses), about a new family request or data request, at most every ten minutes each;
// - a data request's receipt with its deadline, to the address typed into the form: the only email to an address nobody
//   verified besides a code, and it carries nothing the requester wrote (no name, no message) so it cannot carry spam;
// - a family's stewards (verified addresses), when the operator hands them a data request, and for a breach notice.
//
// Every one goes through sendMail (send.server.ts): nothing in a demo or a preview, the limits, the unsubscribe, the language.
// None waits for the provider: they are sent after the answer (`sendLater`) and never fail what caused them.
import type { Locale } from '../i18n/languages.ts';
import { isLocale } from '../i18n/types.ts';
import { accounts, userById, type InviteRow } from '../auth/store.server.ts';
import { hashToken, safeEqual } from '../auth/tokens.server.ts';
import { AuthError } from '../auth/errors.ts';
import { mailDate, mailDay, sendLater, sendMail, type Body, type SendResult } from './send.server.ts';
import type { MailCategory } from './shared.ts';
import type { Key } from '../i18n/dictionary.ts';
import type { Vars } from '../i18n/types.ts';

const localeOf = (l: unknown): Locale => (isLocale(l) ? l : 'en');

// ---------- security ----------

export type SecurityKind = 'password_changed' | 'password_reset' | 'recovery_reset' | 'operator_reset' | 'passkey_added' | 'password_added' | 'sso_added' | 'totp_off';

const SECURITY_KEY: Record<SecurityKind, Key> = {
  password_changed: 'email.mail.sec_password_changed', password_reset: 'email.mail.sec_password_reset', recovery_reset: 'email.mail.sec_recovery_reset',
  operator_reset: 'email.mail.sec_operator_reset', passkey_added: 'email.mail.sec_passkey_added', password_added: 'email.mail.sec_password_added',
  sso_added: 'email.mail.sec_sso_added', totp_off: 'email.mail.sec_totp_off',
};

/** Tells the account's holder about a change to its ways in, at its verified address. Sent later; never throws. */
export function securityNotice(user: string, kind: SecurityKind, request?: Request, vars: { provider?: string } = {}, at = Date.now()): void {
  sendLater(async () => {
    const u = await userById(user);
    if (!u?.email || u.email_verified !== 1) return;
    await sendMail({
      to: u.email, locale: localeOf(u.locale), category: 'security', request,
      body: (t, { server }) => ({
        subject: t('email.mail.security_subject', { server }), greeting: t('email.mail.greeting', { name: u.name }),
        paragraphs: [t(SECURITY_KEY[kind], { date: mailDate(at, localeOf(u.locale)), provider: vars.provider ?? '' }), t('email.mail.not_you')],
      }),
    });
  });
}

// ---------- invitations ----------

/**
 * Sends an invitation to the address its steward typed, with the link they hold (`token`, checked against the invitation's
 * hash: only who made or renewed the link has it). The steward's and the family's names are theirs, and escaped.
 */
export async function emailInvitation(request: Request, invite: InviteRow, token: string, inviter: string, family: string, locale: Locale): Promise<SendResult> {
  if (!invite.email || invite.used_at || invite.revoked_at || invite.expires <= Date.now()) throw new AuthError('invalid', 'email.err.invite');
  if (!(await safeEqual(await hashToken('invite', token), invite.hash))) throw new AuthError('invalid', 'email.err.invite');
  const { result } = await sendMail({
    to: invite.email, locale, category: 'invitation', request,
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
          subject: t('email.mail.operator_subject', { server }), greeting: t('email.mail.greeting', { name: op.name }),
          paragraphs: [t(kind === 'family' ? 'email.mail.operator_family' : 'email.mail.operator_data')],
          action: { label: t('email.mail.operator_action'), url: `${origin}/operator?tab=${kind === 'family' ? 'requests' : 'data'}` },
        }),
      });
    }
  });
}

// ---------- the requester ----------

/** The receipt for a data request: when it came, and the date it must be answered by. Nothing the requester wrote. */
export function emailDataReceipt(to: string, created: number, deadline: number, locale: Locale, request?: Request): void {
  sendLater(() => sendMail({
    to, locale, category: 'receipt', request,
    body: (t, { server }) => ({
      subject: t('email.mail.receipt_subject'),
      paragraphs: [t('email.mail.receipt_body', { server, date: mailDay(created, locale), deadline: mailDay(deadline, locale) }), t('email.mail.receipt_ignore')],
    }),
  }));
}

// ---------- a family's stewards ----------

/**
 * Emails each steward of `tree` with a verified address, in their language. `write` gets the family's name. Exported for other
 * features (a family's lifecycle warnings plug in here); `category` 'family' carries the unsubscribe.
 */
export function emailStewards(tree: string, write: (t: (key: Key, vars?: Vars) => string, ctx: { server: string; origin: string; family: string; locale: Locale }) => Body, opts: { request?: Request; category?: MailCategory } = {}): void {
  sendLater(async () => {
    const stewards = await accounts().all<{ email: string; name: string; locale: string | null }>(
      "SELECT u.email, u.name, u.locale FROM membership m JOIN user u ON u.id = m.user WHERE m.tree = ? AND m.role = 'steward' AND u.email_verified = 1 AND u.email IS NOT NULL", tree);
    if (!stewards.length) return;
    const family = await familyName(tree);
    for (const s of stewards) {
      const locale = localeOf(s.locale);
      await sendMail({
        to: s.email, locale, category: opts.category ?? 'family', request: opts.request,
        body: (t, ctx) => ({ greeting: t('email.mail.greeting', { name: s.name }), ...write(t, { ...ctx, family, locale }) }),
      });
    }
  });
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

/** A breach notice for the stewards of the families it affects (every family when `families` is null), with its text. */
export function emailBreachNotice(families: string[] | null, notice: string, request?: Request): void {
  sendLater(async () => {
    const trees = families ?? (await accounts().all<{ tree: string }>("SELECT DISTINCT tree FROM membership WHERE role = 'steward'")).map((r) => r.tree);
    for (const tree of trees) emailStewards(tree, (t, { server, origin, family }) => ({
    subject: t('email.mail.breach_subject', { family }),
    paragraphs: [t('email.mail.breach_body', { server, family })],
    quote: notice,
    action: { label: t('email.mail.breach_action'), url: `${origin}/${tree}` },
    }), { request });
  });
}
