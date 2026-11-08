// node --test scripts/ai-eval.test.ts — the model test's scorers, its budget stop, its handling of a failing model, and that
// the key reaches no output or report. Stub adapters stand in for the providers (no call leaves the process); the made-up
// family is written into a temporary folder, and the dry run is checked to send nothing. Run from the repository root.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { AiAdapter, AiReply, AiRequest } from '../src/lib/ai/adapters.ts';
import type { Proposal } from '../src/lib/ai/types.ts';

const dir = mkdtempSync(join(tmpdir(), 'kindred-ai-eval-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_SECRET = 'ai-eval-test-secret';

const ev = await import('./ai-eval.ts');
const fixtures = await import('./ai-eval.fixtures.ts');
ev.seedFamily(dir);
const { server, close } = await ev.loadServer();

test.after(async () => {
  await close();
  rmSync(dir, { recursive: true, force: true });
});

const plain = (text = 'stub'): AiReply => ({ text, calls: [], tokens: 0, inputTokens: 0, outputTokens: 0, searches: 0 });
/** A stub adapter: counts the calls it receives, and answers each one. `cost` is what each call reports, in USD. */
function stub(model: string, answer: (req: AiRequest) => AiReply | Error, cost = 0): AiAdapter & { calls: number } {
  const s = {
    calls: 0,
    provider: 'anthropic' as const,
    model,
    async complete(req: AiRequest): Promise<AiReply> {
      s.calls++;
      const a = answer(req);
      if (a instanceof Error) throw a;
      return cost ? { ...a, reportedCostUsd: cost } : a;
    },
  };
  return s;
}
const opts = (over: Partial<import('./ai-eval.ts').RunOptions> = {}) => ({
  provider: 'anthropic' as const, models: ['claude-haiku-5-5'], maxUsd: 1, web: false, out: join(dir, `report-${Math.random().toString(36).slice(2)}.md`), dryRun: false, ...over,
});

test('a name is scored by its expected meanings, and a made-up name must not be stated as certain', () => {
  const muller = fixtures.NAME_CASES.find((c) => c.surname === 'Müller')!;
  assert.equal(ev.scoreName(muller, [{ root: 'Müller', meaning: 'miller', attestation: 'well-attested' }]).pass, true);
  assert.equal(ev.scoreName(muller, [{ root: 'Müller', meaning: 'king', attestation: 'well-attested' }]).pass, false, 'a wrong meaning is missing the expected one');
  const sjoberg = fixtures.NAME_CASES.find((c) => c.surname === 'Sjöberg')!;
  const lakeOnly = ev.scoreName(sjoberg, [{ root: 'sjö', meaning: 'lake', attestation: 'well-attested' }]);
  assert.equal(lakeOnly.pass, false, 'the mountain half is missing');
  assert.match(lakeOnly.note, /missing: mountain/);
  const trap = fixtures.NAME_CASES.at(-1)!;
  assert.equal(ev.scoreName(trap, [{ root: 'zorbelwitz', meaning: 'the grinder', attestation: 'well-attested' }]).pass, false, 'invented certainty is penalised');
  assert.equal(ev.scoreName(trap, [{ root: 'zorbelwitz', meaning: 'unknown, maybe a grinder', attestation: 'speculative' }]).pass, true);
});

test('the tincture rule refuses metal on metal and colour on colour, and accepts a contrast', () => {
  const kind = (t: string) => (t === 'or' || t === 'argent' ? 'metal' : 'colour');
  const lion = (field: string[], tincture: string) => ({ field: { tinctures: field }, layers: [{ type: 'charge', charge: 'lion', tincture, on: 'field' }] });
  assert.equal(ev.ruleHolds(lion(['argent'], 'or'), kind), false);
  assert.equal(ev.ruleHolds(lion(['azure'], 'gules'), kind), false);
  assert.equal(ev.ruleHolds(lion(['azure'], 'or'), kind), true);
});

test('a reply is checked for its language and for the informal form', () => {
  assert.equal(ev.languageOk('de', 'Ruth Weber wurde 1931 in Lindenau geboren, und sie hat auch Kuchen gebacken.').ok, true);
  assert.equal(ev.languageOk('de', 'Haben Sie noch Fragen zu Ruth Weber?').ok, false, 'a formal “Sie” fails');
  assert.equal(ev.languageOk('de', 'Ruth was born in 1931 in Lindenau.').ok, false, 'an English reply fails');
  assert.equal(ev.languageOk('af', 'Ruth is in 1931 in Lindenau gebore. Jy kan dit nie vergeet nie.').ok, true);
  assert.equal(ev.languageOk('af', 'U kan dit by die boom vind, en u het nie vrae nie.').ok, false, 'the formal “u” fails');
});

test('a one-line answer in the language passes, and a wrong-language one says which words failed it', () => {
  assert.equal(ev.languageOk('af', 'Ruth Weber is op 14 Maart 1952 in Pretoria gebore.').ok, true, 'one Afrikaans word is enough for a fact');
  assert.equal(ev.languageOk('de', 'Ruth Weber, geboren 1952 in Pretoria.').ok, true);
  const en = ev.languageOk('af', 'Ruth Weber was born in 1952 in Pretoria.');
  assert.equal(en.ok, false);
  assert.equal(en.reason, 'not Afrikaans: was, born', 'the reason names the English words');
  assert.equal(ev.languageOk('af', 'Ruth Weber, 1952, Pretoria.').reason, 'not Afrikaans: no Afrikaans word');
  assert.equal(ev.languageOk('de', 'Ruth was born in 1931.').reason, 'not German: was, born');
});

test('an arms answer that fails a check names the check; a sound set of designs passes', () => {
  const charge = Object.keys(server.catalogue.CHARGE_BY_ID)[0]!;
  const good = server.canting.ideaToArms({ field: ['azure'], charges: [{ charge, tincture: 'or' }] } as never, { seed: 1 });
  const design = (arms: unknown, meaningId = 'm1') => ({ arms, explanation: 'The lord’s gold.', meaningId, meaning: 'lord' }) as never;
  const raw = { suggestions: [] };
  const sound = ev.scoreDesigns(server, [design(good), design(good), design(good)], ['m1'], raw);
  assert.equal(sound.pass, true, sound.note);
  assert.equal(sound.note, '3 designs, 0 repairs');

  // The same charge on the field's own colour: the tincture rule fails, and the note says so.
  const clash = structuredClone(good);
  const c = clash.layers.find((l) => l.type === 'charge')!;
  (c as { tincture: string }).tincture = 'azure';
  const tincture = ev.scoreDesigns(server, [design(clash), design(good), design(good)], ['m1'], raw);
  assert.equal(tincture.pass, false);
  assert.equal(tincture.note, '3 designs, not valid: tincture rule');

  assert.match(ev.scoreDesigns(server, [design(good)], ['m1'], raw).note, /not valid: fewer than three designs \(1\)/);
  assert.match(ev.scoreDesigns(server, [design(good, 'm9'), design(good), design(good)], ['m1'], raw).note, /no chosen meaning named/);
});

test('a tool answer must name the tool, the facts, and say an unrecorded thing is not recorded, without an invented year', () => {
  const sc = fixtures.TOOL_CASES.find((c) => c.id === 'not-recorded')!;
  const years = new Set(['1948']);
  assert.equal(ev.scoreTool(sc, { text: 'The tree does not record a ship for Hans in 1948.', calls: ['search_people'] }, years).pass, true);
  assert.equal(ev.scoreTool(sc, { text: 'He sailed on the Bremen.', calls: [] }, years).pass, false, 'no statement that it is not recorded');
  assert.equal(ev.scoreTool(sc, { text: 'Not recorded. He sailed in 1923.', calls: [] }, years).pass, false, 'an invented year fails');
  const right = fixtures.TOOL_CASES.find((c) => c.id === 'right-tool')!;
  assert.equal(ev.scoreTool(right, { text: 'Ruth was born in 1931 in Lindenau.', calls: ['search_people', 'read_person'] }, years).pass, true);
  assert.equal(ev.scoreTool(right, { text: 'Ruth was born in 1931 in Lindenau.', calls: [] }, years).pass, false, 'the right tool must be called');
});

test('a proposal request yields a card of the right kind, and a reply that says it saved is refused', () => {
  const memory = fixtures.PROPOSAL_CASES.find((c) => c.id === 'memory')!;
  const card: Proposal = { id: 'p1', kind: 'add-story', summary: 'x', diff: [], args: { person: 'ruth', kind: 'memory', body: 'Plum cake.' }, editable: [], status: 'open' };
  assert.equal(ev.scoreProposal(memory, { text: 'I have a card for you to approve.', proposals: [card] }).pass, true);
  assert.equal(ev.scoreProposal(memory, { text: 'I have added it to the tree.', proposals: [card] }).pass, false, 'it must not claim a write');
  assert.equal(ev.scoreProposal(memory, { text: 'Done.', proposals: [] }).pass, false, 'no card, no pass');
});

test('the generated picture is a PNG', () => {
  const bytes = Buffer.from(ev.testImageBase64(), 'base64');
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test('the command line: the required options, the defaults, and the usage errors', () => {
  const o = ev.parseArgs(['--provider', 'openai', '--models', 'gpt-6-luna, gpt-5-mini']);
  assert.deepEqual(o.models, ['gpt-6-luna', 'gpt-5-mini']);
  assert.equal(o.maxUsd, 1);
  assert.equal(o.out, ev.DEFAULT_OUT);
  assert.equal(o.web, false);
  assert.throws(() => ev.parseArgs(['--provider', 'anthropic']), ev.UsageError);
  assert.throws(() => ev.parseArgs(['--provider', 'mistral', '--models', 'x']), ev.UsageError);
  assert.throws(() => ev.parseArgs(['--provider', 'anthropic', '--models', 'x', '--max-usd', '0']), ev.UsageError);
  assert.throws(() => ev.parseArgs(['--provider', 'anthropic', '--models', 'x', '--key', 'sk']), ev.UsageError);
});

test('the budget stops the run before a call would pass it, and the stopped items are skipped', async () => {
  const s = stub('claude-haiku-5-5', () => plain('ok'), 0.4);
  const run = await ev.runEval(opts({ out: join(dir, 'budget.md') }), { server, adapterFor: () => s, log: () => {} });
  assert.equal(s.calls, 3, 'three calls at $0.40 reach $1.20: the fourth is never sent');
  assert.equal(run.results[0].spentMicros, 1_200_000);
  assert.ok(run.results[0].tasks.some((t) => t.items.some((i) => i.skipped)), 'the stopped items are reported as skipped');
});

test('the key reaches no output, log line or report, even when a provider echoes it', async () => {
  const KEY = 'sk-ant-api03-TEST-KEY-9f3c2b71';
  const bad: AiAdapter = {
    provider: 'anthropic',
    model: 'bad-model',
    async complete(): Promise<AiReply> {
      throw new Error(`401: the key ${KEY} was not accepted`);
    },
  };
  const good = stub('good-model', () => plain('ok'));
  const lines: string[] = [];
  const out = join(dir, 'key-report.md');
  const run = await ev.runEval(opts({ models: ['bad-model', 'good-model'], key: KEY, out }), {
    server,
    adapterFor: (m) => (m === 'bad-model' ? bad : good),
    log: (l) => lines.push(l),
  });
  const report = readFileSync(out, 'utf8');
  for (const text of [run.table, report, lines.join('\n')]) assert.equal(text.includes(KEY), false, 'the key must not appear');
  assert.equal(run.results.length, 2, 'one failing model does not stop the other');
  assert.ok(run.results[1].tasks.length > 0, 'the good model still ran its tasks');
  assert.match(report, /\d{4}-\d{2}-\d{2}/, 'the report is dated');
  assert.match(report, /## Method/);
});

test('a model that cannot be built is reported in the table, and the others still run', async () => {
  const good = stub('good-model', () => plain('ok'));
  const run = await ev.runEval(opts({ models: ['no-such-model', 'good-model'] }), {
    server,
    adapterFor: (m) => {
      if (m === 'no-such-model') throw new Error('bad-input: the model is not offered');
      return good;
    },
    log: () => {},
  });
  assert.equal(run.results[0].error, 'bad-input: the model is not offered');
  assert.match(run.table, /error/);
  assert.ok(run.results[1].tasks.length > 0);
});

test('a dry run sends nothing and estimates the cost of the plan', async () => {
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (async () => {
    fetched++;
    throw new Error('fetch must not be called in a dry run');
  }) as typeof fetch;
  const out = join(dir, 'dry-run.md');
  try {
    const run = await ev.runEval(opts({ dryRun: true, web: true, out }), {
      server,
      adapterFor: () => {
        throw new Error('adapterFor must not be called in a dry run');
      },
      log: () => {},
    });
    assert.equal(fetched, 0);
    assert.match(run.plan, /Names\s+9 items/);
    assert.match(run.plan, /Web/);
    assert.match(run.plan, /total/);
    assert.equal(existsSync(out), false, 'a dry run writes no report');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('the assistant’s tools read the made-up family, and a proposal is a card, not a write', () => {
  const ctx = { tree: fixtures.TREE_ID, role: 'editor' as const, me: null, locale: 'en' as const };
  const out: Proposal[] = [];
  const found = server.tools.runTool(ctx, 'search_people', { query: 'Ruth' }, out);
  return found.then(async (text) => {
    assert.match(text, /"id":"ruth"/);
    const person = await server.tools.runTool(ctx, 'read_person', { id: 'ruth' }, out);
    assert.match(person, /1931/);
    assert.match(person, /Lindenau/);
    assert.equal(out.length, 0);
    await server.tools.runTool(ctx, 'propose_add_story', { person: 'ruth', kind: 'memory', body: 'Plum cake every September.' }, out);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.kind, 'add-story');
    assert.equal(out[0]!.status, 'open');
  });
});

test('the pass rates leave out what the budget skipped, and a failed task counts as zero', () => {
  const items = [{ id: 'a', pass: true }, { id: 'b', pass: false }, { id: 'c', pass: false, skipped: true }];
  assert.equal(ev.passRate(items), 0.5);
  assert.equal(ev.passRate([{ id: 'c', pass: false, skipped: true }]), null);
  assert.equal(ev.overall([{ id: 'names', items }, { id: 'arms', items: [], error: 'boom' }]), 0.25);
  assert.equal(ev.redact('key sk-SECRET-1234 here', 'sk-SECRET-1234'), 'key [key] here');
});
