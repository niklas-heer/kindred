// The server's permission checks, for server functions and server routes. Every function that reads
// or changes a family goes through `requireMember` or `requireCan`, with the same `Action` the browser
// asks `useCan()` about, so hiding a button is never the only protection.
//
//   const { user, role } = await requireCan(data.tree, 'add-story');
//
// They throw a 401 (`signed-out`) without a session, and a 403 (`not-member`, `forbidden`) when the
// reader isn't in that family or their role is too low.
import { appendResponseHeader, getRequest, setResponseStatus } from '@tanstack/react-start/server';
import { can, needs, type Action, type Role } from '../roles';
import { forbidden, notMember, signedOut, type AuthError } from './errors';
import { getSession, type Session } from './session.server';
import { membership, type UserRow } from './store.server';

// One lookup per request, however many checks it makes.
const perRequest = new WeakMap<Request, Promise<Session>>();

/** The current request's session (inside a server function or server route). */
export function currentSession(): Promise<Session> {
  const request = getRequest();
  let s = perRequest.get(request);
  if (!s) {
    s = getSession(request).then((session) => {
      if (session.setCookie) {
        try { appendResponseHeader('Set-Cookie', session.setCookie); } catch {}
      }
      return session;
    });
    perRequest.set(request, s);
  }
  return s;
}

/**
 * Gives a failed server-function call the error's HTTP status (401, 403, 400, 429): Start sends a
 * thrown error back with 200 unless the status is set. Use as `throw fail(new AuthError(…))`.
 */
export function fail<E extends AuthError>(e: E): E {
  try { setResponseStatus(e.status); } catch {}
  return e;
}

export async function requireUser(): Promise<UserRow> {
  const { user } = await currentSession();
  if (!user) throw fail(signedOut());
  return user;
}

export interface Member { user: UserRow; role: Role; person: string | null }

/** The signed-in reader's membership of `tree`; 401 when signed out, 403 when not a member. */
export async function requireMember(tree: string): Promise<Member> {
  const user = await requireUser();
  const m = await membership(user.id, tree);
  if (!m) throw fail(notMember());
  return { user, role: m.role, person: m.person };
}

/** Like `requireMember`, and the reader's role must allow `action` (403 otherwise). */
export async function requireCan(tree: string, action: Action): Promise<Member> {
  const m = await requireMember(tree);
  if (!can(m.role, action)) throw fail(forbidden(action, needs(action)));
  return m;
}
