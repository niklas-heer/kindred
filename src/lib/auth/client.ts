// The browser's side of passkeys (see passkeys.server.ts and routes/api/auth/$action.ts).
import { JOURNAL_PREFIX } from '../../components/fields/autosave.ts';
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
export const acceptWithPasskey = (token: string, name: string) => create('invite-options', 'invite', { token, name }, { token });

/** Adds another passkey for the signed-in reader. */
export const addPasskey = () => create('add-options', 'add', {}, {});

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
