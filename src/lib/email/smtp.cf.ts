// What `#mail/smtp` is inside workerd: no SMTP. A Worker cannot open the mail server's socket the way nodemailer needs, so the
// console offers SMTP on Node only and a Worker refuses it here (package.json "imports" picks this file under `workerd`).
import { MailError, type Mailer } from './mailer.ts';
import type { SmtpSecurity } from './shared.ts';

export interface SmtpConfig { host: string; port: number; security: SmtpSecurity; user: string; password: string }

export const smtpAvailable = false;

export function smtpMailer(_c: SmtpConfig): Mailer {
  return { send: async () => { throw new MailError('email.err.smtp_workers'); } };
}

/** The journeys' outbox file exists on Node only; a Worker keeps fake emails in memory (send.server.ts). */
export async function writeOutbox(_line: string): Promise<void> {}
