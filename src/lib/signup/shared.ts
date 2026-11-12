// What the hosting mode, the landing page and sign-up share with the browser (docs/hosting-many-families.md, "Hosting and
// sign-up"): the settings' shapes and defaults, and small rules with no server imports.

/**
 * How this server is used.
 *   single   one family, or a few, for people who know each other (the default: an install behaves as it always has)
 *   hosting  families who do not know each other: `/` shows a landing page to someone signed out, and the console's
 *            readiness checklist says what a public service still lacks
 */
export const INSTANCE_MODES = ['single', 'hosting'] as const;
export type InstanceMode = (typeof INSTANCE_MODES)[number];
export const DEFAULT_INSTANCE_MODE: InstanceMode = 'single';

/** The ways a new account may be made at sign-up: those the server offers (single sign-on only with a provider on). */
export type SignupMethod = 'passkey' | 'password' | 'oidc';

/** What sign-up does with a sign-up whose email nobody verified (every passkey or password sign-up, this round). */
export const UNVERIFIED = ['open', 'waitlist'] as const;
export type Unverified = (typeof UNVERIFIED)[number];

/** The hosting settings, as the console's Hosting tab edits them. */
export interface HostingSettings {
  mode: InstanceMode;
  /** Families one account may make by sign-up (operators are not limited). */
  perAccount: number;
  /** Sign-ups the server takes in 24 hours. */
  perDay: number;
  /** Families made by sign-up the server holds at most; null for no ceiling. */
  total: number | null;
  /** `waitlist`: an unverified sign-up becomes a request on the waiting list instead of a family. */
  unverified: Unverified;
  /** The operator's own paragraph on the landing page: plain text, no markup. */
  landingText: string;
  /** A demo to link to from the landing page (a web address), or empty. */
  demoUrl: string;
  /** The operator says they keep backups: the one item of the checklist Kindred cannot see for itself. */
  backups: boolean;
}

export const HOSTING_DEFAULTS: HostingSettings = {
  mode: DEFAULT_INSTANCE_MODE, perAccount: 1, perDay: 20, total: 200, unverified: 'open', landingText: '', demoUrl: '', backups: false,
};
export const PER_ACCOUNT_MAX = 100;
export const PER_DAY_MAX = 10_000;
export const TOTAL_MAX = 1_000_000;
export const LANDING_TEXT_MAX = 1200;
export const DEMO_URL_MAX = 300;

/** Sign-ups one network may send in 24 hours, counted in the batch that stores one (a short hash, never the address). */
export const SIGNUPS_PER_NETWORK = 3;

/**
 * One item of the readiness checklist. `required`: sign-up cannot be turned on without it. The others are what a public
 * service should have; the checklist shows them, and nothing refuses.
 */
export const READINESS = ['hosting', 'auth', 'turnstile', 'impressum', 'privacy', 'terms', 'cap', 'contact', 'report', 'recovery', 'backups'] as const;
export type ReadinessItem = (typeof READINESS)[number];
export const REQUIRED_FOR_SIGNUP: readonly ReadinessItem[] = ['hosting', 'auth', 'turnstile', 'impressum', 'privacy', 'terms', 'cap'];
export type Readiness = Record<ReadinessItem, boolean>;
export const missingForSignup = (r: Readiness): ReadinessItem[] => REQUIRED_FOR_SIGNUP.filter((k) => !r[k]);

/**
 * Whether someone may sign up now, and if not, why. `open` also when a code opens it. The reasons:
 *   closed     the server does not take sign-ups (and the code, if any, opens nothing)
 *   not_ready  sign-up is on, but something it needs went missing since (the Turnstile keys, a legal text)
 *   day        today's sign-ups are taken
 *   full       the server holds as many signed-up families as its operator allows
 *   code       the code is wrong, used up, expired or revoked
 * When it is not open and the server takes requests, the page offers /request instead (`requests`).
 */
export type SignupReason = 'closed' | 'not_ready' | 'day' | 'full' | 'code';
export interface SignupState {
  open: boolean;
  reason?: SignupReason;
  /** Signing up puts a request on the waiting list instead of making the family (unverified sign-ups, no code). */
  waitlist: boolean;
  /** The request form is open as a way in when sign-up is not. */
  requests: boolean;
  /** The ways in a new account may be made with: the server's own, never one it does not offer. */
  methods: SignupMethod[];
}

/** What anyone may know of the hosting side: the landing page reads this signed out. Never a family, never a count. */
export interface PublicHosting {
  mode: InstanceMode;
  instanceName: string;
  landingText: string;
  demoUrl: string;
  contactEmail: string;
  /** Where the data is kept, in words the landing page can say: `cloudflare` (with its jurisdiction when set) or `server`. */
  where: { kind: 'cloudflare' | 'server'; jurisdiction?: string };
  /** The limits a new family gets: its storage cap (bytes, null for none) and how AI is provided. */
  capBytes: number | null;
  signup: SignupState;
  /** Cloudflare Turnstile's site key, which sign-up needs (or `fake`, the browser journeys' stand-in). */
  turnstileSiteKey?: string;
}

/** A sign-up code as the console lists it: never the code itself, which is shown once when it is made. */
export interface SignupCode {
  id: string; label: string; usesMax: number; uses: number; expires: number | null; created: number; revoked: boolean;
}

/** One recent sign-up, for the operator: who, their contact email, the family it made. */
export interface RecentSignup {
  id: string; name: string; email: string; family: string | null; verified: boolean; code: string | null; created: number;
}

/** A web address the landing page may link to as the demo: http(s) only. */
export const isDemoUrl = (v: string) => /^https?:\/\/[^\s<>"']+$/i.test(v.trim());

/** A code as people type it: letters and digits, any case, dashes and spaces ignored. */
export const normCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
