// A fresh proof that the person at this browser is the account's owner: a passkey assertion with user verification (face,
// fingerprint or PIN), made on this very session within the last few minutes. Adding another passkey and "sign out
// everywhere else" need one, so an unlocked browser someone borrowed cannot add a passkey of its own or sign its owner's
// other devices out. The proof is kept on the session row (`session.proved`, accounts migration 0025): another browser's
// proof does not count here, and signing out ends it. A sign-in that verified the reader counts as a proof.
//
// An account with no passkey the server accepts proves itself with its password instead, and its two-step code when that is
// on (accounts migration 0040, `session.proved_via`), or by signing in again at a single sign-on provider it uses (accounts
// migration 0046; oidc.server.ts asks the provider with `max_age=0` and checks `auth_time`): so deleting a family and the other
// steps that ask for a proof work for every account. `proofKinds` tells the browser which to ask for.
//
// A sign-in with a code sent by email counts as a proof for a few minutes, except for an operator (email-code.server.ts).
//
// An operator's password alone proves nothing: for an operator, a proof by password counts only with two-step codes on (the
// code was then part of it), so someone who learned an operator's password cannot add a passkey of their own or change the
// console. The one exception is setting up those codes when the password is the account's only way in (`forTotp`).
import { generateAuthenticationOptions, verifyAuthenticationResponse, type AuthenticationResponseJSON } from '@simplewebauthn/server';
import { AuthError, needsProof } from './errors.ts';
import { authMethod } from './method.server.ts';
import { enabledMethods, lastingWayIn, requireMethod } from './methods.server.ts';
import { checkOwnPassword, passwordOf, type Attempt } from './password.server.ts';
import type { PublicProvider } from './oidc.ts';
import { totpOn } from './totp.server.ts';
import { sessionOf, siteOrigin } from './session.server.ts';
import { accounts, credentialById, credentialsOf, credentialUsed, now, saveChallenge, sessionProved, takeChallenge, type UserRow } from './store.server.ts';

/** How long a proof lasts. */
export const PROOF_MS = 5 * 60_000;

const invalid = (message: string) => new AuthError('invalid', message);

/** Proofs exist only under Kindred's own sign-in. */
function needPasskeys() {
  if (authMethod() !== 'kindred') throw invalid('auth.passkeys_off');
}

/** The request's own session, which must be `user`'s: a proof belongs to one session. */
async function ownSession(request: Request, user: UserRow) {
  const s = await sessionOf(request);
  if (!s || s.user !== user.id) throw needsProof();
  return s;
}

/** Whether the account has a way in besides its password that the server accepts (a passkey, a single sign-on provider). */
export async function otherWayIn(user: string): Promise<boolean> {
  const others = (await enabledMethods()).filter((m) => m !== 'password');
  return !!(await accounts().get(`SELECT 1 FROM user u WHERE u.id = ? AND ${lastingWayIn(others)}`, user));
}

/** An operator without two-step codes, whose only proof would be the password. */
const operatorNeedsTotp = () => new AuthError('forbidden', 'pw.err.operator_needs_totp');

/**
 * Refuses unless this session proved itself (a passkey, the password, a provider) within `PROOF_MS`. The browser then asks
 * and tries again. An operator's proof by password counts only with two-step codes on; `forTotp`: setting them up, which an
 * operator whose only way in is the password may do with it.
 */
export async function requireFreshProof(request: Request, user: UserRow, { forTotp = false }: { forTotp?: boolean } = {}): Promise<void> {
  needPasskeys();
  const s = await ownSession(request, user);
  if (s.proved === null || now() - s.proved > PROOF_MS) throw needsProof();
  // A sign-in with a code sent by email is a proof for a few minutes (adding a passkey after losing every device), never an
  // operator's: a mailbox alone must not change the console (email-code.server.ts).
  if (user.operator === 1 && s.proved_via === 'email-code') throw needsProof();
  if (user.operator === 1 && s.proved_via === 'password' && !(await totpOn(user.id))) {
    const other = await otherWayIn(user.id);
    if (forTotp && !other) return;
    // With a passkey or a provider, the browser asks for that instead; with the password alone, codes come first.
    throw other ? needsProof() : operatorNeedsTotp();
  }
}

/**
 * Which proofs this account can give here: a passkey (one saved, and passkeys on), its password (and whether a code goes with
 * it), and the single sign-on providers it uses (signing in there again: oidc.server.ts, purpose `proof`).
 */
export async function proofKinds(user: UserRow): Promise<{ passkey: boolean; password: boolean; totp: boolean; oidc: PublicProvider[] }> {
  needPasskeys();
  const [methods, keys, pw, totp, oidc] = await Promise.all([
    enabledMethods(), credentialsOf(user.id), passwordOf(user.id), totpOn(user.id), import('./oidc.server.ts').then((m) => m.proofProviders(user)),
  ]);
  // An operator's password is a proof only with its code (or when it is all the account has: setting up the codes).
  const passwordCounts = user.operator !== 1 || totp || !(await otherWayIn(user.id));
  return { passkey: methods.includes('passkey') && keys.length > 0, password: methods.includes('password') && !!pw && passwordCounts, totp, oidc };
}

/** The proof by password: the password typed again on this session (and the two-step code, when on). */
export async function finishPasswordProof(request: Request, user: UserRow, input: { password?: unknown; code?: unknown; recovery?: unknown }, a: Attempt): Promise<void> {
  needPasskeys();
  const s = await ownSession(request, user);
  await checkOwnPassword(request, user, input, a);
  await sessionProved(s.hash, user.id, 'password');
}

/** Options for the confirmation: one of the reader's own passkeys, with the reader verified. */
export async function proofOptions(request: Request, user: UserRow) {
  needPasskeys();
  await requireMethod('passkey');
  const s = await ownSession(request, user);
  const options = await generateAuthenticationOptions({
    rpID: siteOrigin(request).hostname,
    allowCredentials: (await credentialsOf(user.id)).map((c) => ({ id: c.id, transports: JSON.parse(c.transports) })),
    userVerification: 'required',
  });
  return { options, challengeId: await saveChallenge({ challenge: options.challenge, purpose: 'confirm', subject: `${user.id} ${s.hash}` }) };
}

/** Checks the confirmation and records it on this session. */
export async function finishProof(request: Request, user: UserRow, challengeId: unknown, response: AuthenticationResponseJSON): Promise<void> {
  needPasskeys();
  await requireMethod('passkey');
  const s = await ownSession(request, user);
  const c = typeof challengeId === 'string' && challengeId.length < 100 ? await takeChallenge(challengeId) : undefined;
  if (!c || c.purpose !== 'confirm' || c.subject !== `${user.id} ${s.hash}`) throw invalid('That took too long. Please try again.');
  const failed = invalid('Your passkey couldn’t be checked. Please try again.');
  const row = typeof response?.id === 'string' ? await credentialById(response.id) : undefined;
  if (!row || row.user !== user.id) throw failed;
  const origin = siteOrigin(request);
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response, expectedChallenge: c.challenge, expectedOrigin: origin.origin, expectedRPID: origin.hostname, requireUserVerification: true,
      credential: { id: row.id, publicKey: new Uint8Array(row.public_key), counter: row.counter, transports: JSON.parse(row.transports) },
    });
  } catch {
    throw failed;
  }
  if (!result.verified || !result.authenticationInfo.userVerified) throw failed;
  await credentialUsed(row.id, result.authenticationInfo.newCounter);
  await sessionProved(s.hash, user.id, 'passkey');
}
