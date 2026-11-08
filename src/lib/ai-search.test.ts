// node --test src/lib/ai-search.test.ts — the assistant's web lookups and the money they cost. The chat's own requests
// never enable provider search; a lookup is its own request, whose only input is a fixed instruction and the query; the
// guard refuses a query that names a living person or carries a private detail; a search-capped call cannot exceed its
// reservation; a failed call costs nothing unless the provider may have billed it; an incomplete reply is an error.
// Runs on a private data folder with `fetch` stubbed: no provider is ever called.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, afterEach } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-ai-search-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_AI_FAKE = '0';
process.env.KINDRED_SECRET = 'ai-search-test-secret';

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { openSqlite, closeAccounts } = await load<typeof import('./store/node.ts')>('/src/lib/store/node.ts');
const { accounts } = await load<typeof import('./auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const chat = await load<typeof import('./ai/chat.server.ts')>('/src/lib/ai/chat.server.ts');
const settings = await load<typeof import('./ai/settings.server.ts')>('/src/lib/ai/settings.server.ts');
const setup = await load<typeof import('./ai/testing.server.ts')>('/src/lib/ai/testing.server.ts');
const providers = await load<typeof import('./ai/providers.server.ts')>('/src/lib/ai/providers.server.ts');
const { AiError, makeAdapter, isolatedSearch, callRounds, outputCap } = await load<typeof import('./ai/adapters.ts')>('/src/lib/ai/adapters.ts');
const lookup = await load<typeof import('./ai/lookup.server.ts')>('/src/lib/ai/lookup.server.ts');
const { tr } = await load<typeof import('./ai/labels.ts')>('/src/lib/ai/labels.ts');
const { graph } = await load<typeof import('./db.server.ts')>('/src/lib/db.server.ts');
const { CONSERVATIVE } = await load<typeof import('./ai/prices.ts')>('/src/lib/ai/prices.ts');
/** The reply cap an Anthropic call sends, and the budget reserves: the request's own maxTokens, raised to the floor (outputCap). */
const anthropicCap = (maxTokens?: number) => outputCap('anthropic', 'claude-sonnet-5-5', maxTokens);

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const KEY = 'sk-ant-search-test-KEY-1234';
const TREE = 'search';
const PRIVATE = 'Ardent Pilgrim Lodge';

// A family with a living woman (married name differs, and a nickname), a deceased man with a private detail, and a
// private yes-value that is too short to guard.
const family = openSqlite(join(dir, `${TREE}.db`), 'tree', { create: true });
family.exec(`
  INSERT INTO meta (key, value) VALUES ('id', '${TREE}'), ('name', 'Searchers'), ('tagline', ''), ('theme', 'codex'), ('focus', 'anna');
  INSERT INTO person (id, given, surname, nickname, living, current_given, current_surname) VALUES
    ('anna', 'Anna', 'Kramer', 'Annie', 1, 'Anna', 'Brandt'),
    ('otto', 'Otto', 'Vogt', NULL, 0, NULL, NULL);
  INSERT INTO person_field (id, person, type, label, value, ord, visibility) VALUES
    ('f1', 'otto', 'address', 'lodge', '{"street":"${PRIVATE}"}', 0, 'editors'),
    ('f2', 'otto', 'notes', 'short', '{"text":"yes"}', 1, 'editors');
`);
family.close();

await accounts().run('INSERT INTO user (id, name, handle, created) VALUES (?, ?, ?, ?)', 'u1', 'Anna', 'handle-search', Date.now());

interface Sent { url: string; body: any; text: string }

/** Replaces fetch with a script: each call gets the next reply. Records each body as sent. */
function stubFetch(replies: (Response | (() => Response) | 'network')[]): Sent[] {
  const sent: Sent[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const text = String(init?.body ?? '');
    sent.push({ url, body: text ? JSON.parse(text) : undefined, text });
    const next = replies.shift();
    if (next === undefined) throw new Error(`unexpected fetch to ${url}`);
    if (next === 'network') throw new TypeError('fetch failed');
    return typeof next === 'function' ? next() : next;
  }) as typeof fetch;
  return sent;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const SEARCH_USAGE = { input_tokens: 100, output_tokens: 20, server_tool_use: { web_search_requests: 1 } };

async function familyFor(tree: string, monthlyMicros: number, webSearch = true, provider: 'anthropic' | 'openai' | 'openrouter' = 'anthropic') {
  await setup.setUpFamilyAi(tree, 'u1', {
    provider, model: '', features: { assistant: true, faces: false, avatar: false, arms: false }, webSearch, monthlyMicros, customPrices: {}, apiKey: KEY,
  });
}

// ---------- the isolated request ----------

test('a lookup is its own request: the fixed instruction and the query only, with no family data and no chat history', async () => {
  await familyFor(TREE, 5_000_000);
  const sent = stubFetch([
    // 1. the chat asks for a lookup
    () => json({ content: [{ type: 'tool_use', id: 't1', name: 'web_lookup', input: { query: 'Heer surname history' } }], stop_reason: 'tool_use', usage: { input_tokens: 50, output_tokens: 10 } }),
    // 2. the lookup itself: a search, citing one page
    () => json({
      content: [
        { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'Heer surname history' } },
        { type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', url: 'https://en.wikipedia.org/wiki/Heer', title: 'Heer' }] },
        { type: 'text', text: 'Heer means lord or host.' },
      ],
      stop_reason: 'end_turn',
      usage: SEARCH_USAGE,
    }),
    // 3. the chat's final answer
    () => json({ content: [{ type: 'text', text: 'Heer is a lord’s title, per the web.' }], stop_reason: 'end_turn', usage: { input_tokens: 80, output_tokens: 12 } }),
  ]);
  const { items } = await chat.sendMessage({ tree: TREE, user: 'u1', role: 'viewer', me: null, text: 'What does Heer mean?', locale: 'en' });

  // The chat's own requests carry no provider search tool: only the function tools.
  const chatCalls = [sent[0], sent[2]];
  for (const c of chatCalls) {
    assert.ok(!JSON.stringify(c.body.tools ?? []).includes('web_search_20250305'), 'the chat never enables provider search');
    assert.ok(c.body.tools.some((t: { name: string }) => t.name === 'web_lookup'), 'the chat gets the web_lookup tool');
  }

  // The lookup is one request: a fixed system prompt, one user message with the query, the search ceiling, no tools.
  const iso = sent[1].body;
  assert.equal(iso.system, lookup.LOOKUP_SYSTEM);
  assert.deepEqual(iso.messages, [{ role: 'user', content: [{ type: 'text', text: 'Heer surname history' }] }]);
  assert.equal(iso.tools.length, 1);
  assert.equal(iso.tools[0].type, 'web_search_20250305');
  assert.equal(iso.tools[0].max_uses, lookup.LOOKUP_SEARCHES);
  for (const secret of ['Anna', 'Kramer', 'Brandt', 'Annie', 'Otto', 'Vogt', PRIVATE, 'Searchers', 'anna']) {
    assert.ok(!sent[1].text.includes(secret), `the lookup request carries no family data (${secret})`);
  }

  // The sources of the lookup come back in the reply, as the stored sources do.
  assert.deepEqual(items[1].sources, [{ url: 'https://en.wikipedia.org/wiki/Heer', title: 'Heer' }]);
});

test('a lookup whose query names a living person is refused before anything is sent', async () => {
  await familyFor(TREE, 5_000_000);
  const sent = stubFetch([
    () => json({ content: [{ type: 'tool_use', id: 't2', name: 'web_lookup', input: { query: 'Anna Kramer history' } }], stop_reason: 'tool_use', usage: { input_tokens: 50, output_tokens: 10 } }),
    () => json({ content: [{ type: 'text', text: 'Refused.' }], stop_reason: 'end_turn', usage: { input_tokens: 80, output_tokens: 3 } }),
  ]);
  const { items } = await chat.sendMessage({ tree: TREE, user: 'u1', role: 'viewer', me: null, text: 'Look up Anna Kramer', locale: 'en' });
  assert.equal(sent.length, 2, 'no lookup request was made');
  assert.ok(!sent.some((s) => s.body.system === lookup.LOOKUP_SYSTEM));
  assert.equal(items[1].text, 'Refused.');
});

// ---------- the guard ----------

test('the guard refuses a living person’s full name (current or birth), a nickname and a private value; a surname alone is allowed', async () => {
  const g = await graph(TREE);
  const guard = await lookup.privacyGuard(TREE, g.people, true);
  const refused = (q: string) => lookup.refusal(guard, q);
  assert.equal(refused('Anna Kramer'), 'living-name', 'birth name');
  assert.equal(refused('anna brandt'), 'living-name', 'current name, case-insensitive');
  assert.equal(refused('Kramer Anna'), 'living-name', 'reversed order');
  assert.equal(refused('Annie'), 'nickname', 'a living person’s nickname');
  assert.equal(refused(PRIVATE.toUpperCase()), 'private', 'a private value, any case');
  assert.equal(refused(`history of ${PRIVATE}`), 'private', 'a private value inside a longer query');
  assert.equal(refused('Kramer'), null, 'a surname alone');
  assert.equal(refused('Vogt'), null, 'a deceased person’s surname alone');
  assert.equal(refused('anniversary customs'), null, 'a nickname only counts as a whole word');
  assert.equal(refused('yes please'), null, 'a private value under four characters is not guarded');
});

test('a refusal says why, without echoing the private data', async () => {
  const g = await graph(TREE);
  const guard = await lookup.privacyGuard(TREE, g.people, true);
  const why = lookup.refusal(guard, `Anna Kramer and ${PRIVATE}`)!;
  assert.ok(why);
  const reason = lookup.REFUSAL_REASON[why];
  assert.ok(reason.length > 0);
  assert.ok(!reason.includes('Kramer') && !reason.includes(PRIVATE) && !reason.includes('Anna'));
});

// ---------- the search ceiling and the budget ----------

test('a search-capped call cannot pass its reservation: three searches fit what was booked for them', async () => {
  const price = { inPerM: 1, outPerM: 1, searchEach: 0.01 };
  const req = { system: 'S', messages: [{ role: 'user' as const, text: 'Heer' }], webSearch: { maxUses: 3 }, maxTokens: 200 };
  // Anthropic may continue a paused search turn, so the reservation covers every request the turn may make.
  const reserved = settings.estimateMicros(req, price, anthropicCap(req.maxTokens), callRounds('anthropic', req));
  await familyFor('cap', reserved, true);
  const adapter = makeAdapter('anthropic', KEY, 'claude-sonnet-5-5');
  const booked = settings.budgeted('cap', reserved, adapter, price, tr('en'));
  const sent = stubFetch([() => json({
    content: [{ type: 'text', text: 'Found.' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 20, server_tool_use: { web_search_requests: 3 } },
  })]);
  await booked.complete(req);
  assert.equal(sent[0].body.tools[0].max_uses, 3, 'the provider is told the ceiling');
  const spent = await settings.spentThisMonth('cap');
  assert.ok(spent <= reserved, `spent ${spent} is within the reservation ${reserved}`);
  assert.equal(spent, 100 + 20 + 3 * 10_000, 'settled to the real cost: tokens plus three searches at the listed price');
});

test('a listed search price of 0 still reserves a sane amount for each search', async () => {
  const free = { inPerM: 1, outPerM: 1, searchEach: 0 };
  const req = { system: 'S', messages: [{ role: 'user' as const, text: 'Heer' }], webSearch: { maxUses: 3 }, maxTokens: 200 };
  const none = settings.estimateMicros({ ...req, webSearch: undefined }, free);
  const withSearches = settings.estimateMicros(req, free);
  // Three searches at the one-cent floor with the margin (45,000 micro-dollars), plus the 4,000 tokens each search's results may bring in at $1 a million (12,000).
  assert.equal(withSearches - none, 57_000);
});

test('a call that would need more than the budget left is refused before it is sent', async () => {
  const price = { inPerM: 1, outPerM: 1, searchEach: 0.01 };
  const req = { system: 'S', messages: [{ role: 'user' as const, text: 'Heer' }], webSearch: { maxUses: 3 }, maxTokens: 200 };
  const reserved = settings.estimateMicros(req, price, anthropicCap(req.maxTokens));
  await familyFor('tight', reserved - 1, true);
  const sent = stubFetch([]);
  const booked = settings.budgeted('tight', reserved - 1, makeAdapter('anthropic', KEY, 'claude-sonnet-5-5'), price, tr('en'));
  await assert.rejects(booked.complete(req), (e: unknown) => e instanceof AiError && e.code === 'budget');
  assert.equal(sent.length, 0);
  assert.equal(await settings.spentThisMonth('tight'), 0);
});

test('every lookup books its own budget: the second lookup cannot take what the first reserved', async () => {
  // A budget for about one lookup and the chat's own calls: the second lookup is refused.
  const price = { inPerM: 1, outPerM: 1, searchEach: 0.01 };
  const lookupReq = { system: lookup.LOOKUP_SYSTEM, messages: [{ role: 'user' as const, text: 'Heer' }], webSearch: { maxUses: lookup.LOOKUP_SEARCHES }, maxTokens: 600 };
  const oneLookup = settings.estimateMicros(lookupReq, price, anthropicCap(lookupReq.maxTokens), callRounds('anthropic', lookupReq));
  await familyFor('lookups', oneLookup + 1_000, true);
  const booked = settings.budgeted('lookups', oneLookup + 1_000, makeAdapter('anthropic', KEY, 'claude-sonnet-5-5'), price, tr('en'));
  stubFetch([() => json({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: SEARCH_USAGE })]);
  await lookup.isolatedLookup(booked, 'Heer');
  await assert.rejects(lookup.isolatedLookup(booked, 'Heer'), (e: unknown) => e instanceof AiError && e.code === 'budget');
});

// ---------- failed calls ----------

test('a failed call costs nothing when the provider did not bill it: auth, rate limit, network and 5xx', async () => {
  const price = { inPerM: 1, outPerM: 1, searchEach: 0.01 };
  const req = { system: 'S', messages: [{ role: 'user' as const, text: 'Hi' }] };
  const cases: { name: string; replies: (Response | (() => Response) | 'network')[] }[] = [
    { name: 'auth', replies: [() => json({ error: { message: 'bad key' } }, 401)] },
    { name: 'rate limit', replies: [() => json({ error: { message: 'slow down' } }, 429), () => json({ error: { message: 'slow down' } }, 429)] },
    { name: 'network', replies: ['network'] },
    { name: '5xx', replies: [() => json({ error: { message: 'boom' } }, 500), () => json({ error: { message: 'boom' } }, 500)] },
  ];
  for (const [i, c] of cases.entries()) {
    const tree = `fail-${i}`;
    await familyFor(tree, 100_000_000, false);
    const booked = settings.budgeted(tree, 100_000_000, makeAdapter('anthropic', KEY, 'claude-sonnet-5-5'), price, tr('en'));
    stubFetch(c.replies);
    await assert.rejects(booked.complete(req), (e: unknown) => e instanceof AiError, c.name);
    assert.equal(await settings.spentThisMonth(tree), 0, `${c.name}: nothing charged`);
  }
});

test('a call that may have billed keeps its reservation: a reply it could not read', async () => {
  const price = { inPerM: 1, outPerM: 1, searchEach: 0.01 };
  const req = { system: 'S', messages: [{ role: 'user' as const, text: 'Hi' }], maxTokens: 200 };
  const reserved = settings.estimateMicros(req, price, anthropicCap(req.maxTokens));
  await familyFor('garbled', reserved * 2, false);
  const booked = settings.budgeted('garbled', reserved * 2, makeAdapter('anthropic', KEY, 'claude-sonnet-5-5'), price, tr('en'));
  // A 200 whose body is not JSON: the provider answered, so it may have billed.
  stubFetch([() => new Response('not json', { status: 200 })]);
  await assert.rejects(booked.complete(req), (e: unknown) => e instanceof AiError && e.code === 'bad-output');
  assert.equal(await settings.spentThisMonth('garbled'), reserved);
});

// ---------- incomplete replies ----------

test('a reply cut off by its cap is an error, not empty text: Anthropic, OpenAI and OpenRouter', async () => {
  stubFetch([() => json({ content: [{ type: 'text', text: 'Partial' }], stop_reason: 'max_tokens', usage: { input_tokens: 5, output_tokens: 9 } })]);
  await assert.rejects(makeAdapter('anthropic', KEY, 'claude-sonnet-5-5').complete({ system: 'S', messages: [{ role: 'user', text: 'Hi' }] }), (e: unknown) => e instanceof AiError && e.code === 'bad-output');

  stubFetch([() => json({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [], usage: { input_tokens: 5, output_tokens: 25000 } })]);
  await assert.rejects(makeAdapter('openai', KEY, 'gpt-6.1-sol').complete({ system: 'S', messages: [{ role: 'user', text: 'Hi' }], webSearch: {} }), (e: unknown) => e instanceof AiError && e.code === 'bad-output');

  stubFetch([() => json({ choices: [{ finish_reason: 'length', message: { content: '' } }], usage: { prompt_tokens: 5, completion_tokens: 9 } })]);
  await assert.rejects(makeAdapter('openrouter', KEY, 'openai/gpt-5').complete({ system: 'S', messages: [{ role: 'user', text: 'Hi' }] }), (e: unknown) => e instanceof AiError && e.code === 'bad-output');
});

// ---------- what counts as a search ----------

test('OpenRouter counts a search only when the reply reports one or cites a page', async () => {
  stubFetch([() => json({ choices: [{ message: { content: 'No search needed.' } }], usage: { prompt_tokens: 5, completion_tokens: 3 } })]);
  const none = await makeAdapter('openrouter', KEY, 'anthropic/claude-sonnet-5-5').complete({ system: 'S', messages: [{ role: 'user', text: 'Hi' }], webSearch: { maxUses: 2 } });
  assert.equal(none.searches, 0, 'nothing searched, nothing claimed');

  stubFetch([() => json({
    choices: [{ message: { content: 'Two pages say so.', annotations: [{ type: 'url_citation', url_citation: { url: 'https://a.example/x', title: 'X' } }] } }],
    usage: { prompt_tokens: 5, completion_tokens: 3, server_tool_use_details: { web_search_requests: 2 } },
  })]);
  const two = await makeAdapter('openrouter', KEY, 'anthropic/claude-sonnet-5-5').complete({ system: 'S', messages: [{ role: 'user', text: 'Hi' }], webSearch: { maxUses: 2 } });
  assert.equal(two.searches, 2, 'the reply reports two searches');
});

test('isolatedSearch sends the given system and prompt, the search ceiling, and nothing else', async () => {
  const sent = stubFetch([() => json({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })]);
  await isolatedSearch(makeAdapter('anthropic', KEY, 'claude-sonnet-5-5'), { system: 'Fixed.', prompt: 'Query only.', maxUses: 2 });
  assert.equal(sent[0].body.system, 'Fixed.');
  assert.deepEqual(sent[0].body.messages, [{ role: 'user', content: [{ type: 'text', text: 'Query only.' }] }]);
  assert.equal(sent[0].body.tools[0].max_uses, 2);
});

// ---------- one lookup per reply ----------

/** A family with one living person, so the chat can load a graph for the tree. */
function makeFamily(tree: string): void {
  const f = openSqlite(join(dir, `${tree}.db`), 'tree', { create: true });
  f.exec(`
    INSERT INTO meta (key, value) VALUES ('id', '${tree}'), ('name', 'Family ${tree}'), ('tagline', ''), ('theme', 'codex'), ('focus', 'anna');
    INSERT INTO person (id, given, surname, nickname, living, current_given, current_surname) VALUES ('anna', 'Anna', 'Kramer', 'Annie', 1, 'Anna', 'Brandt');
  `);
  f.close();
}

test('a reply runs one web lookup: a second call is not run, and the model is told so', async () => {
  makeFamily('once');
  await familyFor('once', 5_000_000);
  const sent = stubFetch([
    () => json({ content: [{ type: 'tool_use', id: 't1', name: 'web_lookup', input: { query: 'history of bakers guild' } }], stop_reason: 'tool_use', usage: { input_tokens: 50, output_tokens: 10 } }),
    () => json({ content: [{ type: 'text', text: 'Bakers guilds began in the Middle Ages.' }], stop_reason: 'end_turn', usage: SEARCH_USAGE }),
    () => json({ content: [{ type: 'tool_use', id: 't2', name: 'web_lookup', input: { query: 'bakers guild in Stellenbosch' } }], stop_reason: 'tool_use', usage: { input_tokens: 50, output_tokens: 10 } }),
    () => json({ content: [{ type: 'text', text: 'Answered from the first lookup.' }], stop_reason: 'end_turn', usage: { input_tokens: 80, output_tokens: 12 } }),
  ]);
  await chat.sendMessage({ tree: 'once', user: 'u1', role: 'viewer', me: null, text: 'Tell me about bakers guilds', locale: 'en' });
  assert.equal(sent.filter((s) => s.body.system === lookup.LOOKUP_SYSTEM).length, 1, 'one lookup went to the web');
  assert.equal(sent.length, 4);
  assert.ok(sent[3].text.includes('Only one web lookup is allowed per reply'), 'the second call got a result that says so');
});

test('a lookup the guard refuses still uses up the reply’s one lookup', async () => {
  makeFamily('refused-first');
  await familyFor('refused-first', 5_000_000);
  const sent = stubFetch([
    () => json({ content: [{ type: 'tool_use', id: 't1', name: 'web_lookup', input: { query: 'Anna Kramer history' } }], stop_reason: 'tool_use', usage: { input_tokens: 50, output_tokens: 10 } }),
    () => json({ content: [{ type: 'tool_use', id: 't2', name: 'web_lookup', input: { query: 'history of bakers guild' } }], stop_reason: 'tool_use', usage: { input_tokens: 50, output_tokens: 10 } }),
    () => json({ content: [{ type: 'text', text: 'No lookup.' }], stop_reason: 'end_turn', usage: { input_tokens: 80, output_tokens: 3 } }),
  ]);
  await chat.sendMessage({ tree: 'refused-first', user: 'u1', role: 'viewer', me: null, text: 'Look up Anna Kramer', locale: 'en' });
  assert.equal(sent.filter((s) => s.body.system === lookup.LOOKUP_SYSTEM).length, 0, 'nothing was sent to the web');
  assert.ok(sent[2].text.includes('Only one web lookup is allowed per reply'), 'a rephrased second query is not run');
});

// ---------- OpenRouter's :online suffix ----------

/** Replies to OpenRouter's model list from a fixed catalogue, and takes the rest from the script, recording each request. */
function stubOpenRouter(replies: (() => Response)[]): Sent[] {
  const sent: Sent[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/v1/models')) {
      return json({ data: [{ id: 'openai/gpt-5', name: 'GPT-5', pricing: { prompt: '0.00000125', completion: '0.00001' }, supported_parameters: ['reasoning', 'tools'] }] });
    }
    const text = String(init?.body ?? '');
    sent.push({ url, body: text ? JSON.parse(text) : undefined, text });
    const next = replies.shift();
    if (!next) throw new Error(`unexpected fetch to ${url}`);
    return next();
  }) as typeof fetch;
  return sent;
}

test(':online never reaches a request: the suffix is dropped for the chat and the arms, and the lookup searches only through its own tool', async () => {
  makeFamily('online');
  await setup.setUpFamilyAi('online', 'u1', {
    provider: 'openrouter', model: 'openai/gpt-5:online', features: { assistant: true, faces: false, avatar: false, arms: true },
    webSearch: true, monthlyMicros: 5_000_000, customPrices: {}, apiKey: KEY,
  });
  assert.equal((await providers.resolveRoute('online', 'assistant')).effective?.model, 'openai/gpt-5', 'the saved model has no suffix');

  const sent = stubOpenRouter([
    () => json({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'c1', function: { name: 'web_lookup', arguments: '{"query":"history of bakers guild"}' } }] } }], usage: { prompt_tokens: 50, completion_tokens: 10 } }),
    () => json({ choices: [{ finish_reason: 'stop', message: { content: 'Bakers guilds formed in the Middle Ages.', annotations: [{ type: 'url_citation', url_citation: { url: 'https://en.wikipedia.org/wiki/Guild', title: 'Guild' } }] } }], usage: { prompt_tokens: 20, completion_tokens: 9, server_tool_use_details: { web_search_requests: 1 } } }),
    () => json({ choices: [{ finish_reason: 'stop', message: { content: 'Done.' } }], usage: { prompt_tokens: 80, completion_tokens: 4 } }),
    () => json({ choices: [{ finish_reason: 'stop', message: { content: 'arms' } }], usage: { prompt_tokens: 5, completion_tokens: 1 } }),
  ]);
  await chat.sendMessage({ tree: 'online', user: 'u1', role: 'viewer', me: null, text: 'What is a bakers guild?', locale: 'en' });
  const { adapter } = await settings.adapterForFeature('online', 'arms', 'en');
  await adapter.complete({ system: 'arms', messages: [{ role: 'user', text: 'Surname: Heer' }] });

  assert.ok(sent.length >= 4, 'chat, lookup, chat, arms');
  assert.ok(sent.every((s) => !s.text.includes(':online')), 'no request carries the suffix');
  assert.ok(sent.every((s) => s.body.model === 'openai/gpt-5'), 'every request uses the model without the suffix');
  // OpenRouter carries the system prompt as the first message. The lookup is the one request that starts with its fixed instruction.
  const isolated = sent.find((s) => s.body.messages?.[0]?.content === lookup.LOOKUP_SYSTEM);
  assert.ok(isolated, 'the lookup went out');
  assert.deepEqual(isolated!.body.messages.map((m: { content: string }) => m.content), [lookup.LOOKUP_SYSTEM, 'history of bakers guild'], 'with its query only');
  for (const r of sent) if (r !== isolated) assert.ok(!JSON.stringify(r.body.tools ?? []).includes('openrouter:web_search'), 'the chat and arms never get the search tool');
  assert.ok(JSON.stringify(isolated!.body.tools).includes('openrouter:web_search'), 'the lookup searches through the server tool');
  assert.equal(isolated!.body.max_tool_calls, lookup.LOOKUP_SEARCHES, 'and the ceiling is the lookup’s');
  assert.equal(isolated!.body.plugins, undefined, 'no plugin is added');
});

test('a model that searches by itself is refused on save, and never used', async () => {
  makeFamily('search-model');
  const base = { features: { assistant: true, faces: false, avatar: false, arms: false }, webSearch: false, monthlyMicros: 5_000_000, customPrices: {}, apiKey: KEY };
  await assert.rejects(setup.setUpFamilyAi('search-model', 'u1', { ...base, provider: 'openai', model: 'gpt-4o-search-preview' }), (e: unknown) => e instanceof AiError && e.code === 'bad-input');
  await assert.rejects(setup.setUpFamilyAi('search-model', 'u1', { ...base, provider: 'openrouter', model: 'perplexity/sonar-pro' }), (e: unknown) => e instanceof AiError && e.code === 'bad-input');
  assert.throws(() => makeAdapter('openrouter', KEY, 'perplexity/sonar'), (e: unknown) => e instanceof AiError && e.code === 'bad-input');
  assert.equal((await providers.providerStates('search-model')).every((p) => p.keyState === 'none'), true, 'nothing was saved, no key either');
});

// ---------- paused search turns and failed rounds ----------

test('a paused search turn is continued at most twice, and the budget reserves for the three requests', async () => {
  const price = { inPerM: 1, outPerM: 1, searchEach: 0.01 };
  const req = { system: 'S', messages: [{ role: 'user' as const, text: 'bakers' }], webSearch: { maxUses: 2 }, maxTokens: 600 };
  const reserved = settings.estimateMicros(req, price, anthropicCap(req.maxTokens), callRounds('anthropic', req));
  await familyFor('paused', reserved, true);
  const booked = settings.budgeted('paused', reserved, makeAdapter('anthropic', KEY, 'claude-sonnet-5-5'), price, tr('en'));
  const paused = () => json({ content: [{ type: 'text', text: 'part' }], stop_reason: 'pause_turn', usage: { input_tokens: 100, output_tokens: 20, server_tool_use: { web_search_requests: 1 } } });
  const sent = stubFetch([paused, paused, paused, paused]);
  await assert.rejects(booked.complete(req), (e: unknown) => e instanceof AiError && e.code === 'bad-output');
  assert.equal(sent.length, 3, 'the first request and two continuations, no more');
  assert.equal(sent[0].body.tools.at(-1).max_uses, 2, 'each request is told the search ceiling');
  const spent = await settings.spentThisMonth('paused');
  assert.equal(spent, 3 * 100 + 3 * 20 + 3 * 10_000, 'settled to what the three requests billed');
  assert.ok(spent <= reserved, `spent ${spent} is within the reservation ${reserved}`);
});

test('a failure in a later round keeps the usage the earlier rounds billed', async () => {
  const price = { inPerM: 1, outPerM: 1, searchEach: 0.01 };
  const req = { system: 'S', messages: [{ role: 'user' as const, text: 'bakers' }], webSearch: { maxUses: 2 }, maxTokens: 600 };
  await familyFor('later', 100_000_000, true);
  const booked = settings.budgeted('later', 100_000_000, makeAdapter('anthropic', KEY, 'claude-sonnet-5-5'), price, tr('en'));
  stubFetch([
    () => json({ content: [{ type: 'text', text: 'part' }], stop_reason: 'pause_turn', usage: { input_tokens: 100, output_tokens: 20, server_tool_use: { web_search_requests: 1 } } }),
    () => json({ error: { message: 'bad key' } }, 401),
  ]);
  const err = await booked.complete(req).catch((e: unknown) => e);
  assert.ok(err instanceof AiError && err.code === 'auth');
  assert.deepEqual(err.billed, { inputTokens: 100, outputTokens: 20, searches: 1 }, 'the error carries what was billed before it');
  assert.equal(await settings.spentThisMonth('later'), 100 + 20 + 10_000, 'the rejected round is not charged, the first one is');
});

test('a request in flight when a later round fails may have billed, so it is charged as one more request', async () => {
  const price = { inPerM: 1, outPerM: 1, searchEach: 0.01 };
  const req = { system: 'S', messages: [{ role: 'user' as const, text: 'bakers' }], webSearch: { maxUses: 2 }, maxTokens: 600 };
  await familyFor('garbled-later', 100_000_000, true);
  const booked = settings.budgeted('garbled-later', 100_000_000, makeAdapter('anthropic', KEY, 'claude-sonnet-5-5'), price, tr('en'));
  stubFetch([
    () => json({ content: [{ type: 'text', text: 'part' }], stop_reason: 'pause_turn', usage: { input_tokens: 100, output_tokens: 20, server_tool_use: { web_search_requests: 1 } } }),
    () => new Response('not json', { status: 200 }),
  ]);
  await assert.rejects(booked.complete(req), (e: unknown) => e instanceof AiError && e.code === 'bad-output');
  const oneRound = settings.estimateMicros(req, price, anthropicCap(req.maxTokens), 1);
  assert.equal(await settings.spentThisMonth('garbled-later'), (100 + 20 + 10_000) + oneRound);
});

// ---------- the single-call share of the budget ----------

test('a call whose reservation is more than a fifth of the budget is refused before it is sent, unless the budget is under a dollar', async () => {
  const req = { system: 'S', messages: [{ role: 'user' as const, text: 'Hi' }], maxTokens: 1200 };
  // An unknown model's conservative price, with a reasoning model's cap of 8,000 tokens, reserves about $1.44 of a $5 budget.
  const unknown = settings.budgeted('share', 5_000_000, makeAdapter('openai', KEY, 'gpt-5.5-pro'), CONSERVATIVE, tr('en'));
  const sent = stubFetch([]);
  await assert.rejects(unknown.complete(req), (e: unknown) => e instanceof AiError && e.code === 'budget');
  assert.equal(sent.length, 0, 'nothing is sent');
  assert.equal(await settings.spentThisMonth('share'), 0, 'nothing is booked');

  // A priced model whose reservation fits its fifth is run.
  await familyFor('share-ok', 2_000_000, false, 'openai');
  const priced = settings.budgeted('share-ok', 2_000_000, makeAdapter('openai', KEY, 'gpt-6.1-sol'), { inPerM: 2, outPerM: 10, searchEach: 0.01 }, tr('en'));
  stubFetch([() => json({ choices: [{ finish_reason: 'stop', message: { content: 'Hi' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } })]);
  assert.equal((await priced.complete(req)).text, 'Hi');

  // Under a dollar the fifth does not apply: the reservation only has to fit the budget. An Anthropic call reserves its cap,
  // which is the 8,000-token floor (outputCap), so at $50 a million output tokens this call reserves $0.40.
  const tiny = { inPerM: 0, outPerM: 50, searchEach: 0.01 };
  const big = { system: 'S', messages: [{ role: 'user' as const, text: 'Hi' }], maxTokens: 1000 };
  const under = settings.budgeted('share-tiny', 500_000, makeAdapter('anthropic', KEY, 'claude-sonnet-5-5'), tiny, tr('en'));
  stubFetch([() => json({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })]);
  assert.equal((await under.complete(big)).text, 'ok', 'a $0.40 reservation fits a $0.50 budget');
  // The same call over a $1.50 budget is more than a fifth of it ($0.30), and is refused.
  const over = settings.budgeted('share-over', 1_500_000, makeAdapter('anthropic', KEY, 'claude-sonnet-5-5'), tiny, tr('en'));
  const none = stubFetch([]);
  await assert.rejects(over.complete(big), (e: unknown) => e instanceof AiError && e.code === 'budget');
  assert.equal(none.length, 0);
});

// ---------- a model that searches by itself, saved before the rule; OpenRouter's reasoning blocks in the chat's loop ----------

test('a saved model that searches by itself is refused on save, and again when the family\'s adapter is made', async () => {
  makeFamily('saved-search');
  const base = { features: { assistant: true, faces: false, avatar: false, arms: false }, webSearch: false, monthlyMicros: 5_000_000, customPrices: {}, apiKey: KEY };
  await assert.rejects(
    setup.setUpFamilyAi('saved-search', 'u1', { ...base, provider: 'openai', model: 'gpt-4o-search-preview' }),
    (e: unknown) => e instanceof AiError && e.code === 'bad-input',
  );
  await setup.setUpFamilyAi('saved-search', 'u1', { ...base, provider: 'openai', model: 'gpt-5' });
  await accounts().run("UPDATE ai_route SET model = ? WHERE tree = ? AND route = 'assistant'", 'o3-deep-research', 'saved-search');
  await assert.rejects(
    settings.adapterForFeature('saved-search', 'assistant', 'en'),
    (e: unknown) => e instanceof AiError && e.code === 'bad-input',
  );
});

test('a reasoning reply\'s blocks go back with its tool calls: the chat\'s second request carries them unchanged', async () => {
  makeFamily('reasoning');
  await setup.setUpFamilyAi('reasoning', 'u1', {
    provider: 'openrouter', model: 'openai/gpt-5', features: { assistant: true, faces: false, avatar: false, arms: false },
    webSearch: false, monthlyMicros: 5_000_000, customPrices: {}, apiKey: KEY,
  });
  const details = [{ type: 'reasoning.encrypted', id: 'r1', format: 'anthropic-claude-v1', index: 0, data: 'SIGNED-BLOCK' }];
  const sent = stubOpenRouter([
    () => json({ choices: [{ finish_reason: 'tool_calls', message: { content: null, reasoning_details: details, tool_calls: [{ id: 'c1', function: { name: 'search_people', arguments: '{"query":"Anna"}' } }] } }], usage: { prompt_tokens: 50, completion_tokens: 10 } }),
    () => json({ choices: [{ finish_reason: 'stop', message: { content: 'Anna Kramer is in the tree.' } }], usage: { prompt_tokens: 80, completion_tokens: 6 } }),
  ]);
  const { items } = await chat.sendMessage({ tree: 'reasoning', user: 'u1', role: 'viewer', me: null, text: 'Who is Anna?', locale: 'en' });
  assert.equal(items.at(-1)!.text, 'Anna Kramer is in the tree.');
  assert.equal(sent.length, 2, 'the tool call, then the answer');
  const turn = sent[1].body.messages.find((m: { role: string }) => m.role === 'assistant');
  assert.ok(turn, 'the second request carries the assistant turn');
  assert.deepEqual(turn.reasoning_details, details, 'with its reasoning blocks, unchanged');
  assert.equal(turn.tool_calls[0].id, 'c1');
  assert.equal(sent[1].body.reasoning.effort, 'low');
});

