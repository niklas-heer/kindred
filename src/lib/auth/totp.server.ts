// Two-step codes (TOTP, RFC 6238: HMAC-SHA-1, six digits, 30-second steps), as authenticator apps make them, and the ten
// one-use recovery codes that stand in for one. Schema in accounts migration 0040 (`totp`, `recovery_code`).
//
// The secret is sealed with the server secret (./seal.server.ts) and bound to the account. A code is accepted for the step
// before, the step now and the step after (a phone's clock a little off), and only for a step later than the last one used:
// the update that records the step is the check, in one statement, so the same code cannot sign in twice, even from two
// requests at once. Recovery codes are random (50 bits), so a plain hash is enough; using one is one statement too.
import { seal, unseal } from './seal.server.ts';
import { accounts, now, q } from './store.server.ts';
import type { Query } from '../store/index.ts';
import { hashToken, safeEqual } from './tokens.server.ts';

export const STEP_SECONDS = 30;
export const RECOVERY_CODES = 10;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function fromBase32(text: string): Uint8Array {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, '');
  const out: number[] = [];
  let bits = 0, value = 0;
  for (const c of clean) {
    value = (value << 5) | ALPHABET.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** The six-digit code of `secret` (base32) for one step. */
export async function codeAt(secret: string, step: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', fromBase32(secret) as BufferSource, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, BigInt(step));
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter));
  const offset = mac[mac.length - 1] & 15;
  const n = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

export const stepAt = (ms: number) => Math.floor(ms / 1000 / STEP_SECONDS);

/** The step a typed code belongs to, within one step of now, or null. Each candidate is compared in constant time. */
export async function matchingStep(secret: string, typed: string, t = now()): Promise<number | null> {
  const code = typed.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(code)) return null;
  const s = stepAt(t);
  let found: number | null = null;
  for (const step of [s - 1, s, s + 1]) if ((await safeEqual(await codeAt(secret, step), code)) && found === null) found = step;
  return found;
}

const info = (user: string) => `totp:${user}`;

export interface TotpRow { user: string; secret_sealed: string; last_step: number; created: number; confirmed_at: number | null }
export const totpOf = (user: string) => accounts().get<TotpRow>('SELECT * FROM totp WHERE user = ?', user);
/** Whether the account has two-step codes switched on (confirmed). */
export const totpOn = async (user: string) => !!(await totpOf(user))?.confirmed_at;

/** A new secret for `user`, waiting for its first code (any unconfirmed one is replaced). Refused, as `false`, while one is on. */
export async function beginTotp(user: string): Promise<string | false> {
  const secret = base32(crypto.getRandomValues(new Uint8Array(20)));
  const r = await accounts().run(
    `INSERT INTO totp (user, secret_sealed, last_step, created, confirmed_at) VALUES (?, ?, 0, ?, NULL)
     ON CONFLICT (user) DO UPDATE SET secret_sealed = excluded.secret_sealed, last_step = 0, created = excluded.created WHERE totp.confirmed_at IS NULL`,
    user, await seal(info(user), secret), now(),
  );
  return r.changes === 1 ? secret : false;
}

/**
 * Checks a code against the account's secret and, when it matches a step later than the last one used, records that step:
 * one statement, so a code works once. `pending`: the secret being set up (and this confirms it); else the confirmed one.
 */
export async function consumeTotp(user: string, typed: string, { pending = false } = {}): Promise<boolean> {
  const row = await totpOf(user);
  if (!row || (pending ? row.confirmed_at !== null : row.confirmed_at === null)) return false;
  const secret = await unseal(info(user), row.secret_sealed);
  if (!secret) return false;
  const step = await matchingStep(secret, typed);
  if (step === null) return false;
  const r = await accounts().run(
    `UPDATE totp SET last_step = ?, confirmed_at = COALESCE(confirmed_at, ?) WHERE user = ? AND last_step < ? AND ${pending ? 'confirmed_at IS NULL' : 'confirmed_at IS NOT NULL'}`,
    step, now(), user, step,
  );
  return r.changes === 1;
}

export const removeTotp = (user: string): Query => q('DELETE FROM totp WHERE user = ?', user);

/** The `otpauth://` link an authenticator app reads (on a phone, opening it adds the account). */
export function otpauthUri(issuer: string, account: string, secret: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}

// ---------- recovery codes ----------

/** "ABCDE-FGHJK": ten base32 characters, 50 bits. Typed in any case, with or without the dash. */
const newCode = () => {
  const c = base32(crypto.getRandomValues(new Uint8Array(7))).slice(0, 10);
  return `${c.slice(0, 5)}-${c.slice(5)}`;
};
const normalizeCode = (typed: string) => typed.toUpperCase().replace(/[^A-Z2-7]/g, '');
const codeHash = (user: string, typed: string) => hashToken('recovery', `${user}:${normalizeCode(typed)}`);

/** Ten new codes for `user`, replacing any left: the statements, and the codes to show once. */
export async function newRecoveryCodes(user: string): Promise<{ codes: string[]; writes: Query[] }> {
  const codes = Array.from({ length: RECOVERY_CODES }, newCode);
  const t = now();
  return {
    codes,
    writes: [
      q('DELETE FROM recovery_code WHERE user = ?', user),
      ...(await Promise.all(codes.map(async (c) => q('INSERT INTO recovery_code (user, hash, created) VALUES (?, ?, ?)', user, await codeHash(user, c), t)))),
    ],
  };
}

/** Uses one recovery code of `user`: true once, false for a wrong, used or malformed code. One statement, so a code works once. */
export async function consumeRecoveryCode(user: string, typed: string): Promise<boolean> {
  if (normalizeCode(typed).length !== 10) return false;
  const r = await accounts().run('UPDATE recovery_code SET used_at = ? WHERE user = ? AND hash = ? AND used_at IS NULL', now(), user, await codeHash(user, typed));
  return r.changes === 1;
}

/** How many unused recovery codes `user` has. */
export const recoveryLeft = async (user: string) =>
  (await accounts().get<{ n: number }>('SELECT count(*) AS n FROM recovery_code WHERE user = ? AND used_at IS NULL', user))!.n;
