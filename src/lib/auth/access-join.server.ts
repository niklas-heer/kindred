// Joining a Cloudflare Access installation in the two cases that need a word from the reader. Everything else an Access identity
// does happens on its own in the session (session.server.ts). `email` is always the identity the server just verified.
import { AuthError } from './errors.ts';
import { cleanName } from './passkeys.server.ts';
import { inviteAcceptance } from '../operator/terms.server.ts';
import { checkSetupCode } from './setup.server.ts';
import { checkCanMakeFamily, cleanFamilyName, families, makeFirstFamily } from './trees.server.ts';
import {
  accounts, commit, inviteById, inviteUsed, newUser, noUsersYet, openInvite, upsertMembership, usable, useInvite, userByEmail, userCount,
} from './store.server.ts';
import type { Locale } from '../i18n/dictionary.ts';
import { store } from '../store/index.ts';

/** The first account when a setup code protects this server. Same result as passkey setup, minus the passkey. */
export async function claimFirstSteward(email: string, code: string, rawName: unknown, rawFamily: unknown, locale: Locale | null): Promise<{ user: string; tree: string | null }> {
  const alreadySetUp = () => new AuthError('invalid', 'Kindred is already set up. Sign in instead.');
  if ((await userCount()) > 0) throw alreadySetUp();
  if (!(await checkSetupCode(code))) throw new AuthError('invalid', 'That setup code isn’t right. Check the server’s console and try again.');
  const name = cleanName(rawName);
  const familyName = cleanFamilyName(rawFamily);
  await checkCanMakeFamily();
  const trees = (await families()).map((t) => t.id);
  const made = trees.length ? null : await makeFirstFamily(familyName);
  const { user, insert } = newUser(name, email, undefined, locale);
  try {
    await accounts().batch([noUsersYet(), insert, ...(made ? [made] : trees).map((t) => upsertMembership(user.id, t, 'steward'))]);
  } catch (e) {
    if ((await userCount()) > 0) throw alreadySetUp();
    throw e;
  }
  // On Cloudflare: the site is set up, so where its Durable Objects are kept is recorded now (src/lib/store/cf.ts).
  await store.markPlace?.();
  return { user: user.id, tree: made };
}

/** An invitation link, opened by a verified Access identity with no account yet: makes the account, in the invited role. */
export async function joinWithInvite(email: string, token: string, rawName: unknown, locale: Locale | null, acceptTerms?: boolean): Promise<string> {
  const gone = () => new AuthError('invalid', 'This invitation has expired, was already used, or was withdrawn. Ask for a new one.');
  const invite = await openInvite(token);
  if (!invite) throw gone();
  const name = cleanName(rawName);
  return commit(async () => {
    const fresh = await inviteById(invite.id);
    if (!fresh || !usable(fresh)) throw gone();
    const existing = await userByEmail(email);
    if (existing) return { writes: [...useInvite(fresh, existing.id), ...(await inviteAcceptance(fresh, existing, acceptTerms))], result: existing.id, refused: inviteUsed };
    const { user, insert } = newUser(name, email, undefined, locale);
    return { writes: [insert, ...useInvite(fresh, user.id), ...(await inviteAcceptance(fresh, user, acceptTerms))], result: user.id, refused: inviteUsed };
  });
}
