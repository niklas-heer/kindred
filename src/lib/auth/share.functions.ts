// The family share link, for the browser: the steward's card on the Access page, and the short page a relative opens. Server-only
// code is imported inside each handler, so it never ships to the browser.
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

const tree = z.string().regex(/^[a-z0-9-]+$/).max(64);
const token = z.string().max(100);

const guard = () => import('./guard.server');
const share = () => import('./share.server');

export interface ShareState {
  link: { id: string; generation: number; hasPassword: boolean; expires: number | null; created: number; ended: boolean } | null;
  /** The site is behind Cloudflare Access and no guest host is set, so a link could not reach a relative. */
  behindAccess: boolean;
}

/** The family's link as a steward sees it: never the token or the password, which exist only as hashes. */
export const fetchShareState = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }): Promise<ShareState> => {
    const [{ requireCan }, s, { authMethod }, { guestOrigin }] = await Promise.all([guard(), share(), import('./method.server'), import('./origin')]);
    await requireCan(data.tree, 'manage-access');
    const link = await s.shareLinkOf(data.tree);
    return {
      link: link ? { id: link.id, generation: link.generation, hasPassword: link.password_hash !== null, expires: link.expires, created: link.created, ended: !s.linkOpen(link) } : null,
      behindAccess: authMethod() === 'cloudflare-access' && !guestOrigin(),
    };
  });
export const shareStateQuery = (t: string) => queryOptions({ queryKey: ['session', 'share', t], queryFn: () => fetchShareState({ data: { tree: t } }) });

/** Makes the link, or replaces it (the old URL and password stop working). The URL and the password are returned only here, once. */
export const makeShareLink = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, password: z.boolean(), days: z.union([z.literal(1), z.literal(7), z.literal(30), z.literal(90), z.null()]) }))
  .handler(async ({ data }) => {
    const [{ requireCan, fail }, s, { family }, { AuthError }, { authMethod }, { guestOrigin, siteOrigin }, { getRequest }] = await Promise.all([
      guard(), share(), import('./trees.server'), import('./errors'), import('./method.server'), import('./origin'), import('@tanstack/react-start/server'),
    ]);
    const { user } = await requireCan(data.tree, 'manage-access');
    if (!(await family(data.tree))) throw fail(new AuthError('invalid', 'No such family.'));
    if (authMethod() === 'cloudflare-access' && !guestOrigin()) throw fail(new AuthError('invalid', 'share.err_behind_access'));
    const made = await s.makeShareLink({ tree: data.tree, password: data.password, days: data.days, createdBy: user.id });
    const origin = guestOrigin() ?? siteOrigin(getRequest());
    return { id: made.id, generation: made.generation, url: `${origin.origin}/share/${made.token}`, password: made.password, expires: made.expires };
  });

/** Turns the link off: it stops working, and everyone looking around through it is sent away. */
export const revokeShareLink = createServerFn({ method: 'POST' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    const [{ requireCan }, s] = await Promise.all([guard(), share()]);
    await requireCan(data.tree, 'manage-access');
    await s.revokeShareLink(data.tree);
  });

// ---------- the relative's side ----------

const WELL_FORMED = /^[A-Za-z0-9_-]{43}$/;

export type ShareEntry = { status: 'open'; password: boolean } | { status: 'closed' } | { status: 'inside'; tree: string };

/**
 * What a link asks for. POST, so the token stays out of query strings and logs, and so a chat app's link preview, which only
 * fetches the page, starts nothing. A link that is unknown, ended or removed answers the same, and no answer names the family.
 */
export const fetchShareEntry = createServerFn({ method: 'POST' })
  .validator(z.object({ token }))
  .handler(async ({ data }): Promise<ShareEntry> => {
    const [{ currentSession }, s, { allow, clientIP }] = await Promise.all([guard(), share(), import('./throttle.server')]);
    // A malformed token is refused before it is counted, so junk cannot use up the limit a relative's real link needs.
    if (!WELL_FORMED.test(data.token) || !allow(`share-entry:${clientIP()}`, 60, 10 * 60_000)) return { status: 'closed' };
    const link = await s.shareLinkByToken(data.token);
    if (!link || !s.linkOpen(link)) return { status: 'closed' };
    const { guest } = await currentSession();
    if (guest?.link === link.id) return { status: 'inside', tree: link.tree };
    return { status: 'open', password: link.password_hash !== null };
  });

export type ShareResult = { status: 'ok'; tree: string } | { status: 'wrong' | 'closed' | 'slow' };

/** Tries a link's password and, when it is right, starts a guest's visit. Each try is counted before the password is hashed. */
export const openShareLink = createServerFn({ method: 'POST' })
  .validator(z.object({ token, password: z.string().max(100).optional() }))
  .handler(async ({ data }): Promise<ShareResult> => {
    const [s, { allow, clientIP }, session, { appendResponseHeader, getRequest }] = await Promise.all([
      share(), import('./throttle.server'), import('./session.server'), import('@tanstack/react-start/server'),
    ]);
    // A malformed token is refused before it is counted, so junk cannot use up the limit a relative's real link needs.
    if (!WELL_FORMED.test(data.token)) return { status: 'closed' };
    if (!allow(`share-open:${clientIP()}`, 60, 10 * 60_000)) return { status: 'slow' };
    const link = await s.shareLinkByToken(data.token);
    if (!link || !s.linkOpen(link)) return { status: 'closed' };
    const ip = clientIP();
    if (!(await s.spendAttempt(link.id, ip))) return { status: 'slow' };
    if (!(await s.checkPassword(link, data.password))) return { status: 'wrong' };
    const visit = await s.startGuestVisit(link);
    if (!visit) return { status: 'closed' };
    await s.forgetAttempts(link.id, ip);
    const request = getRequest();
    for (const cookie of session.guestCookies(request, visit.token, visit.expires)) appendResponseHeader('Set-Cookie', cookie);
    return { status: 'ok', tree: link.tree };
  });

/** A guest ends their visit on this device. */
export const leaveGuestVisit = createServerFn({ method: 'POST' }).handler(async () => {
  const [session, { appendResponseHeader, getRequest }] = await Promise.all([import('./session.server'), import('@tanstack/react-start/server')]);
  appendResponseHeader('Set-Cookie', await session.endGuestSession(getRequest()));
});
