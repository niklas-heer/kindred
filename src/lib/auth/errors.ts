// Errors the auth guards throw. `status` sets the HTTP status of the failed server-function call
// (Start reads it); the message is written for the person reading it, never a stack or a hint.
import type { Action, Role } from '../roles';

export type AuthErrorCode = 'signed-out' | 'not-member' | 'forbidden' | 'throttled' | 'invalid' | 'reauth';

export class AuthError extends Error {
  status: number;
  code: AuthErrorCode;
  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.status = code === 'signed-out' ? 401 : code === 'throttled' ? 429 : code === 'invalid' ? 400 : 403;
  }
}

/** A step that needs the reader to confirm with a passkey on this session first (proof.server.ts). The browser does that and tries again. */
export const needsProof = () => new AuthError('reauth', 'Confirm it’s you with your passkey first.');
export const signedOut = () => new AuthError('signed-out', 'Please sign in to continue.');
export const notMember = () => new AuthError('not-member', 'You don’t have access to this family.');
// The text is one fixed English sentence, so the client can translate it (see translateMessage).
/** Only an operator of this server may do that (src/lib/operator/). One fixed English sentence, translated by the browser. */
export const notOperator = () => new AuthError('forbidden', 'Only an operator of this server can do that.');
/** The family is suspended by the server's operator: its members can read it but change nothing. */
export const suspended = () => new AuthError('forbidden', 'This family is suspended by the server’s operator: you can read it, but nothing can be changed.');
/** The family is closed by the server's operator: nobody can open it until the operator lets it be used again. */
export const closedFamily = () => new AuthError('forbidden', 'This family is closed by the server’s operator.');
export const forbidden = (_action: Action, _needed: Role) => new AuthError('forbidden', 'You don’t have permission for that. Ask a steward for access.');

/** The kind of an error that came back from a server function, if it was an auth error. */
export function authErrorCode(e: unknown): AuthErrorCode | undefined {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && ['signed-out', 'not-member', 'forbidden', 'throttled', 'invalid', 'reauth'].includes(code)) return code as AuthErrorCode;
  const msg = e instanceof Error ? e.message : '';
  if (msg === 'Please sign in to continue.') return 'signed-out';
  if (msg === 'You don’t have access to this family.') return 'not-member';
  return undefined;
}
