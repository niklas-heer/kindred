// Sending one email (docs/hosting-many-families.md, "Email"): a small `Mailer` interface and the providers that speak HTTP, so
// they work on Node and on Workers alike: Resend, Postmark and Mailgun (with its EU region). SMTP is Node's alone
// (`#mail/smtp`, smtp.node.ts; the Worker build gets smtp.cf.ts, which refuses). Every provider takes its `fetch`, so no test
// reaches a real one. Plain code with no server-only imports.
//
// A message is built here from parts that were cleaned first: every header value is one line (no CR, LF or other control
// character can start a new header), every address is one plain mailbox (shared.ts, MAIL_ADDRESS), and only the headers
// Kindred uses may be set. A provider's error is cut to one short line, and never carries the key.
import { isMailAddress } from './shared.ts';

export interface MailMessage {
  from: { name: string; address: string };
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
  /** Only HEADER_NAMES. */
  headers: Record<string, string>;
}

export interface Mailer {
  /** Sends one message; throws a MailError with a short reason when the provider refuses or cannot be reached. */
  send(message: MailMessage): Promise<void>;
}

export class MailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailError';
  }
}

/** The headers a message may carry besides the provider's own: the one-click unsubscribe (RFC 8058), and "sent by a machine". */
export const HEADER_NAMES = ['List-Unsubscribe', 'List-Unsubscribe-Post', 'Auto-Submitted'] as const;

/** One line: every control character (CR and LF among them) and Unicode line separator becomes a space; at most `max` characters. */
export const oneLine = (s: string, max = 300) => s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** `"Name" <address>`, the name quoted with its quotes and backslashes escaped; the address alone when there is no name. */
export function formatAddress(name: string, address: string): string {
  if (!isMailAddress(address)) throw new MailError('invalid address');
  const n = oneLine(name, 80).replace(/["\\]/g, '\\$&');
  return n ? `"${n}" <${address}>` : address;
}

/** Checks a message before it leaves: addresses, one-line headers, only Kindred's headers. Returns it cleaned. */
export function checkedMessage(m: MailMessage): MailMessage {
  if (!isMailAddress(m.to) || !isMailAddress(m.from.address) || (m.replyTo && !isMailAddress(m.replyTo))) throw new MailError('invalid address');
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(m.headers)) {
    if (!(HEADER_NAMES as readonly string[]).includes(k)) throw new MailError(`header not allowed: ${oneLine(k, 40)}`);
    headers[k] = oneLine(v, 1000);
  }
  return { ...m, from: { name: oneLine(m.from.name, 80), address: m.from.address }, subject: oneLine(m.subject, 200), headers };
}

/** A provider's answer as one short line, with the key taken out should it echo it. */
export function shortError(text: string, secret: string): string {
  const cut = oneLine(text, 300);
  return (secret ? cut.split(secret).join('[key]') : cut).slice(0, 200) || 'error';
}

export type Fetch = typeof fetch;
const TIMEOUT_MS = 15_000;

async function post(fetchImpl: Fetch, url: string, init: RequestInit, secret: string): Promise<void> {
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new MailError(shortError(`network: ${(e as Error).message ?? 'failed'}`, secret));
  }
  if (res.ok) {
    await res.body?.cancel();
    return;
  }
  const body = await res.text().catch(() => '');
  throw new MailError(shortError(`${res.status} ${body}`, secret));
}

export function resendMailer(key: string, fetchImpl: Fetch = fetch): Mailer {
  return {
    async send(raw) {
      const m = checkedMessage(raw);
      await post(fetchImpl, 'https://api.resend.com/emails', {
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: formatAddress(m.from.name, m.from.address), to: [m.to], subject: m.subject, text: m.text, html: m.html,
          ...(m.replyTo ? { reply_to: [m.replyTo] } : {}), headers: m.headers,
        }),
      }, key);
    },
  };
}

export function postmarkMailer(key: string, fetchImpl: Fetch = fetch): Mailer {
  return {
    async send(raw) {
      const m = checkedMessage(raw);
      await post(fetchImpl, 'https://api.postmarkapp.com/email', {
        headers: { 'x-postmark-server-token': key, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          From: formatAddress(m.from.name, m.from.address), To: m.to, Subject: m.subject, TextBody: m.text, HtmlBody: m.html,
          ...(m.replyTo ? { ReplyTo: m.replyTo } : {}), Headers: Object.entries(m.headers).map(([Name, Value]) => ({ Name, Value })),
          MessageStream: 'outbound', TrackOpens: false, TrackLinks: 'None',
        }),
      }, key);
    },
  };
}

/** A mail domain as Mailgun's address names it: a host name, nothing that could change the path. */
export const MAIL_DOMAIN = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export function mailgunMailer(key: string, domain: string, region: 'us' | 'eu', fetchImpl: Fetch = fetch): Mailer {
  if (!MAIL_DOMAIN.test(domain)) throw new MailError('invalid Mailgun domain');
  const base = region === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net';
  return {
    async send(raw) {
      const m = checkedMessage(raw);
      const form = new URLSearchParams();
      form.set('from', formatAddress(m.from.name, m.from.address));
      form.set('to', m.to);
      form.set('subject', m.subject);
      form.set('text', m.text);
      form.set('html', m.html);
      if (m.replyTo) form.set('h:Reply-To', m.replyTo);
      for (const [k, v] of Object.entries(m.headers)) form.set(`h:${k}`, v);
      // No open or click tracking: Kindred's emails carry no pixel and no rewritten link.
      form.set('o:tracking', 'no');
      form.set('o:tracking-clicks', 'no');
      form.set('o:tracking-opens', 'no');
      await post(fetchImpl, `${base}/v3/${domain}/messages`, {
        headers: { authorization: `Basic ${btoa(`api:${key}`)}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      }, key);
    },
  };
}
