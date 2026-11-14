// The browser's side of passkeys and passwords (see passkeys.server.ts, password.server.ts and routes/api/auth/$action.ts).
import { JOURNAL_PREFIX } from '../fields/journal-key.ts';
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';

export class AuthRequestError extends Error {
  code?: string;
  status: number;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function post<T>(action: string, body: object = {}): Promise<T> {
  const res = await fetch(`/api/auth/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) throw new AuthRequestError(data.error ?? 'Something went wrong. Please try again.', res.status, data.code);
  return data;
}

/** Whether this browser can use passkeys at all. */
export const passkeysSupported = () => typeof window !== 'undefined' && 'PublicKeyCredential' in window && typeof navigator.credentials?.create === 'function';

/** Turns the browser's WebAuthn errors into something a relative can act on. */
function friendly(e: unknown): Error {
  if (e instanceof AuthRequestError) return e;
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'AbortError') return new Error('Your browser or password manager cancelled the passkey prompt, or it timed out. Try again and choose your saved passkey, or use another device.');
  if (name === 'InvalidStateError') return new Error('This device already has a passkey for your account.');
  if (name === 'SecurityError') return new Error('Passkeys only work on the site’s real address (https, or localhost).');
  return new Error('Your device couldn’t make or use a passkey. Try again, or try another device.');
}

async function create<T = { ok: boolean }>(optionsAction: string, finishAction: string, optionsBody: object, finishBody: object): Promise<T> {
  const { startRegistration } = await import('@simplewebauthn/browser');
  const { options, challengeId } = await post<{ options: PublicKeyCredentialCreationOptionsJSON; challengeId: string }>(optionsAction, optionsBody);
  let response;
  try {
    response = await startRegistration({ optionsJSON: options });
  } catch (e) {
    throw friendly(e);
  }
  return post<T>(finishAction, { ...finishBody, challengeId, response });
}

/** Creates the first steward's passkey (checks the setup code when enabled) and, on a new server, its family. Returns that family's id. */
export const setUpFirstSteward = (code: string, name: string, familyName: string) =>
  create<{ ok: boolean; tree: string | null }>('setup-options', 'setup', { code, name, familyName }, { code, familyName });

/** Creates a passkey from an invitation and joins the family. */
/** `acceptTerms`: the invitee ticked "I accept the terms" (a steward's invitation on a server that has terms asks for it). */
export const acceptWithPasskey = (token: string, name: string, acceptTerms?: boolean) =>
  create('invite-options', 'invite', { token, name, acceptTerms }, { token, acceptTerms });

/**
 * Starts a family on a server that takes sign-ups (src/lib/signup/): checks the form, makes a passkey, and makes the account,
 * the family and its steward. The same fields go with both steps; the server checks them both times. Returns the family's id.
 */
export const signUpWithPasskey = (form: Record<string, unknown>) =>
  create<{ ok: boolean; tree: string }>('signup-options', 'signup', form, form);

/** The same with a username and password (while the server offers them): one step. Returns the family's id. */
export const signUpWithPassword = (form: Record<string, unknown>) => post<{ ok: boolean; tree: string }>('signup-password', form);

/** Confirms with one of the reader's passkeys, on this session, that it is them (see proof.server.ts). */
async function provePasskey() {
  const { startAuthentication } = await import('@simplewebauthn/browser');
  const { options, challengeId } = await post<{ options: PublicKeyCredentialRequestOptionsJSON; challengeId: string }>('confirm-options');
  let response;
  try {
    response = await startAuthentication({ optionsJSON: options });
  } catch (e) {
    throw friendly(e);
  }
  await post('confirm', { challengeId, response });
}

// ---------- the proof by password ----------

/**
 * What the proof prompt (ProofHost) is asked for: the password (`password`, with a two-step code when `totp`), or signing in
 * again at one of `oidc`'s providers, which leaves the page and comes back (the step is then done again by the reader). It
 * resolves once the server accepted a password proof, rejects when cancelled.
 */
export interface PasswordProofAsk { password: boolean; totp: boolean; oidc: { id: string; label: string }[]; resolve: () => void; reject: (e: Error) => void }
const proofListeners = new Set<(ask: PasswordProofAsk) => void>();
/** The prompt registers here (one is mounted at the root of the app). */
export const onPasswordProof = (fn: (ask: PasswordProofAsk) => void) => { proofListeners.add(fn); return () => { proofListeners.delete(fn); }; };
/** Sends the password (and the two-step code) as this session's proof. */
export const confirmPassword = (body: { password: string; code?: string; recovery?: string }) => post('confirm-password', body);

function askProof(kinds: { password: boolean; totp: boolean; oidc: { id: string; label: string }[] }): Promise<void> {
  const [listen] = proofListeners;
  if (!listen) return Promise.reject(new Error('pw.err.no_proof'));
  return new Promise((resolve, reject) => listen({ ...kinds, resolve, reject }));
}

/**
 * Confirms it is the reader: with a passkey when they have one this device can use, else with their password or by signing in
 * again at a single sign-on provider they use.
 */
async function proveItsYou() {
  const kinds = await post<{ passkey: boolean; password: boolean; totp: boolean; oidc: { id: string; label: string }[] }>('proof-kinds');
  const others = kinds.password || kinds.oidc.length > 0;
  if (kinds.passkey && (passkeysSupported() || !others)) return provePasskey();
  if (others) return askProof({ password: kinds.password, totp: kinds.totp, oidc: kinds.oidc });
  throw new Error('pw.err.no_proof');
}

/** The English of the server's "confirm it's you first" refusal (errors.ts, needsProof), for a server function's error. */
const PROOF_NEEDED = 'Confirm it’s you with your passkey first.';
const needsProof = (e: unknown) => (e as { code?: unknown } | null)?.code === 'reauth' || (e instanceof Error && e.message === PROOF_NEEDED);

/**
 * Runs a step that may need a fresh passkey proof: when the server asks for one, the reader confirms with their passkey and
 * the step runs once more. A sign-in a few minutes ago already counts, so then there is no second prompt.
 */
export async function withFreshProof<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (!needsProof(e)) throw e;
    await proveItsYou();
    return run();
  }
}

/** Adds another passkey for the signed-in reader, after they confirm it is them. */
export const addPasskey = () => withFreshProof(() => create('add-options', 'add', {}, {}));

/** Signs in with any of this site's passkeys on the device. */
export async function signInWithPasskey() {
  const { startAuthentication } = await import('@simplewebauthn/browser');
  const { options, challengeId } = await post<{ options: PublicKeyCredentialRequestOptionsJSON; challengeId: string }>('signin-options');
  let response;
  try {
    response = await startAuthentication({ optionsJSON: options });
  } catch (e) {
    throw friendly(e);
  }
  await post('signin', { challengeId, response });
}

export const signOutRequest = () => post('signout');

// ---------- username and password ----------

/** A password sign-in: done (`ok`), or a ticket for the two-step code. A wrong one throws the server's key. */
export const signInWithPassword = (body: { username: string; password: string; turnstile?: string }) =>
  post<{ ok?: true; step?: 'code'; ticket?: string }>('password-signin', body);
/** The two-step code (or a recovery code) for a ticket. */
export const finishPasswordSignIn = (body: { ticket: string; code?: string; recovery?: string }) => post('password-second', body);
/** A forgotten password, reset with a recovery code (and the two-step code, when the account has them); signs in. */
export const recoverPassword = (body: { username: string; recovery: string; code?: string; password: string }) => post('password-recover', body);
/** An operator's reset link: a new password (and a username, if the account had none); signs in. */
export const resetPassword = (body: { token: string; username?: string; password: string; code?: string }) => post('password-reset', body);
/** The first steward with a password. Returns the family made for a new server. */
export const setUpWithPassword = (body: { code: string; name: string; familyName: string; username: string; password: string }) =>
  post<{ ok: boolean; tree: string | null }>('password-setup', body);
/** An invitation taken with a new password account. */
export const acceptWithPassword = (body: { token: string; name: string; username: string; password: string; acceptTerms?: boolean }) => post('password-invite', body);

// ---------- a code by email ----------

/** Asks for a code by email (src/lib/auth/email-code.server.ts): the same answer for every address; binds this browser. */
export const askSignInCode = (body: { email: string }) => post<{ ok: true }>('email-code-request', body);
/** The code from the email: done (`ok`), or a ticket for the account's two-step code. Works only in the browser that asked. */
export const signInWithCode = (body: { code: string }) => post<{ ok?: true; step?: 'code'; ticket?: string }>('email-code', body);
/** The two-step code (or a recovery code) after a right code by email. */
export const finishCodeSignIn = (body: { ticket: string; code?: string; recovery?: string }) => post('email-code-second', body);

// ---------- single sign-on ----------

/**
 * Starts a single sign-on flow (src/lib/auth/oidc.server.ts) and leaves for the provider; the provider sends the browser back
 * to /api/auth/oidc/<provider>/callback, which goes on to `next` (a path on this site). `link` and `proof` need the reader
 * signed in; `invite` takes the invitation with a new account; `test` is the operator's test sign-in from the console.
 */
export async function startSingleSignOn(body: { provider: string; purpose: 'signin' | 'invite' | 'link' | 'proof' | 'signup' | 'test'; next?: string; token?: string; name?: string; acceptTerms?: boolean; [field: string]: unknown }) {
  const { url } = await post<{ url: string }>('oidc-start', body);
  window.location.assign(url);
}

/** The path and query of the page the reader is on, for coming back to it after a provider's sign-in. */
export const hereForReturn = () => (typeof window === 'undefined' ? '/' : `${window.location.pathname}${window.location.search}`);

/** Forgets per-reader state in this browser (who you are in each family), so the next reader starts fresh. */
export function forgetLocalIdentity() {
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith('kindred.ai.inflight.')) sessionStorage.removeItem(k);
    for (const k of Object.keys(localStorage)) if (k.startsWith('kindred:me:') || k === 'kindred:last-visit' || k.startsWith('kindred:invite-link:') || k.startsWith('kindred:assistant-tabs:') || k === 'kindred:assistant-unread' || k.startsWith(JOURNAL_PREFIX)) localStorage.removeItem(k);
  } catch {}
}

/** Only same-site paths, so a sign-in link can't send someone elsewhere afterwards. */
export const safeNext = (next: unknown): string =>
  typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') && !/[\u0000-\u001f\\]/.test(next) ? next : '/';
