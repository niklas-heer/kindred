// Cloudflare Turnstile, against bots on the public request forms (docs/hosting-many-families.md). On only when the server has
// KINDRED_TURNSTILE_SITE_KEY and KINDRED_TURNSTILE_SECRET; the browser shows the widget and sends its token, and the server
// asks Cloudflare whether the token is good. Tests replace the verifier (`setTurnstileVerifier`), so no test calls Cloudflare.
import { turnstileKeys } from './settings.server.ts';
import { TURNSTILE_FAKE_TOKEN } from './shared.ts';

export type TurnstileVerifier = (token: string, secret: string, ip: string | undefined) => Promise<boolean>;

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Asks Cloudflare. A network failure or an unexpected answer is a no: the form can be sent again. */
export const cloudflareVerifier: TurnstileVerifier = async (token, secret, ip) => {
  const body = new FormData();
  body.set('secret', secret);
  body.set('response', token);
  if (ip) body.set('remoteip', ip);
  try {
    const res = await fetch(SITEVERIFY, { method: 'POST', body, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return false;
    return (await res.json() as { success?: unknown }).success === true;
  } catch {
    return false;
  }
};

const g = globalThis as unknown as { __kindredTurnstile?: TurnstileVerifier };

/** For tests: the verifier to use instead of Cloudflare's (undefined puts Cloudflare's back). */
export function setTurnstileVerifier(v: TurnstileVerifier | undefined): void {
  g.__kindredTurnstile = v;
}

/**
 * Sign-up's Turnstile (src/lib/signup/): sign-up needs it, so its site key is Cloudflare's, or, with KINDRED_TURNSTILE_FAKE=1
 * (the browser journeys only, never a real server), `fake`: a local stand-in, a tick box whose token only this check accepts.
 * Nothing then reaches Cloudflare. The stand-in serves sign-up alone; the request forms keep Cloudflare's or nothing.
 */
export const TURNSTILE_FAKE_SITE = 'fake';
/** The stand-in only on a local server: with a public KINDRED_ORIGIN the setting is ignored, so it can never open a real one. */
const localOrigin = (origin: string | undefined) => {
  if (!origin) return true;
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname);
  } catch {
    return false;
  }
};
const fakeOn = (env: Record<string, string | undefined>) => env.KINDRED_TURNSTILE_FAKE === '1' && localOrigin(env.KINDRED_ORIGIN);
export const signupTurnstileSite = (env: Record<string, string | undefined> = process.env): string | undefined =>
  fakeOn(env) ? TURNSTILE_FAKE_SITE : turnstileKeys(env)?.site;
export async function passesSignupTurnstile(token: string | undefined, ip: string | undefined, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  if (fakeOn(env)) return token === TURNSTILE_FAKE_TOKEN;
  if (!turnstileKeys(env)) return false;
  return passesTurnstile(token, ip, env);
}

/** Whether a form passes: always while Turnstile is off; otherwise only with a token Cloudflare accepts. */
export async function passesTurnstile(token: string | undefined, ip: string | undefined, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  const keys = turnstileKeys(env);
  if (!keys) return true;
  if (!token || token.length > 2048) return false;
  return (g.__kindredTurnstile ?? cloudflareVerifier)(token, keys.secret, ip);
}
