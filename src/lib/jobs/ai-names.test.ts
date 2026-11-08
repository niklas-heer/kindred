// node --test src/lib/jobs/ai-names.test.ts — the background task "Collect name meanings", on a private accounts database and
// private family files. Checked: only names with nothing collected or saved are picked; a run is bounded and the next one
// goes on; the budget refuses without counting against a name; a failing name does not stop the others and is given up on;
// nothing is chosen and no arms check runs until a steward chooses; only stewards read and choose; only the surname and the
// country are sent; a steward's own research keeps what was collected.
import assert from 'node:assert/strict';
import type { AsyncLocalStorage } from 'node:async_hooks';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';
import { BATCH, CALLS_PER_DAILY_RUN, CALLS_PER_NAME, type SaveInput } from '../ai/background.ts';
import { MAX_COLLECT_FAILURES, reviewBadge } from '../house-meaning.ts';
import type { AiAdapter, AiReply, AiRequest } from '../ai/adapters.ts';

const dir = mkdtempSync(join(tmpdir(), 'kindred-ai-names-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_SECRET = 'ai-names-test-secret';
delete process.env.KINDRED_AI_FAKE;
globalThis.fetch = (async () => { throw new Error('a test tried to reach the network'); }) as typeof fetch;

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { openSqlite, closeAccounts } = await load<typeof import('../store/node.ts')>('/src/lib/store/node.ts');
const { store } = await load<typeof import('../store/index.ts')>('/src/lib/store/index.ts');
const { startSession } = await load<typeof import('../auth/session.server.ts')>('/src/lib/auth/session.server.ts');
const { newUser, upsertMembership } = await load<typeof import('../auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const bg = await load<typeof import('../ai/background.server.ts')>('/src/lib/ai/background.server.ts');
const { pending } = await load<typeof import('../ai/background-tasks.server.ts')>('/src/lib/ai/background-tasks.server.ts');
const meanings = await load<typeof import('../house-meaning.server.ts')>('/src/lib/house-meaning.server.ts');
const fns = await load<typeof import('../house-meaning.functions.ts')>('/src/lib/house-meaning.functions.ts');
const { checkArms } = await load<typeof import('../ai/arms-fit.server.ts')>('/src/lib/ai/arms-fit.server.ts');
const { setUpFamilyAi } = await load<typeof import('../ai/testing.server.ts')>('/src/lib/ai/testing.server.ts');
const { AiError, makeAdapter } = await load<typeof import('../ai/adapters.ts')>('/src/lib/ai/adapters.ts');

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
const row = (id: string, chosen: boolean) => ({ id, language: 'German', root: 'heer', meaning: `lord ${id}`, attestation: 'well-attested', ideas: [], chosen });

/** A family with one house per name, a private field and a story that must never be sent. */
function makeFamily(id: string, names: string[]): void {
  const d = openSqlite(join(dir, `${id}.db`), 'tree', { create: true });
  d.exec(`INSERT INTO meta (key, value) VALUES ('id', '${id}'), ('name', 'Family ${id}'), ('tagline', ''), ('theme', 'codex'), ('focus', 'ada');`);
  names.forEach((name, i) => d.exec(`INSERT INTO house (id, name, arms) VALUES ('h${i + 1}', 'House ${name}', '${JSON.stringify(ARMS)}');`));
  d.exec(`
    INSERT INTO person (id, given, house, living) VALUES ('ada', 'Ada-Private-Given', 'h1', 1);
    INSERT INTO person_field (id, person, type, label, value, ord, visibility) VALUES ('pf1', 'ada', 'phone', 'Mobile', '{"value":"SECRET-PHONE-0123"}', 0, 'editors');
    INSERT INTO person_field (id, person, type, label, value, ord, visibility, owner) VALUES ('pf2', 'ada', 'notes', '', '{"text":"SECRET-PERSONAL-NOTE"}', 1, 'personal', 'author-1');
    INSERT INTO story (id, person, kind, title, body, author, at, context) VALUES ('s1', 'ada', 'memory', 'SECRET-TITLE', 'SECRET-STORY', 'Ada', '2026-01-01T10:00:00Z', NULL);
    INSERT INTO house_succession (house, country) VALUES ('h1', 'DE');
  `);
  d.close();
}

const rows = (tree: string) => {
  const d = openSqlite(join(dir, `${tree}.db`), 'tree');
  const out = d.prepare('SELECT house, name, meanings, saved_by, collect_failures FROM house_meaning ORDER BY house').all() as { house: string; name: string; meanings: string; saved_by: string; collect_failures: number }[];
  d.close();
  return out;
};
const exec = (tree: string, sql: string) => { const d = openSqlite(join(dir, `${tree}.db`), 'tree'); d.exec(sql); d.close(); };

async function setupAi(tree: string, o: { monthlyMicros?: number; webSearch?: boolean; capShare?: number; on?: boolean } = {}): Promise<void> {
  await setUpFamilyAi(tree, null, {
    provider: 'anthropic', model: '', apiKey: 'sk-test-key-123', features: { assistant: false, faces: false, avatar: false, arms: true },
    webSearch: o.webSearch ?? false, monthlyMicros: o.monthlyMicros ?? 1_000_000, customPrices: {},
  });
  const schedule = () => ({ schedule: 'daily' as const });
  const input: SaveInput = { tasks: { arms: schedule(), occupations: schedule(), chronicle: schedule(), names: schedule() }, capShare: o.capShare ?? 0.2, languages: ['en'], locale: 'en' };
  await bg.saveBackground(tree, 'steward-1', input);
  await bg.setTaskEnabled(tree, 'names', o.on ?? true);
}

function stub(o: { fail?: (user: string) => InstanceType<typeof AiError> | undefined } = {}) {
  const requests: AiRequest[] = [];
  const adapter: AiAdapter = {
    provider: 'anthropic',
    model: 'claude-haiku-5-5',
    async complete(req: AiRequest): Promise<AiReply> {
      requests.push(req);
      const user = req.messages.map((m) => ('text' in m ? m.text : '')).join('\n');
      const failure = o.fail?.(user);
      if (failure) throw failure;
      const base = { calls: [], tokens: 20, inputTokens: 10, outputTokens: 10, searches: 0 };
      if (req.webSearch) return { ...base, text: 'Notes on the surname.', searches: 1, sources: [{ url: 'https://example.org/heer', title: 'Heer' }] };
      if (req.json?.name === 'arms_fit') return { ...base, text: '', json: { verdict: 'fits', reason: 'It fits.', advice: '' } };
      const surname = /Surname: (.+)/.exec(user)?.[1] ?? '';
      return { ...base, text: '', json: { meanings: [
        { language: 'German', root: surname, meaning: `first sense of ${surname}`, attestation: 'well-attested', ideas: [], sources: [] },
        { language: 'Dutch', root: surname, meaning: `second sense of ${surname}`, attestation: 'speculative', ideas: [], sources: [] },
      ], note: null } };
    },
  };
  return { adapter, requests };
}

const run = (tree: string, adapter: AiAdapter) => bg.runTask(tree, 'names', { now: NOW, adapter, price: PRICE });
const parsed = (s: string) => JSON.parse(s) as { id: string; chosen: boolean; meaning: string }[];
const op = (key: string) => ({ key: `${key}-opkey-123`, user: 'steward-1', payload: { key } });

test('off by default, and only names with nothing collected or saved are picked', async () => {
  const tree = 'pick';
  makeFamily(tree, ['Saved', 'Collected', 'Dismissed', 'Failing', 'GivenUp', 'Fresh']);
  const off = stub();
  await setupAi(tree, { on: false });
  assert.equal((await run(tree, off.adapter)).status, 'skipped');
  assert.equal(off.requests.length, 0);
  exec(tree, `INSERT INTO house_meaning (house, name, meanings, saved_at, saved_by, collect_failures) VALUES
    ('h1', 'Saved', '${JSON.stringify([row('m1', true)])}', 1, 's', 0),
    ('h2', 'Collected', '${JSON.stringify([row('m1', false)])}', 1, 'ai-background', 0),
    ('h3', 'Dismissed', '[]', 1, 's', 0),
    ('h4', 'Failing', '[]', 1, 'ai-background', 1),
    ('h5', 'GivenUp', '[]', 1, 'ai-background', ${MAX_COLLECT_FAILURES});`);
  const list = await pending(tree, 'names', ['en']);
  // New names come before a name that has already failed.
  assert.deepEqual(list.map((p) => (p.task === 'names' ? p.surname : '')), ['Fresh', 'Failing']);
});

test('a run is bounded and the next run goes on; an idle run is idle', async () => {
  const tree = 'bounded';
  makeFamily(tree, ['A', 'B', 'C', 'D', 'E', 'F']);
  await setupAi(tree);
  const s = stub();
  const first = await run(tree, s.adapter);
  assert.equal(first.status, 'done');
  assert.equal(first.done, BATCH);
  assert.equal(first.waiting, 6 - BATCH);
  assert.equal(rows(tree).length, BATCH);
  const second = await run(tree, s.adapter);
  assert.equal(second.done, 6 - BATCH);
  assert.equal(rows(tree).length, 6);
  const again = s.requests.length;
  assert.equal((await run(tree, s.adapter)).status, 'idle');
  assert.equal(s.requests.length, again, 'nothing is asked twice');
});

test('the schedule leaves room for a name with its web search, and counts the calls it made', async () => {
  const tree = 'calls';
  makeFamily(tree, ['A', 'B', 'C', 'D', 'E', 'F']);
  await setupAi(tree, { webSearch: true });
  const s = stub();
  const out = await run(tree, s.adapter);
  assert.equal(out.done, BATCH);
  assert.equal(out.calls, BATCH * CALLS_PER_NAME);
  assert.ok(out.calls <= CALLS_PER_DAILY_RUN);
});

test('the background budget refuses before anything is sent, and it does not count against the name', async () => {
  const tree = 'budget';
  makeFamily(tree, ['Heer', 'B']);
  await setupAi(tree, { monthlyMicros: 2, capShare: 0.05 });
  const s = stub();
  const out = await run(tree, s.adapter);
  assert.equal(out.status, 'stopped');
  assert.equal(out.done, 0);
  assert.equal(s.requests.length, 0);
  assert.deepEqual(rows(tree), [], 'no meanings and no failure count');
});

test('a failure on one name does not stop the others, and a name is given up on', async () => {
  const tree = 'failing';
  makeFamily(tree, ['Bad', 'Good']);
  await setupAi(tree);
  const s = stub({ fail: (user) => (/Surname: Bad/.test(user) ? new AiError('provider', 'broken') : undefined) });
  const first = await run(tree, s.adapter);
  assert.equal(first.done, 1);
  assert.equal(first.failed, 1);
  assert.equal(parsed(rows(tree).find((r) => r.name === 'Good')!.meanings).length, 2);
  for (let i = 1; i < MAX_COLLECT_FAILURES; i++) await run(tree, s.adapter);
  assert.equal(rows(tree).find((r) => r.name === 'Bad')!.collect_failures, MAX_COLLECT_FAILURES);
  const asked = s.requests.length;
  assert.equal((await run(tree, s.adapter)).status, 'idle');
  assert.equal(s.requests.length, asked, 'a name given up on is not asked again');

  // A rate limit says nothing about the name.
  const limited = 'limited';
  makeFamily(limited, ['Heer']);
  await setupAi(limited);
  await run(limited, stub({ fail: () => new AiError('rate-limited', 'slow down') }).adapter);
  assert.deepEqual(rows(limited), []);
});

test('nothing is chosen and no arms check runs until a steward chooses; the choice is what makes it saved', async () => {
  const tree = 'choose';
  makeFamily(tree, ['Heer']);
  await setupAi(tree);
  await bg.setTaskEnabled(tree, 'arms', true);
  const s = stub();
  await run(tree, s.adapter);
  const [collected] = rows(tree);
  assert.equal(collected.saved_by, 'ai-background');
  assert.ok(parsed(collected.meanings).every((m) => !m.chosen));
  assert.ok(!s.requests.some((r) => r.json?.name === 'arms_fit'));
  assert.deepEqual(await meanings.readMeanings(tree), {}, 'not saved for any reader');
  assert.deepEqual(await pending(tree, 'arms', ['en']), [], 'the arms review has nothing to check');
  const d = store.tree(tree);
  await assert.rejects(checkArms({ tree, house: 'h1', locale: 'en', force: true, by: 's', op: op('fit'), adapter: s.adapter }), /err_none_chosen/);
  assert.equal(await d.get('SELECT 1 AS x FROM house_arms_review'), undefined);

  const shown = await meanings.readCollected(tree);
  assert.equal(shown.h1.meanings.length, 2);
  const pick = shown.h1.meanings[1].id;
  const saved = await meanings.chooseCollected(tree, 'h1', pick, op('choose'));
  assert.deepEqual(saved.meanings.filter((m) => m.chosen).map((m) => m.id), [pick]);
  assert.equal(saved.meanings.length, 2, 'the others stay, unchosen');
  assert.deepEqual(await meanings.readCollected(tree), {});
  assert.deepEqual(Object.keys(await meanings.readMeanings(tree)), ['h1']);
  assert.equal((await pending(tree, 'arms', ['en'])).length, 1, 'only now the arms can be checked');
  const review = await checkArms({ tree, house: 'h1', locale: 'en', force: false, by: 's', op: op('fit2'), adapter: s.adapter });
  assert.equal(review.verdict, 'fits');
  assert.equal((await pending(tree, 'names', ['en'])).length, 0, 'not collected again');
  await assert.rejects(meanings.chooseCollected(tree, 'h1', pick, op('again')), /err_stale/);
});

test('dismissing all of them clears the card, and the name is not collected again', async () => {
  const tree = 'dismiss';
  makeFamily(tree, ['Heer']);
  await setupAi(tree);
  await run(tree, stub().adapter);
  await meanings.dismissCollected(tree, 'h1', op('dismiss'));
  assert.deepEqual(await meanings.readCollected(tree), {});
  assert.deepEqual(await meanings.readMeanings(tree), {});
  assert.deepEqual(await pending(tree, 'names', ['en']), []);
});

test('only the surname and the country go out, and the web only when the family has web search on', async () => {
  const tree = 'prompt';
  makeFamily(tree, ['Heer']);
  await setupAi(tree);
  const s = stub();
  await run(tree, s.adapter);
  assert.equal(s.requests.length, 1);
  assert.equal(s.requests[0].webSearch, undefined);
  const user = s.requests[0].messages.map((m) => ('text' in m ? m.text : '')).join('\n');
  assert.equal(user, 'Surname: Heer\nCountry (ISO code): DE');
  assert.doesNotMatch(JSON.stringify(s.requests), /SECRET|Ada-Private-Given|House Heer/);

  const web = 'web';
  makeFamily(web, ['Heer']);
  await setupAi(web, { webSearch: true });
  const w = stub();
  await run(web, w.adapter);
  assert.equal(w.requests.length, 2);
  assert.ok(w.requests[0].webSearch, 'the search goes first');
  assert.equal(w.requests[0].messages.map((m) => ('text' in m ? m.text : '')).join('\n'), 'Surname: Heer\nCountry (ISO code): DE');
  assert.doesNotMatch(JSON.stringify(w.requests), /SECRET|Ada-Private-Given|House Heer/);
  assert.equal(rows(web)[0].saved_by, 'ai-background');
});

test('a steward running full research keeps what was collected', async () => {
  const tree = 'research';
  makeFamily(tree, ['Heer']);
  await setupAi(tree);
  await run(tree, stub().adapter);
  const fresh = { id: 'm1', language: 'German', root: 'Heer', meaning: 'a brand-new sense', attestation: 'well-attested' as const, ideas: [], chosen: true };
  const saved = await meanings.saveMeanings(tree, 'h1', { name: 'Heer', familyWords: '', webSearched: false, note: '', meanings: [fresh] }, op('save'));
  assert.deepEqual(saved.meanings.map((m) => m.meaning), ['a brand-new sense', 'first sense of Heer', 'second sense of Heer']);
  assert.deepEqual(saved.meanings.map((m) => m.chosen), [true, false, false]);
  assert.equal(new Set(saved.meanings.map((m) => m.id)).size, 3, 'ids stay distinct');
  // Once something is chosen, a later research replaces the row as it always has.
  const later = await meanings.saveMeanings(tree, 'h1', { name: 'Heer', familyWords: '', webSearched: false, note: '', meanings: [fresh] }, op('save2'));
  assert.equal(later.meanings.length, 1);
});

test('a steward\'s research that lands while the call was out is not overwritten', async () => {
  const tree = 'race';
  makeFamily(tree, ['Heer']);
  await setupAi(tree);
  const s = stub();
  const slow: AiAdapter = {
    ...s.adapter,
    complete: async (req) => {
      await meanings.saveMeanings(tree, 'h1', { name: 'Heer', familyWords: '', webSearched: false, note: '', meanings: [{ ...row('m1', true), attestation: 'well-attested' as const, ideas: [] }] }, op('during'));
      return s.adapter.complete(req);
    },
  };
  await run(tree, slow);
  assert.deepEqual(parsed(rows(tree)[0].meanings).map((m) => m.chosen), [true]);
  assert.notEqual(rows(tree)[0].saved_by, 'ai-background');
});

// ---------- who may read and choose ----------

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

test('roles: only a steward reads, chooses or dismisses a collection; other readers never see one', async () => {
  const tree = 'roles';
  makeFamily(tree, ['Heer']);
  await setupAi(tree);
  await run(tree, stub().adapter);
  const viewer = await memberWith(tree, 'viewer');
  const editor = await memberWith(tree, 'editor');
  const steward = await memberWith(tree, 'steward');
  const status = (e: unknown) => (e as { status?: number }).status;
  const data = { tree, house: 'h1', meanings: ['m1'], opKey: 'choose-opkey-1' };
  for (const cookie of [viewer, editor]) {
    await assert.rejects(asReader(cookie, () => fns.getCollectedMeanings({ data: { tree } })), (e: unknown) => status(e) === 403);
    await assert.rejects(asReader(cookie, () => fns.chooseCollectedMeaning({ data })), (e: unknown) => status(e) === 403);
    await assert.rejects(asReader(cookie, () => fns.dismissCollectedMeanings({ data: { tree, house: 'h1', opKey: 'dismiss-opkey-1' } })), (e: unknown) => status(e) === 403);
    assert.deepEqual(await asReader(cookie, () => fns.getHouseMeanings({ data: { tree } })), {}, 'nothing beyond what they saw before');
  }
  assert.ok(parsed(rows(tree)[0].meanings).every((m) => !m.chosen), 'the refused choices wrote nothing');
  assert.equal((await asReader(steward, () => fns.getCollectedMeanings({ data: { tree } }))).h1.meanings.length, 2);
  const saved = await asReader(steward, () => fns.chooseCollectedMeaning({ data }));
  assert.equal(saved.meanings.filter((m) => m.chosen).length, 1);
  assert.deepEqual(Object.keys(await asReader(viewer, () => fns.getHouseMeanings({ data: { tree } }))), ['h1'], 'once chosen, every reader sees it');
});

test('several origins can be chosen at once; a viewer sees only the chosen ones, a steward sees all', async () => {
  const tree = 'multi';
  makeFamily(tree, ['Heer']);
  await setupAi(tree);
  await run(tree, stub().adapter);
  const viewer = await memberWith(tree, 'viewer');
  const steward = await memberWith(tree, 'steward');
  const ids = (await asReader(steward, () => fns.getCollectedMeanings({ data: { tree } }))).h1.meanings.map((m) => m.id);
  assert.equal(ids.length, 2);
  await assert.rejects(asReader(steward, () => fns.chooseCollectedMeaning({ data: { tree, house: 'h1', meanings: ['nope'], opKey: 'choose-multi-0' } })));
  const saved = await asReader(steward, () => fns.chooseCollectedMeaning({ data: { tree, house: 'h1', meanings: ids, opKey: 'choose-multi-1' } }));
  assert.deepEqual(saved.meanings.filter((m) => m.chosen).map((m) => m.id), ids);
  // The steward narrows the selection later: the viewer then sees just that origin.
  await asReader(steward, () => fns.saveHouseMeaning({ data: {
    tree, house: 'h1', opKey: 'narrow-multi-1', name: saved.name, familyWords: saved.familyWords, webSearched: saved.webSearched, note: saved.note,
    meanings: saved.meanings.map((m) => ({ ...m, chosen: m.id === ids[1] })),
  } }));
  const seen = await asReader(viewer, () => fns.getHouseMeanings({ data: { tree } }));
  assert.deepEqual(seen.h1.meanings.map((m) => m.id), [ids[1]], 'nothing unchosen reaches a viewer');
  const all = await asReader(steward, () => fns.getHouseMeanings({ data: { tree } }));
  assert.equal(all.h1.meanings.length, 2);
});

test('the badge: collected meanings come after an arms review and before "not researched"', () => {
  const base = { aiOn: true, researched: false, generated: true };
  assert.equal(reviewBadge({ ...base, collected: true }), 'meanings-collected');
  assert.equal(reviewBadge({ ...base }), 'name-unresearched');
  assert.equal(reviewBadge({ ...base, collected: true, review: { house: 'h', verdict: 'reconsider', reason: '', advice: '', locale: 'en', checkedAt: 1, current: true, dismissed: false, chosen: true } }), 'arms-review');
});

test('a rich answer through the Anthropic path is kept within the limits, not thrown away', async () => {
  const tree = 'rich';
  makeFamily(tree, ['Holtzmeier']);
  await setupAi(tree, { webSearch: true });
  const urls = Array.from({ length: 12 }, (_, i) => `https://names.example.org/entry/${i}`);
  const meaning = (i: number) => ({
    language: 'German', root: `holt${i}`, meaning: `sense ${i}`, attestation: 'well-attested',
    ideas: ['one', 'two', 'three', 'four', 'five'].map((idea) => ({ kind: 'quality', idea })),
    sources: urls,
  });
  const bodies: Record<string, any>[] = [];
  const usage = { input_tokens: 10, output_tokens: 10 };
  const offline = globalThis.fetch;
  // The shape the Messages API answers in: a search turn with its result blocks, then structured output as JSON text after thinking.
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as Record<string, any>;
    bodies.push(body);
    const content = body.tools
      ? [
          { type: 'thinking', thinking: '', signature: 'sig' },
          { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: 'Holtzmeier' } },
          { type: 'web_search_tool_result', tool_use_id: 'srv_1', content: urls.map((url) => ({ type: 'web_search_result', url, title: 'Entry', encrypted_content: 'x' })) },
          { type: 'text', text: 'Notes on the name.', citations: [] },
        ]
      : [
          { type: 'thinking', thinking: '', signature: 'sig' },
          { type: 'text', text: JSON.stringify({ meanings: Array.from({ length: 10 }, (_, i) => meaning(i)), note: `${'A long and careful note. '.repeat(30)}` }) },
        ];
    return Response.json({ content, stop_reason: 'end_turn', usage: { ...usage, server_tool_use: { web_search_requests: body.tools ? 1 : 0 } } });
  }) as typeof fetch;
  let out: Awaited<ReturnType<typeof run>>;
  try {
    out = await run(tree, makeAdapter('anthropic', 'sk-test-key-123', 'claude-haiku-5-5'));
  } finally {
    globalThis.fetch = offline;
  }
  assert.deepEqual([out.status, out.done, out.failed], ['done', 1, 0], out.note);
  assert.equal(bodies.length, 2, 'one search and one answer: no retry');
  assert.doesNotMatch(JSON.stringify(bodies[1].output_config.format.schema), /maxItems|maxLength/, 'these limits never reach the model as schema');
  const d = openSqlite(join(dir, `${tree}.db`), 'tree');
  const saved = d.prepare('SELECT meanings, note FROM house_meaning').get() as { meanings: string; note: string };
  d.close();
  const list = JSON.parse(saved.meanings) as { ideas: unknown[]; sources: unknown[] }[];
  assert.equal(list.length, 8);
  assert.ok(list.every((m) => m.ideas.length === 4 && m.sources.length === 3));
  assert.ok(saved.note.length > 0 && saved.note.length <= 400);
});

test('a run names the names that failed, in words, and only an all-failed run is failed', async () => {
  const down = () => new AiError('unreachable', 'ai.err_unreachable');
  const mixed = 'mixed';
  makeFamily(mixed, ['Bad', 'Good']);
  await setupAi(mixed);
  const some = await run(mixed, stub({ fail: (user) => (/Surname: Bad/.test(user) ? down() : undefined) }).adapter);
  assert.deepEqual([some.status, some.done, some.failed], ['done', 1, 1]);
  assert.equal(some.note, 'Bad: Could not reach the AI service. Check the connection.');

  const worst = 'all-failed';
  makeFamily(worst, ['Bad', 'Worse']);
  await setupAi(worst);
  const all = await run(worst, stub({ fail: down }).adapter);
  assert.deepEqual([all.status, all.done, all.failed], ['failed', 0, 2]);
  assert.equal(all.note, 'Bad, Worse: Could not reach the AI service. Check the connection.');
});
