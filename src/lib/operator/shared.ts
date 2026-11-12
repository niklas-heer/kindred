// What the operator console, the public request forms and the legal page share with the server: the settings of an
// instance, the shapes the console reads, and small rules with no server imports (docs/hosting-many-families.md).

/**
 * Who may make a family on this server.
 *   operator  only an operator
 *   stewards  a steward of any family here, or an operator (the default: a self-hosted install works as it always has)
 *   requests  anyone may ask (/request); an operator approves, and only an operator makes one directly
 */
export const FAMILY_CREATION = ['operator', 'stewards', 'requests'] as const;
export type FamilyCreation = (typeof FAMILY_CREATION)[number];
export const DEFAULT_FAMILY_CREATION: FamilyCreation = 'stewards';

/** The instance's own settings, as the console edits them. Empty text means "not set". */
export interface InstanceSettings {
  instanceName: string;
  contactEmail: string;
  impressum: string;
  /** The privacy policy: its text, or the address of a page that has it. */
  privacy: string;
  terms: string;
  /** Where to report content (EU DSA): an email address or a web address. */
  reportContact: string;
  /** The storage cap a family made from now on gets, in bytes; null for none. */
  defaultCapBytes: number | null;
  familyCreation: FamilyCreation;
}

export const TEXT_SETTINGS = ['instanceName', 'contactEmail', 'impressum', 'privacy', 'terms', 'reportContact'] as const;
export const SETTING_MAX: Record<(typeof TEXT_SETTINGS)[number], number> = {
  instanceName: 80, contactEmail: 200, impressum: 4000, privacy: 20000, terms: 20000, reportContact: 400,
};

/** What anyone may know of the instance: the forms and the legal page read this, signed in or not. */
export interface PublicInstance {
  instanceName: string;
  familyCreation: FamilyCreation;
  /** Which legal sections have something to show; the footer links only to those, and shows nothing when none has. */
  legal: { impressum: boolean; privacy: boolean; terms: boolean; report: boolean };
  /** Cloudflare Turnstile's site key, when the server has one and its secret (KINDRED_TURNSTILE_*). */
  turnstileSiteKey?: string;
}

/** The legal page's text: each section is text or a link elsewhere. */
export interface LegalTexts {
  instanceName: string;
  contactEmail: string;
  impressum: string;
  privacy: string;
  terms: string;
  reportContact: string;
}

/** A setting that is a single web address is shown as a link to it rather than as text. */
export const isUrl = (value: string) => /^https?:\/\/\S+$/i.test(value.trim());

/** A setting that is a single email address is shown as a link that writes to it. */
export const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

export const anyLegal = (l: PublicInstance['legal']) => l.impressum || l.privacy || l.terms || l.report;

// ---------- the console ----------

export type FamilyStatus = 'active' | 'suspended';

/** One family as the operator sees it: its administration, never its records. */
export interface OperatorFamily {
  id: string;
  name: string;
  /** When it was made, as best known: through the console, or its first membership (ms). */
  created: number | null;
  members: number;
  stewards: { name: string; email: string | null }[];
  usedBytes: number;
  capBytes: number | null;
  /** The last time any member opened it (ms). */
  lastActivity: number | null;
  status: FamilyStatus;
  /** An invitation for its first steward, not used yet: made through the console and waiting. */
  pendingSteward: { email: string | null; expires: number } | null;
}

export interface OperatorAccount { id: string; name: string; email: string | null; self: boolean }

/** `detail` is the JSON the log keeps (never record content); the console shows the action and the family. */
export interface AuditEntry { id: number; at: number; name: string; action: string; family: string | null; detail: string | null }

export type RequestStatus = 'open' | 'approved' | 'declined';
export interface FamilyRequest {
  id: string; name: string; email: string; familyName: string; message: string; created: number; status: RequestStatus;
  decidedAt: number | null; family: string | null;
}

export const DATA_REQUEST_KINDS = ['access', 'correction', 'deletion', 'other'] as const;
export type DataRequestKind = (typeof DATA_REQUEST_KINDS)[number];
export const DATA_REQUEST_STATUSES = ['open', 'forwarded', 'done'] as const;
export type DataRequestStatus = (typeof DATA_REQUEST_STATUSES)[number];
export interface DataRequest {
  id: string; name: string; email: string; familyText: string; family: string | null; kind: DataRequestKind; message: string;
  created: number; status: DataRequestStatus; updatedAt: number | null;
}

/** GDPR gives a month to answer (Art. 12(3)); Kindred counts 30 days from the request. */
export const DATA_REQUEST_DAYS = 30;
const DAY = 86_400_000;
/** Whole days left to answer a request made at `created`, as of `now`: negative once the month is over. */
export const daysLeft = (created: number, now: number) => Math.ceil((created + DATA_REQUEST_DAYS * DAY - now) / DAY);

/** A size in bytes for a person: "0 B", "512 KB", "1.5 GB" (decimal units, as storage is sold). */
export function formatBytes(bytes: number, locale = 'en'): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Math.max(0, bytes);
  let i = 0;
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
  const digits = i === 0 || v >= 100 ? 0 : 1;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(v)} ${units[i]}`;
}

/** Megabytes typed in the console as bytes: "" is none, anything else a whole number of MB. */
export const mbToBytes = (mb: number | null) => (mb === null ? null : Math.round(mb * 1_000_000));
export const bytesToMb = (bytes: number | null) => (bytes === null ? null : Math.round(bytes / 1_000_000));
