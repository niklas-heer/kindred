// Passkeys (WebAuthn, through @simplewebauthn/server): creating one at setup, from an invitation, or
// as another device of a signed-in reader; and signing in with any passkey the device has for this
// site, with no name to type. Passkeys belong to the site's host name (the RP ID): moving the app to
// another domain means creating them again.
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { AuthError } from './errors.ts';
import { authMethod } from './method.server.ts';
import { requireFreshProof } from './proof.server.ts';
import { guestChoice, siteOrigin } from './session.server.ts';
import { checkSetupCode } from './setup.server.ts';
import { checkCanMakeFamily, cleanFamilyName, makeFirstFamily } from './trees.server.ts';
import {
  accounts, commit, credentialById, credentialsOf, credentialUsed, insertCredential, inviteById, inviteUsed, newUser, noUsersYet, openInvite, saveChallenge, takeChallenge,
  upsertMembership, usable, useInvite, userByEmail, userById, userCount, type UserRow,
} from './store.server.ts';

const RP_NAME = 'Kindred';

/** The relying party: passkeys are bound to the site's host name. Localhost works; a bare IP does not. */
export function relyingParty(request: Request) {
  const origin = siteOrigin(request);
  return { rpID: origin.hostname, origin: origin.origin };
}

const invalid = (message: string) => new AuthError('invalid', message);

/** Passkeys exist only under the `kindred` method. Every ceremony starts with options or finishes with `take`, and both check this. */
function needPasskeys() {
  if (authMethod() !== 'kindred') throw invalid('auth.passkeys_off');
}

/** A display name: trimmed, 1–60 characters, no control characters. */
export function cleanName(name: unknown): string {
  const n = typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim() : '';
  if (!n) throw invalid('Please tell us your name.');
  if (n.length > 60) throw invalid('That name is a little long; 60 characters at most.');
  return n;
}

async function creationOptions(request: Request, user: { name: string; handle: string; existing: { id: string; transports: string }[] }) {
  const { rpID } = relyingParty(request);
  return generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: user.name,
    userDisplayName: user.name,
    userID: isoBase64URL.toBuffer(user.handle),
    attestationType: 'none',
    supportedAlgorithmIDs: [-7, -257],
    // A passkey the device remembers (so signing in needs no name), unlocked by face, fingerprint or PIN.
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    excludeCredentials: user.existing.map((c) => ({ id: c.id, transports: JSON.parse(c.transports) })),
  });
}

// A user handle chosen before the account exists, carried in the challenge row's `subject`.
const newHandle = () => isoBase64URL.fromBuffer(crypto.getRandomValues(new Uint8Array(32)));

// ---------- creating a passkey ----------

/**
 * Options for the first steward's passkey; checks the optional setup code. A server with no family yet must be
 * able to make one (on Workers its database must be bound), so a missing binding is refused here, before a passkey.
 */
export async function setupOptions(request: Request, code: string, rawName: unknown, rawFamily?: unknown) {
  needPasskeys();
  if (!(await checkSetupCode(code))) throw invalid((await userCount()) ? 'Kindred is already set up. Sign in instead.' : 'That setup code isn’t right. Check the server’s console and try again.');
  const name = cleanName(rawName);
  cleanFamilyName(rawFamily);
  await checkCanMakeFamily();
  const handle = newHandle();
  const options = await creationOptions(request, { name, handle, existing: [] });
  return { options, challengeId: await saveChallenge({ challenge: options.challenge, purpose: 'setup', subject: handle, name }) };
}

/** Options for a passkey from an invitation link. */
export async function inviteOptions(request: Request, token: string, rawName: unknown) {
  needPasskeys();
  const invite = await openInvite(token);
  if (!invite) throw invalid('This invitation has expired, was already used, or was withdrawn. Ask for a new one.');
  const name = cleanName(rawName);
  const handle = newHandle();
  const options = await creationOptions(request, { name, handle, existing: [] });
  return { options, challengeId: await saveChallenge({ challenge: options.challenge, purpose: 'invite', subject: `${invite.id} ${handle}`, name }) };
}

/** Options for another passkey of a signed-in reader (a new phone, a second laptop), once they have just confirmed it is them. */
export async function addOptions(request: Request, user: UserRow) {
  needPasskeys();
  await requireFreshProof(request, user);
  const options = await creationOptions(request, { name: user.name, handle: user.handle, existing: await credentialsOf(user.id) });
  return { options, challengeId: await saveChallenge({ challenge: options.challenge, purpose: 'add', subject: user.id }) };
}

async function verifyNew(request: Request, challenge: string, response: RegistrationResponseJSON) {
  const { rpID, origin } = relyingParty(request);
  let result;
  try {
    result = await verifyRegistrationResponse({ response, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false });
  } catch {
    throw invalid('Your device’s passkey couldn’t be checked. Please try again.');
  }
  if (!result.verified) throw invalid('Your device’s passkey couldn’t be checked. Please try again.');
  const { credential, credentialBackedUp } = result.registrationInfo;
  if (await credentialById(credential.id)) throw invalid('This passkey is already saved.');
  return { id: credential.id, publicKey: credential.publicKey, counter: credential.counter, transports: credential.transports ?? [], synced: credentialBackedUp };
}

const take = async (id: unknown, purpose: string) => {
  needPasskeys();
  const c = typeof id === 'string' && id.length < 100 ? await takeChallenge(id) : undefined;
  if (!c || c.purpose !== purpose) throw invalid('That took too long. Please try again.');
  return c;
};

/**
 * Finishes setup: the first account, a steward of every family on this server. A server with no family yet makes
 * its first one, named `familyName` (default "Our family"), and the steward is in it. Returns the account's id and
 * the family made for it, if one was.
 */
export async function finishSetup(
  request: Request, code: string, challengeId: unknown, response: RegistrationResponseJSON, trees: string[], familyName?: unknown,
): Promise<{ user: string; tree: string | null; credential: string }> {
  const c = await take(challengeId, 'setup');
  if (!(await checkSetupCode(code))) throw invalid('Kindred is already set up. Sign in instead.');
  const cred = await verifyNew(request, c.challenge, response);
  const done = invalid('Kindred is already set up. Sign in instead.');
  const name = cleanFamilyName(familyName);
  // Made before the account, and only once a passkey is verified; a family made for a setup that then loses the
  // race to another is simply the family the winner uses (its details are written only if it has none).
  const made = trees.length ? null : await makeFirstFamily(name);
  const granted = made ? [made] : trees;
  // Only one first steward, however many tabs race: the batch starts with a guard that no account
  // exists, and batches run one at a time, so a second setup writes nothing.
  const { user, insert } = newUser(c.name!, null, c.subject!, guestChoice(request));
  try {
    await accounts().batch([
      noUsersYet(),
      insert,
      insertCredential({ ...cred, user: user.id, device: deviceName(request) }),
      ...granted.map((t) => upsertMembership(user.id, t, 'steward')),
    ]);
  } catch (e) {
    if ((await userCount()) > 0) throw done;
    throw e;
  }
  return { user: user.id, tree: made, credential: cred.id };
}

/** Finishes an invitation: a new account with the invited role. Returns its id and the new passkey's. */
export async function finishInvite(request: Request, token: string, challengeId: unknown, response: RegistrationResponseJSON): Promise<{ user: string; credential: string }> {
  const c = await take(challengeId, 'invite');
  const [inviteId, handle] = (c.subject ?? '').split(' ');
  const invite = await openInvite(token);
  if (!invite || invite.id !== inviteId) throw invalid('This invitation has expired, was already used, or was withdrawn. Ask for a new one.');
  const cred = await verifyNew(request, c.challenge, response);
  // One batch: the account, its passkey and the invitation's use. If someone else used the invitation
  // or took the email first, the batch writes nothing and is decided again.
  return commit(async () => {
    const fresh = await inviteById(invite.id);
    if (!fresh) throw invalid('This invitation was withdrawn.');
    if (!usable(fresh)) throw inviteUsed();
    // The invited email becomes the account's, unless taken: it is what a later move to Cloudflare Access would recognise.
    const email = fresh.email && !(await userByEmail(fresh.email)) ? fresh.email : null;
    const { user, insert } = newUser(c.name!, email, handle, guestChoice(request));
    return {
      writes: [insert, insertCredential({ ...cred, user: user.id, device: deviceName(request) }), ...useInvite(fresh, user.id)],
      result: { user: user.id, credential: cred.id },
      refused: inviteUsed,
    };
  });
}

/** Saves another passkey for a signed-in reader. */
export async function finishAdd(request: Request, user: UserRow, challengeId: unknown, response: RegistrationResponseJSON) {
  const c = await take(challengeId, 'add');
  if (c.subject !== user.id) throw invalid('That took too long. Please try again.');
  await requireFreshProof(request, user);
  const cred = await verifyNew(request, c.challenge, response);
  await accounts().batch([insertCredential({ ...cred, user: user.id, device: deviceName(request) })]);
}

// ---------- signing in ----------

export async function signInOptions(request: Request) {
  needPasskeys();
  const { rpID } = relyingParty(request);
  // No allowCredentials: the device offers whichever of its passkeys for this site the reader picks.
  const options = await generateAuthenticationOptions({ rpID, allowCredentials: [], userVerification: 'preferred' });
  return { options, challengeId: await saveChallenge({ challenge: options.challenge, purpose: 'login' }) };
}

/** Verifies a sign-in; returns the account's id, the passkey that signed in, and whether the device verified the reader. */
export async function finishSignIn(request: Request, challengeId: unknown, response: AuthenticationResponseJSON): Promise<{ user: string; credential: string; verified: boolean }> {
  const c = await take(challengeId, 'login');
  const unknown = invalid('This passkey isn’t one we know. If you were invited, open your invitation link first.');
  const row = typeof response?.id === 'string' ? await credentialById(response.id) : undefined;
  if (!row) throw unknown;
  const user = await userById(row.user);
  if (!user) throw unknown;
  // The passkey names its account too; both must agree.
  const handle = response.response?.userHandle;
  if (handle && handle !== user.handle) throw unknown;
  const { rpID, origin } = relyingParty(request);
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response, expectedChallenge: c.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false,
      credential: { id: row.id, publicKey: new Uint8Array(row.public_key), counter: row.counter, transports: JSON.parse(row.transports) },
    });
  } catch {
    throw invalid('Your passkey couldn’t be checked. Please try again.');
  }
  if (!result.verified) throw invalid('Your passkey couldn’t be checked. Please try again.');
  await credentialUsed(row.id, result.authenticationInfo.newCounter);
  return { user: user.id, credential: row.id, verified: result.authenticationInfo.userVerified };
}

/** "iPhone", "Mac", "Android"…: a label for the list of someone's passkeys. */
export function deviceName(request: Request): string {
  const ua = request.headers.get('user-agent') ?? '';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android phone';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  if (/CrOS/.test(ua)) return 'Chromebook';
  if (/Linux/.test(ua)) return 'Linux computer';
  return 'Device';
}
