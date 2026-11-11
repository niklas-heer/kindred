// The Campaign's server functions. Members only: every call checks the membership on the server (`requireMember`), which
// refuses a share-link guest, so a guest never reads or plays the game. Viewers may play. The switch is the stewards'
// (`manage-access`). The browser plays a reign and sends its moves; the server plays them again and keeps the score.
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { RULES } from './engine.ts';
import type { CampaignStatus, CampaignView, FinishResult, RunStart } from './types.ts';

const tree = z.string().regex(/^[a-z0-9-]{1,64}$/);
const opKey = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/);
const province = z.number().int().min(0).max(63);
const troops = z.number().int().min(1).max(99);
const move = z.discriminatedUnion('t', [
  z.object({ t: z.literal('place'), to: province }),
  z.object({ t: z.literal('march'), from: province, to: province, troops }),
  z.object({ t: z.literal('attack'), from: province, to: province, troops }),
  z.object({ t: z.literal('end') }),
]);

const guard = () => import('../auth/guard.server');
const game = () => import('./campaign.server');

/** The member as the game knows them: the account, the name it shows, and the person they stand for here. */
async function member(t: string) {
  const m = await (await guard()).requireMember(t);
  return { account: m.user.id, name: m.user.name, person: m.person };
}

/** The whole campaign page for a member. A POST, because the first visit after the upgrade closes the old season. */
export const getCampaign = createServerFn({ method: 'POST' })
  .validator(z.object({ tree }))
  .handler(async ({ data }): Promise<CampaignView> => (await game()).campaignView(data.tree, await member(data.tree)));

export const campaignQuery = (t: string) => queryOptions({ queryKey: ['campaign', t], queryFn: () => getCampaign({ data: { tree: t } }), staleTime: 15_000 });

/** Whether the game is on, and where the reader stands this week: for the navigation and the Today card. */
export const getCampaignStatus = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }): Promise<CampaignStatus> => (await game()).campaignStatus(data.tree, await member(data.tree)));

export const campaignStatusQuery = (t: string) => queryOptions({ queryKey: ['campaign-status', t], queryFn: () => getCampaignStatus({ data: { tree: t } }), staleTime: 60_000 });

/** Begins a reign of this week's challenge. `side` counts only for a member who stands for nobody in a house. */
export const startCampaignRun = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, side: z.string().min(1).max(100).nullable() }))
  .handler(async ({ data }): Promise<RunStart> => (await game()).startRun(data.tree, await member(data.tree), data.side));

/** Finishes a reign with the moves that were played. The score is the server's. */
export const finishCampaignRun = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, opKey, id: z.string().uuid(), moves: z.array(move).max(RULES.MAX_MOVES) }))
  .handler(async ({ data }): Promise<FinishResult> => (await game()).finishRun(data.tree, await member(data.tree), data.id, data.moves, { key: data.opKey }));

// ---------- the stewards' switch ----------

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
