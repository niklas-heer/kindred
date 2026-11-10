// The Campaign's server functions. Members only: every call checks the membership on the server (`requireMember`), which
// refuses a share-link guest, so a guest never reads or plays the game. Viewers may play. The switch and "end the season
// now" are the stewards' (`manage-access`). The dice are rolled on the server; the browser sends an order and reads the result.
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { CampaignStatus, CampaignView, OrderResult } from './types.ts';

const tree = z.string().regex(/^[a-z0-9-]{1,64}$/);
const opKey = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/);
const province = z.number().int().min(0).max(63);
const troops = z.number().int().min(1).max(99);
const order = z.discriminatedUnion('type', [
  z.object({ type: z.literal('muster'), to: province, troops }),
  z.object({ type: z.literal('march'), from: province, to: province, troops }),
  z.object({ type: z.literal('attack'), from: province, to: province, troops }),
]);

const guard = () => import('../auth/guard.server');
const game = () => import('./campaign.server');

/** The member as the game knows them: the account, the name it shows, and the person they stand for here. */
async function member(t: string) {
  const m = await (await guard()).requireMember(t);
  return { account: m.user.id, name: m.user.name, person: m.person };
}

/** Sends the day's push to the houses that lost a province, after the response: the page does not wait for it. */
async function tell(t: string, fallen: import('./campaign.server').Fallen[]) {
  if (!fallen.length) return;
  const [{ notifyFallen }, { store }] = await Promise.all([import('./push.server'), import('../db.server')]);
  store.keepAlive(notifyFallen(t, fallen));
}

/** The whole campaign page for a member. A POST, because opening the game plays the nights that have passed. */
export const getCampaign = createServerFn({ method: 'POST' })
  .validator(z.object({ tree }))
  .handler(async ({ data }): Promise<CampaignView> => {
    const who = await member(data.tree);
    const { view, fallen } = await (await game()).campaignView(data.tree, who);
    await tell(data.tree, fallen);
    return view;
  });

export const campaignQuery = (t: string) => queryOptions({ queryKey: ['campaign', t], queryFn: () => getCampaign({ data: { tree: t } }), staleTime: 15_000 });

/** Whether the game is on, the season's day, the reader's house and orders: for the navigation and the Today card. */
export const getCampaignStatus = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }): Promise<CampaignStatus> => (await game()).campaignStatus(data.tree, await member(data.tree)));

export const campaignStatusQuery = (t: string) => queryOptions({ queryKey: ['campaign-status', t], queryFn: () => getCampaignStatus({ data: { tree: t } }), staleTime: 60_000 });

export const giveCampaignOrder = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, opKey, order, cry: z.string().max(80).nullable() }))
  .handler(async ({ data }): Promise<OrderResult> => {
    const who = await member(data.tree);
    const { result, fallen } = await (await game()).giveOrder(data.tree, who, data.order, data.cry, { key: data.opKey });
    await tell(data.tree, fallen);
    return result;
  });

export const pledgeCampaignSide = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, side: z.string().min(1).max(100) }))
  .handler(async ({ data }) => {
    await (await game()).pledge(data.tree, await member(data.tree), data.side);
  });

export const markCampaignSeen = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, upTo: z.number().int().min(0) }))
  .handler(async ({ data }) => {
    await (await game()).markSeen(data.tree, await member(data.tree), data.upTo);
  });

// ---------- the stewards' controls ----------

export const getCampaignSettings = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    await (await guard()).requireCan(data.tree, 'manage-access');
    return (await game()).campaignSettings(data.tree);
  });

export const campaignSettingsQuery = (t: string) => queryOptions({ queryKey: ['campaign-settings', t], queryFn: () => getCampaignSettings({ data: { tree: t } }) });

export const setCampaignOn = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, on: z.boolean() }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireCan(data.tree, 'manage-access');
    await (await game()).setCampaignEnabled(data.tree, data.on, m.user.id);
  });

export const endCampaignSeason = createServerFn({ method: 'POST' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    await (await guard()).requireCan(data.tree, 'manage-access');
    await (await game()).endSeasonNow(data.tree);
  });
