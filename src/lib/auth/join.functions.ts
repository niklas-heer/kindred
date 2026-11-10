// "Ask to join", for the browser: the guest's invitation, preview and passkey, and the steward's request cards. Server-only code
// is imported inside each handler (./join.server.ts), so it never ships to the browser. Every call is a server function, so the
// CSRF check in src/start.ts covers it; the passkey's origin is checked as for every other passkey.
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { z } from 'zod';
import type { JoinRequestView, JoinState } from './join.server';
import type { Place, Usage } from './join-rules';

const tree = z.string().regex(/^[a-z0-9-]+$/).max(64);
const person = z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/).nullable();

const guard = () => import('./guard.server');
const join = () => import('./join.server');

/** Turns an AuthError into a failed call with its status. */
const failing = async <T>(work: () => Promise<T>): Promise<T> => {
  const [{ fail }, { AuthError }] = await Promise.all([guard(), import('./errors')]);
  try {
    return await work();
  } catch (e) {
    throw e instanceof AuthError ? fail(e) : e;
  }
};

/** What a guest's pages show: the invitation, or this browser's request. A request that is gone clears its cookie. */
export const fetchJoinState = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }): Promise<JoinState> => {
    const [{ currentSession }, j, { getRequest, appendResponseHeader }] = await Promise.all([guard(), join(), import('@tanstack/react-start/server')]);
    const request = getRequest();
    const session = await currentSession();
    // A steward viewing the family as a guest of its link sees the invitation that guest would see (the browser explains
    // that a preview sends nothing, and every request to join would be refused anyway).
    const state = await j.joinState(request, session.viewAs?.kind === 'guest' ? { user: null, guest: session.guest } : session, data.tree);
    if (!state.request && j.hasJoinCookie(request) && !(await j.requestOfBrowser(request))) appendResponseHeader('Set-Cookie', j.clearJoinCookie(request));
    return state;
  });
export const joinStateQuery = (t: string) => queryOptions({ queryKey: ['join', t], queryFn: () => fetchJoinState({ data: { tree: t } }), staleTime: 30_000 });

/** Exactly what the stewards will receive, apart from what the guest types: the approximate place, the device and the usage. */
export const fetchJoinPreview = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }): Promise<{ place: Place | null; device: string; usage: Usage | null }> => {
    const [{ currentSession }, j, { getRequest }] = await Promise.all([guard(), join(), import('@tanstack/react-start/server')]);
    return failing(async () => j.joinPreview(getRequest(), await currentSession(), data.tree));
  });

const input = z.object({
  tree,
  name: z.string().max(200),
  person,
  message: z.string().max(2000).optional(),
  timeZone: z.string().max(100).optional(),
  language: z.string().max(100).optional(),
});

/** The passkey's options for a request. Everything is checked, and the try counted, before a passkey is made. */
export const joinOptions = createServerFn({ method: 'POST' })
  .validator(input)
  .handler(async ({ data }) => {
    const [{ currentSession }, j, { getRequest }, { allow, clientIP }, { AuthError }] = await Promise.all([
      guard(), join(), import('@tanstack/react-start/server'), import('./throttle.server'), import('./errors'),
    ]);
    return failing(async () => {
      const ip = clientIP();
      if (!allow(`join:${ip}`, 20, 10 * 60_000)) throw new AuthError('throttled', 'join.err_slow');
      const { tree: t, ...rest } = data;
      const { options, challengeId } = await j.joinOptions(getRequest(), await currentSession(), t, rest, ip);
      // As text: the options' type names binary fields the server-function serialiser cannot vouch for, though the JSON form has none.
      return { options: JSON.stringify(options), challengeId };
    });
  });

/** Sends the request: the pending account, its passkey and the request. The stewards with reminders on get a push. */
export const sendJoinRequest = createServerFn({ method: 'POST' })
  .validator(z.object({ challengeId: z.string().max(100), response: z.record(z.string(), z.unknown()) }))
  .handler(async ({ data }) => {
    const [{ currentSession }, j, { getRequest, appendResponseHeader }, { allow, clientIP }, { AuthError }, { vapidFrom, envSetting }] = await Promise.all([
      guard(), join(), import('@tanstack/react-start/server'), import('./throttle.server'), import('./errors'), import('../reminders.server'),
    ]);
    return failing(async () => {
      if (!allow(`join:${clientIP()}`, 20, 10 * 60_000)) throw new AuthError('throttled', 'join.err_slow');
      const done = await j.finishJoin(getRequest(), await currentSession(), data.challengeId, data.response as unknown as RegistrationResponseJSON);
      appendResponseHeader('Set-Cookie', done.cookie);
      // Awaited, so a Worker does not end the request before it is sent; the push has its own short timeout.
      await j.notifyStewards(done.tree, done.name, vapidFrom(envSetting));
      return { ok: true as const };
    });
  });

// ---------- the steward's side ----------

export interface JoinRequests { requests: JoinRequestView[] }

export const fetchJoinRequests = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }): Promise<JoinRequests> => {
    const [{ requireCan }, j] = await Promise.all([guard(), join()]);
    await requireCan(data.tree, 'manage-access');
    return { requests: await j.listJoinRequests(data.tree) };
  });
export const joinRequestsQuery = (t: string) => queryOptions({ queryKey: ['session', 'join-requests', t], queryFn: () => fetchJoinRequests({ data: { tree: t } }) });

export const approveJoinRequest = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: z.string().uuid(), role: z.enum(['viewer', 'contributor', 'editor', 'steward']), person }))
  .handler(async ({ data }) => {
    const [{ requireCan }, j] = await Promise.all([guard(), join()]);
    await requireCan(data.tree, 'manage-access');
    await failing(() => j.approveJoinRequest(data));
  });

export const declineJoinRequest = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const [{ requireCan }, j] = await Promise.all([guard(), join()]);
    await requireCan(data.tree, 'manage-access');
    await failing(() => j.declineJoinRequest(data.tree, data.id));
  });

/** The per-link switch: whether the link's guests may ask to join. Requests already sent stay. */
export const setAskToJoin = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, on: z.boolean() }))
  .handler(async ({ data }) => {
    const [{ requireCan, fail }, { setShareAskToJoin }, { AuthError }] = await Promise.all([guard(), import('./share.server'), import('./errors')]);
    await requireCan(data.tree, 'manage-access');
    if (!(await setShareAskToJoin(data.tree, data.on))) throw fail(new AuthError('invalid', 'share.err_no_link'));
  });
