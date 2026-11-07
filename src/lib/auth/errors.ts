// Errors the auth guards throw. `status` sets the HTTP status of the failed server-function call
// (Start reads it); the message is written for the person reading it, never a stack or a hint.
import type { Action, Role } from '../roles';

export type AuthErrorCode = 'signed-out' | 'not-member' | 'forbidden' | 'throttled' | 'invalid';

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

export const signedOut = () => new AuthError('signed-out', 'Please sign in to continue.');
export const notMember = () => new AuthError('not-member', 'You don’t have access to this family.');
export const forbidden = (action: Action, needed: Role) => new AuthError('forbidden', `Only ${needed === 'editor' ? 'an' : 'a'} ${needed} can do that (${action.replace('-', ' ')}). Ask a steward for access.`);

/** The kind of an error that came back from a server function, if it was an auth error. */
export function authErrorCode(e: unknown): AuthErrorCode | undefined {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && ['signed-out', 'not-member', 'forbidden', 'throttled', 'invalid'].includes(code)) return code as AuthErrorCode;
  const msg = e instanceof Error ? e.message : '';
  if (msg === 'Please sign in to continue.') return 'signed-out';
  if (msg === 'You don’t have access to this family.') return 'not-member';
  return undefined;
}
