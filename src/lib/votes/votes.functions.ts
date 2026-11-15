// The server functions of family votes: the list and one vote (a member or a share-link guest may read them), starting,
// changing, closing and removing a vote, adding an option and striking a voter (members, by role), and casting a ballot (a
// member, or a guest who gives a name). Each checks the reader first; votes.server.ts checks again.
//
// A guest's key comes only from the `kindred_voter` cookie the server sets with their first ballot (guest-voter.server.ts);
// nothing here takes a key from the client. A ballot has no retry key on purpose: an op row's fingerprint would reveal secret
// choices, and casting again simply replaces the ballot.
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { Action } from '../roles';
import { MAX_DESCRIPTION, MAX_GUEST_NAME, MAX_OPTION, MAX_OPTIONS, MAX_QUESTION, type VoteSummary, type VoteView } from './types';

const tree = z.string().regex(/^[a-z0-9-]+$/).max(64);
const opKey = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/).optional();
const voteId = z.string().regex(/^[0-9a-f-]{36}$/);
const optionId = z.string().regex(/^[0-9a-f-]{36}$/);
// A little room over the limits for line endings the server folds; the server holds the limits itself.
const question = z.string().max(MAX_QUESTION * 2);
const description = z.string().max(MAX_DESCRIPTION * 2);
const label = z.string().max(MAX_OPTION * 2);
const vote = z.object({
  question,
  description: description.optional(),
  kind: z.enum(['single', 'ranked']),
  secret: z.boolean(),
  addOptions: z.boolean(),
  guests: z.boolean(),
  closesAt: z.string().max(40),
  options: z.array(label).max(MAX_OPTIONS),
});

const guard = () => import('../auth/guard.server');
const votes = () => import('./votes.server');

/** The member asking, with the role `action` needs; without one any member, and the .server function decides (a creator's own vote). */
async function who(t: string, action?: Action) {
  const g = await guard();
  const m = action ? await g.requireCan(t, action) : await g.requireMember(t);
  return { id: m.user.id, name: m.user.name, role: m.role, person: m.person, personConfirmed: m.personConfirmed };
}

/** The retry key for a change, bound to who sends it and to everything else they sent (see db.server.ts `once`). */
function opOf<D extends { opKey?: string }>(user: string, data: D) {
  if (!data.opKey) return undefined;
  const { opKey: key, ...payload } = data;
  return { key, user, payload };
}

/** A guest reader's key (the cookie they were given when they first voted), or undefined for a member or a new guest. */
async function guestKeyOf(reader: { guest: boolean }): Promise<string | undefined> {
  if (!reader.guest) return undefined;
  const [{ getRequest }, { guestVoterKey }] = await Promise.all([import('@tanstack/react-start/server'), import('./guest-voter.server')]);
  return guestVoterKey(getRequest());
}

// ---------- reads ----------

export const getVotes = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }): Promise<VoteSummary[]> => {
    const reader = await (await guard()).requireReader(data.tree);
    return (await votes()).listVotes(data.tree, reader, await guestKeyOf(reader));
  });

export const votesQuery = (t: string) => queryOptions({ queryKey: ['votes', t], queryFn: () => getVotes({ data: { tree: t } }), staleTime: 30_000 });

export const getVote = createServerFn({ method: 'GET' })
  .validator(z.object({ tree, id: voteId }))
  .handler(async ({ data }): Promise<VoteView | null> => {
    const reader = await (await guard()).requireReader(data.tree);
    return (await votes()).voteView(data.tree, reader, data.id, await guestKeyOf(reader));
  });

export const voteQuery = (t: string, id: string) =>
  queryOptions({ queryKey: ['votes', t, id], queryFn: () => getVote({ data: { tree: t, id } }), staleTime: 30_000 });

// ---------- changes ----------

/** Starts a vote. The devices that asked are told afterwards (vote-push.server.ts); the page does not wait. */
export const startVote = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, vote, opKey }))
  .handler(async ({ data }): Promise<{ id: string }> => {
    const me = await who(data.tree, 'start-vote');
    const result = await (await votes()).createVote(data.tree, me, data.vote, opOf(me.id, data));
    const [{ notifyVote }, { store }] = await Promise.all([import('./vote-push.server'), import('../db.server')]);
    store.keepAlive(notifyVote(data.tree, me, result.id));
    return result;
  });

export const changeVote = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: voteId, vote: vote.partial(), opKey }))
  .handler(async ({ data }) => {
    const me = await who(data.tree, 'start-vote');
    await (await votes()).editVote(data.tree, me, data.id, data.vote, opOf(me.id, data));
  });

export const endVote = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: voteId, opKey }))
  .handler(async ({ data }) => {
    const me = await who(data.tree);
    await (await votes()).closeVote(data.tree, me, data.id, opOf(me.id, data));
  });

export const deleteVote = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: voteId, opKey }))
  .handler(async ({ data }) => {
    const me = await who(data.tree);
    return (await votes()).removeVote(data.tree, me, data.id, opOf(me.id, data));
  });

export const addVoteOption = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: voteId, label, opKey }))
  .handler(async ({ data }): Promise<{ id: string }> => {
    const me = await who(data.tree, 'vote');
    return (await votes()).addOption(data.tree, me, data.id, data.label, opOf(me.id, data));
  });

export const strikeVoter = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: voteId, voter: z.string().min(1).max(100), struck: z.boolean(), opKey }))
  .handler(async ({ data }) => {
    const me = await who(data.tree, 'strike-voter');
    await (await votes()).strikeVoter(data.tree, me, data.id, data.voter, data.struck, opOf(me.id, data));
  });

/**
 * Casts or changes the reader's ballot: `choices` are option ids (one for a single-choice vote, in order for a ranked one). A
 * guest must give a `name`, and the response sets their `kindred_voter` cookie when they have none yet.
 */
export const castVote = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: voteId, choices: z.array(optionId).max(MAX_OPTIONS), name: z.string().min(1).max(MAX_GUEST_NAME).optional() }))
  .handler(async ({ data }) => {
    const g = await guard();
    const reader = await g.requireReader(data.tree);
    if (!reader.guest) {
      const me = await who(data.tree, 'vote');
      return (await votes()).castBallot(data.tree, { kind: 'member', who: me }, data.id, data.choices);
    }
    const name = data.name?.trim();
    if (!name || name.length > MAX_GUEST_NAME) throw new Error('votes.err.name');
    const [{ getRequest, appendResponseHeader }, voter, session] = await Promise.all([
      import('@tanstack/react-start/server'), import('./guest-voter.server'), g.currentSession(),
    ]);
    const guest = session.guest;
    if (!guest) throw g.fail((await import('../auth/errors')).signedOut());
    const request = getRequest();
    let key = await voter.guestVoterKey(request);
    let setCookie: string | undefined;
    if (!key) ({ key, setCookie } = await voter.voterCookie(request, guest.expires));
    await (await votes()).castBallot(data.tree, { kind: 'guest', key, name, link: guest.link, net: await voter.netOf(request) }, data.id, data.choices);
    // Only a ballot that was taken sets the cookie, so a refused one leaves the browser as it was.
    if (setCookie) appendResponseHeader('Set-Cookie', setCookie);
  });
