// node --test src/lib/ai-limits.test.ts — a provider's structured output drops maxItems/maxLength/number bounds, so the model never
// sees them. An answer a little over a limit is trimmed, not refused; ids, enums and required fields are still checked. And the
// daily run's fair turn: every due task of every family gets a share of the 8 calls, and the first turn rotates by day.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-ai-limits-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_SECRET = 'ai-limits-test-secret';
delete process.env.KINDRED_AI_FAKE;

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const arms = await load<typeof import('./ai/arms.server.ts')>('/src/lib/ai/arms.server.ts');
const { fitReply } = await load<typeof import('./ai/arms-fit.server.ts')>('/src/lib/ai/arms-fit.server.ts');
const { storyReply } = await load<typeof import('./ai/background-tasks.server.ts')>('/src/lib/ai/background-tasks.server.ts');
const { faceResultSchema } = await load<typeof import('./ai/types.ts')>('/src/lib/ai/types.ts');
const { translation } = await load<typeof import('./occupations.translate.ts')>('/src/lib/occupations.translate.ts');
const { rotated, turnLimit } = await load<typeof import('./ai/background.server.ts')>('/src/lib/ai/background.server.ts');
const { CALLS_PER_NAME, CALLS_PER_DAILY_RUN } = await load<typeof import('./ai/background.ts')>('/src/lib/ai/background.ts');

test.after(async () => {
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

const stub = (json: unknown) => ({
  provider: 'anthropic' as const,
  model: 'stub',
  async complete() {
    return { text: '', calls: [], json, tokens: 50, inputTokens: 30, outputTokens: 20, searches: 0 };
  },
}) as never;

const MEANINGS = [{ id: 'm1', language: 'Dutch', root: 'heer', meaning: 'lord', attestation: 'well-attested' as const, ideas: [] }];
const long = (n: number) => 'x'.repeat(n);
const design = (extra: object = {}) => ({
  explanation: long(300), meaningId: 'm1', field: ['azure', 'or', 'gules', 'vert'], element: long(90),
  charges: [{ charge: 'lion', tincture: 'or', count: 14 }],
  symbolism: Array(9).fill({ element: long(90), why: long(300) }), ...extra,
});

test('designArms: an over-long answer is trimmed and succeeds', async () => {
  const out = await arms.designArms({ adapter: stub({ suggestions: Array(12).fill(0).map(() => design()) }), surname: 'Heer', meanings: MEANINGS, locale: 'en' });
  assert.ok(out.length >= 3 && out.length <= 5);
  assert.ok(out.every((d) => d.explanation.length <= 200 && (d.symbolism?.length ?? 0) <= 6));
});

test('designArms: a missing explanation is still refused', async () => {
  await assert.rejects(arms.designArms({ adapter: stub({ suggestions: Array(4).fill(design({ explanation: '' })) }), surname: 'Heer', meanings: MEANINGS, locale: 'en' }));
});

test('reviseArms: over-long refinements and designs are trimmed and succeed', async () => {
  const refinement = { meaningId: 'm1', explanation: long(300), charges: [{ charge: 'key' }, { charge: 'tower' }, { charge: 'rose' }], symbolism: Array(7).fill({ element: 'e', why: 'w' }) };
  const out = await arms.reviseArms({
    adapter: stub({ refinements: Array(11).fill(refinement), designs: Array(10).fill(0).map(() => design()) }),
    surname: 'Heer', meanings: MEANINGS, locale: 'en', feedback: { reason: 'r', advice: 'a' },
    arms: { shield: 'heater', field: { division: 'plain', tinctures: ['azure'], line: 'straight' }, layers: [{ type: 'charge', charge: 'lion', tincture: 'or', count: 1, arrangement: 'auto', on: 'field' }] },
  });
  assert.ok(out.filter((r) => r.kind === 'fresh').length >= 2);
  assert.ok(out.every((r) => r.explanation.length <= 200));
});

test('researchName: too many meanings, ideas and a long note are trimmed', async () => {
  const meaning = { language: 'Dutch', root: 'heer', meaning: 'lord', attestation: 'well-attested', ideas: Array(7).fill({ kind: 'quality', idea: 'courage' }), sources: [] };
  const out = await arms.researchName({
    adapter: stub({ meanings: Array(12).fill(0).map((_, i) => ({ ...meaning, meaning: `lord ${i}` })), note: long(900) }),
    webSearch: false, surname: 'Heer', locale: 'en',
  });
  assert.ok(out.meanings.length > 0 && out.meanings.length <= 8);
  assert.ok((out.note?.length ?? 0) <= 400);
});

test('the fit check keeps an over-long reason and advice, cut', () => {
  const r = fitReply.safeParse({ verdict: 'partly', reason: long(700), advice: long(700) });
  assert.ok(r.success);
  assert.equal(r.data.reason.length, 400);
  assert.equal(r.data.advice?.length, 400);
  assert.equal(fitReply.safeParse({ verdict: 'maybe', reason: 'x' }).success, false, 'the verdict is still checked');
});

test('the chronicle translation keeps an over-long title and body, cut', () => {
  const r = storyReply.safeParse({ same: false, title: long(260), body: long(20_500) });
  assert.ok(r.success);
  assert.equal(r.data.title.length, 200);
  assert.equal(r.data.body.length, 20_000);
});

test('faces: too many suggestions and faces are trimmed', () => {
  const face = { box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, suggestions: Array(8).fill({ personId: 'p1', confidence: 0.5, reason: long(400) }) };
  const r = faceResultSchema.safeParse({ faces: Array(45).fill(face) });
  assert.ok(r.success);
  assert.equal(r.data.faces.length, 40);
  assert.equal(r.data.faces[0].suggestions.length, 5);
  assert.equal(r.data.faces[0].suggestions[0].reason.length, 200);
  assert.equal(faceResultSchema.safeParse({ faces: [{ box: { x: 'a' }, suggestions: [] }] }).success, false, 'the box is still checked');
});

test('an occupation label past 80 characters is cut, an empty one is refused', async () => {
  const store = { get: async () => undefined, put: async () => {} };
  const got = await translation('qwertyuiop zzz', 'de', store, async () => ({ label: long(120) }));
  assert.equal(got?.label.length, 80);
  assert.equal(await translation('qwertyuiop yyy', 'de', store, async () => ({ label: '  ' })), undefined);
});

// ---------- the fair turn ----------

type Turn = { tree: string; task: 'arms' | 'occupations' | 'chronicle' | 'names' };
/** One daily run on the pure rules: who gets how many items, and how many calls each takes. */
function day(due: Turn[], by: number) {
  let left = CALLS_PER_DAILY_RUN;
  const order = rotated(due, by);
  return order.map((t, at) => {
    const limit = turnLimit(left, order.length - at, t.task);
    left -= limit * (t.task === 'names' ? CALLS_PER_NAME : 1);
    return { ...t, limit };
  });
}

test('one family with a backlog in every task: names gets its turn on the day everything is due', () => {
  const due: Turn[] = (['arms', 'occupations', 'chronicle', 'names'] as const).map((task) => ({ tree: 'seed', task }));
  for (let d = 0; d < 4; d++) {
    const turns = day(due, d);
    assert.ok(turns.every((t) => t.limit >= 1), `day ${d}: ${JSON.stringify(turns)}`);
    assert.ok(turns.reduce((n, t) => n + t.limit * (t.task === 'names' ? CALLS_PER_NAME : 1), 0) <= CALLS_PER_DAILY_RUN);
  }
});

test('many families: nobody takes all the calls, and the order rotates so every turn comes up', () => {
  const due: Turn[] = ['a', 'b', 'c', 'd', 'e'].flatMap((tree) => (['occupations', 'chronicle', 'names'] as const).map((task) => ({ tree, task })));
  const served = new Set<string>();
  for (let d = 0; d < due.length; d++) {
    const turns = day(due, d);
    assert.ok(Math.max(...turns.map((t) => t.limit)) <= 2, 'no family takes the whole run');
    assert.ok(turns.reduce((n, t) => n + t.limit * (t.task === 'names' ? CALLS_PER_NAME : 1), 0) <= CALLS_PER_DAILY_RUN, 'the total cap holds');
    for (const t of turns) if (t.limit > 0) served.add(`${t.tree}/${t.task}`);
  }
  assert.equal(served.size, due.length, 'every family and task is served within a rotation');
});

test('the total cap: nothing is left to a turn when the calls are gone', () => {
  assert.equal(turnLimit(0, 3, 'arms'), 0);
  assert.equal(turnLimit(1, 1, 'names'), 0, 'a name needs two calls');
  assert.equal(turnLimit(8, 1, 'arms'), 4, 'a lone task is still held to a batch');
});
