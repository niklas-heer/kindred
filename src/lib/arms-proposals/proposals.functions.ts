// The server functions of coat-of-arms proposals: a house's proposals, how many wait in each house, and the family's setting
// (members only: a guest is refused, so a proposer's name and note never reach one); proposing and withdrawing (a member;
// `propose-arms` is checked inside proposeArms, and a proposer may always withdraw their own); and accepting, declining,
// putting to a vote and changing the setting (`edit-house`, a steward). proposals.server.ts checks again, and the setting's
// mode where an action depends on it.
//
// A write that starts an arms vote (a proposal in vote mode when none runs, or Put to a vote) tells the family's devices of
// the new vote after the answer, as startVote does; joining or chaining a vote tells nobody.
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { armsSchema } from '~/lib/heraldry/schema';
import type { Action } from '../roles';
import { MAX_DECLINE_REASON, MAX_PROPOSAL_NAME, MAX_PROPOSAL_NOTE, type ArmsMode, type ProposalView } from './types';

const tree = z.string().regex(/^[a-z0-9-]+$/).max(64);
const opKey = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/).optional();
const house = z.string().min(1).max(120);
const proposalId = z.string().regex(/^[0-9a-f-]{36}$/);
// A little room over the limits for line endings the server folds; proposals.server.ts holds the limits itself.
const name = z.string().max(MAX_PROPOSAL_NAME * 2);
const note = z.string().max(MAX_PROPOSAL_NOTE * 2).optional();
const reason = z.string().max(MAX_DECLINE_REASON * 2).optional();
const mode = z.enum(['steward', 'vote', 'choose']);

const guard = () => import('../auth/guard.server');
const proposals = () => import('./proposals.server');

/** The member asking, with the role `action` needs; without one any member, and the .server function decides. A guest is refused by the guard. */
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

/** Tells the family's devices of an arms vote this write started; the page does not wait. */
async function announce(t: string, me: Awaited<ReturnType<typeof who>>, result: { vote: string | null; started: boolean }) {
  if (!result.started || !result.vote) return;
  const [{ notifyVote }, { store }] = await Promise.all([import('../votes/vote-push.server'), import('../db.server')]);
  store.keepAlive(notifyVote(t, me, result.vote));
}

// ---------- reads (members) ----------

export const getHouseProposals = createServerFn({ method: 'GET' })
  .validator(z.object({ tree, house }))
  .handler(async ({ data }): Promise<{ proposals: ProposalView[]; mode: ArmsMode; settled: boolean }> => {
    const me = await who(data.tree);
    return (await proposals()).houseProposals(data.tree, me, data.house);
  });

export const houseProposalsQuery = (t: string, h: string) =>
  queryOptions({ queryKey: ['arms-proposals', t, h], queryFn: () => getHouseProposals({ data: { tree: t, house: h } }), staleTime: 30_000 });

/** Open proposals per house id: the number each house's page and the tree's menu show. */
export const getProposalCounts = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }): Promise<Record<string, number>> => {
    const me = await who(data.tree);
    return (await proposals()).proposalCounts(data.tree, me);
  });

export const proposalCountsQuery = (t: string) =>
  queryOptions({ queryKey: ['arms-proposals', t, 'counts'], queryFn: () => getProposalCounts({ data: { tree: t } }), staleTime: 30_000 });

export const getArmsSettings = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }): Promise<{ mode: ArmsMode; guests: boolean }> => {
    await who(data.tree);
    return (await proposals()).armsSettings(data.tree);
  });

export const armsSettingsQuery = (t: string) =>
  queryOptions({ queryKey: ['arms-settings', t], queryFn: () => getArmsSettings({ data: { tree: t } }), staleTime: 30_000 });

// ---------- changes ----------

/** What a write leaves stale: the house's proposals and counts, the votes (an arms vote starts, joins or goes) and the graph (an accepted design). */
export const armsKeys = (t: string) => [['arms-proposals', t], ['votes', t], ['graph', t]];

export const setArmsSettings = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, mode, guests: z.boolean(), opKey }))
  .handler(async ({ data }) => {
    const me = await who(data.tree, 'edit-house');
    await (await proposals()).saveArmsSettings(data.tree, me, { mode: data.mode, guests: data.guests }, opOf(me.id, data));
  });

export const proposeArmsFn = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, house, name, note, arms: armsSchema, opKey }))
  .handler(async ({ data }): Promise<{ id: string; vote: string | null; started: boolean }> => {
    const me = await who(data.tree);
    const result = await (await proposals()).proposeArms(data.tree, me, data.house, { name: data.name, note: data.note, arms: data.arms }, opOf(me.id, data));
    await announce(data.tree, me, result);
    return result;
  });

export const withdrawProposalFn = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: proposalId, opKey }))
  .handler(async ({ data }) => {
    const me = await who(data.tree);
    await (await proposals()).withdrawProposal(data.tree, me, data.id, opOf(me.id, data));
  });

export const acceptProposalFn = createServerFn({ method: 'POST' })
  .validator(z.object({
    tree, id: proposalId, opKey,
    // The house as the steward saw it: an accept over someone else's newer change is refused (db.server.ts `houseWritePlan`).
    before: z.object({ name: z.string().max(200), motto: z.string().max(400).nullable(), arms: z.unknown() }),
  }))
  .handler(async ({ data }) => {
    const me = await who(data.tree, 'edit-house');
    await (await proposals()).acceptProposal(data.tree, me, data.id, data.before, opOf(me.id, data));
  });

export const declineProposalFn = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: proposalId, reason, opKey }))
  .handler(async ({ data }) => {
    const me = await who(data.tree, 'edit-house');
    await (await proposals()).declineProposal(data.tree, me, data.id, data.reason, opOf(me.id, data));
  });

export const putToVoteFn = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: proposalId, opKey }))
  .handler(async ({ data }): Promise<{ vote: string; started: boolean }> => {
    const me = await who(data.tree, 'edit-house');
    const result = await (await proposals()).putToVote(data.tree, me, data.id, opOf(me.id, data));
    await announce(data.tree, me, result);
    return result;
  });
