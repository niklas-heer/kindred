// New accounts with a username and password instead of a passkey: the first steward at setup, and someone taking an
// invitation. The same rules as their passkey forms in ./passkeys.server.ts (the setup code, one first steward however many
// tabs race, an invitation used once, the server's terms for a steward's invitation), with the password's own rules
// (./password.server.ts). An invitation's email is never proof of anything: it only becomes the account's address.
import { AuthError } from './errors.ts';
import { cleanName } from './passkeys.server.ts';
import { checkNewPassword, cleanUsername, hashAccountPassword, passwordAllowed, passwordRows, passwordWrites, requireFreeUsername, rethrowTaken } from './password.server.ts';
import { guestChoice } from './session.server.ts';
import { checkSetupCode } from './setup.server.ts';
import { checkCanMakeFamily, cleanFamilyName, makeFirstFamily } from './trees.server.ts';
import { inviteAcceptance } from '../operator/terms.server.ts';
import { store } from '../store/index.ts';
import {
  accounts, commit, inviteById, inviteUsed, newUser, noUsersYet, openInvite, upsertMembership, usable, useInvite, userByEmail, userCount,
} from './store.server.ts';

const invalid = (key: string) => new AuthError('invalid', key);

/** The first steward, with a password. A server with no family yet makes its first one, as passkey setup does. */
export async function setupWithPassword(
  request: Request, input: { code?: unknown; name?: unknown; familyName?: unknown; username?: unknown; password?: unknown }, trees: string[],
): Promise<{ user: string; tree: string | null }> {
  await passwordAllowed(request);
  const code = typeof input.code === 'string' ? input.code.slice(0, 200) : '';
  if (!(await checkSetupCode(code))) throw invalid((await userCount()) ? 'Kindred is already set up. Sign in instead.' : 'That setup code isn’t right. Check the server’s console and try again.');
  const name = cleanName(input.name);
  const familyName = cleanFamilyName(input.familyName);
  const username = cleanUsername(input.username);
  const password = checkNewPassword(input.password, username);
  await requireFreeUsername(username);
  await checkCanMakeFamily();
  const made = trees.length ? null : await makeFirstFamily(familyName);
  const granted = made ? [made] : trees;
  const { user, insert } = newUser(name, null, undefined, guestChoice(request));
  try {
    await accounts().batch([noUsersYet(), insert, ...(await passwordWrites(user.id, username, password)), ...granted.map((t) => upsertMembership(user.id, t, 'steward'))]);
  } catch (e) {
    if ((await userCount()) > 0) throw invalid('Kindred is already set up. Sign in instead.');
    rethrowTaken(e);
  }
  await store.markPlace?.();
  return { user: user.id, tree: made };
}

/** Takes an invitation with a new account that signs in with a password. */
export async function inviteWithPassword(
  request: Request, input: { token?: unknown; name?: unknown; username?: unknown; password?: unknown; acceptTerms?: unknown },
): Promise<{ user: string }> {
  await passwordAllowed(request);
  const gone = 'This invitation has expired, was already used, or was withdrawn. Ask for a new one.';
  const invite = typeof input.token === 'string' ? await openInvite(input.token) : undefined;
  if (!invite) throw invalid(gone);
  const name = cleanName(input.name);
  const username = cleanUsername(input.username);
  const password = checkNewPassword(input.password, username);
  await requireFreeUsername(username);
  const hash = await hashAccountPassword(password);
  try {
    return await commit(async () => {
      const fresh = await inviteById(invite.id);
      if (!fresh) throw invalid('This invitation was withdrawn.');
      if (!usable(fresh)) throw inviteUsed();
      const email = fresh.email && !(await userByEmail(fresh.email)) ? fresh.email : null;
      const { user, insert } = newUser(name, email, undefined, guestChoice(request));
      const terms = await inviteAcceptance(fresh, user, input.acceptTerms === true);
      return { writes: [insert, ...passwordRows(user.id, username, hash), ...useInvite(fresh, user.id), ...terms], result: { user: user.id }, refused: inviteUsed };
    });
  } catch (e) {
    return rethrowTaken(e);
  }
}
