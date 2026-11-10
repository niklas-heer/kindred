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
//
// A steward's "View as" preview (view-as.server.ts) is resolved here, with the session, once per request: from then on every
// check below answers for the previewed reader in that family, and the request writes nothing (src/lib/read-only.ts).
import { appendResponseHeader, getRequest, setResponseStatus } from '@tanstack/react-start/server';
import { CHANGE_OF_ACTION } from '../stats/shared';
import { onChangeCommitted } from '../db.server';
import { onActor, type Actor } from '../history.server';
import { can, needs, type Action, type Role } from '../roles';
import { forbidden, notMember, signedOut, type AuthError } from './errors';
import { getSession, type Session } from './session.server';
import { membershipsOf, type MembershipRow, type UserRow } from './store.server';
import { demoRefused, isDemo } from '../demo';
import { onRequestReadOnly } from '../read-only';
import { previewMemberships, resolveViewAs, viewAsRefused, viewAsToken, viewAsUser, type ViewAs } from './view-as.server';

// One lookup per request, however many checks it makes.
const perRequest = new WeakMap<Request, Promise<Session>>();

/** The current request's session (inside a server function or server route). */
export function currentSession(): Promise<Session> {
  const request = getRequest();
  let s = perRequest.get(request);
  if (!s) {
    s = getSession(request).then(async (session) => {
      if (session.setCookie) {
        try { appendResponseHeader('Set-Cookie', session.setCookie); } catch {}
      }
      return withViewAs(request, session);
    });
    perRequest.set(request, s);
  }
  return s;
}

/**
 * The session with the steward's preview applied, when this browser has one that still holds (view-as.server.ts). Checked
 * against the real session: its account, its passkey session and its own memberships, never the previewed ones. From here on
 * the request is read-only.
 */
async function withViewAs(request: Request, session: Session): Promise<Session> {
  if (!session.user || (session.via !== 'passkey' && session.via !== 'access') || !viewAsToken(request)) return session;
  const real = session.memberships ?? (await membershipsOf(session.user.id));
  const { viewAs, clear } = await resolveViewAs(request, { user: session.user, via: session.via, session: session.sessionHash ?? null, memberships: real });
  if (clear) {
    try { appendResponseHeader('Set-Cookie', clear); } catch {}
  }
  if (!viewAs) return { ...session, memberships: real };
  // Read-only from here on: the preview's own row was the last write this request may make.
  previewing.set(request, viewAs);
  const guest = viewAs.kind === 'guest' ? { link: viewAs.guest!.link ?? 'view-as', tree: viewAs.tree, expires: viewAs.expires, protectLiving: viewAs.guest!.protectLiving } : session.guest;
  return { ...session, memberships: previewMemberships(real, viewAs), realMemberships: real, guest, viewAs };
}

// The requests of a previewing session, and those of them allowed to change the preview itself (start, switch, stop).
const previewing = new WeakMap<Request, ViewAs>();
const previewChange = new WeakSet<Request>();

// The one place that says a request may not write: asked by the store, `once`, the media store and the AI adapters.
onRequestReadOnly(() => {
  let request: Request;
  try { request = getRequest(); } catch { return undefined; } // outside a request: a job, a script
  const viewAs = previewing.get(request);
  return viewAs && !previewChange.has(request) ? viewAsRefused(viewAs) : undefined;
});

/** The request's preview, if the session has one (after `currentSession`). */
export const previewOf = (): ViewAs | undefined => previewing.get(getRequest());

/**
 * Lets this request write again, for what a previewing session may change: the preview itself (starting another one, or
 * stopping it) and the steward's own language. Nothing else may call this.
 */
export function allowPreviewChange(): void {
  previewChange.add(getRequest());
}

/** The steward's own memberships, whatever they preview: for what stays theirs (the families page, starting a preview). */
export async function myRealMemberships(): Promise<MembershipRow[]> {
  const s = await currentSession();
  return s.realMemberships ?? (await myMemberships());
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
  const signedIn = await requireUser();
  const m = await membership(signedIn.id, tree);
  if (!m) throw fail(notMember());
  const user = readerAccount(await currentSession(), tree) ?? signedIn;
  actorsOf(getRequest()).set(tree, { account: user.id, name: user.name });
  return { user, role: m.role, person: m.person, personConfirmed: !!m.person_confirmed };
}

/** During a preview of `tree` as a member or a role: the account that reader is, which no row has (view-as.server.ts). */
const readerAccount = (s: Session, tree: string): UserRow | undefined => (s.viewAs?.tree === tree && s.viewAs.kind !== 'guest' && s.user ? viewAsUser(s.viewAs, s.user) : undefined);

// Who a request's changes are by, per family, as the membership check found them: the history names them (history.server.ts).
// A request that never passed a member's check (a daily job, a script) changes the family as Kindred itself.
const requestActors = new WeakMap<Request, Map<string, Actor>>();
const actorsOf = (request: Request) => {
  let m = requestActors.get(request);
  if (!m) requestActors.set(request, (m = new Map()));
  return m;
};
onActor((tree) => requestActors.get(getRequest())?.get(tree));

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
  const session = await currentSession();
  const { user, guest } = session;
  const m = user && (await membership(user.id, tree));
  if (user && m) return { user: readerAccount(session, tree) ?? user, role: m.role, person: m.person, personConfirmed: !!m.person_confirmed, guest: false, protectLiving: false };
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
