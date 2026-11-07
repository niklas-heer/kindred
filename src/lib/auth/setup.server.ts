// The first account claims stewardship; an optional console code protects public deployments.
import { randomInt } from 'node:crypto';
import { userCount } from './store.server.ts';
import { safeEqual } from './tokens.server.ts';

// No 0/O or 1/I/L: the code is read off a terminal and typed by hand. 16 characters ≈ 80 bits.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const g = globalThis as unknown as { __kindredSetup?: { code: string; shownAt: number } };

function state() {
  if (!g.__kindredSetup) {
    const chars = Array.from({ length: 16 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
    g.__kindredSetup = { code: chars.replace(/(.{4})(?!$)/g, '$1-'), shownAt: 0 };
  }
  return g.__kindredSetup;
}

export const setupCodeRequired = () => process.env.KINDRED_SETUP_CODE === 'required' || process.env.KINDRED_REQUIRE_SETUP_CODE === '1';

export const needsSetup = () => userCount() === 0;

/**
 * Prints the setup code while nobody has an account: on the server's first request, and again when
 * someone opens /setup (at most once a minute). The only secret Kindred ever logs.
 */
export function announceSetup(origin?: string, force = false) {
  if (!needsSetup() || !setupCodeRequired()) return;
  const s = state();
  if (!force && s.shownAt) return;
  if (force && Date.now() - s.shownAt < 60_000) return;
  s.shownAt = Date.now();
  const where = origin ? `${origin}/setup` : '/setup';
  console.log(
    `\n  ┌─ Kindred setup ────────────────────────────────────────────\n` +
      `  │ Nobody has an account yet. Open ${where}\n` +
      `  │ and enter this one-time setup code to become the first steward:\n` +
      `  │\n` +
      `  │     ${s.code}\n` +
      `  │\n` +
      `  │ It works until the first account exists and changes when the server restarts.\n` +
      `  └────────────────────────────────────────────────────────────\n`,
  );
}

/** Whether a typed code is the setup code (case, spaces and dashes don't matter). */
export function checkSetupCode(typed: string): boolean {
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return needsSetup() && (!setupCodeRequired() || safeEqual(norm(typed), norm(state().code)));
}
