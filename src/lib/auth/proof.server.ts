// A fresh proof that the person at this browser is the account's owner: a passkey assertion with user verification (face,
// fingerprint or PIN), made on this very session within the last few minutes. Adding another passkey and "sign out
// everywhere else" need one, so an unlocked browser someone borrowed cannot add a passkey of its own or sign its owner's
// other devices out. The proof is kept on the session row (`session.proved`, accounts migration 0025): another browser's
// proof does not count here, and signing out ends it. A sign-in that verified the reader counts as a proof.
import { generateAuthenticationOptions, verifyAuthenticationResponse, type AuthenticationResponseJSON } from '@simplewebauthn/server';
import { AuthError, needsProof } from './errors.ts';
import { authMethod } from './method.server.ts';
import { sessionOf, siteOrigin } from './session.server.ts';
import { credentialById, credentialsOf, credentialUsed, now, saveChallenge, sessionProved, takeChallenge, type UserRow } from './store.server.ts';

/** How long a proof lasts. */
export const PROOF_MS = 5 * 60_000;

const invalid = (message: string) => new AuthError('invalid', message);

function needPasskeys() {
  if (authMethod() !== 'kindred') throw invalid('auth.passkeys_off');
}

/** The request's own session, which must be `user`'s: a proof belongs to one session. */
async function ownSession(request: Request, user: UserRow) {
  const s = await sessionOf(request);
  if (!s || s.user !== user.id) throw needsProof();
  return s;
}

/** Refuses unless this session proved a passkey within `PROOF_MS`. The browser then asks for one and tries again. */
export async function requireFreshProof(request: Request, user: UserRow): Promise<void> {
  needPasskeys();
  const s = await ownSession(request, user);
  if (s.proved === null || now() - s.proved > PROOF_MS) throw needsProof();
}

/** Options for the confirmation: one of the reader's own passkeys, with the reader verified. */
export async function proofOptions(request: Request, user: UserRow) {
  needPasskeys();
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
  await sessionProved(s.hash, user.id);
}
