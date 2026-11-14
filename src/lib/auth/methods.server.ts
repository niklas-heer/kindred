// Which ways into an account this server offers under Kindred's own sign-in (./methods.ts), and the rules for changing that.
//
// Where the list comes from, first match wins:
//   KINDRED_AUTH_METHODS   a break-glass override (`passkey,password`): for an operator who locked themselves out. While it
//                          is set, the console shows the list and cannot change it.
//   the console            `instance_setting.auth_methods`, a JSON list, once an operator saved it.
//   KINDRED_AUTH           its value, when it lists methods (`passkey,password`) instead of naming a mode: imported, in the
//                          sense that the console starts from it and the first save stores it; from then on the console holds.
//   the default            passkeys only, so an upgrade changes nothing.
// Cloudflare Access (KINDRED_AUTH=cloudflare-access) is not on this list: it is the deployment's mode (method.server.ts), and
// then none of these is offered.
//
// Turning a method off is refused when an operator would be left without a way in; it ends every session that method
// started; the console first shows how many accounts would lose their only way in.
//
// A code by email (`email-code`) is a way back in, not a way an account keeps: it is never counted when Kindred checks that an
// operator, or an account removing a way in, still has one (`lastingWayIn`), as email can stop and a code is never an operator's
// fresh proof. The console's counts and its "left with no way in" still count it, as it is how those accounts sign in now.
import { authSetting } from './method.server.ts';
import { DEFAULT_METHODS, parseMethods, SIGN_IN_METHODS, type MethodCard, type MethodState, type SignInMethod, type SignInSettings } from './methods.ts';
import { accounts, guard, isGuardError, q } from './store.server.ts';
import type { Query } from '../store/index.ts';
import { AuthError } from './errors.ts';

type Env = Record<string, string | undefined>;
export const SETTING_KEY = 'auth_methods';

let warned = false;
/** The break-glass list, if KINDRED_AUTH_METHODS holds one. A value Kindred cannot read is ignored and said once in the log. */
export function breakGlass(env: Env = process.env): SignInMethod[] | null {
  const raw = env.KINDRED_AUTH_METHODS?.trim();
  if (!raw) return null;
  const list = parseMethods(raw);
  if (!list && !warned) {
    warned = true;
    console.error(`[kindred] KINDRED_AUTH_METHODS="${raw}" is not a list of sign-in methods (passkey, password, oidc, email-code); it is ignored.`);
  }
  return list;
}

/** The list KINDRED_AUTH carries, when it names methods rather than a mode. */
export function importedMethods(env: Env = process.env): SignInMethod[] | null {
  const raw = env.KINDRED_AUTH?.trim().toLowerCase();
  if (!raw || raw === 'kindred' || raw === 'cloudflare-access') return null;
  return parseMethods(raw);
}

/** The enabled list, and where it comes from, given the stored setting's text (or undefined). */
export function resolveMethods(stored: string | undefined | null, env: Env = process.env): { methods: SignInMethod[]; source: SignInSettings['source'] } {
  const glass = breakGlass(env);
  if (glass) return { methods: glass, source: 'break-glass' };
  const saved = parseMethods(stored);
  if (saved) return { methods: saved, source: 'console' };
  const imported = importedMethods(env);
  if (imported) return { methods: imported, source: 'KINDRED_AUTH' };
  return { methods: [...DEFAULT_METHODS], source: 'default' };
}

/** The setting's statement, for a read batch (the session read carries it, so every request knows the list in one trip). */
export const methodsQuery = () => q('SELECT value FROM instance_setting WHERE key = ?', SETTING_KEY);

export async function storedMethods(): Promise<string | undefined> {
  return (await accounts().get<{ value: string }>('SELECT value FROM instance_setting WHERE key = ?', SETTING_KEY))?.value;
}

/** The ways in this server offers now. Empty under Cloudflare Access or a refused sign-in setting. */
export async function enabledMethods(env: Env = process.env): Promise<SignInMethod[]> {
  if (authSetting(env).method !== 'kindred') return [];
  return resolveMethods(await storedMethods(), env).methods;
}

export async function methodEnabled(m: SignInMethod): Promise<boolean> {
  return (await enabledMethods()).includes(m);
}

/** Refuses unless `m` is on: every ceremony and form of a method starts with this. */
export async function requireMethod(m: SignInMethod): Promise<void> {
  if (!(await methodEnabled(m))) throw new AuthError('invalid', m === 'passkey' ? 'auth.passkeys_off' : m === 'oidc' ? 'oidc.err.off' : m === 'email-code' ? 'email.err.code_off' : 'pw.err.method_off');
}

/**
 * Whether this server could offer a method at all. Passkeys and passwords need nothing more than Kindred's own sign-in.
 * Single sign-on needs a provider the operator added and left on (`auth_provider`, oidc.server.ts); a code by email needs the
 * server to send email (src/lib/email/send.server.ts, emailOn: a provider and a trusted origin for links).
 */
async function available(m: SignInMethod): Promise<boolean> {
  if (m === 'oidc') return !!(await accounts().get('SELECT 1 FROM auth_provider WHERE enabled = 1 LIMIT 1'));
  if (m === 'email-code') return (await import('../email/send.server.ts')).emailOn();
  return true;
}

/** Statements that list, per account, which ways in it has. Used for the counts and for the operator rule. */
const HAS = {
  passkey: 'EXISTS (SELECT 1 FROM credential c WHERE c.user = u.id)',
  password: 'EXISTS (SELECT 1 FROM password p WHERE p.user = u.id)',
  // An identity at a provider that is on (oidc.server.ts): turning the provider off takes this way in away.
  oidc: 'EXISTS (SELECT 1 FROM oidc_identity o JOIN auth_provider ap ON ap.id = o.provider WHERE o.user = u.id AND ap.enabled = 1)',
  // A confirmed address (accounts migration 0050): a code is sent to nothing else (email-code.server.ts).
  'email-code': '(u.email_verified = 1 AND u.email IS NOT NULL)',
} as const satisfies Record<SignInMethod, string>;

/** An SQL condition: the account `u` has a way in among `methods`. */
export const hasWayIn = (methods: readonly SignInMethod[]) => (methods.length ? `(${methods.map((m) => HAS[m]).join(' OR ')})` : '0');

/**
 * An SQL condition: the account `u` has a way in among `methods` that it keeps, leaving out a code by email. The rules that an
 * operator, and an account giving up a way in, must keep one use this.
 */
export const lastingWayIn = (methods: readonly SignInMethod[]) => hasWayIn(methods.filter((m) => m !== 'email-code'));

/** The console's view: each method's state, how many accounts can use it, and how many have nothing else. */
export async function signInSettings(env: Env = process.env): Promise<SignInSettings> {
  const setting = authSetting(env);
  const mode = setting.method === 'cloudflare-access' ? 'cloudflare-access' : 'kindred';
  const { methods: enabled, source } = resolveMethods(await storedMethods(), env);
  const counts = await accounts().get<Record<string, number>>(
    // "The only way in" leaves out a code by email while it is off: a confirmed address is then no way in at all.
    `SELECT ${SIGN_IN_METHODS.map((m) => `sum(${HAS[m]}) AS "${m}", sum(${HAS[m]} AND NOT ${hasWayIn(SIGN_IN_METHODS.filter((o) => o !== m && (o !== 'email-code' || enabled.includes(o))))}) AS "${m}_only"`).join(', ')} FROM user u`,
  );
  const cards: MethodCard[] = [];
  for (const m of SIGN_IN_METHODS) {
    const can = mode === 'kindred' && (await available(m));
    const state: MethodState = !can ? 'unavailable' : enabled.includes(m) ? 'enabled' : 'configured';
    cards.push({ id: m, state, accounts: counts?.[m] ?? 0, onlyWay: counts?.[`${m}_only`] ?? 0 });
  }
  return { mode, source, methods: cards };
}

export interface MethodChange { methods: SignInMethod[]; removed: SignInMethod[]; added: SignInMethod[]; lockedOut: number }

/** What saving `next` would do: which methods go, which come, and how many accounts would then have no way in. */
export async function previewMethods(next: SignInMethod[]): Promise<MethodChange> {
  const { methods: now } = resolveMethods(await storedMethods());
  const removed = now.filter((m) => !next.includes(m));
  const added = next.filter((m) => !now.includes(m));
  const row = await accounts().get<{ n: number }>(`SELECT count(*) AS n FROM user u WHERE ${hasWayIn(now)} AND NOT ${hasWayIn(next)}`);
  return { methods: next, removed, added, lockedOut: row?.n ?? 0 };
}

/**
 * Saves the console's list. Refused when it is empty, while KINDRED_AUTH_METHODS overrides it, when a method is not available,
 * and when an operator would be left with no way in (a guard in the same batch, so it holds against a race). Ends every
 * session a removed method started. Returns the change. `audit` is the operator's log statement for the batch.
 */
export async function saveMethods(next: SignInMethod[], by: string, audit: (change: MethodChange) => Query, env: Env = process.env): Promise<MethodChange> {
  if (authSetting(env).method !== 'kindred') throw new AuthError('invalid', 'pw.err.access_mode');
  if (breakGlass(env)) throw new AuthError('invalid', 'pw.err.break_glass');
  const list = SIGN_IN_METHODS.filter((m) => next.includes(m));
  if (!list.length) throw new AuthError('invalid', 'pw.err.no_method');
  for (const m of list) if (!(await available(m))) throw new AuthError('invalid', 'pw.err.unavailable');
  const change = await previewMethods(list);
  const t = Date.now();
  try {
    await accounts().batch([
      q(`INSERT INTO instance_setting (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`, SETTING_KEY, JSON.stringify(list), t, by),
      // Every operator keeps a way in (a code by email does not count: it is never an operator's proof).
      guard(`NOT EXISTS (SELECT 1 FROM user u WHERE u.operator = 1 AND NOT ${lastingWayIn(list)})`),
      ...change.removed.map((m) => q('DELETE FROM session WHERE COALESCE(method, ?) = ?', 'passkey', m)),
      audit(change),
    ]);
  } catch (e) {
    if (isGuardError(e)) throw new AuthError('invalid', 'pw.err.operator_locked_out');
    throw e;
  }
  return change;
}
