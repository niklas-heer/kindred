// The email settings (docs/self-host.md, "Email"; docs/hosting-many-families.md, "Email"): rows of instance_setting named
// `mail_*`, so a server that never opened the console's Email tab has none and sends nothing. The provider's key (or the SMTP
// password) is sealed with the server secret (../auth/seal.server.ts) and never leaves the server again: the console sees only
// whether one is stored. KINDRED_MAIL_API_KEY (the services) and KINDRED_SMTP_PASSWORD (SMTP) in the environment are the
// alternative, and win when set. Changing KINDRED_SECRET makes a stored key unreadable: the console then asks for it again.
import { seal, unseal } from '../auth/seal.server.ts';
import { q, store, type Query } from '../store/index.ts';
import { MAIL_DOMAIN, mailgunMailer, oneLine, postmarkMailer, resendMailer, type Fetch, type Mailer } from './mailer.ts';
import {
  isMailAddress, isMailProvider, MAILGUN_REGIONS, PER_HOUR_DEFAULT, PER_HOUR_MAX, SMTP_SECURITY,
  type MailgunRegion, type MailProvider, type MailSettingsInput, type MailSettingsView, type SmtpSecurity,
} from './shared.ts';
import { smtpAvailable, smtpMailer } from '#mail/smtp';

const accounts = () => store.accounts();
const SEAL_INFO = 'mail-secret';

type Env = Record<string, string | undefined>;
const envValue = (env: Env, name: string) => {
  const v = env[name];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
};
/** The environment variable that holds the secret for a provider. */
export const secretEnvName = (p: MailProvider) => (p === 'smtp' ? 'KINDRED_SMTP_PASSWORD' : 'KINDRED_MAIL_API_KEY');

const KEYS = {
  provider: 'mail_provider', fromName: 'mail_from_name', fromAddress: 'mail_from_address', replyTo: 'mail_reply_to',
  mailgunDomain: 'mail_mailgun_domain', mailgunRegion: 'mail_mailgun_region', smtpHost: 'mail_smtp_host', smtpPort: 'mail_smtp_port',
  smtpSecurity: 'mail_smtp_security', smtpUser: 'mail_smtp_user', perHour: 'mail_per_hour', secret: 'mail_secret_sealed',
} as const;

export interface MailConfig {
  provider: MailProvider;
  fromName: string;
  fromAddress: string;
  replyTo: string;
  mailgunDomain: string;
  mailgunRegion: MailgunRegion;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: SmtpSecurity;
  smtpUser: string;
  perHour: number;
  /** The sealed key as stored, or ''. */
  sealed: string;
}

async function rows(): Promise<Map<string, string>> {
  const all = await accounts().all<{ key: string; value: string }>("SELECT key, value FROM instance_setting WHERE key LIKE 'mail\\_%' ESCAPE '\\'");
  return new Map(all.map((r) => [r.key, r.value]));
}

export async function mailConfig(): Promise<MailConfig> {
  const v = await rows();
  const provider = v.get(KEYS.provider);
  const region = v.get(KEYS.mailgunRegion);
  const security = v.get(KEYS.smtpSecurity);
  const port = Number(v.get(KEYS.smtpPort));
  const perHour = Number(v.get(KEYS.perHour));
  return {
    provider: isMailProvider(provider) ? provider : 'off',
    fromName: v.get(KEYS.fromName) ?? '', fromAddress: v.get(KEYS.fromAddress) ?? '', replyTo: v.get(KEYS.replyTo) ?? '',
    mailgunDomain: v.get(KEYS.mailgunDomain) ?? '', mailgunRegion: (MAILGUN_REGIONS as readonly string[]).includes(region ?? '') ? (region as MailgunRegion) : 'eu',
    smtpHost: v.get(KEYS.smtpHost) ?? '', smtpPort: Number.isInteger(port) && port > 0 && port < 65536 ? port : 587,
    smtpSecurity: (SMTP_SECURITY as readonly string[]).includes(security ?? '') ? (security as SmtpSecurity) : 'starttls',
    smtpUser: v.get(KEYS.smtpUser) ?? '',
    perHour: Number.isInteger(perHour) && perHour >= 1 ? Math.min(perHour, PER_HOUR_MAX) : PER_HOUR_DEFAULT,
    sealed: v.get(KEYS.secret) ?? '',
  };
}

/** The key the provider needs: the environment's, else the stored one unsealed ('' when neither, or it no longer opens). */
async function secretOf(c: MailConfig, env: Env): Promise<string> {
  if (c.provider === 'off') return '';
  const fromEnv = envValue(env, secretEnvName(c.provider));
  if (fromEnv) return fromEnv;
  return c.sealed ? (await unseal(SEAL_INFO, c.sealed)) ?? '' : '';
}

/** Whether a configuration can send: a provider, a sender, what that provider needs, and a key (SMTP may go without a login). */
function complete(c: MailConfig, secret: string): boolean {
  if (c.provider === 'off' || !isMailAddress(c.fromAddress)) return false;
  if (c.provider === 'mailgun' && !MAIL_DOMAIN.test(c.mailgunDomain)) return false;
  if (c.provider === 'smtp') return smtpAvailable && !!c.smtpHost && (!c.smtpUser || !!secret);
  return !!secret;
}

export interface ReadyMailer { mailer: Mailer; config: MailConfig }

/** The mailer this server sends with now, or null while email is off or incomplete. */
export async function configuredMailer(env: Env = process.env, fetchImpl: Fetch = fetch): Promise<ReadyMailer | null> {
  const c = await mailConfig();
  const secret = await secretOf(c, env);
  if (!complete(c, secret)) return null;
  const mailer = c.provider === 'resend' ? resendMailer(secret, fetchImpl)
    : c.provider === 'postmark' ? postmarkMailer(secret, fetchImpl)
    : c.provider === 'mailgun' ? mailgunMailer(secret, c.mailgunDomain, c.mailgunRegion, fetchImpl)
    : smtpMailer({ host: c.smtpHost, port: c.smtpPort, security: c.smtpSecurity, user: c.smtpUser, password: secret });
  return { mailer, config: c };
}

/** What the console shows: every setting but the key, which it only knows is there. */
export async function mailSettingsView(env: Env = process.env): Promise<MailSettingsView> {
  const c = await mailConfig();
  const fromEnv = c.provider !== 'off' && !!envValue(env, secretEnvName(c.provider));
  const secret = await secretOf(c, env);
  const { sealed: _sealed, ...rest } = c;
  return { ...rest, secret: fromEnv ? 'env' : c.sealed ? 'stored' : 'none', smtpAvailable, on: complete(c, secret) };
}

/** Checks the console's input; throws the key of the first problem. Returns the statements that store it. */
export async function mailSettingsWrites(input: MailSettingsInput, by: string, at = Date.now()): Promise<Query[]> {
  const before = await mailConfig();
  const next = {
    provider: input.provider, fromName: oneLine(input.fromName, 80), fromAddress: input.fromAddress.trim(), replyTo: input.replyTo.trim(),
    mailgunDomain: input.mailgunDomain.trim().toLowerCase(), mailgunRegion: input.mailgunRegion, smtpHost: input.smtpHost.trim().toLowerCase(),
    smtpPort: input.smtpPort, smtpSecurity: input.smtpSecurity, smtpUser: oneLine(input.smtpUser, 200), perHour: input.perHour,
  };
  if (next.provider !== 'off') {
    if (!isMailAddress(next.fromAddress)) throw new Error('email.err.from');
    if (next.replyTo && !isMailAddress(next.replyTo)) throw new Error('email.err.address');
    if (next.provider === 'mailgun' && !MAIL_DOMAIN.test(next.mailgunDomain)) throw new Error('email.err.domain');
    if (next.provider === 'smtp' && !smtpAvailable) throw new Error('email.err.smtp_workers');
    if (next.provider === 'smtp' && !MAIL_DOMAIN.test(next.smtpHost) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(next.smtpHost)) throw new Error('email.err.smtp_host');
  }
  // A new key replaces the stored one; '' removes it; undefined keeps it. Switching between SMTP and a service drops it, as the
  // one is a password and the other a key.
  const kind = (p: MailProvider) => (p === 'smtp' ? 'smtp' : 'api');
  const keep = input.secret === undefined && (before.provider === 'off' || next.provider === 'off' || kind(before.provider) === kind(next.provider));
  const sealed = input.secret ? await seal(SEAL_INFO, input.secret.trim()) : keep ? before.sealed : '';
  const values: Record<keyof typeof KEYS, string> = {
    provider: next.provider === 'off' ? '' : next.provider, fromName: next.fromName, fromAddress: next.fromAddress, replyTo: next.replyTo,
    mailgunDomain: next.mailgunDomain, mailgunRegion: next.mailgunRegion, smtpHost: next.smtpHost, smtpPort: String(next.smtpPort),
    smtpSecurity: next.smtpSecurity, smtpUser: next.smtpUser, perHour: next.perHour === PER_HOUR_DEFAULT ? '' : String(next.perHour), secret: sealed,
  };
  return (Object.keys(KEYS) as (keyof typeof KEYS)[]).map((k) => values[k]
    ? q('INSERT INTO instance_setting (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by', KEYS[k], values[k], at, by)
    : q('DELETE FROM instance_setting WHERE key = ?', KEYS[k]));
}

/** Whether email is on (cheap enough for a page to ask): a complete configuration. */
export async function mailOn(env: Env = process.env): Promise<boolean> {
  return !!(await configuredMailer(env)) || fakeMailOn(env);
}

// ---------- the stand-in for the browser journeys ----------

/** The fake mailer only on a local server: with a public KINDRED_ORIGIN the setting is ignored, like Turnstile's stand-in. */
const localOrigin = (origin: string | undefined) => {
  if (!origin) return true;
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname);
  } catch {
    return false;
  }
};
/** KINDRED_MAIL_FAKE=1 on a local server (the browser journeys): emails are kept, not sent (send.server.ts). */
export const fakeMailOn = (env: Env = process.env) => env.KINDRED_MAIL_FAKE === '1' && localOrigin(env.KINDRED_ORIGIN);
