// SMTP on Node (`#mail/smtp` outside workerd, package.json "imports"): nodemailer, over TLS from the start or STARTTLS, never in
// the clear. The Worker build resolves `#mail/smtp` to ./smtp.cf.ts instead, so nodemailer never reaches the Worker bundle
// (`mise run smoke:worker` checks it). nodemailer may read no file and fetch no address while it builds a message.
import { createTransport } from 'nodemailer';
import { checkedMessage, MailError, shortError, type Mailer } from './mailer.ts';
import type { SmtpSecurity } from './shared.ts';

export interface SmtpConfig { host: string; port: number; security: SmtpSecurity; user: string; password: string }

export const smtpAvailable = true;

export function smtpMailer(c: SmtpConfig): Mailer {
  const transport = createTransport({
    host: c.host, port: c.port, secure: c.security === 'tls', requireTLS: c.security === 'starttls',
    ...(c.user ? { auth: { user: c.user, pass: c.password } } : {}),
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
    disableFileAccess: true, disableUrlAccess: true,
  });
  return {
    async send(raw) {
      const m = checkedMessage(raw);
      try {
        await transport.sendMail({
          from: { name: m.from.name, address: m.from.address }, to: m.to, ...(m.replyTo ? { replyTo: m.replyTo } : {}),
          subject: m.subject, text: m.text, html: m.html, headers: m.headers, disableFileAccess: true, disableUrlAccess: true,
        });
      } catch (e) {
        throw new MailError(shortError(`smtp: ${(e as Error).message ?? 'failed'}`, c.password));
      }
    },
  };
}

/**
 * The browser journeys' stand-in (KINDRED_MAIL_FAKE=1 on a local server, settings.server.ts): each email is appended as one
 * JSON line to `mail-outbox.jsonl` in the data folder, where the journey reads it. Nothing is sent.
 */
export async function writeOutbox(line: string): Promise<void> {
  const [{ appendFile }, { join }] = await Promise.all([import('node:fs/promises'), import('node:path')]);
  await appendFile(join(process.env.KINDRED_DATA_DIR?.trim() || 'data', 'mail-outbox.jsonl'), `${line}\n`, 'utf8');
}
