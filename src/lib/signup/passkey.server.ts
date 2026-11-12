// Signing up with a passkey (routes/api/auth/$action.ts, `signup-options` and `signup`): the passkey ceremony around
// signup.server.ts. Everything the server can check is checked before the device makes a passkey (the form, sign-up open,
// Turnstile, this network's count), so nobody makes one in vain; the finish checks the passkey, then makes the account and
// the family in one step whose last batch holds the limits again.
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { AuthError } from '../auth/errors.ts';
import { cleanName, creationOptions, deviceName, needPasskeys, newHandle, take, verifyNew } from '../auth/passkeys.server.ts';
import { guestChoice } from '../auth/session.server.ts';
import { saveChallenge } from '../auth/store.server.ts';
import { translate } from '../i18n/dictionary.ts';
import { cleanForm, closedError, completeSignup, networkKey, precheck, type SignupForm } from './signup.server.ts';

/** The form as the browser sends it, with its guards. */
export type SignupBody = SignupForm & { turnstile?: string; website?: string };

const asForm = (b: Record<string, unknown>): SignupForm => ({
  name: typeof b.name === 'string' ? b.name.slice(0, 400) : '',
  familyName: typeof b.familyName === 'string' ? b.familyName.slice(0, 400) : '',
  familyId: typeof b.familyId === 'string' ? b.familyId.slice(0, 80) : '',
  email: typeof b.email === 'string' ? b.email.slice(0, 400) : '',
  theme: b.theme === 'modern' ? 'modern' : 'codex',
  accept: b.accept === true,
  age16: b.age16 === true,
  ...(typeof b.code === 'string' && b.code.trim() ? { code: b.code.slice(0, 64) } : {}),
});

/**
 * Options for a new account's passkey, once everything else about the sign-up is right. `signedIn`: someone signed in starts
 * a family with their own account (signup.functions.ts), never with a second one made here.
 */
export async function signupOptions(request: Request, body: Record<string, unknown>, ip: string, signedIn: boolean) {
  await needPasskeys();
  if (signedIn) throw new AuthError('invalid', translate('en', 'signup.err.signed_in'));
  const form = cleanForm(asForm(body), true);
  const checked = await precheck(form, { ip, honeypot: typeof body.website === 'string' ? body.website : undefined, turnstile: typeof body.turnstile === 'string' ? body.turnstile : undefined });
  // A bot that filled the hidden field gets no passkey ceremony.
  if (!checked) throw closedError('closed');
  // Unverified sign-ups wait on the list (the operator's choice): the page sends a request instead of making a passkey.
  if (checked.state.waitlist) throw closedError('closed');
  const name = cleanName(form.name);
  const handle = newHandle();
  const options = await creationOptions(request, { name, handle, existing: [] });
  return { options, challengeId: await saveChallenge({ challenge: options.challenge, purpose: 'signup', subject: handle, name }) };
}

/** Finishes a sign-up: the passkey, then the account, the family and its steward. Returns the account, the family and the passkey. */
export async function finishSignup(request: Request, body: Record<string, unknown>, ip: string): Promise<{ user: string; tree: string; credential: string }> {
  const c = await take(body.challengeId, 'signup');
  const form = cleanForm(asForm(body), true);
  const cred = await verifyNew(request, c.challenge, body.response as RegistrationResponseJSON);
  const { tree, user } = await completeSignup(
    { kind: 'passkey', name: c.name!, handle: c.subject!, locale: guestChoice(request), credential: { ...cred, device: deviceName(request) } },
    form, await networkKey(ip),
  );
  return { user, tree, credential: cred.id };
}
