// node --test src/lib/jobs/ai-tasks.test.ts — the background AI tasks on a private accounts database and private family files
// (never data/). Checked: off by default; the schedule (never run, daily, weekly); the background cap stops work and stays
// stopped across runs; a run resumes in batches; the outgoing request bodies (a real Anthropic adapter behind a stubbed
// fetch) never carry a private field; the originals (stories, people, houses) are never altered; a stale translation is not
// shown and is translated again; web search is refused; the arms review runs only when its fingerprint changes; the role
// checks on the real server functions (stewards only, and every member may read the translated stories).
import assert from 'node:assert/strict';
import type { AsyncLocalStorage } from 'node:async_hooks';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';
import { BATCH, CALLS_PER_DAILY_RUN, SCHEDULE_GAP_MS, capMicros, isDue, saveSchema, type SaveInput } from '../ai/background.ts';
import { can } from '../roles.ts';
import type { AiAdapter, AiReply, AiRequest } from '../ai/adapters.ts';

const dir = mkdtempSync(join(tmpdir(), 'kindred-ai-tasks-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_SECRET = 'ai-tasks-test-secret';
delete process.env.KINDRED_AI_FAKE;
// No test reaches a provider: any request that is not stubbed (stubFetch below) fails here instead of going out.
globalThis.fetch = (async () => { throw new Error('a test tried to reach the network'); }) as typeof fetch;

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { openSqlite, closeAccounts } = await load<typeof import('../store/node.ts')>('/src/lib/store/node.ts');
const { store } = await load<typeof import('../store/index.ts')>('/src/lib/store/index.ts');
const { startSession } = await load<typeof import('../auth/session.server.ts')>('/src/lib/auth/session.server.ts');
const { newUser, upsertMembership, accounts } = await load<typeof import('../auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const bg = await load<typeof import('../ai/background.server.ts')>('/src/lib/ai/background.server.ts');
const fns = await load<typeof import('../ai/background.functions.ts')>('/src/lib/ai/background.functions.ts');
const { pending, storyTranslations } = await load<typeof import('../ai/background-tasks.server.ts')>('/src/lib/ai/background-tasks.server.ts');
const { setUpFamilyAi } = await load<typeof import('../ai/testing.server.ts')>('/src/lib/ai/testing.server.ts');
const { AiError } = await load<typeof import('../ai/adapters.ts')>('/src/lib/ai/adapters.ts');

// TanStack Start keeps each request in two AsyncLocalStorage stores; the server functions need them (see house-meaning.test.ts).
type Store<T> = AsyncLocalStorage<T>;
const registry = globalThis as unknown as Record<symbol, Store<unknown> | undefined>;
await load<unknown>('@tanstack/react-start/server');
const events = registry[Symbol.for('tanstack-start:event-storage')] as Store<{ request: Request; requestUrl: URL }>;
const contexts = registry[Symbol.for('tanstack-start:start-storage-context')] as Store<{ startOptions: object }>;

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

const NOW = new Date('2026-11-08T06:00:00Z');
const PRICE = { inPerM: 1, outPerM: 1, searchEach: 0 };
const ARMS = { field: 'gules', division: 'plain', charge: 'none', chargeTincture: 'or' };
const MEANING = (id: string, root: string, meaning: string, chosen: boolean) => ({
  id, language: 'German', root, meaning, attestation: 'well-attested', ideas: [{ kind: 'quality', idea: 'honour' }], chosen,
});

/** A family file with a house (arms and chosen meanings), people with occupations, a private field, and two stories. */
function makeFamily(id: string, { meanings = true }: { meanings?: boolean } = {}): void {
  const d = openSqlite(join(dir, `${id}.db`), 'tree', { create: true });
  d.exec(`
    INSERT INTO meta (key, value) VALUES ('id', '${id}'), ('name', 'Family ${id}'), ('tagline', ''), ('theme', 'codex'), ('focus', 'ada');
    INSERT INTO house (id, name, arms) VALUES ('h1', 'House Heer', '${JSON.stringify(ARMS)}');
    INSERT INTO person (id, given, house, occupation, living) VALUES
      ('ada', 'Ada', 'h1', 'Scherenschleifer', 1),
      ('bo', 'Bo', NULL, 'Zinngießer', 1),
      ('cy', 'Cy', NULL, 'Pfeifenmacher', 1),
      ('di', 'Di', NULL, 'Brunnenbauer', 1),
      ('ed', 'Ed', NULL, 'Lohgerber', 1),
      ('fi', 'Fi', NULL, 'Ziegelbrenner', 1);
    INSERT INTO person_field (id, person, type, label, value, ord, visibility) VALUES ('pf1', 'ada', 'phone', 'Mobile', '{"value":"SECRET-PHONE-0123"}', 0, 'editors');
    INSERT INTO person_field (id, person, type, label, value, ord, visibility, owner) VALUES ('pf2', 'ada', 'notes', '', '{"text":"SECRET-PERSONAL-NOTE"}', 1, 'personal', 'author-1');
    INSERT INTO story (id, person, kind, title, body, author, at, context) VALUES
      ('s1', 'ada', 'memory', 'The workshop', 'We mended kettles on Sundays.', 'Ada', '2026-01-01T10:00:00Z', NULL),
      ('s2', 'bo', 'quote', NULL, '"Mind the kettle, it is hot."', 'Bo', '2026-01-02T10:00:00Z', 'At the fair');
  `);
  if (meanings) {
    d.exec(`INSERT INTO house_meaning (house, name, family_words, meanings, web_searched, note, saved_at, saved_by) VALUES
      ('h1', 'Heer', 'We kept an estate.', '${JSON.stringify([MEANING('m1', 'heer', 'lord, gentleman', true), MEANING('m2', 'hehr', 'noble', false)])}', 0, '', ${NOW.getTime()}, 'steward-1')`);
  }
  d.close();
}

/** The family's AI as set up: the Anthropic key, the assistant on Anthropic, a monthly budget, and the features on. */
async function setupAi(tree: string, monthlyMicros = 1_000_000): Promise<void> {
  await setUpFamilyAi(tree, null, {
    provider: 'anthropic', model: '', apiKey: 'sk-test-key-123', features: { assistant: true, faces: false, avatar: false, arms: true },
    webSearch: false, monthlyMicros, customPrices: {},
  });
}

const input = (over: Partial<SaveInput> & { on?: Array<'arms' | 'occupations' | 'chronicle'> } = {}): SaveInput => {
  const schedule = () => ({ schedule: 'daily' as const });
  return {
    tasks: { arms: schedule(), occupations: schedule(), chronicle: schedule(), names: schedule() },
    capShare: over.capShare ?? 0.2,
    languages: over.languages ?? ['en'],
    locale: 'en',
  };
};

/** The steward's background settings, as the page saves them, and each task's switch as the routes table sets it. */
async function setBackground(tree: string, o: Parameters<typeof input>[0] = {}): Promise<void> {
  await bg.saveBackground(tree, 'steward-1', input(o));
  const on = o?.on ?? [];
  for (const task of ['arms', 'occupations', 'chronicle'] as const) await bg.setTaskEnabled(tree, task, on.includes(task));
}

/** A stub provider: answers each task's question, records every request, and can report a cost per call. */
function stubProvider(reportedUsd?: number) {
  const requests: AiRequest[] = [];
  const adapter: AiAdapter = {
    provider: 'anthropic',
    model: 'claude-haiku-5-5',
    async complete(req: AiRequest): Promise<AiReply> {
      requests.push(req);
      const user = [...req.messages].reverse().map((m) => (m.role === 'user' ? m.text : '')).find((t) => !!t) ?? '';
      const json = req.json?.name === 'occupation' ? { label: `EN ${user}` }
        : req.json?.name === 'story_translation' ? { same: false, title: '', body: `EN ${user}` }
        : req.json?.name === 'house_meanings_translation' ? { same: true, note: '', meanings: [] }
        : req.json?.name === 'arms_fit' ? { verdict: 'partly', reason: 'Only courage is spoken for.', advice: 'Add a charge for the trade.' }
        : undefined;
      if (!json) throw new AiError('bad-output', 'no answer');
      return { text: '', calls: [], json, tokens: 20, inputTokens: 10, outputTokens: 10, searches: 0, ...(reportedUsd !== undefined ? { reportedCostUsd: reportedUsd } : {}) };
    },
  };
  return { adapter, requests };
}

/** A fetch stub for the real Anthropic adapter: records each request body, answers each question. */
function stubFetch() {
  const original = globalThis.fetch;
  const bodies: string[] = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const text = String(init?.body ?? '');
    bodies.push(text);
    const body = JSON.parse(text) as { system?: string; tools?: { name: string }[] };
    const system = body.system ?? '';
    const answer = system.includes('translate one occupation') ? { label: 'EN occupation' }
      : system.includes('translate one story') ? { same: false, title: '', body: 'EN story' }
      : system.includes('where a surname may come from') ? { same: true, note: '', meanings: [] }
      : { verdict: 'partly', reason: 'Only courage.', advice: 'Add a trade charge.' };
    const toolName = body.tools?.[0]?.name;
    const content = [{ type: 'text', text: JSON.stringify(answer) }, ...(toolName ? [{ type: 'tool_use', id: 'tu1', name: toolName, input: answer }] : [])];
    return new Response(JSON.stringify({ content, stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { bodies, restore: () => { globalThis.fetch = original; } };
}

/** Every row a task may change, as text, to prove the originals stayed as they were. */
function originals(tree: string): string {
  const d = openSqlite(join(dir, `${tree}.db`), 'tree');
  const rows = ['SELECT * FROM story ORDER BY id', 'SELECT * FROM person ORDER BY id', 'SELECT * FROM house ORDER BY id', 'SELECT * FROM person_field ORDER BY id'].map((q) => JSON.stringify(d.prepare(q).all()));
  d.close();
  return rows.join('\n');
}

const translationCount = (tree: string) => {
  const d = openSqlite(join(dir, `${tree}.db`), 'tree');
  const n = (d.prepare('SELECT COUNT(*) AS n FROM story_translation').get() as { n: number }).n;
  d.close();
  return n;
};

// ---------- the schedule and the cap, as pure rules ----------

test('a task that has never run is due; a daily one is due again after about a day, a weekly one after about a week', () => {
  assert.equal(isDue(null, 'daily', NOW.getTime()), true);
  assert.equal(isDue(NOW.getTime() - 3_600_000, 'daily', NOW.getTime()), false, 'an hour later is not due');
  assert.equal(isDue(NOW.getTime() - SCHEDULE_GAP_MS.daily, 'daily', NOW.getTime()), true);
  assert.equal(isDue(NOW.getTime() - 2 * 86_400_000, 'weekly', NOW.getTime()), false, 'two days later a weekly task waits');
  assert.equal(isDue(NOW.getTime() - 7 * 86_400_000, 'weekly', NOW.getTime()), true);
});

test('the cap is a share of the monthly budget, rounded down; the settings accept 5% to 100% and the known languages only', () => {
  assert.equal(capMicros(5_000_000, 0.2), 1_000_000);
  assert.equal(capMicros(1_000_001, 0.5), 500_000);
  assert.equal(saveSchema.safeParse({ ...input(), capShare: 0.01 }).success, false, 'below 5% is refused');
  assert.equal(saveSchema.safeParse({ ...input(), capShare: 1.5 }).success, false);
  assert.equal(saveSchema.safeParse({ ...input(), languages: ['xx'] as never }).success, false, 'an unknown language is refused');
  assert.equal(saveSchema.safeParse(input({ capShare: 0.2 })).success, true);
});

// ---------- off by default ----------

test('off by default: nothing runs and no call is made until a steward switches a task on', async () => {
  const tree = 'off-default';
  makeFamily(tree);
  await setupAi(tree);
  const stub = stubProvider();
  const settings = await bg.readBackground(tree);
  assert.equal(settings.tasks.arms.enabled, false);
  assert.equal(settings.tasks.occupations.enabled, false);
  assert.equal(settings.tasks.chronicle.enabled, false);
  await bg.runScheduled([tree], NOW, () => {});
  assert.equal((await bg.runTask(tree, 'occupations', { adapter: stub.adapter, price: PRICE })).status, 'skipped');
  assert.equal(stub.requests.length, 0);
  assert.equal(translationCount(tree), 0);
});

// ---------- the batches, the cap, and resuming ----------

test('a run does one batch and the next run resumes where it stopped', async () => {
  const tree = 'batches';
  makeFamily(tree);
  await setupAi(tree);
  // Two stories in three languages make six items: more than one batch of BATCH (4).
  await setBackground(tree, { on: ['chronicle'], languages: ['en', 'de', 'af'], capShare: 1 });
  const stub = stubProvider();
  const first = await bg.runTask(tree, 'chronicle', { adapter: stub.adapter, price: PRICE, source: 'manual', now: NOW });
  assert.equal(first.status, 'done');
  assert.equal(first.done, BATCH, 'one batch of items, not all of them');
  assert.equal(first.waiting, 6 - BATCH, 'the rest waits for the next run');
  const second = await bg.runTask(tree, 'chronicle', { adapter: stub.adapter, price: PRICE, source: 'manual', now: NOW });
  assert.equal(second.done, 6 - BATCH);
  assert.equal(second.waiting, 0);
  assert.equal(stub.requests.length, 6, 'each item is one call, and none is made twice');
  const third = await bg.runTask(tree, 'chronicle', { adapter: stub.adapter, price: PRICE, source: 'manual', now: NOW });
  assert.equal(third.status, 'idle', 'nothing is left to translate');
  assert.equal(stub.requests.length, 6);
});

test('the background cap stops the work, stays stopped on the next run, and the whole budget still counts it', async () => {
  const tree = 'cap';
  makeFamily(tree, { meanings: false });
  await setupAi(tree, 1_000_000);
  // A fifth of $1 is $0.05 for background work; each call reports $0.03, so the second call is the last one that fits.
  await setBackground(tree, { on: ['occupations'], languages: ['en'], capShare: 0.05 });
  const stub = stubProvider(0.03);
  const out = await bg.runTask(tree, 'occupations', { adapter: stub.adapter, price: PRICE, source: 'manual', now: NOW });
  assert.equal(out.status, 'stopped');
  assert.equal(out.calls, 2, 'two calls fit under the cap, the third is refused before it is sent');
  assert.equal(stub.requests.length, 2);
  assert.match(out.note, /share|budget|month/i);
  const again = await bg.runTask(tree, 'occupations', { adapter: stub.adapter, price: PRICE, source: 'manual', now: NOW });
  assert.equal(again.status, 'stopped', 'the cap is still used up on the next run');
  assert.equal(stub.requests.length, 2, 'no call is made past the cap');
  const spent = (await accounts().get<{ micros: number }>('SELECT micros FROM ai_background_spend WHERE tree = ?', tree))?.micros ?? 0;
  assert.ok(spent >= 50_000 && spent <= 60_000 + 1_000, `background spend is booked (${spent} micro-dollars)`);
  const total = (await accounts().get<{ micros: number }>('SELECT micros FROM ai_spend WHERE tree = ?', tree))?.micros ?? 0;
  assert.ok(total >= spent, 'the whole budget books background calls too');
});

test('a budget of nothing stops the task before any call (AI off means background off)', async () => {
  const tree = 'no-budget';
  makeFamily(tree);
  await setupAi(tree, 0);
  await setBackground(tree, { on: ['occupations'] });
  const stub = stubProvider();
  const out = await bg.runTask(tree, 'occupations', { adapter: stub.adapter, price: PRICE, source: 'manual' });
  assert.equal(out.status, 'skipped');
  assert.equal(out.note, 'budget-off');
  assert.equal(stub.requests.length, 0);
});

// ---------- what goes out, and what stays as it was ----------

test('no private field is sent: the outgoing bodies of all three tasks, from a real adapter behind a stubbed fetch', async () => {
  const tree = 'private';
  makeFamily(tree);
  await setupAi(tree, 5_000_000);
  await setBackground(tree, { on: ['arms', 'occupations', 'chronicle'], languages: ['en'], capShare: 1 });
  const before = originals(tree);
  const fetched = stubFetch();
  try {
    await bg.runScheduled([tree], NOW, () => {});
  } finally {
    fetched.restore();
  }
  assert.ok(fetched.bodies.length >= 3, 'every task sent something');
  assert.ok(fetched.bodies.some((b) => b.includes('Brunnenbauer')), 'an occupation was sent');
  assert.ok(fetched.bodies.some((b) => b.includes('We mended kettles')), 'a story was sent');
  assert.ok(fetched.bodies.some((b) => b.includes('House Heer') || b.includes('lord, gentleman')), 'the arms review was sent');
  for (const body of fetched.bodies) assert.ok(!body.includes('SECRET-PHONE-0123'), 'a private field never leaves the server');
  for (const body of fetched.bodies) assert.ok(!body.includes('SECRET-PERSONAL-NOTE'), 'a personal field never leaves the server');
  assert.equal(originals(tree), before, 'the originals are not altered');
});

test('the originals are never altered: the story, person and house rows are the same after the tasks, and translations sit beside them', async () => {
  const tree = 'originals';
  makeFamily(tree);
  await setupAi(tree);
  await setBackground(tree, { on: ['chronicle', 'occupations'], languages: ['de', 'en'] });
  const before = originals(tree);
  const stub = stubProvider();
  await bg.runTask(tree, 'chronicle', { adapter: stub.adapter, price: PRICE, source: 'manual', now: NOW });
  await bg.runTask(tree, 'chronicle', { adapter: stub.adapter, price: PRICE, source: 'manual', now: NOW });
  await bg.runTask(tree, 'occupations', { adapter: stub.adapter, price: PRICE, source: 'manual', now: NOW });
  assert.equal(originals(tree), before);
  assert.ok(translationCount(tree) > 0, 'the translations are stored');
  const shown = await storyTranslations(tree, 'de');
  assert.match(shown.s1?.body ?? '', /^EN [\s\S]*We mended kettles on Sundays\.$/, 'the reader gets the translation of the story');
});

test('a story edited after it was translated is shown in its original text until it is translated again', async () => {
  const tree = 'stale';
  makeFamily(tree);
  await setupAi(tree);
  await setBackground(tree, { on: ['chronicle'], languages: ['en'], capShare: 1 });
  const stub = stubProvider();
  await bg.runTask(tree, 'chronicle', { adapter: stub.adapter, price: PRICE, source: 'manual', now: NOW });
  assert.ok((await storyTranslations(tree, 'en')).s1, 'translated');
  const d = openSqlite(join(dir, `${tree}.db`), 'tree');
  d.exec("UPDATE story SET body = 'We mended kettles on Saturdays now.' WHERE id = 's1'");
  d.close();
  assert.equal((await storyTranslations(tree, 'en')).s1, undefined, 'the stale translation is not shown');
  assert.equal((await pending(tree, 'chronicle', ['en'])).length, 1, 'and the edited story is waiting again');
  await bg.runTask(tree, 'chronicle', { adapter: stub.adapter, price: PRICE, source: 'manual', now: NOW });
  assert.match((await storyTranslations(tree, 'en')).s1?.body ?? '', /Saturdays now\.$/, 'the new text is translated and shown');
});

test('web search is refused: a background call that asks for it is not sent', async () => {
  const tree = 'no-search';
  makeFamily(tree);
  await setupAi(tree);
  const stub = stubProvider();
  const adapter = bg.backgroundAdapter(tree, stub.adapter, { monthlyMicros: 1_000_000, capMicros: 500_000, price: PRICE, c: (k) => k, meter: { micros: 0 } });
  await assert.rejects(adapter.complete({ system: 'x', messages: [{ role: 'user', text: 'x' }], webSearch: { maxUses: 2 } }), (e: unknown) => e instanceof AiError && e.code === 'bad-input');
  assert.equal(stub.requests.length, 0);
});

// ---------- the arms review, only when its fingerprint changed ----------

test('the arms review runs once per fingerprint: nothing is asked again until the arms or the chosen meanings change', async () => {
  const tree = 'arms';
  makeFamily(tree);
  await setupAi(tree);
  await setBackground(tree, { on: ['arms'], capShare: 1 });
  const stub = stubProvider();
  const first = await bg.runTask(tree, 'arms', { adapter: stub.adapter, price: PRICE, source: 'manual', now: NOW });
  assert.equal(first.status, 'done');
  assert.equal(stub.requests.length, 1);
  assert.equal(stub.requests[0].json?.name, 'arms_fit');
  const second = await bg.runTask(tree, 'arms', { adapter: stub.adapter, price: PRICE, source: 'manual', now: NOW });
  assert.equal(second.status, 'idle', 'the same arms and meanings are not asked again');
  assert.equal(stub.requests.length, 1);
  const waiting = await bg.activity(tree, NOW);
  assert.equal(waiting.waiting.length, 0, 'a "partly" is a quiet idea: nothing waits for a steward');
  assert.equal(await bg.attention(tree, NOW), 0);
  const d = openSqlite(join(dir, `${tree}.db`), 'tree');
  d.exec("UPDATE house_arms_review SET verdict = 'reconsider' WHERE house = 'h1'");
  const flagged = await bg.activity(tree, NOW);
  assert.equal(flagged.waiting.length, 1, 'a real problem waits for a steward');
  assert.equal(flagged.waiting[0].verdict, 'reconsider');
  d.exec("UPDATE house SET arms = '{\"field\":\"azure\",\"division\":\"plain\",\"charge\":\"none\",\"chargeTincture\":\"or\"}' WHERE id = 'h1'");
  d.close();
  const third = await bg.runTask(tree, 'arms', { adapter: stub.adapter, price: PRICE, source: 'manual', now: NOW });
  assert.equal(third.status, 'done', 'changed arms are checked again');
  assert.equal(stub.requests.length, 2);
});

// ---------- the schedule, through the daily run ----------

test('the daily run skips a task that ran today, and runs it again once it is due', async () => {
  const tree = 'scheduled';
  makeFamily(tree, { meanings: false });
  await setupAi(tree);
  await setBackground(tree, { on: ['occupations'], capShare: 1 });
  const stub = stubProvider();
  const runAt = (now: Date) => bg.runTask(tree, 'occupations', { adapter: stub.adapter, price: PRICE, source: 'schedule', now });
  const day1 = new Date(NOW);
  await runAt(day1);
  assert.equal(stub.requests.length, BATCH, 'the first day does one batch of the six occupations');
  // The daily run itself checks due-ness, through the family's own adapter: the fetch stub counts what it sends.
  const fetched = stubFetch();
  try {
    await bg.runScheduled([tree], new Date(day1.getTime() + 3_600_000), () => {});
    assert.equal(fetched.bodies.length, 0, 'a task that ran this morning is not run again');
    await bg.runScheduled([tree], new Date(day1.getTime() + 2 * 86_400_000), () => {});
    assert.equal(fetched.bodies.length, 6 - BATCH, 'the next run resumes with what is left');
    await bg.runScheduled([tree], new Date(day1.getTime() + 4 * 86_400_000), () => {});
    assert.equal(fetched.bodies.length, 6 - BATCH, 'nothing is left to do, so later runs are quiet');
  } finally {
    fetched.restore();
  }
});

test('the daily run makes at most its call limit across families and tasks; the rest waits for the next day', async () => {
  const trees = ['limit-a', 'limit-b'];
  for (const t of trees) {
    makeFamily(t);
    await setupAi(t);
    await setBackground(t, { on: ['occupations', 'chronicle', 'arms'], languages: ['en', 'de', 'af'], capShare: 1 });
  }
  const fetched = stubFetch();
  try {
    await bg.runScheduled(trees, NOW, () => {});
  } finally {
    fetched.restore();
  }
  assert.ok(fetched.bodies.length <= CALLS_PER_DAILY_RUN, `at most ${CALLS_PER_DAILY_RUN} calls, made ${fetched.bodies.length}`);
  assert.ok(fetched.bodies.length > 0);
  assert.ok(BATCH <= CALLS_PER_DAILY_RUN);
});

test('the daily call ceiling counts calls: retries cannot pass it, and a retry never takes a later item’s first attempt', async () => {
  const tree = 'limit-calls';
  makeFamily(tree);
  await setupAi(tree);
  const make = (left: number, owed: number) => {
    const room = { left, owed, item: 0 };
    const requests: number[] = [];
    const inner: AiAdapter = { provider: 'anthropic', model: 'claude-haiku-5-5', async complete() { requests.push(1); return { text: 'x', calls: [], tokens: 2, inputTokens: 1, outputTokens: 1, searches: 0 }; } };
    const adapter = bg.backgroundAdapter(tree, inner, { monthlyMicros: 1_000_000, capMicros: 500_000, price: PRICE, c: (k) => k, meter: { micros: 0 }, room });
    return { room, requests, adapter };
  };
  const ask = (a: AiAdapter) => a.complete({ system: 'x', messages: [{ role: 'user', text: 'x' }] });
  const refused = (e: unknown) => e instanceof AiError && e.code === 'budget';

  // One call of room: the first attempt goes, the retry of the same item does not.
  const one = make(1, 0);
  await ask(one.adapter);
  await assert.rejects(ask(one.adapter), refused);
  assert.equal(one.requests.length, 1);
  assert.equal(one.room.left, 0);

  // Two calls of room, one later item still owed its first attempt: the retry is refused, the later item's first attempt is not.
  const two = make(2, 1);
  await ask(two.adapter);
  await assert.rejects(ask(two.adapter), refused);
  two.room.item = 0;
  two.room.owed = 0;
  await ask(two.adapter);
  assert.equal(two.requests.length, 2);
  assert.equal(two.room.left, 0);
});

// ---------- the role checks, on the real server functions ----------

async function memberWith(tree: string, role: 'viewer' | 'contributor' | 'editor' | 'steward') {
  const { user, insert } = newUser(role, null);
  await store.accounts().batch([insert, upsertMembership(user.id, tree, role)]);
  const set = await startSession(new Request('http://localhost:4791/'), user.id);
  return set.split(';')[0];
}

function asReader<T>(cookie: string | undefined, call: () => Promise<T>): Promise<T> {
  const request = new Request('http://localhost:4791/', { headers: cookie ? { cookie } : {} });
  return events.run({ request, requestUrl: new URL(request.url) }, () => contexts.run({ startOptions: {} }, call));
}

test('role checks: only a steward sees the activity, runs a task or saves the settings; every member reads the translated stories', async () => {
  const tree = 'roles';
  makeFamily(tree);
  await setupAi(tree);
  await setBackground(tree, { on: ['occupations'] });
  const viewer = await memberWith(tree, 'viewer');
  const editor = await memberWith(tree, 'editor');
  const steward = await memberWith(tree, 'steward');
  const status = (e: unknown) => (e as { status?: number }).status;
  for (const cookie of [viewer, editor]) {
    await assert.rejects(asReader(cookie, () => fns.aiActivity({ data: { tree } })), (e: unknown) => status(e) === 403);
    await assert.rejects(asReader(cookie, () => fns.aiRunTask({ data: { tree, task: 'occupations' } })), (e: unknown) => status(e) === 403);
    await assert.rejects(asReader(cookie, () => fns.aiSaveBackground({ data: { tree, input: input() } })), (e: unknown) => status(e) === 403);
  }
  await assert.rejects(asReader(undefined, () => fns.aiActivity({ data: { tree } })), (e: unknown) => status(e) === 401);
  assert.deepEqual(await asReader(viewer, () => fns.aiAttention({ data: { tree } })), { access: 0, ai: 0 }, 'a viewer gets no badge');
  assert.equal((await asReader(steward, () => fns.aiActivity({ data: { tree } }))).tasks.length, 4, 'a steward sees the four tasks');
  assert.ok(await asReader(viewer, () => fns.storyTranslations({ data: { tree, locale: 'en' } })) !== undefined, 'a viewer reads the translated stories');
  assert.equal(can('viewer', 'manage-access'), false);
  assert.equal(can('editor', 'manage-access'), false);
  assert.equal(can('steward', 'manage-access'), true);
});

test('the server functions run a task for a steward and report what it did', async () => {
  const tree = 'roles-run';
  makeFamily(tree);
  await setupAi(tree);
  await setBackground(tree, { on: ['arms'], capShare: 1 });
  const steward = await memberWith(tree, 'steward');
  // The fake-free path needs a real adapter: this family's saved key goes to the stubbed fetch.
  const fetched = stubFetch();
  try {
    const out = await asReader(steward, () => fns.aiRunTask({ data: { tree, task: 'arms' } }));
    assert.equal(out.status, 'done');
    assert.equal(out.done, 1);
  } finally {
    fetched.restore();
  }
  const runs = await asReader(steward, () => fns.aiActivity({ data: { tree } }));
  assert.equal(runs.runs[0]?.source, 'manual');
  assert.equal(runs.runs[0]?.status, 'done');
});

// ---------- nothing to do means nothing happens ----------

type Quiet = { task: 'arms' | 'occupations' | 'chronicle' | 'names'; meanings: boolean; languages: Array<'en' | 'de' | 'af'>; appear: (tree: string) => Promise<void> };
const QUIET: Quiet[] = [
  // Arms: no chosen meaning, so no house is checked. Work appears when a meaning is chosen.
  { task: 'arms', meanings: false, languages: ['en'], appear: async (tree) => {
    const d = openSqlite(join(dir, `${tree}.db`), 'tree');
    d.exec(`INSERT INTO house_meaning (house, name, family_words, meanings, web_searched, note, saved_at, saved_by) VALUES
      ('h1', 'Heer', '', '${JSON.stringify([MEANING('m1', 'heer', 'lord', true)])}', 0, '', ${NOW.getTime()}, 'steward-1')`);
    d.close();
  } },
  // Occupations and the chronicle: no language is chosen, so there is nothing to translate into.
  { task: 'occupations', meanings: true, languages: [], appear: async (tree) => { await bg.saveBackground(tree, 'steward-1', input({ languages: ['en'] })); } },
  { task: 'chronicle', meanings: true, languages: [], appear: async (tree) => { await bg.saveBackground(tree, 'steward-1', input({ languages: ['en'] })); } },
  // Names: the only house already has a row. Work appears with a new house.
  { task: 'names', meanings: true, languages: ['en'], appear: async (tree) => {
    const d = openSqlite(join(dir, `${tree}.db`), 'tree');
    d.exec(`INSERT INTO house (id, name, arms) VALUES ('h2', 'House Neumann', '${JSON.stringify(ARMS)}')`);
    d.close();
  } },
];

for (const q of QUIET) {
  test(`${q.task}: with nothing to do, no call, no key, no reservation and no run entry; work that appears later is done`, async () => {
    const tree = `quiet-${q.task}`;
    makeFamily(tree, { meanings: q.meanings });
    // No AI is set up at all: a task with nothing to do must not even notice, so its answer is "nothing", not "not set up".
    await bg.saveBackground(tree, 'steward-1', input({ languages: q.languages }));
    await bg.setTaskEnabled(tree, q.task, true);
    const stub = stubProvider();
    const fetched = stubFetch();
    const counts = async () => {
      const a = accounts();
      return {
        runs: (await a.get<{ n: number }>('SELECT COUNT(*) AS n FROM ai_task_run WHERE tree = ?', tree))!.n,
        background: (await a.get<{ n: number }>('SELECT COUNT(*) AS n FROM ai_background_spend WHERE tree = ?', tree))!.n,
        total: (await a.get<{ n: number }>('SELECT COUNT(*) AS n FROM ai_spend WHERE tree = ?', tree))!.n,
      };
    };
    try {
      // Run now: said plainly, nothing recorded, and not marked as run.
      const manual = await bg.runTask(tree, q.task, { adapter: stub.adapter, price: PRICE, source: 'manual', now: NOW });
      assert.equal(manual.status, 'idle');
      assert.deepEqual(await counts(), { runs: 0, background: 0, total: 0 });
      assert.equal((await bg.readBackground(tree)).tasks[q.task].lastStarted, null, 'an idle check is not a run');
      // The schedule: it looks, finds nothing and notes only that it looked.
      await bg.runScheduled([tree], NOW, () => {});
      assert.deepEqual(await counts(), { runs: 0, background: 0, total: 0 });
      const looked = (await bg.readBackground(tree)).tasks[q.task];
      assert.equal(looked.lastStarted, null);
      assert.equal(looked.lastChecked, NOW.getTime());
      const idle = await bg.activity(tree, NOW);
      assert.equal(idle.runs.length, 0, 'the steward’s history shows nothing');
      assert.equal(idle.tasks.find((t) => t.task === q.task)?.waiting, 0);
      assert.equal(stub.requests.length + fetched.bodies.length, 0);

      // Work appears. The task is not asked again before its next scheduled time ...
      await setupAi(tree);
      await q.appear(tree);
      const soon = new Date(NOW.getTime() + 3_600_000);
      await bg.runScheduled([tree], soon, () => {});
      assert.equal(fetched.bodies.length, 0, 'an hour later it is not due yet');
      assert.deepEqual(await counts(), { runs: 0, background: 0, total: 0 });
      // ... and then it does the work, with a run entry this time.
      const next = new Date(NOW.getTime() + SCHEDULE_GAP_MS.daily);
      await bg.runScheduled([tree], next, () => {});
      assert.ok(fetched.bodies.length > 0, 'the work was done at the next scheduled time');
      const after = await counts();
      assert.equal(after.runs, 1);
      assert.ok((await bg.readBackground(tree)).tasks[q.task].lastStarted !== null);
    } finally {
      fetched.restore();
    }
  });
}

test('an item that keeps failing for its own reason is left alone after a few tries, until it changes', async () => {
  const tree = 'giveup';
  makeFamily(tree);
  await setupAi(tree);
  await setBackground(tree, { on: ['occupations'], languages: ['en'], capShare: 1 });
  const broken: AiAdapter = { provider: 'anthropic', model: 'claude-haiku-5-5', async complete() { throw new AiError('bad-output', 'no answer'); } };
  for (let i = 0; i < 6; i++) await bg.runTask(tree, 'occupations', { adapter: broken, price: PRICE, source: 'manual', now: NOW });
  assert.equal((await pending(tree, 'occupations', ['en'])).length, 0, 'texts that cannot be answered stop waiting after three tries');
  const stub = stubProvider();
  assert.equal((await bg.runTask(tree, 'occupations', { adapter: stub.adapter, price: PRICE, source: 'manual', now: NOW })).status, 'idle');
  assert.equal(stub.requests.length, 0);
  const d = openSqlite(join(dir, `${tree}.db`), 'tree');
  d.exec("UPDATE person SET occupation = 'Kupferschmied' WHERE id = 'ada'");
  d.close();
  assert.equal((await pending(tree, 'occupations', ['en'])).length, 1, 'a changed text is a new item');
});
