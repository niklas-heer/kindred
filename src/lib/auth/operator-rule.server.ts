// Who may act as this server's operator right now: one rule for the console (`requireOperator`, ./guard.server.ts) and for the
// provider test sign-in, which starts from a session of its own and comes back to it (./oidc.server.ts). It lives here, apart
// from the guard, so code that is handed a session (not the request's current one) reads the same rule.
import { AuthError, notOperator, signedOut } from './errors.ts';
import type { UserRow } from './store.server.ts';
import { totpOn } from './totp.server.ts';
import { isDemo } from '../demo.ts';

/** A session as the rule reads it: the account, how the visitor is signed in, and the way in that started the session. */
export interface OperatorSession { user: UserRow | null; via?: string | null; method?: string | null }

/** Why this session may not act as the operator, or undefined when it may. */
export async function operatorRefusal(s: OperatorSession): Promise<AuthError | undefined> {
  if (!s.user) return signedOut();
  if (isDemo() || s.via === 'demo' || s.user.operator !== 1) return notOperator();
  // An operator signed in with a password, or with a code sent by email, reaches the console only with two-step codes on
  // (docs/hosting-many-families.md): neither a password nor a mailbox alone opens it.
  if ((s.method === 'password' || s.method === 'email-code') && !(await totpOn(s.user.id))) {
    return new AuthError('forbidden', s.method === 'password' ? 'pw.err.operator_needs_totp' : 'email.err.operator_code_totp');
  }
  return undefined;
}
