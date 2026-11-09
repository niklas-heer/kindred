// The installation's one sign-in method, chosen when it is deployed (KINDRED_AUTH), never from inside the app:
//
//   kindred            Kindred's own accounts and passkeys. Cloudflare Access tokens are ignored, even valid ones.
//   cloudflare-access  Cloudflare Access is the only sign-in. Kindred's sessions and passkeys are off.
//
// Empty means `kindred`, which is what every install without Access settings already does. With Access settings present and
// no KINDRED_AUTH, Kindred refuses to guess: the two answers lock out different people. So does any value it cannot use, and
// `cloudflare-access` without its team domain and audience. Refusing means nobody signs in; it never means open access.
import { accessConfig, verifyAccessToken, type AccessConfig } from './access.server.ts';
import { onGuestHost } from './origin.ts';
import { negotiateLocale, translate, type Key } from '../i18n/dictionary.ts';

export type AuthMethod = 'kindred' | 'cloudflare-access';
export type AuthProblem = 'ambiguous' | 'unknown-value' | 'needs-access-settings' | 'bad-team-domain';
export type AuthSetting = { method: 'kindred' } | { method: 'cloudflare-access'; access: AccessConfig } | { method: null; problem: AuthProblem };

type Env = Record<string, string | undefined>;

/** Reads the setting. Never throws, and never reads a request: a deployment has one answer. */
export function authSetting(env: Env = process.env): AuthSetting {
  const chosen = env.KINDRED_AUTH?.trim().toLowerCase();
  if (!chosen) return env.CF_ACCESS_TEAM_DOMAIN?.trim() || env.CF_ACCESS_AUD?.trim() ? { method: null, problem: 'ambiguous' } : { method: 'kindred' };
  if (chosen === 'kindred') return { method: 'kindred' };
  if (chosen !== 'cloudflare-access') return { method: null, problem: 'unknown-value' };
  try {
    const access = accessConfig(env);
    return access ? { method: 'cloudflare-access', access } : { method: null, problem: 'needs-access-settings' };
  } catch {
    return { method: null, problem: 'bad-team-domain' };
  }
}

/** The active method, or null when the setting is refused. */
export const authMethod = (): AuthMethod | null => authSetting().method;

/** The verified Access email for a request. Undefined unless Cloudflare Access is the active method. */
export async function accessEmail(request: Request): Promise<string | undefined> {
  const setting = authSetting();
  return setting.method === 'cloudflare-access' ? verifyAccessToken(request.headers.get('cf-access-jwt-assertion'), setting.access) : undefined;
}

/** Where to send someone to sign out, when Cloudflare Access is what signed them in. */
export const accessLogoutUrl = () => (authMethod() === 'cloudflare-access' ? '/cdn-cgi/access/logout' : undefined);

const PROBLEM_TEXT: Record<AuthProblem, Key> = {
  ambiguous: 'auth.refused_ambiguous',
  'unknown-value': 'auth.refused_unknown',
  'needs-access-settings': 'auth.refused_needs_settings',
  'bad-team-domain': 'auth.refused_bad_domain',
};

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

let logged = false;
/**
 * The page that replaces the whole site while the setting is refused, or undefined when it is fine. The guest host stays up:
 * a guest's visit has its own token and depends on neither method. Names settings, never their values.
 */
export function authRefusal(request: Request): Response | undefined {
  const setting = authSetting();
  if (setting.method || onGuestHost(request)) return undefined;
  if (!logged) {
    logged = true;
    console.error(`[kindred] Nobody can sign in. ${translate('en', PROBLEM_TEXT[setting.problem])} (docs/self-host.md, "Choosing how people sign in").`);
  }
  const locale = negotiateLocale(request.headers.get('accept-language') ?? '');
  const html = `<!doctype html><html lang="${locale}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Kindred</title><main><h1>${escapeHtml(translate(locale, 'auth.refused_title'))}</h1><p>${escapeHtml(translate(locale, 'auth.refused_text'))}</p><p><code>${escapeHtml(translate(locale, PROBLEM_TEXT[setting.problem]))}</code></p></main></html>`;
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
