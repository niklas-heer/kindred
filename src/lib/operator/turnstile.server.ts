// Cloudflare Turnstile, against bots on the public request forms (docs/hosting-many-families.md). On only when the server has
// KINDRED_TURNSTILE_SITE_KEY and KINDRED_TURNSTILE_SECRET; the browser shows the widget and sends its token, and the server
// asks Cloudflare whether the token is good. Tests replace the verifier (`setTurnstileVerifier`), so no test calls Cloudflare.
import { turnstileKeys } from './settings.server.ts';

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

/** Whether a form passes: always while Turnstile is off; otherwise only with a token Cloudflare accepts. */
export async function passesTurnstile(token: string | undefined, ip: string | undefined, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  const keys = turnstileKeys(env);
  if (!keys) return true;
  if (!token || token.length > 2048) return false;
  return (g.__kindredTurnstile ?? cloudflareVerifier)(token, keys.secret, ip);
}
