// "Who is this?" server functions (docs/who-is-this.md). Members only: every call checks the membership on the server
// (`requireMember`), which refuses a share-link guest. Any member may play and propose a name; confirming or declining a
// proposal needs the gallery's tagging right (`upload-photo`, through `requireCan`), and the rule in rules.ts keeps a
// member from confirming their own.
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { WhoOutcome, WhoRound } from './types.ts';

const tree = z.string().regex(/^[a-z0-9-]{1,64}$/);
const mediaKey = z.string().regex(/^gallery\/[a-z0-9-]{1,80}\.[a-z]{2,4}$/);
const unit = z.number().min(0).max(1);
const box = z
  .object({ x: unit, y: unit, w: unit.refine((n) => n > 0), h: unit.refine((n) => n > 0) })
  .refine((b) => b.x + b.w <= 1.0001 && b.y + b.h <= 1.0001, 'photos.err.box_off');

const guard = () => import('../auth/guard.server');
const server = () => import('./whois.server');

async function member(t: string) {
  const m = await (await guard()).requireMember(t);
  return { account: m.user.id, name: m.user.name, role: m.role };
}

/** The next few pictures for the reader, skipping `seen` (what this visit showed already). A POST: `seen` can be long. */
export const getWhoRound = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, seen: z.array(mediaKey).max(200) }))
  .handler(async ({ data }): Promise<WhoRound> => (await server()).round(data.tree, await member(data.tree), data.seen));

export const whoRoundQuery = (t: string, seen: readonly string[] = [], round = 0) =>
  queryOptions({ queryKey: ['whois', t, round], queryFn: () => getWhoRound({ data: { tree: t, seen: [...seen] } }), staleTime: 60_000 });

export const answerWho = createServerFn({ method: 'POST' })
  .validator(z.object({
    tree,
    answer: z.discriminatedUnion('verdict', [
      z.object({ key: mediaKey, verdict: z.literal('named'), person: z.string().min(1).max(120), box: box.nullable() }),
      z.object({ key: mediaKey, verdict: z.enum(['unknown', 'skip']) }),
    ]),
  }))
  .handler(async ({ data }): Promise<WhoOutcome> => (await server()).answer(data.tree, await member(data.tree), data.answer));

export const decideWho = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: z.number().int().positive(), accept: z.boolean() }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireCan(data.tree, 'upload-photo');
    return (await server()).decide(data.tree, { account: m.user.id, name: m.user.name, role: m.role }, data.id, data.accept);
  });
