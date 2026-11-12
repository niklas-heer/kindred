// The hosting settings (rows of `instance_setting`, accounts migration 0034), the readiness checklist, and whether sign-up
// is open now (docs/hosting-many-families.md, "Hosting and sign-up"). A missing row is its default, so an install that never
// opened the console's Hosting tab is `single` and takes no sign-ups: it behaves as it always has.
import { authMethod } from '../auth/method.server.ts';
import { hashToken } from '../auth/tokens.server.ts';
import { instanceSettings } from '../operator/settings.server.ts';
import { signupTurnstileSite } from '../operator/turnstile.server.ts';
import { onWorkers, q, store, type Query } from '../store/index.ts';
import {
  DEMO_URL_MAX, HOSTING_DEFAULTS, INSTANCE_MODES, LANDING_TEXT_MAX, PER_ACCOUNT_MAX, PER_DAY_MAX, TOTAL_MAX, UNVERIFIED, isDemoUrl, missingForSignup, normCode,
  type HostingSettings, type InstanceMode, type PublicHosting, type Readiness, type SignupState,
} from './shared.ts';

const accounts = () => store.accounts();

const KEY: Record<keyof HostingSettings, string> = {
  mode: 'instance_mode', perAccount: 'signup_per_account', perDay: 'signup_per_day', total: 'signup_total', unverified: 'signup_unverified',
  landingText: 'landing_text', demoUrl: 'demo_url', backups: 'backups_confirmed',
};

const whole = (v: string | undefined, max: number): number | null => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isInteger(n) && n >= 0 && n <= max ? n : null;
};

/** The hosting settings, with the defaults for those never set. */
export async function hostingSettings(): Promise<HostingSettings> {
  const rows = await accounts().all<{ key: string; value: string }>(
    `SELECT key, value FROM instance_setting WHERE key IN (${Object.values(KEY).map(() => '?').join(', ')})`, ...Object.values(KEY));
  const v = new Map(rows.map((r) => [r.key, r.value]));
  const d = HOSTING_DEFAULTS;
  const mode = v.get(KEY.mode);
  const unverified = v.get(KEY.unverified);
  // `total`: a missing row is the default ceiling; "none" is no ceiling.
  const total = v.get(KEY.total);
  return {
    mode: (INSTANCE_MODES as readonly string[]).includes(mode ?? '') ? (mode as InstanceMode) : d.mode,
    perAccount: whole(v.get(KEY.perAccount), PER_ACCOUNT_MAX) ?? d.perAccount,
    perDay: whole(v.get(KEY.perDay), PER_DAY_MAX) ?? d.perDay,
    total: total === 'none' ? null : whole(total, TOTAL_MAX) ?? d.total,
    unverified: (UNVERIFIED as readonly string[]).includes(unverified ?? '') ? (unverified as HostingSettings['unverified']) : d.unverified,
    landingText: (v.get(KEY.landingText) ?? '').slice(0, LANDING_TEXT_MAX),
    demoUrl: isDemoUrl(v.get(KEY.demoUrl) ?? '') ? v.get(KEY.demoUrl)!.trim() : '',
    backups: v.get(KEY.backups) === '1',
  };
}

export const instanceMode = async (): Promise<InstanceMode> => (await hostingSettings()).mode;

/** Plain text for the landing page: no control characters but line breaks, at most LANDING_TEXT_MAX characters. */
export const cleanLandingText = (s: string) =>
  s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, LANDING_TEXT_MAX);

/** The statements that store `next`; a value equal to its default is deleted, so it is the default again. */
export function saveHosting(next: HostingSettings, by: string, at = Date.now()): Query[] {
  const d = HOSTING_DEFAULTS;
  const value: Record<keyof HostingSettings, string | null> = {
    mode: next.mode === d.mode ? null : next.mode,
    perAccount: next.perAccount === d.perAccount ? null : String(next.perAccount),
    perDay: next.perDay === d.perDay ? null : String(next.perDay),
    total: next.total === d.total ? null : next.total === null ? 'none' : String(next.total),
    unverified: next.unverified === d.unverified ? null : next.unverified,
    landingText: cleanLandingText(next.landingText) || null,
    demoUrl: isDemoUrl(next.demoUrl) ? next.demoUrl.trim().slice(0, DEMO_URL_MAX) : null,
    backups: next.backups ? '1' : null,
  };
  return (Object.keys(KEY) as (keyof HostingSettings)[]).map((k) => {
    const v = value[k];
    return v === null
      ? q('DELETE FROM instance_setting WHERE key = ?', KEY[k])
      : q('INSERT INTO instance_setting (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by', KEY[k], v, at, by);
  });
}

/**
 * What a public service needs, item by item (the console's checklist). `mode` and `defaultCapBytes` may be given to judge
 * settings not saved yet (turning sign-up on in the same save that changes them).
 */
export async function readiness(over: { mode?: InstanceMode; settings?: Awaited<ReturnType<typeof instanceSettings>> } = {}): Promise<Readiness> {
  const [s, h, ops] = await Promise.all([
    over.settings ?? instanceSettings(), hostingSettings(),
    accounts().all<{ id: string; n: number }>('SELECT u.id, (SELECT count(*) FROM credential c WHERE c.user = u.id) AS n FROM user u WHERE u.operator = 1'),
  ]);
  const set = (v: string) => !!v.trim();
  return {
    hosting: (over.mode ?? h.mode) === 'hosting',
    // Sign-up makes an account with a passkey: Kindred's own sign-in, not Cloudflare Access (which decides who exists itself).
    auth: authMethod() === 'kindred',
    turnstile: !!signupTurnstileSite(),
    impressum: set(s.impressum),
    privacy: set(s.privacy),
    terms: set(s.terms),
    cap: s.defaultCapBytes !== null,
    contact: set(s.contactEmail),
    report: set(s.reportContact),
    // An operator who loses their only passkey has no way back in: two operators, or each with a second passkey.
    recovery: ops.length >= 2 || (ops.length === 1 && ops[0]!.n >= 2),
    backups: h.backups,
  };
}

// ---------- codes ----------

/** The stored form of a code: its SHA-256 (the code itself is shown once, when it is made). */
export const codeHash = (code: string) => hashToken('invite', `signup-code:${normCode(code)}`);

export interface CodeRow { id: string; uses_max: number; uses: number; expires: number | null; revoked_at: number | null }

/** The code someone typed, when it exists (usable or not). */
export async function codeRow(code: string | undefined): Promise<CodeRow | undefined> {
  if (!code || normCode(code).length < 8 || code.length > 64) return undefined;
  return accounts().get<CodeRow>('SELECT id, uses_max, uses, expires, revoked_at FROM signup_code WHERE hash = ?', await codeHash(code));
}

export const codeUsable = (c: CodeRow | undefined, now = Date.now()): c is CodeRow =>
  !!c && c.revoked_at === null && c.uses < c.uses_max && (c.expires === null || c.expires > now);

// ---------- is sign-up open? ----------

const DAY = 86_400_000;

/** Today's sign-ups and the signed-up families the server holds: the two counts the limits read. */
export async function signupCounts(now = Date.now()): Promise<{ day: number; total: number }> {
  const row = await accounts().get<{ day: number; total: number }>(
    'SELECT (SELECT count(*) FROM signup WHERE created > ?) AS day, (SELECT count(*) FROM family_admin WHERE self_signed = 1) AS total', now - DAY);
  return { day: row?.day ?? 0, total: row?.total ?? 0 };
}

/**
 * Whether sign-up is open for someone now, with `code` when they came with one. Sign-up is open while `family_creation` is
 * `signup` and the server is still ready for it, within today's sign-ups and the ceiling; a usable code opens it while the
 * server takes requests too, and passes the day's limit and the ceiling (the operator chose to let that person in). The
 * batch that makes the family holds the same limits again (signup.server.ts): this answer is for the page.
 */
export async function signupState(code?: string, now = Date.now()): Promise<SignupState> {
  const [s, h, ready, c] = await Promise.all([instanceSettings(), hostingSettings(), readiness(), codeRow(code)]);
  const mode = s.familyCreation;
  const requests = mode === 'requests' || mode === 'signup';
  const base = { requests, methods: ['passkey' as const] };
  const withCode = codeUsable(c, now);
  if (code && !withCode && (mode === 'signup' || mode === 'requests')) return { ...base, open: false, reason: 'code', waitlist: false };
  if (mode !== 'signup' && !(withCode && mode === 'requests')) return { ...base, open: false, reason: 'closed', waitlist: false };
  if (missingForSignup(ready).length) return { ...base, open: false, reason: 'not_ready', waitlist: false };
  if (!withCode) {
    const counts = await signupCounts(now);
    if (counts.day >= h.perDay) return { ...base, open: false, reason: 'day', waitlist: false };
    if (h.total !== null && counts.total >= h.total) return { ...base, open: false, reason: 'full', waitlist: false };
  }
  return { ...base, open: true, waitlist: !withCode && h.unverified === 'waitlist' };
}

/** What anyone may know of the hosting side: the landing page and the sign-up page read it. Never a family, never a count. */
export async function publicHosting(code?: string): Promise<PublicHosting> {
  const [s, h, signup] = await Promise.all([instanceSettings(), hostingSettings(), signupState(code)]);
  const site = signupTurnstileSite();
  const jurisdiction = String(process.env.KINDRED_JURISDICTION ?? '').trim().toLowerCase();
  return {
    mode: h.mode, instanceName: s.instanceName, landingText: h.landingText, demoUrl: h.demoUrl, contactEmail: s.contactEmail.trim(),
    where: onWorkers ? { kind: 'cloudflare', ...(jurisdiction ? { jurisdiction } : {}) } : { kind: 'server' },
    capBytes: s.defaultCapBytes, signup,
    ...(site ? { turnstileSiteKey: site } : {}),
  };
}
