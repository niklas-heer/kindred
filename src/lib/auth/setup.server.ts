// The first account claims stewardship; an optional console code protects public deployments.
import { userCount } from './store.server.ts';
import { safeEqual } from './tokens.server.ts';

// No 0/O or 1/I/L: the code is read off a terminal and typed by hand. 16 characters ≈ 80 bits.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const g = globalThis as unknown as { __kindredSetup?: { code: string; shownAt: number } };

/** A uniformly random character of ALPHABET (rejection sampling, so no letter is likelier). */
function randomChar(): string {
  const limit = 256 - (256 % ALPHABET.length);
  const b = new Uint8Array(1);
  do crypto.getRandomValues(b);
  while (b[0] >= limit);
  return ALPHABET[b[0] % ALPHABET.length];
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * A code set in KINDRED_SETUP_CODE itself (12+ letters or digits) rather than `required`: the same in
 * every process, which a Worker needs (each isolate would otherwise make up its own). Keep it secret.
 */
const fixedCode = () => {
  const v = process.env.KINDRED_SETUP_CODE?.trim();
  return v && v !== 'required' && norm(v).length >= 12 ? v : undefined;
};

function state() {
  if (!g.__kindredSetup) {
    const chars = Array.from({ length: 16 }, randomChar).join('');
    g.__kindredSetup = { code: chars.replace(/(.{4})(?!$)/g, '$1-'), shownAt: 0 };
  }
  return g.__kindredSetup;
}

export const setupCodeRequired = () => process.env.KINDRED_SETUP_CODE === 'required' || process.env.KINDRED_REQUIRE_SETUP_CODE === '1' || !!fixedCode();

export const needsSetup = async () => (await userCount()) === 0;

/**
 * Prints the setup code while nobody has an account: on the server's first request, and again when
 * someone opens /setup (at most once a minute). The only secret Kindred ever logs; a code set in
 * KINDRED_SETUP_CODE is never printed. Never throws.
 */
export async function announceSetup(origin?: string, force = false) {
  try {
    if (!setupCodeRequired() || !(await needsSetup())) return;
    const where = origin ? `${origin}/setup` : '/setup';
    if (fixedCode()) {
      if (!force) return;
      console.log(`[kindred] Nobody has an account yet. Open ${where} and enter the setup code from KINDRED_SETUP_CODE.`);
      return;
    }
    const s = state();
    if (!force && s.shownAt) return;
    if (force && Date.now() - s.shownAt < 60_000) return;
    s.shownAt = Date.now();
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
  } catch (e) {
    console.error('[kindred] setup notice failed', e);
  }
}

/** Whether a typed code is the setup code (case, spaces and dashes don't matter). */
export async function checkSetupCode(typed: string): Promise<boolean> {
  if (!(await needsSetup())) return false;
  if (!setupCodeRequired()) return true;
  return safeEqual(norm(typed), norm(fixedCode() ?? state().code));
}
