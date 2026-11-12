// Demo mode (KINDRED_DEMO=1): a public, read-only showcase of the invented families. Nobody signs in; every visitor reads as a
// viewer of every family, and every write is refused on the server in one place: the storage layer (src/lib/store/index.ts),
// which every family database, the accounts database and the media store pass through, with `once` (src/lib/db.server.ts)
// refusing before a change is even planned. So a feature added later is read-only in a demo without knowing about it.
//
// The setting is read from the environment only (process.env, which on Workers carries the Worker's vars), never from a
// request: no header, cookie or query can turn it on or off. Settings that need accounts, a guest host or push cannot be
// combined with it; the server then refuses to start (server/node.ts) or answers every request with a page naming them
// (src/start.ts), as it does for a sign-in setting it cannot use.
//
// Plain code with no server-only imports: the store, the guard and the start middleware all import it.
import { translate } from './i18n/dictionary.ts';
import { AuthError } from './auth/errors.ts';

type Env = Record<string, string | undefined>;

const ON = new Set(['1', 'true', 'yes', 'on']);
const OFF = new Set(['', '0', 'false', 'no', 'off']);

/** Settings a demo cannot have: they turn on accounts, a guest host for share links, setup, or push. */
export const DEMO_CONFLICTS = [
  'KINDRED_AUTH',
  'KINDRED_AUTH_METHODS',
  'CF_ACCESS_TEAM_DOMAIN',
  'CF_ACCESS_AUD',
  'KINDRED_GUEST_ORIGIN',
  'KINDRED_SETUP_CODE',
  'KINDRED_REQUIRE_SETUP_CODE',
  'KINDRED_VAPID_PUBLIC_KEY',
  'KINDRED_VAPID_PRIVATE_JWK',
  'KINDRED_VAPID_SUBJECT',
] as const;

export type DemoSetting = { on: boolean; problem?: undefined } | { on: false; problem: string };

/**
 * KINDRED_DEMO as set. A value Kindred does not know, or a setting a demo cannot have beside it, is a problem: the server then
 * does not run at all, so a typo can never open a real family to the public, nor leave a demo half open.
 */
export function demoSetting(env: Env = process.env): DemoSetting {
  const raw = env.KINDRED_DEMO?.trim().toLowerCase() ?? '';
  if (OFF.has(raw)) return { on: false };
  if (!ON.has(raw)) return { on: false, problem: `KINDRED_DEMO must be 1 (a demo) or empty, not "${env.KINDRED_DEMO}".` };
  const clashing = DEMO_CONFLICTS.filter((name) => {
    const v = env[name]?.trim() ?? '';
    // Kindred's own sign-in is what KINDRED_AUTH means when empty; it is harmless spelled out. A "no" for the setup-code flag too.
    if (name === 'KINDRED_AUTH') return !!v && v.toLowerCase() !== 'kindred';
    if (name === 'KINDRED_REQUIRE_SETUP_CODE') return !OFF.has(v.toLowerCase());
    return !!v;
  });
  if (clashing.length) return { on: false, problem: `KINDRED_DEMO=1 cannot be combined with ${clashing.join(', ')}: a demo has no accounts, no share links and no reminders. Remove ${clashing.length > 1 ? 'them' : 'it'}.` };
  return { on: true };
}

/** Whether this server is a demo. Read on every call, from the environment only. */
export const isDemo = (env: Env = process.env): boolean => demoSetting(env).on;

/** The problem with the demo setting, or undefined when there is none (also when it is off). */
export const demoProblem = (env: Env = process.env): string | undefined => demoSetting(env).problem;

/** The refusal every write gets in a demo: a 403 with a sentence the reader's language has (translateMessage). */
export const demoRefused = () => new AuthError('forbidden', translate('en', 'demo.err_read_only'));

/** Throws the demo's refusal when this server is a demo. For code that does work before it writes (an upload, an AI call). */
export function refuseInDemo(): void {
  if (isDemo()) throw demoRefused();
}

/** The demo visitor's account id: no account row has it (account ids are UUIDs), so nothing in the accounts database matches. */
export const DEMO_USER_ID = 'demo';

/** Where the banner points: the project's repository. */
export const DEMO_REPOSITORY = 'https://github.com/niklas-heer/kindred';

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

let logged = false;
/** The page that replaces the whole site while the demo setting is refused (src/start.ts); undefined when it is fine. */
export function demoRefusal(env: Env = process.env): Response | undefined {
  const problem = demoProblem(env);
  if (!problem) return undefined;
  if (!logged) {
    logged = true;
    console.error(`[kindred] ${problem} (docs/self-host.md, "A public demo").`);
  }
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Kindred</title><main><h1>${escapeHtml(translate('en', 'demo.refused_title'))}</h1><p><code>${escapeHtml(problem)}</code></p></main></html>`;
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
