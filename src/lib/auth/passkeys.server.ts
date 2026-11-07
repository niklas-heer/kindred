// Passkeys (WebAuthn, through @simplewebauthn/server): creating one at setup, from an invitation, or
// as another device of a signed-in reader; and signing in with any passkey the device has for this
// site, with no name to type. Passkeys belong to the site's host name (the RP ID): moving the app to
// another domain means creating them again.
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { AuthError } from './errors';
import { siteOrigin } from './session.server';
import { checkSetupCode } from './setup.server';
import {
  addCredential, addMembership, credentialById, credentialsOf, credentialUsed, createUser, inviteById, openInvite, saveChallenge, takeChallenge, tx,
  useInvite, userByEmail, userById, userCount, type UserRow,
} from './store.server';

const RP_NAME = 'Kindred';

/** The relying party: passkeys are bound to the site's host name. Localhost works; a bare IP does not. */
export function relyingParty(request: Request) {
  const origin = siteOrigin(request);
  return { rpID: origin.hostname, origin: origin.origin };
}

const invalid = (message: string) => new AuthError('invalid', message);

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
    // A passkey the device remembers (so signing in needs no name), unlocked by face, fingerprint or PIN.
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    excludeCredentials: user.existing.map((c) => ({ id: c.id, transports: JSON.parse(c.transports) })),
  });
}

// A user handle chosen before the account exists, carried in the challenge row's `subject`.
const newHandle = () => isoBase64URL.fromBuffer(crypto.getRandomValues(new Uint8Array(32)));

// ---------- creating a passkey ----------

/** Options for the first steward's passkey; needs the setup code. */
export async function setupOptions(request: Request, code: string, rawName: unknown) {
  if (!checkSetupCode(code)) throw invalid(userCount() ? 'Kindred is already set up. Sign in instead.' : 'That setup code isn’t right. Check the server’s console and try again.');
  const name = cleanName(rawName);
  const handle = newHandle();
  const options = await creationOptions(request, { name, handle, existing: [] });
  return { options, challengeId: saveChallenge({ challenge: options.challenge, purpose: 'setup', subject: handle, name }) };
}

/** Options for a passkey from an invitation link. */
export async function inviteOptions(request: Request, token: string, rawName: unknown) {
  const invite = openInvite(token);
  if (!invite) throw invalid('This invitation has expired, was already used, or was withdrawn. Ask for a new one.');
  const name = cleanName(rawName);
  const handle = newHandle();
  const options = await creationOptions(request, { name, handle, existing: [] });
  return { options, challengeId: saveChallenge({ challenge: options.challenge, purpose: 'invite', subject: `${invite.id} ${handle}`, name }) };
}

/** Options for another passkey of a signed-in reader (a new phone, a second laptop). */
export async function addOptions(request: Request, user: UserRow) {
  const options = await creationOptions(request, { name: user.name, handle: user.handle, existing: credentialsOf(user.id) });
  return { options, challengeId: saveChallenge({ challenge: options.challenge, purpose: 'add', subject: user.id }) };
}

async function verifyNew(request: Request, challenge: string, response: RegistrationResponseJSON) {
  const { rpID, origin } = relyingParty(request);
  let result;
  try {
    result = await verifyRegistrationResponse({ response, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true });
  } catch {
    throw invalid('Your device’s passkey couldn’t be checked. Please try again.');
  }
  if (!result.verified) throw invalid('Your device’s passkey couldn’t be checked. Please try again.');
  const { credential, credentialBackedUp } = result.registrationInfo;
  if (credentialById(credential.id)) throw invalid('This passkey is already saved.');
  return { id: credential.id, publicKey: credential.publicKey, counter: credential.counter, transports: credential.transports ?? [], synced: credentialBackedUp };
}

const take = (id: unknown, purpose: string) => {
  const c = typeof id === 'string' && id.length < 100 ? takeChallenge(id) : undefined;
  if (!c || c.purpose !== purpose) throw invalid('That took too long. Please try again.');
  return c;
};

/** Finishes setup: the first account, a steward of every family on this server. Returns its id. */
export async function finishSetup(request: Request, code: string, challengeId: unknown, response: RegistrationResponseJSON, trees: string[]): Promise<string> {
  const c = take(challengeId, 'setup');
  if (!checkSetupCode(code)) throw invalid('Kindred is already set up. Sign in instead.');
  const cred = await verifyNew(request, c.challenge, response);
  return tx((d) => {
    // Inside the write lock: only one first steward, however many tabs race.
    if ((d.prepare('SELECT count(*) AS n FROM user').get() as { n: number }).n > 0) throw invalid('Kindred is already set up. Sign in instead.');
    const user = createUser(d, c.name!, null, c.subject!);
    addCredential(d, { ...cred, user: user.id, device: deviceName(request) });
    for (const t of trees) addMembership(d, user.id, t, 'steward');
    return user.id;
  });
}

/** Finishes an invitation: a new account with the invited role. Returns its id. */
export async function finishInvite(request: Request, token: string, challengeId: unknown, response: RegistrationResponseJSON): Promise<string> {
  const c = take(challengeId, 'invite');
  const [inviteId, handle] = (c.subject ?? '').split(' ');
  const invite = openInvite(token);
  if (!invite || invite.id !== inviteId) throw invalid('This invitation has expired, was already used, or was withdrawn. Ask for a new one.');
  const cred = await verifyNew(request, c.challenge, response);
  return tx((d) => {
    const fresh = inviteById(invite.id);
    if (!fresh) throw invalid('This invitation was withdrawn.');
    // The invited email becomes the account's (it lets Cloudflare Access recognise them too), unless taken.
    const email = fresh.email && !userByEmail(fresh.email) ? fresh.email : null;
    const user = createUser(d, c.name!, email, handle);
    addCredential(d, { ...cred, user: user.id, device: deviceName(request) });
    useInvite(d, fresh, user.id);
    return user.id;
  });
}

/** Saves another passkey for a signed-in reader. */
export async function finishAdd(request: Request, user: UserRow, challengeId: unknown, response: RegistrationResponseJSON) {
  const c = take(challengeId, 'add');
  if (c.subject !== user.id) throw invalid('That took too long. Please try again.');
  const cred = await verifyNew(request, c.challenge, response);
  tx((d) => addCredential(d, { ...cred, user: user.id, device: deviceName(request) }));
}

// ---------- signing in ----------

export async function signInOptions(request: Request) {
  const { rpID } = relyingParty(request);
  // No allowCredentials: the device offers whichever of its passkeys for this site the reader picks.
  const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
  return { options, challengeId: saveChallenge({ challenge: options.challenge, purpose: 'login' }) };
}

/** Verifies a sign-in; returns the account's id. */
export async function finishSignIn(request: Request, challengeId: unknown, response: AuthenticationResponseJSON): Promise<string> {
  const c = take(challengeId, 'login');
  const unknown = invalid('This passkey isn’t one we know. If you were invited, open your invitation link first.');
  const row = typeof response?.id === 'string' ? credentialById(response.id) : undefined;
  if (!row) throw unknown;
  const user = userById(row.user);
  if (!user) throw unknown;
  // The passkey names its account too; both must agree.
  const handle = response.response?.userHandle;
  if (handle && handle !== user.handle) throw unknown;
  const { rpID, origin } = relyingParty(request);
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response, expectedChallenge: c.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
      credential: { id: row.id, publicKey: new Uint8Array(row.public_key), counter: row.counter, transports: JSON.parse(row.transports) },
    });
  } catch {
    throw invalid('Your passkey couldn’t be checked. Please try again.');
  }
  if (!result.verified) throw invalid('Your passkey couldn’t be checked. Please try again.');
  credentialUsed(row.id, result.authenticationInfo.newCounter);
  return user.id;
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
