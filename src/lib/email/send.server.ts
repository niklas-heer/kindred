// Sending an email (docs/hosting-many-families.md, "Email"). Every email Kindred sends goes through `sendMail`, which:
//
// - sends nothing while nothing may be written (a demo, a steward's "View as" preview: ../read-only.ts), and nothing while the
//   operator has not set email up (settings.server.ts);
// - sends nothing in a category its recipient unsubscribed from (security emails have no category to leave);
// - holds the limits in the database, in the batch that records the send (`email_send`, accounts migration 0053): a few emails
//   an hour and a day to one address, the server's emails an hour (the operator's setting), and a category's own gap (the
//   operators hear of new requests at most every ten minutes), so no number of processes or isolates gets past them;
// - writes the email in the recipient's language, as plain text and simple HTML (render.ts), with the footer, and for a
//   category one may leave the one-click unsubscribe (List-Unsubscribe and List-Unsubscribe-Post, RFC 8058, and a link);
// - records whether it went out, and the provider's error when not (the Health tab shows these; never the message).
//
// The recipient is stored only as a keyed hash of the address (`recipientHash`), so the tables name nobody. Tests replace the
// mailer (`setMailerForTests`), and KINDRED_MAIL_FAKE=1 on a local server keeps emails in an outbox instead of sending them.
import { serverHmac } from '../auth/seal.server.ts';
import { translate, type Key } from '../i18n/dictionary.ts';
import type { Locale } from '../i18n/languages.ts';
import type { Vars } from '../i18n/types.ts';
import { readOnly } from '../read-only.ts';
import { guard, isGuardError, q, store } from '../store/index.ts';
import { checkedMessage, MailError, type MailMessage, type Mailer } from './mailer.ts';
import { renderMail, type MailContent } from './render.ts';
import { configuredMailer, fakeMailOn, mailConfig, type MailConfig } from './settings.server.ts';
import { isMailAddress, isOptionalCategory, type MailCategory, type OptionalCategory } from './shared.ts';
import { writeOutbox } from '#mail/smtp';

const accounts = () => store.accounts();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const KEEP_MS = 30 * DAY;

/** Emails one address gets at most: in an hour, and in a day (every category together). */
export const RECIPIENT_PER_HOUR = 6;
export const RECIPIENT_PER_DAY = 20;
/** Codes and links (a sign-up code, a confirmation link, a reset link) to one address in an hour. */
export const CODES_PER_HOUR = 3;
const CODE_CATEGORIES: MailCategory[] = ['verify', 'signup', 'reset'];

const b64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** The address as the tables keep it: an HMAC under the server secret, so a copied database names nobody. */
export const recipientHash = async (address: string) => b64u(await serverHmac('mail-recipient', new TextEncoder().encode(address.trim().toLowerCase())));

// ---------- which mailer ----------

const g = globalThis as unknown as { __kindredMailer?: { mailer: Mailer; config?: Partial<MailConfig> } | null; __kindredOutbox?: MailMessage[] };

/** For tests: the mailer to use instead of the configured one (null: none, so email is off; undefined: back to the configuration). */
export function setMailerForTests(m: { mailer: Mailer; config?: Partial<MailConfig> } | null | undefined): void {
  g.__kindredMailer = m;
}

/** The emails the local stand-in kept (KINDRED_MAIL_FAKE=1), newest last; the journeys read the outbox file instead. */
export const fakeOutbox = (): MailMessage[] => (g.__kindredOutbox ??= []);

const fakeMailer: Mailer = {
  async send(raw) {
    const m = checkedMessage(raw);
    fakeOutbox().push(m);
    await writeOutbox(JSON.stringify({ to: m.to, subject: m.subject, text: m.text, html: m.html, headers: m.headers, at: Date.now() }));
  },
};

/** The mailer this server sends with now and its settings, or null while email is off. */
export async function activeMailer(): Promise<{ mailer: Mailer; config: MailConfig } | null> {
  if (g.__kindredMailer !== undefined) {
    if (!g.__kindredMailer) return null;
    const base = await mailConfig();
    return { mailer: g.__kindredMailer.mailer, config: { ...base, provider: base.provider === 'off' ? 'resend' : base.provider, fromAddress: base.fromAddress || 'kindred@example.test', ...g.__kindredMailer.config } };
  }
  const ready = await configuredMailer();
  if (!ready) return null;
  // The journeys' stand-in: a server set up to send keeps its emails instead, on a local origin only.
  return fakeMailOn() ? { mailer: fakeMailer, config: ready.config } : ready;
}

/** Whether this server sends email now. */
export const emailOn = async () => !!(await activeMailer());

// ---------- unsubscribing ----------

/** The proof in an unsubscribe link: an HMAC over the address's hash and the category, so it unsubscribes that pair alone. */
export const unsubscribeMac = async (recipient: string, category: OptionalCategory) =>
  b64u(await serverHmac('mail-unsubscribe', new TextEncoder().encode(`${recipient}\n${category}`))).slice(0, 32);

export async function unsubscribeUrl(origin: string, address: string, category: OptionalCategory): Promise<string> {
  const r = await recipientHash(address);
  const u = new URL('/unsubscribe', origin);
  u.searchParams.set('r', r);
  u.searchParams.set('c', category);
  u.searchParams.set('t', await unsubscribeMac(r, category));
  return u.href;
}

export const optedOut = async (recipient: string, category: MailCategory) =>
  isOptionalCategory(category) && !!(await accounts().get('SELECT 1 FROM email_optout WHERE recipient = ? AND category = ?', recipient, category));

// ---------- the server's name and address ----------

/** The server as an email names it: the operator's name for it, else "Kindred". */
export async function serverName(): Promise<string> {
  const row = await accounts().get<{ value: string }>("SELECT value FROM instance_setting WHERE key = 'instance_name'");
  return row?.value.trim() || 'Kindred';
}

/** The origin an email's links start with: KINDRED_ORIGIN, else the request's own (a job without either sends no link). */
export function mailOrigin(request?: Request): string | undefined {
  const configured = process.env.KINDRED_ORIGIN?.trim();
  if (configured) return new URL(configured).origin;
  return request ? new URL(request.url).origin : undefined;
}

/** The request being answered, when there is one (a server function's): its origin is the server's own. */
async function currentRequest(): Promise<Request | undefined> {
  try {
    return (await import('@tanstack/react-start/server')).getRequest();
  } catch {
    return undefined;
  }
}

/** The time an email gives: the date and time in UTC, written for the recipient's language. */
export function mailDate(ms: number, locale: Locale): string {
  const intl = locale === 'en' ? 'en-GB' : locale;
  const date = new Intl.DateTimeFormat(intl, { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(ms));
  return translate(locale, 'email.mail.when', { date });
}
/** A deadline: the date alone. */
export const mailDay = (ms: number, locale: Locale) => new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(ms));

// ---------- sending ----------

/** What a caller writes: the parts above the footer, in the recipient's language. */
export type Body = Omit<MailContent, 'locale' | 'footer' | 'unsubscribe' | 'greeting'> & { greeting?: string };

export interface Outgoing {
  to: string;
  locale: Locale;
  category: MailCategory;
  /** Writes the email; `t` translates into the recipient's language. */
  body: (t: (key: Key, vars?: Vars) => string, ctx: { server: string; origin: string }) => Body | Promise<Body>;
  /** The request it answers, for the origin of its links when KINDRED_ORIGIN is not set. */
  request?: Request;
  /** At most one email of this category to this address in this time. */
  gapMs?: number;
}

export type SendResult = 'sent' | 'failed' | 'off' | 'read-only' | 'invalid' | 'unsubscribed' | 'throttled';

/** Sends one email. Never throws: the result says what happened. */
export async function sendMail(o: Outgoing, now = Date.now()): Promise<{ result: SendResult; error?: string }> {
  try {
    if (readOnly()) return { result: 'read-only' };
    const active = await activeMailer();
    if (!active) return { result: 'off' };
    const to = o.to.trim();
    const origin = mailOrigin(o.request ?? (await currentRequest()));
    if (!isMailAddress(to) || !origin) return { result: 'invalid' };
    const recipient = await recipientHash(to);
    if (await optedOut(recipient, o.category)) {
      await accounts().run("INSERT INTO email_send (at, recipient, category, status) VALUES (?, ?, ?, 'skipped')", now, recipient, o.category);
      return { result: 'unsubscribed' };
    }
    const counted = `status <> 'skipped'`;
    const limits = [
      guard(`(SELECT count(*) FROM email_send WHERE recipient = ? AND at > ? AND ${counted}) < ?`, recipient, now - HOUR, RECIPIENT_PER_HOUR),
      guard(`(SELECT count(*) FROM email_send WHERE recipient = ? AND at > ? AND ${counted}) < ?`, recipient, now - DAY, RECIPIENT_PER_DAY),
      guard(`(SELECT count(*) FROM email_send WHERE at > ? AND ${counted}) < ?`, now - HOUR, active.config.perHour),
      ...(CODE_CATEGORIES.includes(o.category)
        ? [guard(`(SELECT count(*) FROM email_send WHERE recipient = ? AND at > ? AND category IN ('verify', 'signup', 'reset') AND ${counted}) < ?`, recipient, now - HOUR, CODES_PER_HOUR)]
        : []),
      ...(o.gapMs ? [guard(`NOT EXISTS (SELECT 1 FROM email_send WHERE recipient = ? AND category = ? AND at > ? AND ${counted})`, recipient, o.category, now - o.gapMs)] : []),
    ];
    let id: number;
    try {
      const results = await accounts().batch([
        q('DELETE FROM email_send WHERE at < ?', now - KEEP_MS),
        ...limits,
        q("INSERT INTO email_send (at, recipient, category, status) VALUES (?, ?, ?, 'sending') RETURNING id", now, recipient, o.category),
      ]);
      id = (results.at(-1)!.rows as { id: number }[])[0]!.id;
    } catch (e) {
      if (!isGuardError(e)) throw e;
      await accounts().run("INSERT INTO email_send (at, recipient, category, status) VALUES (?, ?, ?, 'skipped')", now, recipient, o.category);
      return { result: 'throttled' };
    }

    const t = (key: Key, vars?: Vars) => translate(o.locale, key, vars);
    const server = await serverName();
    const body = await o.body(t, { server, origin });
    const optional = isOptionalCategory(o.category) ? o.category : null;
    const content: MailContent = {
      ...body, locale: o.locale, greeting: body.greeting ?? t('email.mail.greeting_plain'),
      footer: [...(optional ? [] : o.category === 'security' ? [t('email.mail.security_footer')] : []), t('email.mail.sent_by', { server, address: new URL(origin).host })],
      ...(optional ? { unsubscribe: { question: t('email.mail.unsubscribe_q'), label: t('email.mail.unsubscribe'), url: await unsubscribeUrl(origin, to, optional) } } : {}),
    };
    const rendered = renderMail(content, origin);
    const message: MailMessage = {
      from: { name: active.config.fromName || server, address: active.config.fromAddress },
      to, ...(active.config.replyTo ? { replyTo: active.config.replyTo } : {}),
      subject: rendered.subject, text: rendered.text, html: rendered.html,
      headers: {
        'Auto-Submitted': 'auto-generated',
        ...(content.unsubscribe ? { 'List-Unsubscribe': `<${apiUnsubscribe(content.unsubscribe.url)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : {}),
      },
    };
    try {
      await active.mailer.send(message);
      await accounts().run("UPDATE email_send SET status = 'sent' WHERE id = ?", id);
      return { result: 'sent' };
    } catch (e) {
      const error = e instanceof MailError ? e.message : 'error';
      await accounts().run("UPDATE email_send SET status = 'failed', error = ? WHERE id = ?", error, id);
      return { result: 'failed', error };
    }
  } catch (e) {
    // A notification never breaks what caused it; the failure is logged without the message or the address.
    console.error('[email] could not send:', (e as Error).message);
    return { result: 'failed', error: 'error' };
  }
}

/** The one-click address (RFC 8058) of an unsubscribe link: the same query, posted to /api/unsubscribe. */
const apiUnsubscribe = (pageUrl: string) => {
  const u = new URL(pageUrl);
  u.pathname = '/api/unsubscribe';
  return u.href;
};

/**
 * Sends later: the caller answers at once, whatever the email does, so the time an answer takes tells nothing (a password reset
 * for an address with no account answers as fast as one with). On Workers the request is kept alive until it is done.
 */
export function sendLater(work: () => Promise<unknown>): void {
  const p: Promise<void> = Promise.resolve().then(work).then(() => {}, (e) => console.error('[email] background send failed:', (e as Error).message))
    .finally(() => pending().delete(p));
  pending().add(p);
  store.keepAlive(p);
}

const pending = () => ((globalThis as unknown as { __kindredMailPending?: Set<Promise<void>> }).__kindredMailPending ??= new Set());
/** For tests: waits until every email sent later has been dealt with. */
export async function settleSends(): Promise<void> {
  while (pending().size) await Promise.all([...pending()]);
}

/** Unsubscribes the address behind `r` from `c`, when `t` proves the link. Returns whether it did (or already was). */
export async function unsubscribe(r: unknown, c: unknown, t: unknown, now = Date.now()): Promise<boolean> {
  if (typeof r !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(r) || !isOptionalCategory(c) || typeof t !== 'string') return false;
  const { safeEqual } = await import('../auth/tokens.server.ts');
  if (!(await safeEqual(t, await unsubscribeMac(r, c)))) return false;
  await accounts().run('INSERT INTO email_optout (recipient, category, at) VALUES (?, ?, ?) ON CONFLICT (recipient, category) DO NOTHING', r, c, now);
  return true;
}
