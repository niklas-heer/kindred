// node --test src/lib/ai-arms-fit.test.ts — does a house's arms still fit its name: asked only when the arms or the chosen
// meanings changed (or when a steward forces it), booked against the family's budget, retried once on a bad answer, stored
// with its fingerprint, and refused for anyone who is not a steward or when the arms feature is off. A stub provider stands in
// for the model; no key is read from the environment and nothing is sent anywhere.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { AsyncLocalStorage } from 'node:async_hooks';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-arms-fit-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_SECRET = 'arms-fit-test-secret';
delete process.env.KINDRED_AI_FAKE;

const TREE = 'family';
const HOUSE = 'h1';
const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { openSqlite, closeAccounts } = await load<typeof import('./store/node.ts')>('/src/lib/store/node.ts');
const { store } = await load<typeof import('./store/index.ts')>('/src/lib/store/index.ts');
const { startSession } = await load<typeof import('./auth/session.server.ts')>('/src/lib/auth/session.server.ts');
const { newUser, upsertMembership } = await load<typeof import('./auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const { checkArms, describeArms, fitSystem, fitUser, withFitFixture } = await load<typeof import('./ai/arms-fit.server.ts')>('/src/lib/ai/arms-fit.server.ts');
const { checkArmsFit } = await load<typeof import('./ai/arms-fit.functions.ts')>('/src/lib/ai/arms-fit.functions.ts');
const { budgeted, spentThisMonth, OFF } = await load<typeof import('./ai/settings.server.ts')>('/src/lib/ai/settings.server.ts');
const providers = await load<typeof import('./ai/providers.server.ts')>('/src/lib/ai/providers.server.ts');
const { setUpFamilyAi } = await load<typeof import('./ai/testing.server.ts')>('/src/lib/ai/testing.server.ts');
const { tr } = await load<typeof import('./ai/labels.ts')>('/src/lib/ai/labels.ts');
const { AiError } = await load<typeof import('./ai/adapters.ts')>('/src/lib/ai/adapters.ts');
const { readReviews, settleReview } = await load<typeof import('./house-meaning.server.ts')>('/src/lib/house-meaning.server.ts');
const { dismissArmsReview } = await load<typeof import('./house-meaning.functions.ts')>('/src/lib/house-meaning.functions.ts');
const { PRESETS } = await load<typeof import('./heraldry/presets.ts')>('/src/lib/heraldry/presets.ts');
/** A real design, stored as the designer stores one (`v2`): the arms the steward drew. */
const DESIGNED = PRESETS[0].arms;
const { saveHouseMeaning } = await load<typeof import('./house-meaning.functions.ts')>('/src/lib/house-meaning.functions.ts');

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

const ARMS = { field: 'azure', division: 'plain', charge: 'lion', chargeTincture: 'or' };
const family = openSqlite(join(dir, `${TREE}.db`), 'tree', { create: true });
family.exec(`
  INSERT INTO meta (key, value) VALUES ('id', '${TREE}'), ('name', 'Family'), ('tagline', ''), ('theme', 'codex'), ('focus', 'ada');
  INSERT INTO house (id, name, arms) VALUES ('${HOUSE}', 'House Heer', '${JSON.stringify(ARMS)}');
  INSERT INTO person (id, given, house) VALUES ('ada', 'Ada', '${HOUSE}');
`);
family.close();

async function memberWith(role: 'viewer' | 'editor' | 'steward') {
  const { user, insert } = newUser(role, null);
  await store.accounts().batch([insert, upsertMembership(user.id, TREE, role)]);
  const set = await startSession(new Request('http://localhost:4791/'), user.id);
  return { cookie: set.split(';')[0], id: user.id };
}

function asReader<T>(cookie: string | undefined, call: () => Promise<T>): Promise<T> {
  const request = new Request('http://localhost:4791/', { headers: cookie ? { cookie } : {} });
  return events.run({ request, requestUrl: new URL(request.url) }, () => contexts.run({ startOptions: {} }, call));
}

// ---------- a stub provider: counts its calls, and answers from a script ----------

type Answer = { json: unknown } | Error;
function stub(answers: Answer[]) {
  let calls = 0;
  const adapter = {
    provider: 'anthropic' as const,
    model: 'stub',
    async complete(req: { json?: { name: string } }) {
      calls++;
      if (req.json?.name !== 'arms_fit') throw new Error(`unexpected call ${req.json?.name}`);
      const a = answers[Math.min(calls - 1, answers.length - 1)];
      if (a instanceof Error) throw a;
      return { text: '', calls: [], json: a.json, tokens: 50, inputTokens: 30, outputTokens: 20, searches: 0 };
    },
  };
  return { adapter: adapter as never, count: () => calls };
}

const FITS_NOT = { verdict: 'partly', reason: 'The lion stands for courage; nothing speaks to the name’s trade.', advice: 'Add a charge for the trade the name comes from.' };
const c = tr('en');
const PRICE = { inPerM: 1, outPerM: 2, searchEach: 0.01 };

/** A steward's research on the house, saved through the real server function (its retry key is the steward's own). */
async function researchSaved(steward: { cookie: string }, key: string) {
  await asReader(steward.cookie, () => saveHouseMeaning({ data: {
    tree: TREE, house: HOUSE, opKey: key, name: 'Heer', familyWords: '', webSearched: false, note: '',
    meanings: [{ id: 'm1', language: 'Dutch', root: 'heer', meaning: 'lord', attestation: 'well-attested', ideas: [], chosen: true }],
  } }));
}

const op = (key: string, user: string, force = false) => ({ key, user, payload: { house: HOUSE, force } });

// ---------- the feature must be on ----------

test('with the arms feature off, nothing is asked and nothing is stored', async () => {
  const steward = await memberWith('steward');
  await researchSaved(steward, 'fit-research-01');
  const s = stub([{ json: FITS_NOT }]);
  await assert.rejects(checkArms({ tree: TREE, house: HOUSE, locale: 'en', force: false, by: steward.id, op: op('fit-off-000001', steward.id) }),
    (e: unknown) => e instanceof AiError && e.code === 'not-configured');
  assert.equal(s.count(), 0);
  assert.deepEqual(await readReviews(TREE), {});
});

test('a research must exist before the arms are checked; without it nothing is asked', async () => {
  const steward = await memberWith('steward');
  const s = stub([{ json: FITS_NOT }]);
  await assert.rejects(checkArms({ tree: TREE, house: 'nobody', locale: 'en', force: false, by: steward.id, op: op('fit-nores-00001', steward.id), adapter: s.adapter }),
    (e: Error) => e.message === 'houses.meaning.err_not_researched');
  assert.equal(s.count(), 0);
});

// ---------- asked only when something changed ----------

test('the check is asked once; the same arms and meanings are not asked again, a change is, and "check again" always asks', async () => {
  const steward = await memberWith('steward');
  await setUpFamilyAi(TREE, steward.id, { provider: 'anthropic', model: '', features: { ...OFF, arms: true }, webSearch: false, monthlyMicros: 5_000_000, customPrices: {}, apiKey: 'sk-test-0123456789' });
  await researchSaved(steward, 'fit-research-02');
  const s = stub([{ json: FITS_NOT }]);
  const run = (key: string, force = false) => checkArms({ tree: TREE, house: HOUSE, locale: 'en', force, by: steward.id, op: op(key, steward.id, force), adapter: s.adapter });

  const first = await run('fit-once-0000001');
  assert.equal(s.count(), 1);
  assert.equal(first.verdict, 'partly');
  assert.equal(first.current, true);
  assert.equal(first.dismissed, false);

  const again = await run('fit-again-000001');
  assert.equal(s.count(), 1, 'same arms and meanings: the stored check, no call');
  assert.deepEqual(again, first);

  await store.tree(TREE).run('UPDATE house SET arms = ? WHERE id = ?', JSON.stringify({ ...ARMS, v2: DESIGNED }), HOUSE);
  const changed = await run('fit-changed-0001');
  assert.equal(s.count(), 2, 'the arms changed: asked again');
  assert.equal(changed.current, true);

  await run('fit-forced-00001', true);
  assert.equal(s.count(), 3, 'check again asks even when nothing changed');
});

test('a bad answer is asked once more; two bad answers store nothing and say so', async () => {
  const steward = await memberWith('steward');
  const good = stub([{ json: { verdict: 'nonsense' } }, { json: FITS_NOT }]);
  const reply = await checkArms({ tree: TREE, house: HOUSE, locale: 'en', force: true, by: steward.id, op: op('fit-retry-00001', steward.id), adapter: good.adapter });
  assert.equal(good.count(), 2);
  assert.equal(reply.verdict, 'partly');

  const bad = stub([{ json: { verdict: 'nonsense' } }]);
  await assert.rejects(checkArms({ tree: TREE, house: HOUSE, locale: 'en', force: true, by: steward.id, op: op('fit-bad-000001', steward.id, true), adapter: bad.adapter }),
    (e: unknown) => e instanceof AiError && e.code === 'bad-output');
  assert.equal(bad.count(), 2);
});

test('a fit stores no advice, and a check that fits says so', async () => {
  const steward = await memberWith('steward');
  const fits = stub([{ json: { verdict: 'fits', reason: 'Every element speaks to the name.', advice: 'Change nothing.' } }]);
  const reply = await checkArms({ tree: TREE, house: HOUSE, locale: 'en', force: true, by: steward.id, op: op('fit-fits-000001', steward.id, true), adapter: fits.adapter });
  assert.equal(reply.verdict, 'fits');
  assert.equal(reply.advice, '', 'nothing to change when the arms fit');
  const row = await store.tree(TREE).get<{ advice: string; verdict: string; checked_by: string }>('SELECT advice, verdict, checked_by FROM house_arms_review WHERE house = ?', HOUSE);
  assert.deepEqual({ ...row }, { advice: '', verdict: 'fits', checked_by: steward.id });
});

// ---------- a decision settles it ----------

test('sealing a suggestion settles the check: not asked again, and the card shows the steward’s choice, not the old advice', async () => {
  const steward = await memberWith('steward');
  const s = stub([{ json: FITS_NOT }]);
  const run = (key: string, force = false) => checkArms({ tree: TREE, house: HOUSE, locale: 'en', force, by: steward.id, op: op(key, steward.id, force), adapter: s.adapter });
  await run('settle-check-0001', true);
  await store.tree(TREE).run('UPDATE house SET arms = ? WHERE id = ?', JSON.stringify({ ...ARMS, v2: PRESETS[1].arms }), HOUSE);
  assert.equal((await readReviews(TREE))[HOUSE].current, false, 'the old check no longer speaks for the sealed arms');

  const settled = await settleReview(TREE, HOUSE, { key: 'settle-seal-00001', user: steward.id, payload: { house: HOUSE } });
  assert.deepEqual({ current: settled.current, dismissed: settled.dismissed, chosen: settled.chosen }, { current: true, dismissed: true, chosen: true });
  assert.deepEqual((await readReviews(TREE))[HOUSE], settled, 'and it stays that way after a reload');

  const calls = s.count();
  const again = await run('settle-after-0001');
  assert.equal(s.count(), calls, 'a check that is not forced asks nothing');
  assert.equal(again.chosen, true);
});

test('"check again" tells the model what was advised and what the steward chose, and may flag the arms again', async () => {
  const steward = await memberWith('steward');
  const texts: string[] = [];
  const adapter = { provider: 'anthropic', model: 'stub', complete: async (req: { messages: { text: string }[] }) => {
    texts.push(req.messages[0].text);
    return { text: '', calls: [], json: { verdict: 'reconsider', reason: 'It reads badly.', advice: 'Take one away.' }, tokens: 1, inputTokens: 1, outputTokens: 0, searches: 0 };
  } } as never;
  const forced = await checkArms({ tree: TREE, house: HOUSE, locale: 'en', force: true, by: steward.id, op: op('settle-force-0001', steward.id, true), adapter });
  assert.match(texts[0], /What the steward already decided:\n- The check advised: "Add a charge for the trade the name comes from\."\. The steward then chose these arms from the suggestions: /);
  assert.deepEqual({ dismissed: forced.dismissed, chosen: forced.chosen, verdict: forced.verdict }, { dismissed: false, chosen: false, verdict: 'reconsider' });
});

test('a dismissed check is remembered too, and comes back only when the arms change', async () => {
  const steward = await memberWith('steward');
  await asReader(steward.cookie, () => dismissArmsReview({ data: { tree: TREE, house: HOUSE, opKey: 'settle-keep-00001' } }));
  const kept = (await readReviews(TREE))[HOUSE];
  assert.deepEqual({ dismissed: kept.dismissed, chosen: kept.chosen }, { dismissed: true, chosen: false });
  let text = '';
  const adapter = { provider: 'anthropic', model: 'stub', complete: async (req: { messages: { text: string }[] }) => {
    text = req.messages[0].text;
    return { text: '', calls: [], json: { verdict: 'fits', reason: 'Good.' }, tokens: 1, inputTokens: 1, outputTokens: 0, searches: 0 };
  } } as never;
  await checkArms({ tree: TREE, house: HOUSE, locale: 'en', force: true, by: steward.id, op: op('settle-kept-00001', steward.id, true), adapter });
  assert.match(text, /The check advised: "Take one away\."\. The steward then kept the arms as they were: /);
});

test('the prompt judges the whole design: not a checklist, and adding is not the default', () => {
  const system = fitSystem('en');
  assert.match(system, /do not each need a symbol/);
  assert.match(system, /good enough counts as fitting/);
  assert.match(system, /Adding more is never the default advice/);
  assert.match(system, /"reconsider" rarely/);
});

test('several chosen origins are one pool: all are shown to the check, and one represented meaning is enough', () => {
  const m = (id: string, root: string, meaning: string) => ({ id, language: '', root, meaning, attestation: 'well-attested' as const, ideas: [], chosen: true });
  const user = fitUser({ name: 'Heer', familyWords: '', chosen: [m('a', 'heer', 'lord'), m('b', 'hehr', 'noble')], arms: { shield: 'heater', field: { division: 'plain', tinctures: ['azure'], line: 'straight' }, layers: [] } as never, history: [] });
  assert.match(user, /heer/);
  assert.match(user, /hehr/);
  assert.match(user, /possible origins[^\n]*only one of them/);
  assert.match(fitSystem('en'), /One clear charge that speaks to one real meaning fits, even when the other meanings have no element/);
});

// ---------- the budget ----------

test('the check is booked against the family’s budget, and a call the budget cannot pay for is refused before it is sent', async () => {
  const steward = await memberWith('steward');
  await setUpFamilyAi(TREE, steward.id, { provider: 'anthropic', model: '', features: { ...OFF, arms: true }, webSearch: false, monthlyMicros: 5_000_000, customPrices: {}, apiKey: 'sk-test-0123456789' });
  const before = await spentThisMonth(TREE);
  const s = stub([{ json: FITS_NOT }]);
  const metered = budgeted(TREE, 5_000_000, s.adapter, PRICE, c);
  await checkArms({ tree: TREE, house: HOUSE, locale: 'en', force: true, by: steward.id, op: op('fit-budget-0001', steward.id, true), adapter: metered });
  assert.equal(s.count(), 1);
  const spent = await spentThisMonth(TREE);
  assert.ok(spent > before, 'the call was booked');
  assert.ok(spent < 5_000_000, 'and settled to what it really cost');

  const broke = stub([{ json: FITS_NOT }]);
  await assert.rejects(checkArms({ tree: TREE, house: HOUSE, locale: 'en', force: true, by: steward.id, op: op('fit-broke-00001', steward.id, true), adapter: budgeted(TREE, 1, broke.adapter, PRICE, c) }),
    (e: unknown) => e instanceof AiError && e.code === 'budget');
  assert.equal(broke.count(), 0, 'refused before it was sent');
});

// ---------- the route ----------

test('a steward’s manual check goes to the arms-review route, not the arms route', async () => {
  const steward = await memberWith('steward');
  await providers.saveProviderKey(TREE, steward.id, 'openrouter', 'sk-or-v1-REVIEW-ROUTE-KEY-4444');
  await setUpFamilyAi(TREE, steward.id, {
    provider: 'anthropic', model: '', features: { ...OFF, arms: true }, webSearch: false, monthlyMicros: 5_000_000, customPrices: {}, apiKey: 'sk-test-0123456789',
    routes: [{ route: 'arms-review', provider: 'openrouter', model: 'google/gemini-3.8-flash' }],
  });
  const urls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (url.includes('/models')) return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'not json' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    await checkArms({ tree: TREE, house: HOUSE, locale: 'en', force: true, by: steward.id, op: op('fit-route-00001', steward.id, true) }).catch(() => undefined);
  } finally {
    globalThis.fetch = real;
  }
  const sent = urls.filter((u) => !u.includes('/models'));
  assert.ok(sent.length >= 1, 'the check was sent');
  assert.ok(sent.every((u) => u.startsWith('https://openrouter.ai/')), 'every call went to the arms-review provider, none to the arms (assistant) provider');
});

// ---------- who may ask ----------

test('a viewer and an editor are refused the check, and nothing is asked', async () => {
  const viewer = await memberWith('viewer');
  const editor = await memberWith('editor');
  const before = await readReviews(TREE);
  for (const [n, reader] of [viewer, editor].entries()) {
    await assert.rejects(asReader(reader.cookie, () => checkArmsFit({ data: { tree: TREE, house: HOUSE, opKey: `role-check-000${n + 1}`, locale: 'en', force: true } })),
      (e: { status?: number; code?: string }) => e.status === 403 && e.code === 'forbidden');
  }
  assert.deepEqual(await readReviews(TREE), before, 'no review written by a refused reader');
});

test('a stranger is signed out before anything is read', async () => {
  await assert.rejects(asReader(undefined, () => checkArmsFit({ data: { tree: TREE, house: HOUSE, opKey: 'stranger-check-1' } })),
    (e: { status?: number }) => e.status === 401);
});

// ---------- what the model is shown ----------

test('the arms are described as a blazon and as what each colour and charge stands for', () => {
  const text = describeArms({ shield: 'heater', field: { division: 'plain', tinctures: ['azure'], line: 'straight' }, layers: [{ type: 'charge', charge: 'lion', tincture: 'or', count: 1, arrangement: 'single', on: 'field', reversed: false }] } as never);
  assert.match(text, /^Blazon: /m);
  assert.match(text, /lion/);
  assert.match(text, /azure \(/);
  assert.match(text, /^As drawn: 1 group of charges, 1 charges in all, 0 ordinaries; no charges overlap; the rule of tincture is kept\.$/m);
});

test('the fixture answers the fit check when the fake provider is on, and passes every other call through', async () => {
  const seen: string[] = [];
  const inner = { provider: 'fake', model: 'fake', complete: async (req: { json?: { name: string } }) => { seen.push(req.json?.name ?? ''); return { text: 'x', calls: [], tokens: 1, inputTokens: 1, outputTokens: 0, searches: 0 }; } };
  const wrapped = withFitFixture(inner as never);
  const fit = await wrapped.complete({ system: '', messages: [], json: { name: 'arms_fit', schema: {} } } as never);
  assert.equal((fit.json as { verdict: string }).verdict, 'partly');
  await wrapped.complete({ system: '', messages: [], json: { name: 'name_meaning', schema: {} } } as never);
  assert.deepEqual(seen, ['name_meaning']);
});
