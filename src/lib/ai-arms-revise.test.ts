// node --test src/lib/ai-arms-revise.test.ts — new arms from the check's feedback: what the call carries (the feedback, the saved
// meanings and the arms as they are, with no web search), the feedback's words as candidate charges, the two kinds of
// suggestion (a refinement keeps the arms and adds the charge; a fresh design draws on a chosen meaning), the one retry, the
// role and feature checks, and the budget. A stub adapter stands in for the model; no key is read and nothing is sent.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { AsyncLocalStorage } from 'node:async_hooks';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-arms-revise-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_SECRET = 'arms-revise-test-secret';
delete process.env.KINDRED_AI_FAKE;

type ArmsV2 = import('./seed-format.ts').ArmsV2;

const TREE = 'family';
const HOUSE = 'h1';
const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { openSqlite, closeAccounts } = await load<typeof import('./store/node.ts')>('/src/lib/store/node.ts');
const { store } = await load<typeof import('./store/index.ts')>('/src/lib/store/index.ts');
const { startSession } = await load<typeof import('./auth/session.server.ts')>('/src/lib/auth/session.server.ts');
const { newUser, upsertMembership } = await load<typeof import('./auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const arms = await load<typeof import('./ai/arms.server.ts')>('/src/lib/ai/arms.server.ts');
const { aiArmsRevisions } = await load<typeof import('./ai/arms.functions.ts')>('/src/lib/ai/arms.functions.ts');
const { saveSettings, budgeted, spentThisMonth, OFF } = await load<typeof import('./ai/settings.server.ts')>('/src/lib/ai/settings.server.ts');
const { saveProviderKey } = await load<typeof import('./ai/providers.server.ts')>('/src/lib/ai/providers.server.ts');
const { tr } = await load<typeof import('./ai/labels.ts')>('/src/lib/ai/labels.ts');
const { AiError } = await load<typeof import('./ai/adapters.ts')>('/src/lib/ai/adapters.ts');
const { armsV2Schema } = await load<typeof import('./heraldry/schema.ts')>('/src/lib/heraldry/schema.ts');
const { chargesOverlap } = await load<typeof import('./heraldry/clear-layout.ts')>('/src/lib/heraldry/clear-layout.ts');
const { blazonV2 } = await load<typeof import('./heraldry/blazon.ts')>('/src/lib/heraldry/blazon.ts');

// The family's tree, with its house as it is: the budget and the steward's settings live with it.
const family = openSqlite(join(dir, `${TREE}.db`), 'tree', { create: true });
family.exec(`
  INSERT INTO meta (key, value) VALUES ('id', '${TREE}'), ('name', 'Family'), ('tagline', ''), ('theme', 'codex'), ('focus', 'ada');
  INSERT INTO house (id, name, arms) VALUES ('${HOUSE}', 'House Heer', '${JSON.stringify({ shield: 'heater', field: { division: 'plain', tinctures: ['azure'], line: 'straight' }, layers: [{ type: 'charge', charge: 'lion', tincture: 'or', count: 1, arrangement: 'auto', on: 'field' }] })}');
  INSERT INTO person (id, given, house) VALUES ('ada', 'Ada', '${HOUSE}');
`);
family.close();

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

// ---------- the house as it is: a blue shield with a golden lion ----------

const HOUSE_ARMS: ArmsV2 = {
  shield: 'heater',
  field: { division: 'plain', tinctures: ['azure'], line: 'straight' },
  layers: [{ type: 'charge', charge: 'lion', tincture: 'or', count: 1, arrangement: 'auto', on: 'field' }],
};
const FEEDBACK = {
  reason: 'The house charge stands for a home, hearth and family. Nothing in the arms speaks to the steward of the estate.',
  advice: 'Add a charge or tincture that speaks to the estate steward’s role, such as a key or staff of office for the manager of the manor farm.',
};
const CHOSEN = [
  { id: 'm1', language: 'Dutch and German', root: 'heer', meaning: 'lord, gentleman', attestation: 'well-attested' as const, ideas: [{ kind: 'trade' as const, idea: 'a steward of an estate' }] },
  { id: 'm2', language: 'German', root: 'hehr', meaning: 'noble, honourable', attestation: 'well-attested' as const, ideas: [{ kind: 'quality' as const, idea: 'honour' }] },
];

// ---------- a stub model: each call takes the next scripted answer (or throws it) ----------

type Answer = { json: unknown } | Error;
function stub(answers: Answer[]) {
  const calls: { system: string; text: string; name: string | undefined; webSearch: unknown }[] = [];
  let i = 0;
  const adapter = {
    provider: 'fake' as const,
    model: 'stub',
    async complete(req: { system: string; messages: { role: string; text?: string }[]; json?: { name: string }; webSearch?: unknown }) {
      const user = [...req.messages].reverse().find((m) => m.role === 'user')?.text ?? '';
      calls.push({ system: req.system, text: user, name: req.json?.name, webSearch: req.webSearch });
      const a = answers[Math.min(i++, answers.length - 1)];
      if (a instanceof Error) throw a;
      return { text: '', calls: [], json: a.json, tokens: 60, inputTokens: 40, outputTokens: 20, searches: 0 };
    },
  };
  return { adapter: adapter as never, calls };
}

const REFINE_KEY = { meaningId: 'm1', explanation: 'A key beside the lion, for the steward’s office.', charges: [{ charge: 'key', tincture: 'or', on: 'chief' }] };
const REFINE_GARB = { meaningId: 'm2', explanation: 'A garb on the field, for the manor farm.', charges: [{ charge: 'garb', tincture: 'argent', on: 'field' }] };
const DESIGN = (explanation: string, meaningId: string, charge: string) => ({ explanation, meaningId, field: ['azure'], charges: [{ charge, tincture: 'or', count: 1 }] });
const GOOD = {
  refinements: [REFINE_KEY, REFINE_GARB],
  designs: [DESIGN('A lion for the lord', 'm1', 'lion'), DESIGN('A tower for the house', 'm2', 'tower'), DESIGN('A key for the office', 'm1', 'key')],
};
const REQ = { surname: 'Heer', country: 'NL', meanings: CHOSEN, arms: HOUSE_ARMS, feedback: FEEDBACK, locale: 'en' as const };

// ---------- the call: what it carries ----------

test('the feedback, the saved meanings and the arms as they are reach the prompt, with no web search', async () => {
  const s = stub([{ json: GOOD }]);
  await arms.reviseArms({ adapter: s.adapter, ...REQ });
  const c = s.calls[0];
  assert.equal(c.name, 'arms_revisions');
  assert.equal(c.webSearch, undefined, 'no web search');
  assert.match(c.text, /^Surname: Heer$/m);
  assert.match(c.text, /^Reason: The house charge stands for a home/m);
  assert.match(c.text, /^What to change: Add a charge or tincture that speaks to the estate steward/m);
  assert.match(c.text, /^m1: "heer" \(Dutch and German\): lord, gentleman, well attested\./m);
  assert.match(c.text, /^Blazon: /m);
  assert.match(c.text, /^Charges now: lion \(Lion/m, 'the charges now, by id, so a refinement can keep them');
  assert.match(c.system, /"refinements"/);
  assert.match(c.system, /"designs"/);
  assert.match(c.system, /Never say that the family bore these arms/, 'the shared design rules are in the prompt');
});

test('the feedback’s words are candidate charges, listed before the ones the meanings fit', async () => {
  const s = stub([{ json: GOOD }]);
  await arms.reviseArms({ adapter: s.adapter, ...REQ });
  const system = s.calls[0].system;
  const askedAt = system.indexOf('Charges that answer to what the check asks for:');
  const fitAt = system.indexOf('Charges whose names fit the chosen meanings:');
  assert.ok(askedAt >= 0, 'a block for the feedback’s charges');
  assert.ok(askedAt < fitAt, 'and it comes first');
  const asked = system.slice(askedAt, fitAt);
  assert.match(asked, /^key \(/m, '"key" in the feedback finds the key charge');
});

test('the plain design call (step two) has no block for a check’s words, and its rules are the same as the revision’s', async () => {
  const d = stub([{ json: { suggestions: [DESIGN('A lion', 'm1', 'lion'), DESIGN('A key', 'm1', 'key'), DESIGN('A tower', 'm2', 'tower')] } }]);
  await arms.designArms({ adapter: d.adapter, surname: 'Heer', meanings: CHOSEN, locale: 'en' });
  assert.doesNotMatch(d.calls[0].system, /what the check asks for/);
  const r = stub([{ json: GOOD }]);
  await arms.reviseArms({ adapter: r.adapter, ...REQ });
  const rule = 'Do not put a detailed charge on a narrow ordinary';
  assert.ok(d.calls[0].system.includes(rule) && r.calls[0].system.includes(rule), 'both prompts carry the one rule text');
});

// ---------- the two kinds of suggestion ----------

test('a refinement keeps the arms as they are and adds the charge the check asks for, tinctured to stand clear of the field', async () => {
  const s = stub([{ json: GOOD }]);
  const out = await arms.reviseArms({ adapter: s.adapter, ...REQ });
  const refinements = out.filter((r) => r.kind === 'refinement');
  assert.equal(refinements.length, 2);
  const [first] = refinements;
  assert.deepEqual(first.arms.field, HOUSE_ARMS.field, 'the field is kept');
  assert.ok(first.arms.layers.some((l) => JSON.stringify(l) === JSON.stringify(HOUSE_ARMS.layers[0])), 'the house charge is kept, unchanged');
  const last = first.arms.layers.at(-1)!;
  assert.equal(last.type === 'charge' && last.charge, 'key');
  assert.deepEqual(first.added, ['key']);
  assert.equal(first.meaningId, 'm1');
  assert.equal(first.meaning, 'heer: lord, gentleman');
  assert.ok(armsV2Schema.safeParse(first.arms).success);
});

test('a refinement that would break the rule of tincture is repaired, not sent as it was asked', async () => {
  // Gold asked for on a gold-on-azure field is fine; a colour asked on the blue field is not: it is moved to the metal.
  const clash = { ...REFINE_KEY, charges: [{ charge: 'key', tincture: 'azure', on: 'field' }] };
  const s = stub([{ json: { refinements: [clash, REFINE_GARB], designs: GOOD.designs } }]);
  const out = await arms.reviseArms({ adapter: s.adapter, ...REQ });
  const repaired = out.find((r) => r.kind === 'refinement')!;
  const under = repaired.arms.layers.find((l) => l.type === 'ordinary' && l.kind === 'chief')!;
  assert.notEqual(repaired.arms.layers.at(-1)!.tincture, under.tincture, 'it stands clear of the chief it lies on');
});

test('fresh designs draw on a chosen meaning and are valid arms, labelled as fresh', async () => {
  const s = stub([{ json: GOOD }]);
  const out = await arms.reviseArms({ adapter: s.adapter, ...REQ });
  const fresh = out.filter((r) => r.kind === 'fresh');
  assert.equal(fresh.length, 3);
  for (const f of fresh) {
    assert.ok(['m1', 'm2'].includes(f.meaningId), 'draws on a chosen meaning');
    assert.ok(armsV2Schema.safeParse(f.arms).success);
    assert.ok(f.explanation.length > 0);
  }
  // Refinements come first, then the fresh designs.
  assert.deepEqual(out.map((r) => r.kind), ['refinement', 'refinement', 'fresh', 'fresh', 'fresh']);
});

test('a refinement that names no chosen meaning is left out', async () => {
  const unknown = { ...REFINE_KEY, meaningId: 'm9' };
  const s = stub([{ json: { refinements: [unknown, REFINE_GARB], designs: GOOD.designs } }]);
  const out = await arms.reviseArms({ adapter: s.adapter, ...REQ });
  assert.equal(s.calls.length, 1);
  assert.deepEqual(out.filter((r) => r.kind === 'refinement').map((r) => r.added), [['garb']]);
});

// ---------- a refinement must look good ----------

const KEY_ON_SABLE: ArmsV2 = { shield: 'heater', field: { division: 'plain', tinctures: ['sable'], line: 'straight' }, layers: [{ type: 'charge', charge: 'key', tincture: 'or', count: 1, arrangement: 'auto', on: 'field' }] };
const refined = async (armsNow: ArmsV2, refinements: unknown[]) => {
  const s = stub([{ json: { refinements, designs: GOOD.designs } }]);
  const out = await arms.reviseArms({ adapter: s.adapter, ...REQ, arms: armsNow });
  return { list: out.filter((r) => r.kind === 'refinement'), fresh: out.filter((r) => r.kind === 'fresh') };
};
const groupsOf = (a: ArmsV2) => a.layers.filter((l) => l.type === 'charge');

test('a garb asked for on top of the key gets a chief of its own, and the key stays clear of it', async () => {
  const { list } = await refined(KEY_ON_SABLE, [{ meaningId: 'm1', explanation: 'A golden sheaf for the manor farm.', charges: [{ charge: 'garb', tincture: 'or', on: 'field' }] }]);
  assert.equal(list.length, 1);
  const [{ arms: a }] = list;
  assert.equal(chargesOverlap(a), false);
  assert.deepEqual(a.layers.filter((l) => l.type === 'ordinary').map((l) => l.kind), ['chief']);
  assert.deepEqual(groupsOf(a).map((l) => [l.charge, l.on]), [['key', 'field'], ['garb', 'chief']]);
  assert.match(blazonV2(a), /chief/);
});

test('without somewhere clear to go, a refinement is dropped, and the fresh designs still come', async () => {
  // A cross runs through the chief and the field alike, so a new charge has no space of its own.
  const crossed: ArmsV2 = { ...KEY_ON_SABLE, layers: [{ type: 'ordinary', kind: 'cross', tincture: 'argent', line: 'straight' }] };
  const { list, fresh } = await refined(crossed, [{ meaningId: 'm1', explanation: 'A garb.', charges: [{ charge: 'garb', on: 'field' }] }]);
  assert.deepEqual(list, []);
  assert.equal(fresh.length, 3);
});

test('two groups of charges are the most a refinement leaves: a third is dropped, a replacement is not', async () => {
  const two: ArmsV2 = { ...KEY_ON_SABLE, layers: [{ type: 'ordinary', kind: 'chief', tincture: 'or', line: 'straight' }, ...KEY_ON_SABLE.layers, { type: 'charge', charge: 'garb', tincture: 'sable', count: 1, arrangement: 'auto', on: 'chief' }] };
  const added = await refined(two, [{ meaningId: 'm1', explanation: 'A third.', charges: [{ charge: 'lion', on: 'base' }] }]);
  assert.deepEqual(added.list, []);
  const swapped = await refined(two, [{ meaningId: 'm1', explanation: 'A plough for the garb.', charges: [{ charge: 'plough', tincture: 'sable', replaces: 'garb' }] }]);
  assert.equal(swapped.list.length, 1);
  assert.deepEqual(swapped.list[0].replaced, [{ from: 'garb', to: 'plough' }]);
  assert.deepEqual(groupsOf(swapped.list[0].arms).map((l) => l.charge), ['key', 'plough']);
});

test('the same refinement asked for twice is shown once', async () => {
  const { list } = await refined(KEY_ON_SABLE, [REFINE_KEY, { ...REFINE_KEY, explanation: 'Again.' }]);
  assert.equal(list.length, 1);
});

test('the check for a clean drawing sees charges on top of each other, and a lone charge as clear', () => {
  const stacked: ArmsV2 = { ...KEY_ON_SABLE, layers: [...KEY_ON_SABLE.layers, { type: 'charge', charge: 'garb', tincture: 'or', count: 1, arrangement: 'auto', on: 'field' }] };
  assert.equal(chargesOverlap(stacked), true);
  assert.equal(chargesOverlap(KEY_ON_SABLE), false);
});

test('fewer than two fresh designs is bad output: asked once more, then refused in the reader’s language', async () => {
  const short = { refinements: [REFINE_KEY], designs: GOOD.designs.slice(0, 1) };
  const good = stub([{ json: short }, { json: GOOD }]);
  const out = await arms.reviseArms({ adapter: good.adapter, ...REQ });
  assert.equal(good.calls.length, 2);
  assert.equal(out.length, 5);

  const twice = stub([{ json: short }, { json: { refinements: 'nope' } }]);
  await assert.rejects(
    arms.reviseArms({ adapter: twice.adapter, ...REQ, locale: 'de' }),
    (e: unknown) => e instanceof AiError && e.code === 'bad-output' && e.message.length > 0,
  );
  assert.equal(twice.calls.length, 2);
});

// ---------- the budget and the roles ----------

const PRICE = { inPerM: 1, outPerM: 2, searchEach: 0.01 };
const c = tr('en');

test('the call goes through the family’s budget: refused before it is sent when the budget cannot pay, booked when it can', async () => {
  const broke = stub([{ json: GOOD }]);
  await assert.rejects(arms.reviseArms({ adapter: budgeted(TREE, 1, broke.adapter, PRICE, c), ...REQ }), (e: unknown) => e instanceof AiError && e.code === 'budget');
  assert.equal(broke.calls.length, 0, 'nothing was sent');

  // The budget is the family's: its spend is read from the family's own settings.
  const steward = await memberWith('steward');
  await connectAndSwitchOn(steward.id, 5_000_000);
  const before = await spentThisMonth(TREE);
  const ok = stub([{ json: GOOD }]);
  const out = await arms.reviseArms({ adapter: budgeted(TREE, 5_000_000, ok.adapter, PRICE, c), ...REQ });
  assert.equal(out.length, 5);
  assert.ok((await spentThisMonth(TREE)) > before, 'the call was booked against the budget');
});

test('a viewer and an editor are refused the suggestions, and nothing is asked; a stranger is signed out first', async () => {
  const viewer = await memberWith('viewer');
  const editor = await memberWith('editor');
  for (const reader of [viewer, editor]) {
    await assert.rejects(asReader(reader.cookie, () => aiArmsRevisions({ data: revisionData() })));
  }
  await assert.rejects(asReader(undefined, () => aiArmsRevisions({ data: revisionData() })));
});

test('with the arms feature off, a steward gets no suggestions and nothing is asked', async () => {
  const steward = await memberWith('steward');
  await saveSettings(TREE, steward.id, { features: { ...OFF, arms: false }, webSearch: false, monthlyMicros: 5_000_000, customPrices: {} });
  await assert.rejects(asReader(steward.cookie, () => aiArmsRevisions({ data: revisionData() })), (e: unknown) => e instanceof AiError && e.code === 'not-configured');
});

test('with the budget at zero, a steward is refused before the model is called', async () => {
  const steward = await memberWith('steward');
  await connectAndSwitchOn(steward.id, 0);
  await assert.rejects(asReader(steward.cookie, () => aiArmsRevisions({ data: revisionData() })), (e: unknown) => e instanceof AiError && e.code === 'budget');
});

// ---------- helpers for the server function ----------

/** Connects a provider with a placeholder key (it is never sent: every call here is refused first) and switches arms on. */
async function connectAndSwitchOn(by: string, monthlyMicros: number) {
  await saveProviderKey(TREE, by, 'anthropic', 'sk-test-0123456789');
  // The arms route follows the assistant's provider, so the assistant route names the connected one.
  await saveSettings(TREE, by, { features: { ...OFF, arms: true }, webSearch: false, monthlyMicros, customPrices: {}, routes: [{ route: 'assistant', provider: 'anthropic', model: '' }] });
}

function revisionData() {
  return { tree: TREE, surname: 'Heer', country: 'NL', locale: 'en', meanings: CHOSEN, arms: HOUSE_ARMS, feedback: FEEDBACK };
}

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
