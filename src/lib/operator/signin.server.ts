// The operator console's sign-in tab (docs/hosting-many-families.md): which ways in the server offers (src/lib/auth/
// methods.server.ts holds the rules), the single sign-on providers (src/lib/auth/oidc.server.ts), and a one-hour reset link
// for someone who cannot sign in any more. Every change needs the operator's fresh proof (checked by the server function) and
// is written to the audit log in the same batch.
import { AuthError } from '../auth/errors.ts';
import { previewMethods, saveMethods, signInSettings, type MethodChange } from '../auth/methods.server.ts';
import { normalizeUsername, type SignInMethod, type SignInSettings } from '../auth/methods.ts';
import { makeResetLink, passwordOf } from '../auth/password.server.ts';
import { deleteProvider, listProviders, saveProvider, type ProviderInput } from '../auth/oidc.server.ts';
import { accounts, type UserRow } from '../auth/store.server.ts';
import { audit } from './settings.server.ts';

const actor = (u: UserRow) => ({ id: u.id, name: u.name });

export { signInSettings, previewMethods, listProviders };
export type { SignInSettings, MethodChange };

/** Saves which ways in the server offers. Refused when an operator would be left without one; ends the removed methods' sessions. */
export function setSignInMethods(op: UserRow, methods: SignInMethod[]): Promise<MethodChange> {
  return saveMethods(methods, op.id, (change) => audit(actor(op), 'signin.methods', null, { methods: change.methods, removed: change.removed, added: change.added, lockedOut: change.lockedOut }));
}

/**
 * A one-hour link that lets the account with this username or email set a new password (and, with `clearTotp`, turns its
 * two-step codes off, for a lost phone). Only for an account that has a password: a link never gives an account its first
 * one. It never adds anyone to a family. The token is shown to the operator once; using it ends the account's sessions and
 * leaves the holder a notice.
 */
export async function resetLinkFor(op: UserRow, who: string, clearTotp: boolean): Promise<{ token: string; expires: number; name: string }> {
  const typed = who.trim();
  const target = typed.includes('@') && !(await accounts().get('SELECT 1 FROM user WHERE username = ?', normalizeUsername(typed)))
    ? await accounts().get<{ id: string; name: string }>('SELECT id, name FROM user WHERE email = ?', typed)
    : await accounts().get<{ id: string; name: string }>('SELECT id, name FROM user WHERE username = ?', normalizeUsername(typed));
  if (!target) throw new AuthError('invalid', 'pw.err.no_account');
  if (!(await passwordOf(target.id))) throw new AuthError('invalid', 'pw.err.reset_no_password');
  const { token, expires, writes } = await makeResetLink(target.id, op.id, clearTotp);
  await accounts().batch([...writes, audit(actor(op), 'signin.reset_link', null, { account: target.id, name: target.name, clearTotp })]);
  return { token, expires, name: target.name };
}

/** Adds or changes a single sign-on provider (the secret is sealed; the issuer is fixed once it exists). */
export function setProvider(op: UserRow, input: ProviderInput): Promise<void> {
  return saveProvider(input, (detail) => audit(actor(op), 'signin.provider', null, detail));
}

/** Removes a single sign-on provider, the identities at it and the sessions it started. */
export function removeProvider(op: UserRow, id: string): Promise<void> {
  return deleteProvider(id, (detail) => audit(actor(op), 'signin.provider_deleted', null, detail));
}
