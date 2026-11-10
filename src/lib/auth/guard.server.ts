// The server's permission checks, for server functions and server routes. Every function that reads
// or changes a family goes through `requireMember` or `requireCan`, with the same `Action` the browser
// asks `useCan()` about, so hiding a button is never the only protection.
//
//   const { user, role } = await requireCan(data.tree, 'add-story');
//
// They throw a 401 (`signed-out`) without a session, and a 403 (`not-member`, `forbidden`) when the
// reader isn't in that family or their role is too low.
//
// A guest (a family share link) has no account, so all of these refuse them. Only `requireReader`, used by the reads that are
// safe for someone who is not a member, lets a guest through, and then with exactly a viewer's role. Anything new is closed to
// guests until it says otherwise.
import { appendResponseHeader, getRequest, setResponseStatus } from '@tanstack/react-start/server';
import { CHANGE_OF_ACTION } from '../stats/shared';
import { onChangeCommitted } from '../db.server';
import { can, needs, type Action, type Role } from '../roles';
import { forbidden, notMember, signedOut, type AuthError } from './errors';
import { getSession, type Session } from './session.server';
import { membershipsOf, type MembershipRow, type UserRow } from './store.server';
import { demoRefused, isDemo } from '../demo';

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

// And one read of the reader's memberships per request: with the session's, when they came with it.
const perRequestMemberships = new WeakMap<Request, Promise<MembershipRow[]>>();

/** The signed-in reader's memberships, read once per request (empty for nobody). Every check below uses these. */
export function myMemberships(): Promise<MembershipRow[]> {
  const request = getRequest();
  let m = perRequestMemberships.get(request);
  if (!m) {
    m = currentSession().then((s) => s.memberships ?? (s.user ? membershipsOf(s.user.id) : []));
    perRequestMemberships.set(request, m);
  }
  return m;
}
const membership = async (_user: string, tree: string) => (await myMemberships()).find((m) => m.tree === tree);

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

export interface Member { user: UserRow; role: Role; person: string | null; personConfirmed: boolean }

/** The signed-in reader's membership of `tree`; 401 when signed out, 403 when not a member. */
export async function requireMember(tree: string): Promise<Member> {
  const user = await requireUser();
  const m = await membership(user.id, tree);
  if (!m) throw fail(notMember());
  return { user, role: m.role, person: m.person, personConfirmed: !!m.person_confirmed };
}

/**
 * Someone reading a family: a member, or a guest with a viewer's role. A guest gets no person and no account.
 * `protectLiving` is true only for a guest whose link protects living people (src/lib/protect-living.ts).
 */
export interface Reader { user: UserRow | null; role: Role; person: string | null; personConfirmed: boolean; guest: boolean; protectLiving: boolean }

/**
 * Like `requireMember`, and a guest of this family counts too, as a viewer. Use it only for reads a guest may have: the role
 * it returns is what keeps private fields and private research back, exactly as for a viewer, and `protectLiving` is what
 * keeps living people back when the guest's link asks for it. Every read that allows a guest passes both on.
 */
export async function requireReader(tree: string): Promise<Reader> {
  const { user, guest } = await currentSession();
  const m = user && (await membership(user.id, tree));
  if (user && m) return { user, role: m.role, person: m.person, personConfirmed: !!m.person_confirmed, guest: false, protectLiving: false };
  // A visit that does not say is protected: only a link that has the setting off shows the living in full.
  if (guest?.tree === tree) return { user: null, role: 'viewer', person: null, personConfirmed: false, guest: true, protectLiving: guest.protectLiving !== false };
  throw fail(user ? notMember() : signedOut());
}

/** Like `requireMember`, and the reader's role must allow `action` (403 otherwise). */
export async function requireCan(tree: string, action: Action): Promise<Member> {
  const m = await requireMember(tree);
  // A demo's visitor is a viewer, so this only says it sooner and in the demo's words: anything beyond reading would be a change,
  // and the store refuses every change anyway (src/lib/store/index.ts).
  if (isDemo() && action !== 'view') throw fail(demoRefused());
  if (!can(m.role, action)) throw fail(forbidden(action, needs(action)));
  if (CHANGE_OF_ACTION[action]) {
    const request = getRequest();
    if (!allowedChange.has(request)) allowedChange.set(request, { tree, user: m.user.id, role: m.role, action });
  }
  return m;
}

// The change a request has been allowed to make, under the role just confirmed. The statistics count it once, when a write of it
// reaches the database: a permission alone is not a change, whether the request only reads or its save is refused.
const allowedChange = new WeakMap<Request, { tree: string; user: string; role: Role; action: Action }>();

onChangeCommitted(async (tree) => {
  const request = getRequest();
  const change = allowedChange.get(request);
  if (change?.tree !== tree) return;
  allowedChange.delete(request);
  // Awaited, so a Worker does not end the request before it is written.
  await (await import('../stats/store.server')).countChange(tree, change.user, change.role, change.action);
});
