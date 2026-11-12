// What the email feature shares with the browser (docs/hosting-many-families.md, "Email"): the providers, the categories a
// reader may unsubscribe from, the console's view of the settings, and small rules with no server imports.

/** How this server sends email: not at all (the default), or through one provider. SMTP works on Node only. */
export const MAIL_PROVIDERS = ['off', 'resend', 'postmark', 'mailgun', 'smtp'] as const;
export type MailProvider = (typeof MAIL_PROVIDERS)[number];
export const isMailProvider = (v: unknown): v is MailProvider => typeof v === 'string' && (MAIL_PROVIDERS as readonly string[]).includes(v);

/** Mailgun's two regions: its EU region keeps the messages in the EU. */
export const MAILGUN_REGIONS = ['us', 'eu'] as const;
export type MailgunRegion = (typeof MAILGUN_REGIONS)[number];

/** How an SMTP connection is protected: TLS from the start (port 465) or STARTTLS (587). Never in the clear. */
export const SMTP_SECURITY = ['tls', 'starttls'] as const;
export type SmtpSecurity = (typeof SMTP_SECURITY)[number];

/**
 * What an email is about. The security ones (a code, a link, a notice about the account's ways in) cannot be unsubscribed
 * from; the others carry a one-click unsubscribe for their category.
 */
export const SECURITY_CATEGORIES = ['verify', 'signup', 'reset', 'security', 'test'] as const;
export const OPTIONAL_CATEGORIES = ['invitation', 'operator', 'family', 'receipt'] as const;
export type SecurityCategory = (typeof SECURITY_CATEGORIES)[number];
export type OptionalCategory = (typeof OPTIONAL_CATEGORIES)[number];
export type MailCategory = SecurityCategory | OptionalCategory;
export const isOptionalCategory = (v: unknown): v is OptionalCategory => typeof v === 'string' && (OPTIONAL_CATEGORIES as readonly string[]).includes(v);

/** The console's limits: emails one server sends in an hour at most (the operator's choice), within these bounds. */
export const PER_HOUR_DEFAULT = 300;
export const PER_HOUR_MAX = 100_000;

export const NAME_MAX = 80;
export const ADDRESS_MAX = 254;

/**
 * An address Kindred will send to or from: one mailbox, no display name, no spaces, no control characters, no characters a
 * header could be split on. Stricter than RFC 5322 on purpose.
 */
export const MAIL_ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
export const isMailAddress = (v: unknown): v is string => typeof v === 'string' && v.length <= ADDRESS_MAX && MAIL_ADDRESS.test(v);

/** The console's view of the settings: never a key or a password, only whether one is there and where it came from. */
export interface MailSettingsView {
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
  /** A key (or SMTP password) is stored, sealed; or it comes from the environment (`env`), which then wins. */
  secret: 'none' | 'stored' | 'env';
  /** Whether SMTP can work here (Node, not Workers). */
  smtpAvailable: boolean;
  /** Whether the server sends now: a provider, a sender and a key. */
  on: boolean;
}

/** What the console sends to save: the key is undefined to keep the stored one, '' to remove it. */
export interface MailSettingsInput {
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
  secret?: string;
}

/** The Health tab's line about email: what went out in the last day, and the latest failures (never a message or an address). */
export interface MailHealth {
  on: boolean;
  provider: MailProvider;
  day: { sent: number; failed: number; skipped: number };
  failures: { at: number; category: string; error: string }[];
}

/** How long a verification link and a password reset link hold, and a sign-up code. */
export const VERIFY_LINK_MS = 24 * 60 * 60_000;
export const RESET_LINK_MS = 60 * 60_000;
export const SIGNUP_CODE_MS = 15 * 60_000;
export const SIGNUP_CODE_TRIES = 5;
