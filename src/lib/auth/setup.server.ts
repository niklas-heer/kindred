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

/** The values that turn KINDRED_REQUIRE_SETUP_CODE on, in any case. */
const REQUIRE_ON = new Set(['1', 'true', 'yes', 'required']);
let warnedRequireFlag = false;

/**
 * KINDRED_REQUIRE_SETUP_CODE: 1, true, yes or required (any case) require the code. Any other non-empty value does not,
 * and the server says so once. It fails open, as the other switches here do not: the warning is the only guard against a
 * typo. The value itself is never logged, because someone may have pasted the setup code there by mistake.
 */
function requireFlagOn(): boolean {
  const raw = process.env.KINDRED_REQUIRE_SETUP_CODE?.trim();
  if (!raw) return false;
  if (REQUIRE_ON.has(raw.toLowerCase())) return true;
  if (!warnedRequireFlag) {
    warnedRequireFlag = true;
    console.warn(
      '[kindred] KINDRED_REQUIRE_SETUP_CODE has a value Kindred does not understand, so the setup code is NOT required. ' +
        'Use 1, true, yes or required (docs/self-host.md).',
    );
  }
  return false;
}

export const setupCodeRequired = () => process.env.KINDRED_SETUP_CODE === 'required' || requireFlagOn() || !!fixedCode();

export const needsSetup = async () => (await userCount()) === 0;

/**
 * The address a request arrived at, as the browser named it. Behind a TLS proxy the request's own scheme is http, so
 * X-Forwarded-Proto (the scheme the browser used, when the proxy sends it) is used instead. Only http and https count.
 */
export function arrivedAt(request: Request): URL {
  const url = new URL(request.url);
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  return proto === 'http' || proto === 'https' ? new URL(`${proto}://${url.host}${url.pathname}${url.search}`) : url;
}

/** This machine: its loopback names. Anything else is a public address as far as the setup is concerned. */
export const isLocalHost = (hostname: string) => {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || /^127\./.test(h);
};

/**
 * Whether first-account setup is open to anyone who can reach the server: no setup code, and a public address.
 * `origin` is the site's configured address (KINDRED_ORIGIN, or the request's own when it is not set); `host` is
 * the address the request actually arrived at. Either one being public makes setup public: a proxy can forward a
 * public name to a server whose KINDRED_ORIGIN is still the local one. The first person there becomes the
 * steward, which is the default but should be a choice on purpose.
 */
export const setupOpenToPublic = (origin: URL, host?: URL) =>
  !setupCodeRequired() && (!isLocalHost(origin.hostname) || (!!host && !isLocalHost(host.hostname)));

let openWarning: 'pending' | 'shown' | 'moot' = 'pending';
/**
 * A loud console warning, once per process, while nobody has an account and setup is open to the public.
 * Called on the server's first request. Never throws.
 */
export async function warnOpenSetup(origin: URL, host?: URL) {
  try {
    if (openWarning !== 'pending') return;
    if (!setupOpenToPublic(origin, host)) return;
    if (!(await needsSetup())) { openWarning = 'moot'; return; }
    openWarning = 'shown';
    const where = host && !isLocalHost(host.hostname) ? host.origin : origin.origin;
    console.warn(
      `\n  ┌─ Kindred WARNING ──────────────────────────────────────────\n` +
        `  │ Setup is open on ${where} and nobody has an account yet.\n` +
        `  │ The first person to create an account there becomes the steward.\n` +
        `  │ Set KINDRED_SETUP_CODE (12+ characters, or "required") to require a code,\n` +
        `  │ or create the steward account now.\n` +
        `  └────────────────────────────────────────────────────────────\n`,
    );
  } catch (e) {
    console.error('[kindred] setup warning failed', e);
  }
}

let originLogged = false;
/**
 * Logs once per process when a request arrives at a public host other than KINDRED_ORIGIN's. Passkeys and sign-in
 * cookies follow KINDRED_ORIGIN, so a different name in the request is worth a line in the log. Only the host is
 * compared: a proxy that ends TLS makes the request's scheme differ from KINDRED_ORIGIN's, which is normal. A loopback
 * arrival is the server itself (its start-up check of its own address) or someone on the machine, so it is not logged,
 * and does not use up the one line. Returns whether it logged.
 */
export function logOriginMismatch(configured: string | undefined, request: URL, log: (message: string) => void = console.warn): boolean {
  if (originLogged || !configured || isLocalHost(request.hostname)) return false;
  let origin: URL;
  try {
    origin = new URL(configured);
  } catch {
    return false;
  }
  if (origin.host === request.host) return false;
  originLogged = true;
  log(
    `[kindred] Requests arrive at ${request.origin}, but KINDRED_ORIGIN is ${origin.origin}. ` +
      `Passkeys and sign-in cookies follow KINDRED_ORIGIN. If ${request.origin} is your address, set KINDRED_ORIGIN to it (docs/self-host.md).`,
  );
  return true;
}

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
