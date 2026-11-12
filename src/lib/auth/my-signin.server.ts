// The reader's own ways in, from the account menu: a password (set, change, remove), two-step codes, recovery codes, and
// how they sit beside the passkeys (./passkeys.server.ts). Every change needs a fresh proof on this session (./proof.server.ts),
// so a borrowed, unlocked browser cannot add a way in of its own or take one away; none is possible in a demo or a preview.
// A way in is added only from a signed-in session like this, never by matching an email.
//
// An account always keeps a way in the server accepts: a password goes only while a passkey (with passkeys on) remains, and
// the last passkey only while a password (with passwords on) remains (store.server.ts, removeCredential). An operator's
// password goes with two-step codes: set only once they are on, and they stay on while it does (proof.server.ts).
import { AuthError } from './errors.ts';
import { authMethod } from './method.server.ts';
import { enabledMethods, hasWayIn } from './methods.server.ts';
import type { SignInMethod } from './methods.ts';
import { checkNewPassword, cleanUsername, passwordAllowed, passwordOf, passwordWrites, requireFreeUsername, rethrowTaken } from './password.server.ts';
import { requireFreshProof } from './proof.server.ts';
import { sessionOf } from './session.server.ts';
import { accounts, credentialsOf, guard, isGuardError, q, type UserRow } from './store.server.ts';
import { beginTotp, newRecoveryCodes, otpauthUri, recoveryLeft, recoveryNeedsRenewal, removeTotp, totpOf, totpOn, consumeTotp } from './totp.server.ts';
import { refuseReadOnly } from '../read-only.ts';
import { instanceSettings } from '../operator/settings.server.ts';

const invalid = (key: string) => new AuthError('invalid', key);

export interface MySignIn {
  /** The ways in this server offers. */
  methods: SignInMethod[];
  /** How this session was started. */
  current: SignInMethod | null;
  username: string | null;
  password: { setAt: number } | null;
  totp: boolean;
  recoveryLeft: number;
  passkeys: number;
  /** Single sign-on providers the account uses that are on (0 while single sign-on is off). */
  oidc: number;
  /** An operator: a password needs two-step codes first. */
  operator: boolean;
  /** Unused recovery codes stored the old way: the account is asked to make new ones. */
  recoveryRenew: boolean;
}

export async function mySignIn(request: Request, user: UserRow): Promise<MySignIn> {
  const [methods, pw, totp, left, keys, session, oidc, renew] = await Promise.all([
    enabledMethods(), passwordOf(user.id), totpOf(user.id), recoveryLeft(user.id), credentialsOf(user.id), sessionOf(request),
    accounts().get<{ n: number }>('SELECT count(*) AS n FROM oidc_identity o JOIN auth_provider p ON p.id = o.provider WHERE o.user = ? AND p.enabled = 1', user.id),
    recoveryNeedsRenewal(user.id),
  ]);
  return {
    methods, current: session ? ((session.method as SignInMethod | null) ?? 'passkey') : null, username: user.username ?? null,
    password: pw ? { setAt: pw.set_at } : null, totp: !!totp?.confirmed_at, recoveryLeft: left, passkeys: keys.length,
    oidc: methods.includes('oidc') ? oidc?.n ?? 0 : 0, operator: user.operator === 1, recoveryRenew: renew,
  };
}

/** A change to the reader's ways in: passwords on, a fresh proof, and nothing read-only about the request. */
async function changing(request: Request, user: UserRow, o: { forTotp?: boolean } = {}): Promise<void> {
  await passwordAllowed(request);
  await requireFreshProof(request, user, o);
}

/**
 * Sets the reader's password: their first one (which also chooses their username, and links this way in to the account), or a
 * new one. Every other session a password started ends; this one stays.
 */
export async function setMyPassword(request: Request, user: UserRow, input: { username?: unknown; password?: unknown }): Promise<{ username: string }> {
  await changing(request, user);
  // An operator's password is never enough alone: two-step codes come first.
  if (user.operator === 1 && !(await totpOn(user.id))) throw invalid('pw.err.operator_password_totp');
  const username = user.username ?? cleanUsername(input.username);
  const password = checkNewPassword(input.password, username);
  if (!user.username) await requireFreeUsername(username);
  const keep = (await sessionOf(request))?.hash ?? '';
  try {
    await accounts().batch([...(await passwordWrites(user.id, username, password)), q("DELETE FROM session WHERE user = ? AND hash <> ? AND method = 'password'", user.id, keep)]);
  } catch (e) {
    rethrowTaken(e);
  }
  await notice(user.id, user.username ? 'password_changed' : 'password_added', request);
  return { username };
}

/**
 * Removes the reader's password, its username, two-step codes and recovery codes, and every session a password started (this
 * one too, when it was). Refused unless another way in the server accepts remains (a passkey, a single sign-on provider).
 */
export async function removeMyPassword(request: Request, user: UserRow): Promise<void> {
  if (authMethod() !== 'kindred') throw invalid('pw.err.method_off');
  refuseReadOnly();
  await requireFreshProof(request, user);
  const methods = await enabledMethods();
  try {
    await accounts().batch([
      q('DELETE FROM password WHERE user = ?', user.id),
      q('UPDATE user SET username = NULL WHERE id = ?', user.id),
      removeTotp(user.id),
      q('DELETE FROM recovery_code WHERE user = ?', user.id),
      // Another way in the server accepts remains: a passkey, or a single sign-on provider (accounts migration 0046).
      guard(`EXISTS (SELECT 1 FROM user u WHERE u.id = ? AND ${hasWayIn(methods)})`, user.id),
      q("DELETE FROM session WHERE user = ? AND method = 'password'", user.id),
    ]);
  } catch (e) {
    if (isGuardError(e)) throw invalid('pw.err.last_way_in');
    throw e;
  }
}

/** Starts two-step codes: a new secret to type into an authenticator app, and its link. Needs a password (an operator's come first). */
export async function startMyTotp(request: Request, user: UserRow): Promise<{ secret: string; uri: string }> {
  await changing(request, user, { forTotp: true });
  if (user.operator !== 1 && (!(await passwordOf(user.id)) || !user.username)) throw invalid('pw.err.no_password');
  const secret = await beginTotp(user.id);
  if (!secret) throw invalid('pw.err.totp_on');
  const issuer = (await instanceSettings()).instanceName.trim() || 'Kindred';
  return { secret, uri: otpauthUri(issuer, user.username ?? user.name, secret) };
}

/** Confirms two-step codes with the first code the app shows. Returns the ten recovery codes, shown once. */
export async function confirmMyTotp(request: Request, user: UserRow, code: unknown): Promise<{ codes: string[] }> {
  await changing(request, user, { forTotp: true });
  if (typeof code !== 'string' || !(await consumeTotp(user.id, code, { pending: true }))) throw invalid('pw.err.code');
  const { codes, writes } = await newRecoveryCodes(user.id);
  await accounts().batch(writes);
  return { codes };
}

/** Turns two-step codes off. An operator keeps them while the account has a password. */
export async function stopMyTotp(request: Request, user: UserRow): Promise<void> {
  await changing(request, user);
  if (user.operator === 1 && (await passwordOf(user.id))) throw invalid('pw.err.operator_totp');
  await accounts().batch([removeTotp(user.id)]);
  await notice(user.id, 'totp_off', request);
}

/** The security email after a change to the ways in (src/lib/email/notify.server.ts): sent later, never in the way. */
const notice = async (user: string, kind: 'password_changed' | 'password_added' | 'totp_off', request: Request) =>
  (await import('../email/notify.server.ts')).securityNotice(user, kind, request);

/** Ten new recovery codes, replacing the ones left. */
export async function renewMyRecoveryCodes(request: Request, user: UserRow): Promise<{ codes: string[] }> {
  await changing(request, user);
  if (!(await passwordOf(user.id))) throw invalid('pw.err.no_password');
  const { codes, writes } = await newRecoveryCodes(user.id);
  await accounts().batch(writes);
  return { codes };
}
