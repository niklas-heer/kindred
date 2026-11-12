// Signing up with a username and password (routes/api/auth/$action.ts, `signup-password`), while the operator offers
// passwords: one step, as the form has no device ceremony. Everything a passkey sign-up checks is checked (the form, sign-up
// open, Turnstile, this network's count), then the password's own rules and a free username (a taken one costs the network a
// try, so usernames cannot be listed by signing up), then the account, its password, the family and its steward in the batch
// that holds the limits. A password never verifies an email, so with "unverified sign-ups go to the waiting list" it is
// refused here and the page sends a request instead.
import { checkNewPassword, cleanUsername, hashAccountPassword, passwordAllowed, passwordRows, requireFreeUsername, usernameTaken } from '../auth/password.server.ts';
import { cleanName } from '../auth/passkeys.server.ts';
import { guestChoice } from '../auth/session.server.ts';
import { accounts } from '../auth/store.server.ts';
import { guard } from '../store/index.ts';
import { asForm } from './passkey.server.ts';
import { cleanForm, closedError, completeSignup, precheck } from './signup.server.ts';

export async function signupWithPassword(request: Request, body: Record<string, unknown>, ip: string): Promise<{ user: string; tree: string }> {
  await passwordAllowed(request);
  const form = cleanForm(asForm(body), true);
  const name = cleanName(form.name);
  const username = cleanUsername(body.username);
  const password = checkNewPassword(body.password, username);
  const checked = await precheck(form, { ip, honeypot: typeof body.website === 'string' ? body.website : undefined, turnstile: typeof body.turnstile === 'string' ? body.turnstile : undefined });
  // A bot that filled the hidden field, and an unverified sign-up while those wait: no account.
  if (!checked || checked.state.waitlist) throw closedError('closed');
  await requireFreeUsername(username, ip);
  const hash = await hashAccountPassword(password);
  return completeSignup({
    kind: 'new', name, locale: guestChoice(request),
    writes: (user) => [guard('NOT EXISTS (SELECT 1 FROM user WHERE username = ?)', username), ...passwordRows(user, username, hash)],
    conflict: async () => ((await accounts().get('SELECT 1 FROM user WHERE username = ?', username)) ? usernameTaken() : undefined),
  }, form, checked.network);
}
