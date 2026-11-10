// "View as", for the browser: whom a steward can preview the family as, and starting, switching and stopping a preview. The
// rules are in ./view-as.server.ts; the guard applies a preview to every other server function (./guard.server.ts).
// Server-only code is imported inside each handler, so it never ships to the browser.
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { Role } from '../roles';

const tree = z.string().regex(/^[a-z0-9-]+$/).max(64);

const guard = () => import('./guard.server');

export interface ViewAsChoices {
  /** The family's other members: who a steward can view it as. */
  members: { id: string; name: string; role: Role; person: string | null }[];
  /** The family's share link while it is open, with its settings; null when it has none (then a plain guest is offered). */
  link: { protectLiving: boolean; askToJoin: boolean } | null;
}

/**
 * The steward's real session and their stewardship of `tree`, never the previewed reader's: a steward viewing the family as a
 * viewer can still switch and stop. Refuses a demo, a guest and anyone else.
 */
async function realSteward(t: string) {
  const [{ currentSession, myRealMemberships, fail }, { AuthError, signedOut }, { refuseStart }] = await Promise.all([guard(), import('./errors'), import('./view-as.server')]);
  const session = await currentSession();
  if (session.via === 'demo') throw fail(refuseStart('viewas.err_demo'));
  if (!session.user || (session.via !== 'passkey' && session.via !== 'access')) throw fail(signedOut());
  const mine = (await myRealMemberships()).find((m) => m.tree === t);
  if (mine?.role !== 'steward') throw fail(refuseStart('viewas.err_not_steward'));
  return { session, user: session.user, AuthError, fail };
}

/** Whom the family can be viewed as. For its stewards only, by their own role whatever they preview. */
export const fetchViewAsChoices = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }): Promise<ViewAsChoices> => {
    const { user } = await realSteward(data.tree);
    const [s, share] = await Promise.all([import('./store.server'), import('./share.server')]);
    const link = await share.shareLinkOf(data.tree);
    return {
      members: (await s.membersOf(data.tree)).filter((m) => m.id !== user.id).map((m) => ({ id: m.id, name: m.name, role: m.role, person: m.person })),
      link: link && share.linkOpen(link) ? { protectLiving: link.protect_living === 1, askToJoin: link.ask_to_join === 1 } : null,
    };
  });
export const viewAsChoicesQuery = (t: string) => queryOptions({ queryKey: ['view-as', 'choices', t], queryFn: () => fetchViewAsChoices({ data: { tree: t } }) });

const choice = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('role'), role: z.enum(['viewer', 'contributor', 'editor']) }),
  z.object({ kind: z.literal('member'), member: z.string().uuid() }),
  z.object({ kind: z.literal('guest') }),
]);

/** Starts a preview of `tree`, or switches to another one. Needs no fresh passkey proof: it changes nothing but the view. */
export const startViewAs = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, choice }))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { session, user, AuthError, fail } = await realSteward(data.tree);
    const [{ allowPreviewChange }, v, { getRequest, appendResponseHeader }] = await Promise.all([guard(), import('./view-as.server'), import('@tanstack/react-start/server')]);
    // A session already previewing is read-only; the preview itself is the one thing it may change.
    allowPreviewChange();
    try {
      appendResponseHeader('Set-Cookie', await v.startViewAs(getRequest(), { user: user.id, session: session.via === 'passkey' ? session.sessionHash ?? null : null }, data.tree, data.choice));
    } catch (e) {
      throw e instanceof AuthError ? fail(e) : e;
    }
    return { ok: true };
  });

/** Ends this browser's preview. Always works, for anyone holding it, and needs no passkey proof. */
export const stopViewAs = createServerFn({ method: 'POST' }).handler(async (): Promise<{ ok: true }> => {
  const [{ allowPreviewChange }, v, { getRequest, appendResponseHeader }] = await Promise.all([guard(), import('./view-as.server'), import('@tanstack/react-start/server')]);
  allowPreviewChange();
  appendResponseHeader('Set-Cookie', await v.endViewAs(getRequest()));
  return { ok: true };
});
