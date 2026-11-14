// The ways into a Kindred account under its own sign-in (KINDRED_AUTH empty or `kindred`), shared by the server and the
// browser. Plain code, no server imports. Cloudflare Access is not one of these: it is a mode of the whole deployment
// (method.server.ts) that replaces them all.
//
// Single sign-on (`oidc`) is OpenID Connect with providers the operator adds in the console (./oidc.ts, ./oidc.server.ts): it is
// available once one provider is on. A code by email (`email-code`, ./email-code.server.ts) goes to an account's confirmed
// address: it is available while the server sends email.

export const SIGN_IN_METHODS = ['passkey', 'password', 'oidc', 'email-code'] as const;
export type SignInMethod = (typeof SIGN_IN_METHODS)[number];

/** What a fresh install and an upgrade have: passkeys only, so an upgrade changes nothing. */
export const DEFAULT_METHODS: readonly SignInMethod[] = ['passkey'];

/**
 * How the console shows a method: `unavailable` (this server cannot offer it: no provider configured, or the deployment signs
 * in with Cloudflare Access), `configured` (it could be turned on), `enabled` (people sign in with it).
 */
export type MethodState = 'unavailable' | 'configured' | 'enabled';

export const isSignInMethod = (v: unknown): v is SignInMethod => typeof v === 'string' && (SIGN_IN_METHODS as readonly string[]).includes(v);

/** A list of methods as stored or typed (`["passkey","password"]` or `passkey,password`); null when it is empty or holds anything unknown. */
export function parseMethods(text: string | undefined | null): SignInMethod[] | null {
  const raw = text?.trim();
  if (!raw) return null;
  let items: unknown[];
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      items = parsed;
    } catch {
      return null;
    }
  } else {
    items = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  }
  if (!items.length || !items.every(isSignInMethod)) return null;
  // In the canonical order, each once.
  return SIGN_IN_METHODS.filter((m) => items.includes(m));
}

/** What the console shows for one method. */
export interface MethodCard {
  id: SignInMethod;
  state: MethodState;
  /** Accounts that can use it (a passkey saved, a password set, a confirmed address for a code by email). */
  accounts: number;
  /** Accounts for which it is the only way in: turning it off locks them out until they get another. */
  onlyWay: number;
}

/** The console's sign-in tab. `source` says where the enabled list comes from now. */
export interface SignInSettings {
  mode: 'kindred' | 'cloudflare-access';
  source: 'break-glass' | 'console' | 'KINDRED_AUTH' | 'default';
  methods: MethodCard[];
}

/** Username rules: what is typed is trimmed and lower-cased; 3 to 64 of a–z, 0–9 and . _ - @ +, starting with a letter or digit. */
export const USERNAME = /^[a-z0-9][a-z0-9._@+-]{2,63}$/;
export const normalizeUsername = (typed: string) => typed.normalize('NFKC').trim().toLowerCase();

/** The shortest password Kindred accepts, in characters (spaces count). */
export const PASSWORD_MIN = 12;
/** The longest, so hashing one stays cheap. */
export const PASSWORD_MAX = 256;
/** Characters as a person counts them (an emoji is one). */
export const passwordLength = (pw: string) => [...pw].length;
