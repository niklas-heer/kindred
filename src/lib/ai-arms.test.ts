// node --test src/lib/ai-arms.test.ts — arms from a surname in two steps: what each call carries (the family's own
// words never reach a web-enabled call; the public search sees the surname and country only), when web search is
// offered and what it may cite, the shape of both answers, the one retry on bad output, the tincture repair and dropped
// charges, and the whole flow on the fake provider. A stub adapter stands in for the provider; no key is read and
// nothing is sent anywhere.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-ai-arms-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_AI_FAKE = '1';
process.env.KINDRED_SECRET = 'ai-arms-test-secret';

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const arms = await load<typeof import('./ai/arms.server.ts')>('/src/lib/ai/arms.server.ts');
const { fakeAdapter } = await load<typeof import('./ai/fake.ts')>('/src/lib/ai/fake.ts');
const { AiError } = await load<typeof import('./ai/adapters.ts')>('/src/lib/ai/adapters.ts');
const { translate } = await load<typeof import('./i18n/dictionary.ts')>('/src/lib/i18n/dictionary.ts');
const { closeAccounts } = await load<typeof import('./store/node.ts')>('/src/lib/store/node.ts');

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

// ---------- a stub provider: each call takes the next scripted answer (or throws it) ----------

type Answer = { json?: unknown; text?: string; sources?: { url: string; title?: string }[]; searches?: number } | Error;
interface Recorded { system: string; text: string; messages: number; raw: string; webSearch?: { maxUses?: number }; name: string | undefined; timeoutMs?: number; maxTokens?: number; hasTool: boolean }
function stub(answers: Answer[]) {
  const calls: Recorded[] = [];
  let i = 0;
  const adapter = {
    provider: 'fake' as const,
    model: 'stub',
    async complete(req: { system: string; messages: { role: string; text?: string }[]; json?: { name: string }; webSearch?: { maxUses?: number }; timeoutMs?: number; maxTokens?: number }) {
      const user = [...req.messages].reverse().find((m) => m.role === 'user')?.text ?? '';
      calls.push({ system: req.system, text: user, messages: req.messages.length, raw: JSON.stringify(req), webSearch: req.webSearch, name: req.json?.name, timeoutMs: req.timeoutMs, maxTokens: req.maxTokens, hasTool: !!req.json });
      const a = answers[Math.min(i++, answers.length - 1)];
      if (a instanceof Error) throw a;
      // A forced JSON tool answers in json; free text (a web search) answers in text.
      const text = a.text ?? JSON.stringify(a.json);
      const searches = a.searches ?? (a.sources ? 1 : 0);
      return { text, calls: [], json: req.json ? a.json : undefined, tokens: 10, inputTokens: 5, outputTokens: 5, searches, ...(a.sources ? { sources: a.sources } : {}) };
    },
  };
  return { adapter: adapter as never, calls };
}

const LORD = { language: 'Dutch and German', root: 'heer', meaning: 'lord, gentleman', attestation: 'well-attested', ideas: [{ kind: 'quality', idea: 'a lord’s courage' }], sources: [] };
const HONOUR = { language: 'German', root: 'hehr', meaning: 'noble, honourable', attestation: 'well-attested', ideas: [{ kind: 'quality', idea: 'honour' }], sources: ['https://de.wiktionary.org/wiki/hehr'] };
const HOST = { language: 'German', root: 'Heer', meaning: 'army, host', attestation: 'well-attested', ideas: [{ kind: 'object', idea: 'a banner over a host' }], sources: [] };
const bad = { meanings: [{ language: 'x', root: 'x', meaning: 'x', attestation: 'nonsense', ideas: [] }] };
const HEHR_PAGE = { url: 'https://de.wiktionary.org/wiki/hehr', title: 'hehr: Wiktionary' };

const DESIGN = (explanation: string, meaningId: string, field: string[], charges: { charge: string; tincture?: string; count?: number }[]) =>
  ({ explanation, meaningId, field, charges });
const CHOSEN = [
  { id: 'm1', language: 'Dutch and German', root: 'heer', meaning: 'lord, gentleman', attestation: 'well-attested' as const, ideas: [] },
  { id: 'm2', language: 'German', root: 'hehr', meaning: 'noble, honourable', attestation: 'well-attested' as const, ideas: [] },
];

// ---------- step one: the research, without the web ----------

test('step one carries the family’s own words and the country, and puts the family’s meaning first, unchanged', async () => {
  const s = stub([{ json: { meanings: [LORD, HONOUR] } }]);
  const out = await arms.researchName({ adapter: s.adapter, webSearch: false, surname: 'Heer', country: 'NL', familyHint: 'in our family it means honourable', locale: 'en' });
  const c = s.calls[0];
  assert.match(c.text, /^Surname: Heer$/m);
  assert.match(c.text, /^Country \(ISO code\): NL$/m);
  assert.match(c.text, /^The family says: "in our family it means honourable"$/m);
  assert.equal(c.name, 'name_meaning');
  assert.match(c.system, /most important input/);
  assert.match(c.system, /Never invent a historic family/);
  // The family's own meaning was not among the candidates, so it leads, in their words.
  assert.equal(out.meanings[0].attestation, 'family');
  assert.equal(out.meanings[0].meaning, 'in our family it means honourable');
  assert.deepEqual(out.meanings.map((m) => m.id), ['m1', 'm2', 'm3']);
});

test('a family meaning the model restates is kept, and the family’s own words replace a different one', async () => {
  const restated = { language: '', root: '', meaning: 'army', attestation: 'family', ideas: [{ kind: 'object', idea: 'a banner' }], sources: [] };
  const s = stub([{ json: { meanings: [LORD, restated] } }]);
  const out = await arms.researchName({ adapter: s.adapter, webSearch: false, surname: 'Heer', familyHint: 'honourable', locale: 'en' });
  assert.equal(out.meanings[0].attestation, 'family');
  assert.equal(out.meanings[0].meaning, 'honourable');
  assert.equal(out.meanings.filter((m) => m.attestation === 'family').length, 1);
  assert.equal(out.meanings.length, 2);
});

test('without a family meaning, a model’s "family" entry is treated as speculative; candidates stay distinct', async () => {
  const claim = { ...LORD, attestation: 'family' };
  const s = stub([{ json: { meanings: [claim, { ...LORD }, HOST] } }]);
  const out = await arms.researchName({ adapter: s.adapter, webSearch: false, surname: 'Heer', locale: 'en' });
  assert.equal(out.meanings[0].attestation, 'speculative');
  assert.equal(out.meanings.length, 2);
  assert.equal(out.meanings[1].root, 'Heer');
});

test('an honest empty answer is an empty list, not an error', async () => {
  const s = stub([{ json: { meanings: [], note: 'Little is known of this name.' } }]);
  const out = await arms.researchName({ adapter: s.adapter, webSearch: false, surname: 'Qwrtz', locale: 'en' });
  assert.deepEqual(out.meanings, []);
  assert.equal(out.note, 'Little is known of this name.');
});

test('a null note is an honest "nothing to add": it is no note, and it costs no retry', async () => {
  const s = stub([{ json: { meanings: [LORD], note: null } }]);
  const out = await arms.researchName({ adapter: s.adapter, webSearch: false, surname: 'Heer', locale: 'en' });
  assert.equal(s.calls.length, 1, 'no retry');
  assert.equal(out.note, undefined);
  assert.equal(out.meanings.length, 1);
});

test('without web search the research is one call with no web, and says so', async () => {
  const off = stub([{ json: { meanings: [HONOUR] } }]);
  const r2 = await arms.researchName({ adapter: off.adapter, webSearch: false, surname: 'Heer', locale: 'en' });
  assert.equal(off.calls.length, 1);
  assert.equal(off.calls[0].webSearch, undefined);
  assert.equal(r2.webSearched, false);
  assert.match(off.calls[0].system, /cannot search the web/);
  assert.deepEqual(r2.meanings[0].sources ?? [], []);
});

test('bad output is retried once; a second bad answer is a clear error in the reader’s language', async () => {
  const good = stub([{ json: bad }, { json: { meanings: [LORD] } }]);
  const out = await arms.researchName({ adapter: good.adapter, webSearch: false, surname: 'Heer', locale: 'en' });
  assert.equal(good.calls.length, 2);
  assert.equal(out.meanings.length, 1);

  const twice = stub([{ json: bad }, { json: { meanings: 'nope' } }]);
  await assert.rejects(
    arms.researchName({ adapter: twice.adapter, webSearch: false, surname: 'Heer', locale: 'de' }),
    (e: unknown) => e instanceof AiError && e.code === 'bad-output' && e.message === translate('de', 'ai.errBadOutput'),
  );
  assert.equal(twice.calls.length, 2);
});

test('an adapter’s bad-output error is retried too, while other provider errors are not', async () => {
  const shape = stub([new AiError('bad-output', 'ai.err_shape'), { json: { meanings: [LORD] } }]);
  await arms.researchName({ adapter: shape.adapter, webSearch: false, surname: 'Heer', locale: 'en' });
  assert.equal(shape.calls.length, 2);

  const down = stub([new AiError('provider', 'Anthropic answered 500.')]);
  await assert.rejects(arms.researchName({ adapter: down.adapter, webSearch: false, surname: 'Heer', locale: 'en' }), (e: unknown) => e instanceof AiError && e.code === 'provider');
  assert.equal(down.calls.length, 1);
});

test('the prompts are in the reader’s language, with German in du and Afrikaans in jy', async () => {
  const s = stub([{ json: { meanings: [] } }, { json: { meanings: [] } }]);
  await arms.researchName({ adapter: s.adapter, webSearch: false, surname: 'Heer', locale: 'de' });
  await arms.researchName({ adapter: s.adapter, webSearch: false, surname: 'Heer', locale: 'af' });
  assert.match(s.calls[0].system, /German \(du\)/);
  assert.match(s.calls[1].system, /Afrikaans \(jy\)/);
});

// ---------- step one with the web: the search sees the surname and country, nothing else ----------

test('web search is offered only when the family allows it, and then with three searches at most, in a call of its own', async () => {
  const on = stub([{ text: 'Heer: lord (Dutch). Hehr: noble (German).', sources: [HEHR_PAGE] }, { json: { meanings: [HONOUR] } }]);
  const r1 = await arms.researchName({ adapter: on.adapter, webSearch: true, surname: 'Heer', country: 'NL', familyHint: 'honourable', locale: 'en' });
  assert.equal(on.calls.length, 2, 'the search, then the meanings');
  assert.deepEqual(on.calls[0].webSearch, { maxUses: 3 });
  assert.equal(on.calls[0].hasTool, false, 'a forced tool would stop the search');
  assert.equal(on.calls[1].webSearch, undefined, 'the meanings are made with no web search');
  assert.match(on.calls[1].system, /holds research notes from a public web search/);
  assert.equal(r1.webSearched, true);

  const off = stub([{ json: { meanings: [HONOUR] } }]);
  const r2 = await arms.researchName({ adapter: off.adapter, webSearch: false, surname: 'Heer', locale: 'en' });
  assert.equal(off.calls[0].webSearch, undefined);
  assert.equal(r2.webSearched, false);
  assert.match(off.calls[0].system, /cannot search the web/);
});

test('the web-enabled calls carry only a fixed instruction and the surname and country: the family’s words reach no search', async () => {
  const SECRET = 'a-private-family-remark-7f3a';
  const notes = { text: 'Heer: lord (Dutch). Hehr: noble (German).', sources: [HEHR_PAGE] };
  const first = stub([notes, { json: { meanings: [HONOUR] } }]);
  const out = await arms.researchName({ adapter: first.adapter, webSearch: true, surname: 'Heer', country: 'NL', familyHint: SECRET, locale: 'en' });
  // The same search with no hint, in another language: the instruction is the same, and the search is the same.
  const second = stub([notes, { json: { meanings: [HONOUR] } }]);
  await arms.researchName({ adapter: second.adapter, webSearch: true, surname: 'Heer', country: 'NL', locale: 'de' });

  const searches = [...first.calls, ...second.calls].filter((c) => c.webSearch);
  assert.equal(searches.length, 2);
  for (const c of searches) {
    assert.equal(c.messages, 1, 'one message: no family text, no earlier turns');
    assert.equal(c.text, 'Surname: Heer\nCountry (ISO code): NL');
    assert.ok(!c.raw.includes(SECRET), 'the family’s words are in no web-enabled request');
  }
  assert.equal(searches[0].system, searches[1].system, 'the instruction is fixed, whatever the hint and the language');

  // The family's words lead the meanings, and go only to the call that has no web search.
  assert.equal(first.calls[1].webSearch, undefined);
  assert.match(first.calls[1].text, new RegExp(`^The family says: "${SECRET}"$`, 'm'));
  assert.equal(out.meanings[0].attestation, 'family');
  assert.equal(out.meanings[0].meaning, SECRET);
});

test('the meanings call is given the search notes and the pages it returned, and may cite only those pages', async () => {
  const s = stub([
    { text: 'Hehr: noble, honourable (German).', sources: [HEHR_PAGE] },
    { json: { meanings: [{ ...HONOUR, sources: [HEHR_PAGE.url, 'https://example.invalid/made-up'] }] } },
  ]);
  await arms.researchName({ adapter: s.adapter, webSearch: true, surname: 'Heer', locale: 'en' });
  const meanings = s.calls[1];
  assert.match(meanings.text, /^Research notes from a public web search for the surname \(not from the family\):$/m);
  assert.match(meanings.text, /^Hehr: noble, honourable \(German\)\.$/m);
  assert.match(meanings.text, /^https:\/\/de\.wiktionary\.org\/wiki\/hehr \(hehr: Wiktionary\)$/m);
  assert.match(meanings.system, /Build the meanings from those notes/);
});

test('the search notes are cut to a sensible size before the meanings call', async () => {
  const s = stub([{ text: 'x'.repeat(20_000), sources: [HEHR_PAGE] }, { json: { meanings: [HONOUR] } }]);
  await arms.researchName({ adapter: s.adapter, webSearch: true, surname: 'Heer', locale: 'en' });
  assert.ok(s.calls[1].text.length < 7_000, `the meanings call is ${s.calls[1].text.length} characters`);
});

test('a model that ran no search says so: the meanings come from its own knowledge, with no sources', async () => {
  const s = stub([{ text: 'Heer means lord, I think.' }, { json: { meanings: [HONOUR] } }]);
  const out = await arms.researchName({ adapter: s.adapter, webSearch: true, surname: 'Heer', locale: 'en' });
  assert.equal(s.calls[0].webSearch?.maxUses, 3, 'the search was offered');
  assert.equal(s.calls[1].webSearch, undefined);
  assert.match(s.calls[1].system, /cannot search the web/);
  assert.equal(out.webSearched, false);
  assert.deepEqual(out.meanings[0].sources ?? [], []);
});

test('sources are kept only when the search returned them, and only the pages the meaning cites', async () => {
  const s = stub([
    { text: 'Hehr: noble.', sources: [HEHR_PAGE] },
    { json: { meanings: [{ ...HONOUR, sources: [HEHR_PAGE.url, 'https://example.invalid/made-up'] }] } },
  ]);
  const out = await arms.researchName({ adapter: s.adapter, webSearch: true, surname: 'Heer', locale: 'en' });
  assert.deepEqual(out.meanings[0].sources, [HEHR_PAGE]);

  // Without a search, nothing the model names is shown as a source.
  const off = stub([{ json: { meanings: [HONOUR] }, sources: [HEHR_PAGE] }]);
  const out2 = await arms.researchName({ adapter: off.adapter, webSearch: false, surname: 'Heer', locale: 'en' });
  assert.deepEqual(out2.meanings[0].sources ?? [], []);
});

test('an empty search answer is bad output and is retried once', async () => {
  const s = stub([{ text: '   ', sources: [HEHR_PAGE] }, { text: 'Hehr: noble.', sources: [HEHR_PAGE] }, { json: { meanings: [HONOUR] } }]);
  const out = await arms.researchName({ adapter: s.adapter, webSearch: true, surname: 'Heer', locale: 'en' });
  assert.equal(s.calls.length, 3);
  assert.equal(out.webSearched, true);
});

// ---------- step two: the designs ----------

test('designs draw on the chosen meanings; unknown charges are dropped; a tincture clash is repaired', async () => {
  const s = stub([{ json: { suggestions: [
    DESIGN('A lion for courage', 'm1', ['gules'], [{ charge: 'lion', tincture: 'gules' }, { charge: 'not-a-charge' }]),
    DESIGN('Three stars for honour', 'm2', ['azure'], [{ charge: 'mullet', tincture: 'or', count: 3 }]),
    DESIGN('A tower for the house', 'm1', ['vert'], [{ charge: 'tower', tincture: 'argent' }]),
    DESIGN('Draws on nothing chosen', 'm9', ['azure'], [{ charge: 'lion', tincture: 'or' }]),
  ] } }]);
  const out = await arms.designArms({ adapter: s.adapter, surname: 'Heer', country: 'NL', meanings: CHOSEN, locale: 'en' });
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((d) => d.meaningId), ['m1', 'm2', 'm1']);
  const lion = out[0].arms.layers.find((l) => l.type === 'charge');
  assert.ok(lion && lion.type === 'charge');
  assert.equal(lion.charge, 'lion');
  assert.notEqual(lion.tincture, 'gules', 'a lion may not be gules on a gules field');
  assert.ok(['or', 'argent'].includes(lion.tincture));
  // The unknown charge is gone: one charge, not two.
  assert.equal(out[0].arms.layers.filter((l) => l.type === 'charge').length, 1);
  assert.equal(out[0].meaning, 'heer: lord, gentleman');
  assert.equal(out[0].explanation, 'A lion for courage');
});

test('a design whose only charges are unknown is dropped, and too few usable designs is bad output', async () => {
  const s = stub([
    { json: { suggestions: [
      DESIGN('Nothing real', 'm1', ['azure'], [{ charge: 'no-such-thing' }]),
      DESIGN('A star', 'm2', ['gules'], [{ charge: 'mullet', tincture: 'or' }]),
      DESIGN('A tower', 'm1', ['vert'], [{ charge: 'tower', tincture: 'argent' }]),
    ] } },
    { json: { suggestions: [DESIGN('One only', 'm1', ['azure'], [{ charge: 'lion', tincture: 'or' }])] } },
  ]);
  await assert.rejects(arms.designArms({ adapter: s.adapter, surname: 'Heer', meanings: CHOSEN, locale: 'en' }), (e: unknown) => e instanceof AiError && e.code === 'bad-output');
  assert.equal(s.calls.length, 2, 'one retry, then the error');
});

test('bad design output is retried once, then succeeds', async () => {
  const s = stub([
    { json: { suggestions: 'not a list' } },
    { json: { suggestions: [
      DESIGN('A lion', 'm1', ['azure'], [{ charge: 'lion', tincture: 'or' }]),
      DESIGN('A star', 'm2', ['gules'], [{ charge: 'mullet', tincture: 'or', count: 3 }]),
      DESIGN('A tower', 'm1', ['vert'], [{ charge: 'tower', tincture: 'argent' }]),
    ] } },
  ]);
  const out = await arms.designArms({ adapter: s.adapter, surname: 'Heer', meanings: CHOSEN, locale: 'en' });
  assert.equal(out.length, 3);
  assert.equal(s.calls.length, 2);
});

test('the design prompt carries the chosen meanings, the family’s words, the country and the charge list, at a sensible size', async () => {
  const s = stub([{ json: { suggestions: [
    DESIGN('A', 'own1', ['azure'], [{ charge: 'lion', tincture: 'or' }]),
    DESIGN('B', 'm1', ['gules'], [{ charge: 'mullet', tincture: 'or' }]),
    DESIGN('C', 'm1', ['vert'], [{ charge: 'tower', tincture: 'argent' }]),
  ] } }]);
  const family = { id: 'own1', language: '', root: '', meaning: 'honourable', attestation: 'family' as const, ideas: [] };
  await arms.designArms({ adapter: s.adapter, surname: 'Heer', country: 'NL', familyHint: 'honourable', meanings: [family, CHOSEN[0]], locale: 'en' });
  const c = s.calls[0];
  assert.match(c.text, /^Country \(ISO code\): NL$/m);
  assert.match(c.text, /^The family says: "honourable"$/m);
  assert.match(c.text, /^own1: the family's own meaning, in their words: "honourable"\. Heraldic ideas: none\.$/m);
  assert.match(c.text, /^m1: "heer" \(Dutch and German\): lord, gentleman, well attested\./m);
  assert.match(c.system, /lion \(Lion’s head; löwe/);
  assert.match(c.system, /metal \(or, argent\) on colour/);
  assert.ok(c.system.length < 16_000, `design prompt is ${c.system.length} characters`);
});

test('the design call asks for the canting shape, with a sensible token budget and timeout', async () => {
  const s = stub([{ json: { suggestions: [
    DESIGN('A', 'm1', ['azure'], [{ charge: 'lion', tincture: 'or' }]),
    DESIGN('B', 'm2', ['gules'], [{ charge: 'mullet', tincture: 'or' }]),
    DESIGN('C', 'm1', ['vert'], [{ charge: 'tower', tincture: 'argent' }]),
  ] } }]);
  await arms.designArms({ adapter: s.adapter, surname: 'Heer', meanings: CHOSEN, locale: 'en' });
  assert.equal(s.calls[0].name, 'arms_designs');
  assert.ok((s.calls[0].maxTokens ?? 0) >= 2000 && (s.calls[0].maxTokens ?? 0) <= 4000);
  assert.ok((s.calls[0].timeoutMs ?? 0) > 0 && (s.calls[0].timeoutMs ?? 0) <= 90_000);
});

// ---------- the whole flow on the fake provider, with a Heer-like example and sources ----------

test('the flow runs on the fake provider: Heer’s three meanings with sources, then three designs on the chosen ones', async () => {
  const fake = fakeAdapter('fake');
  const research = await arms.researchName({ adapter: fake, webSearch: true, surname: 'Heer', country: 'NL', locale: 'en' });
  assert.deepEqual(research.meanings.map((m) => m.root), ['heer', 'hehr', 'Heer']);
  assert.equal(research.webSearched, true);
  assert.ok(research.meanings.every((m) => (m.sources ?? []).length === 1));
  assert.equal(research.meanings[1].sources?.[0].title, 'hehr: Wiktionary');

  const chosen = research.meanings.filter((m) => m.root !== 'Heer');
  const designs = await arms.designArms({ adapter: fake, surname: 'Heer', country: 'NL', meanings: chosen, locale: 'en' });
  assert.equal(designs.length, 3);
  assert.ok(designs.every((d) => chosen.some((m) => m.id === d.meaningId)));
});

test('without web search the fake answers from its own knowledge, with no sources', async () => {
  const research = await arms.researchName({ adapter: fakeAdapter('fake'), webSearch: false, surname: 'Heer', locale: 'en' });
  assert.equal(research.webSearched, false);
  assert.ok(research.meanings.every((m) => (m.sources ?? []).length === 0));
  assert.match(research.note ?? '', /own knowledge/);
});
