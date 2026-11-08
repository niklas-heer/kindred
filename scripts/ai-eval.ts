// Measures which models do Kindred's own AI jobs, on made-up data only: name meanings, arms designs, tool use, proposals,
// the answer language, a face-box shape and (with --web) one web-search lookup. Every call goes through the real adapter,
// and the prompts and functions are the app's own (researchName, designArms, systemPrompt, toolsFor, runTool). A budget
// shared by all models stops the run before a call would pass it. The key is never printed, logged or written.
//
//   node scripts/ai-eval.ts --provider anthropic --models claude-haiku-5-5,claude-sonnet-5-5 [--max-usd 1] [--web]
//   node scripts/ai-eval.ts --provider anthropic --models claude-haiku-5-5 --dry-run   (plan and estimate; no call)
//
// The key: KINDRED_AI_EVAL_KEY, or --saved-family <id> for the family's saved key (needs KINDRED_DATA_DIR, the family's own
// folder). KINDRED_AI_FAKE=1 runs every task on the fake provider (nothing is sent). The synthetic family is written to a
// temporary folder that is removed afterwards; the real data folder is never opened, except to read the saved key.
// Run as `mise run ai-eval -- <options>`. Tests: scripts/ai-eval.test.ts.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import { z } from 'zod';
import { costMicros, MICROS_PER_USD, PRICES_CHECKED, PRICES_SOURCES, resolvePrice, searchReserveMicros, type Price } from '../src/lib/ai/prices.ts';
import type { AiAdapter, AiMessage, AiReply, AiRequest } from '../src/lib/ai/adapters.ts';
import type { NameDesign, NameMeaning, Proposal, Provider, AiLocale } from '../src/lib/ai/types.ts';
import type { TinctureV2 } from '../src/lib/seed-format.ts';
import { ARMS_CASES, FAMILY, LANGUAGE_CASES, NAME_CASES, PROPOSAL_CASES, TOOL_CASES, TREE_ID, VISION_QUESTION, WEB_CASE, type NameCase, type ProposalCase, type ToolCase } from './ai-eval.fixtures.ts';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_OUT = 'docs/ai-model-test.md';
const PROVIDERS = ['anthropic', 'openai', 'openrouter'] as const;
const MAX_STEPS = 5;
/** The number of requests an Anthropic search turn may take (adapters.ts callRounds): the cost estimate counts them. */
const ANTHROPIC_SEARCH_ROUNDS = 3;
/** Input tokens a generated picture is taken to cost (adapters.ts IMAGE_TOKENS), and a search's results (SEARCH_TOKENS). */
const IMAGE_TOKENS = 2000;
const SEARCH_TOKENS = 4000;

/** The modules of the app, loaded through Vite (their imports use the `~/` alias that plain Node does not resolve). */
export interface Server {
  arms: typeof import('../src/lib/ai/arms.server.ts');
  adapters: typeof import('../src/lib/ai/adapters.ts');
  tools: typeof import('../src/lib/ai/tools.server.ts');
  prompt: typeof import('../src/lib/ai/prompt.ts');
  types: typeof import('../src/lib/ai/types.ts');
  canting: typeof import('../src/components/heraldry/canting.ts');
  catalogue: typeof import('../src/components/heraldry/catalogue.ts');
  tinctures: typeof import('../src/components/heraldry/tinctures.ts');
  schema: typeof import('../src/components/heraldry/schema.ts');
  fake: typeof import('../src/lib/ai/fake.ts');
  models: typeof import('../src/lib/ai/models.server.ts');
  settings: typeof import('../src/lib/ai/settings.server.ts');
  secret: typeof import('../src/lib/ai/secret.server.ts');
  store: typeof import('../src/lib/store/node.ts');
}

export type TaskId = 'names' | 'arms' | 'tools' | 'proposals' | 'language' | 'vision' | 'web';
/** `callsPerItem`: the requests one item makes (the cost estimate multiplies the first request by it). */
export const TASKS: { id: TaskId; title: string; callsPerItem: number; webOnly?: boolean }[] = [
  { id: 'names', title: 'Names', callsPerItem: 1 },
  { id: 'arms', title: 'Arms', callsPerItem: 2 },
  { id: 'tools', title: 'Tools', callsPerItem: 2 },
  { id: 'proposals', title: 'Proposals', callsPerItem: 2 },
  { id: 'language', title: 'Language', callsPerItem: 2 },
  { id: 'vision', title: 'Vision', callsPerItem: 1 },
  { id: 'web', title: 'Web', callsPerItem: 2, webOnly: true },
];

export interface Item { id: string; pass: boolean; skipped?: boolean; note?: string; repairs?: number }
export interface TaskResult { id: TaskId; items: Item[]; error?: string }
export interface ModelResult { model: string; tasks: TaskResult[]; error?: string; spentMicros: number; latencyMs: number | null; calls: number; failures: number }
export interface RunOptions { provider: Provider; models: string[]; maxUsd: number; web: boolean; out: string; dryRun: boolean; key?: string }
export interface Listed { price?: Price; reasoning?: boolean }
/** What the run needs from its caller: the app's modules, an adapter for each model, the OpenRouter price list, and a log. */
export interface Deps {
  server: Server;
  adapterFor(model: string, listed: Listed | undefined): AiAdapter;
  listedFor?(model: string): Promise<Listed | undefined>;
  log(line: string): void;
}
export interface RunOutput { results: ModelResult[]; table: string; plan: string; reportPath?: string }

// ---------- pure helpers: budget, cost, scoring ----------

/** Thrown in place of a call the budget would not pass. Never reaches the provider. */
export class BudgetStop extends Error { constructor() { super('the budget would be passed by this call'); this.name = 'BudgetStop'; } }
/** Thrown by the dry run's recording adapter, once per planned call. Never reaches the provider. */
export class DryRunStop extends Error { constructor() { super('dry run'); this.name = 'DryRunStop'; } }
export class UsageError extends Error { constructor(message: string) { super(message); this.name = 'UsageError'; } }

export interface Meter { capMicros: number; spentMicros: number }

/** What a finished call cost, in micro-dollars: the provider's reported USD figure when it gives one, else its usage at the price. */
export function replyMicros(u: { reportedCostUsd?: number; inputTokens: number; outputTokens: number; searches: number }, price: Price): number {
  if (typeof u.reportedCostUsd === 'number') return Math.ceil(Math.max(0, u.reportedCostUsd) * MICROS_PER_USD);
  return costMicros(u, price);
}

/**
 * What a failed call is charged: the requests that completed (billed), plus the in-flight request when it may have billed;
 * nothing for a typed refusal (a rate limit, a bad key, a refused request); the estimate otherwise. Mirrors the app's budget.
 */
export function failureMicros(e: unknown, estimate: number, price: Price): number {
  const err = e as { code?: unknown; billed?: { inputTokens: number; outputTokens: number; searches: number }; inFlight?: boolean } | null;
  const code = typeof err?.code === 'string' ? err.code : undefined;
  if (err?.billed) return replyMicros(err.billed, price) + (err.inFlight && (code === 'timeout' || code === 'bad-output') ? estimate : 0);
  if (code !== undefined && code !== 'timeout' && code !== 'bad-output') return 0;
  return estimate;
}

/**
 * The most a call may cost, before it is sent: its input (estimated from its text, two characters a token, as the app does),
 * its reply's cap, every request an Anthropic search turn may take, and the searches' reserve.
 */
export function estimateCall(req: AiRequest, price: Price, cap: number, provider: string): number {
  const rounds = provider === 'anthropic' && req.webSearch && !req.json ? ANTHROPIC_SEARCH_ROUNDS : 1;
  const images = req.messages.reduce((n, m) => n + (m.role === 'user' ? (m.images?.length ?? 0) : 0), 0);
  const payload = JSON.stringify({ system: req.system, messages: req.messages.map((m) => (m.role === 'user' ? { role: m.role, text: m.text } : m)), tools: req.tools, json: req.json });
  const searches = req.webSearch && !req.json ? (req.webSearch.maxUses ?? 3) : 0;
  const inputTokens = Math.ceil(payload.length / 2) + images * IMAGE_TOKENS + searches * SEARCH_TOKENS;
  return costMicros({ inputTokens: rounds * inputTokens, outputTokens: rounds * cap, searches: 0 }, price) + searchReserveMicros(searches, price);
}

interface Stats { started: number; failures: number; skipped: number; latency: number[] }

/**
 * The adapter the tasks call. Before a call is sent, its estimate is added to the spend: a call that would take the run past
 * the cap is refused (BudgetStop) and never sent. After it, the spend is what the call cost, or what a failure billed.
 */
export function metered(base: AiAdapter, o: { meter: Meter; price: Price; cap: (req: AiRequest) => number; stats: Stats; captured: Map<string, unknown>; now: () => number }): AiAdapter {
  return {
    provider: base.provider,
    model: base.model,
    reasoning: base.reasoning,
    async complete(req: AiRequest): Promise<AiReply> {
      const estimate = estimateCall(req, o.price, o.cap(req), base.provider);
      if (o.meter.spentMicros + estimate > o.meter.capMicros) {
        o.stats.skipped++;
        throw new BudgetStop();
      }
      const started = o.now();
      o.stats.started++;
      try {
        const reply = await base.complete(req);
        o.meter.spentMicros += replyMicros(reply, o.price);
        o.stats.latency.push(o.now() - started);
        if (req.json) o.captured.set(req.json.name, reply.json);
        return reply;
      } catch (e) {
        o.meter.spentMicros += failureMicros(e, estimate, o.price);
        o.stats.failures++;
        throw e;
      }
    },
  };
}

/** Years in a text, as four digits. */
const yearsIn = (s: string): string[] => [...s.matchAll(/\b(1[0-9]{3}|20[0-9]{2})\b/g)].map((m) => m[1]!);

/** A name's candidates against the case. Missing groups fail; a candidate stated as certain that the case does not expect is invented certainty. */
export function scoreName(c: NameCase, meanings: { root: string; meaning: string; attestation: string }[]): { pass: boolean; note: string } {
  const text = (m: { root: string; meaning: string }) => `${m.root} ${m.meaning}`.toLowerCase();
  if (c.expect.length === 0) {
    const certain = meanings.filter((m) => m.attestation === 'well-attested').length;
    return { pass: certain === 0, note: certain ? `${certain} stated as certain` : 'no certain meaning' };
  }
  const missing = c.expect.filter((g) => !meanings.some((m) => g.some((w) => text(m).includes(w)))).map((g) => g[0]);
  const allowed = [...c.expect.flat(), ...(c.also ?? [])];
  const invented = meanings.filter((m) => m.attestation === 'well-attested' && !allowed.some((w) => text(m).includes(w))).length;
  const notes = [missing.length ? `missing: ${missing.join(', ')}` : '', invented ? `${invented} stated as certain` : ''].filter(Boolean);
  return { pass: missing.length === 0 && invented === 0, note: notes.join('; ') || 'ok' };
}

/** The tincture rule: no metal on metal and no colour on colour, each layer against what it sits on (field, ordinary, chief or base). */
export function ruleHolds(arms: ArmsLike, kind: (t: string) => string): boolean {
  const field = arms.field.tinctures;
  const ordinaryOf = (k: string) => arms.layers.filter((l) => l.type === 'ordinary' && l.kind === k).map((l) => l.tincture ?? '');
  for (const l of arms.layers) {
    if (!l.tincture || l.tincture === 'proper') continue;
    const under = l.type === 'charge' && l.on === 'ordinary' ? arms.layers.filter((o) => o.type === 'ordinary' && o.kind !== 'base' && o.kind !== 'chief').map((o) => o.tincture ?? '')
      : l.type === 'charge' && l.on === 'chief' ? ordinaryOf('chief')
      : l.type === 'charge' && l.on === 'base' ? ordinaryOf('base')
      : field;
    const k = kind(l.tincture);
    for (const u of under) if (u && kind(u) === k && (k === 'metal' || k === 'colour')) return false;
  }
  return true;
}
interface ArmsLike {
  field: { tinctures: readonly string[] };
  layers: readonly { type: string; kind?: string; tincture?: string; on?: string; charge?: string }[];
}

/** A design as the model first gave it, before the app repaired it: a charge on the field of its own kind. */
function rawClash(s: { field?: string[]; charges?: { tincture?: string; on?: string }[] }, kind: (t: string) => string): boolean {
  const f = s.field?.[0];
  if (!f) return false;
  return (s.charges ?? []).some((c) => c.tincture && (!c.on || c.on === 'field') && (kind(c.tincture) === kind(f)) && ['metal', 'colour'].includes(kind(f)));
}

const NOT_RECORDED = /\b(not recorded|isn['’]?t recorded|is not recorded|no records?|not in the tree|doesn['’]?t (say|record|mention)|does not (say|record|mention)|do not have|don['’]?t have|no information|not known|unknown|cannot find|can['’]?t find|no data|no such)\b/i;
const CLAIMS_SAVED = /\b(i (have )?(added|saved|recorded|updated)|i['’]ve (added|saved|recorded|updated)|has been (added|saved|updated))\b/i;

/** A tool-use answer: the right tool was called, the answer holds what the tree says, and an unrecorded thing is said so, with no invented year. */
export function scoreTool(sc: ToolCase, r: { text: string; calls: string[] }, allowedYears: Set<string>): { pass: boolean; note: string } {
  const mustTools = sc.mustTools;
  const toolOk = !mustTools || r.calls.some((c) => mustTools.includes(c));
  const text = r.text.toLowerCase();
  const missing = sc.mustText.filter((g) => !g.some((w) => text.includes(w))).map((g) => g[0]);
  const said = NOT_RECORDED.test(r.text);
  const invented = yearsIn(r.text).filter((y) => !allowedYears.has(y));
  const notes = [
    toolOk ? '' : 'no matching tool call',
    missing.length ? `missing: ${missing.join(', ')}` : '',
    sc.unrecorded && !said ? 'did not say it is not recorded' : '',
    invented.length ? `invented years: ${[...new Set(invented)].join(', ')}` : '',
  ].filter(Boolean);
  return { pass: toolOk && missing.length === 0 && (!sc.unrecorded || (said && invented.length === 0)), note: notes.join('; ') || 'ok' };
}

/** Whether a proposal card with the expected kind and arguments came back, and the reply does not say it already saved anything. */
export function scoreProposal(sc: ProposalCase, r: { text: string; proposals: Proposal[] }): { pass: boolean; note: string } {
  const matches = (args: Record<string, unknown>, k: string, v: string) => args[k] !== undefined && JSON.stringify(args[k]).replace(/\s/g, '').includes(v);
  const found = r.proposals.find((p) => p.kind === sc.kind && Object.entries(sc.expectArgs).every(([k, v]) => matches(p.args, k, v)));
  const claims = CLAIMS_SAVED.test(r.text);
  const notes = [found ? '' : `no ${sc.kind} card with the expected details`, claims ? 'says it already saved' : ''].filter(Boolean);
  return { pass: !!found && !claims, note: notes.join('; ') || 'ok' };
}

/**
 * A reply in the reader's language, with the informal "du" or "jy" and no formal address. Simple markers, as the task promises.
 * The question is one short fact, so the answer has few words: one word of the language that the other two do not use is
 * enough, with no word of either other language. The first real run failed every model's Afrikaans answer while the German
 * one passed. The likely cause is a two-word floor on a short answer, with a thin Afrikaans word list; the report keeps no
 * answers, so that is not confirmed. The reason names the words that failed the check.
 */
export function languageOk(locale: 'en' | 'de' | 'af', text: string): { ok: boolean; reason: string } {
  const t = text.trim();
  if (!t) return { ok: false, reason: 'empty reply' };
  const words = new Set(t.toLowerCase().match(/\p{L}+/gu) ?? []);
  const found = (list: string[]) => list.filter((w) => words.has(w));
  if (locale === 'de') {
    if (/(?<=[a-zäöüß,]\s)Sie\b|\bIhnen\b/.test(t)) return { ok: false, reason: 'formal “Sie”' };
    const right = found(['und', 'ist', 'nicht', 'ich', 'wurde', 'geboren', 'mit', 'auch', 'dass', 'das', 'eine']);
    const wrong = found(['the', 'and', 'was', 'born', 'with', 'is']);
    if (wrong.length) return { ok: false, reason: `not German: ${wrong.join(', ')}` };
    return right.length ? { ok: true, reason: 'German, du' } : { ok: false, reason: 'not German: no German word' };
  }
  if (locale === 'af') {
    if (/(^|\s)[Uu](?=[\s,.!?;:])/.test(t)) return { ok: false, reason: 'formal “u”' };
    const right = found(['jy', 'jou', 'nie', 'het', 'vir', 'ek', 'gebore', 'dit', 'saam', 'ons', 'hulle', 'wat', 'ook', 'maar', 'baie']);
    const wrong = found(['the', 'and', 'was', 'born', 'und', 'nicht', 'ist', 'geboren']);
    if (wrong.length) return { ok: false, reason: `not Afrikaans: ${wrong.join(', ')}` };
    return right.length ? { ok: true, reason: 'Afrikaans, jy' } : { ok: false, reason: 'not Afrikaans: no Afrikaans word' };
  }
  return { ok: true, reason: 'English' };
}

/** The picture the vision task sends: a pale face on a blue ground, drawn as a PNG with no image library. */
export function testImageBase64(size = 160): string {
  const w = size, h = size, stride = w * 3 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = y * stride + 1 + x * 3;
      const dx = (x - w / 2) / (w * 0.28), dy = (y - h / 2) / (h * 0.36);
      const eye = (Math.abs(x - w * 0.4) < 6 || Math.abs(x - w * 0.6) < 6) && Math.abs(y - h * 0.42) < 4;
      const px = eye ? [40, 30, 30] : dx * dx + dy * dy <= 1 ? [236, 196, 166] : [198, 214, 232];
      raw[o] = px[0]!; raw[o + 1] = px[1]!; raw[o + 2] = px[2]!;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return png.toString('base64');
}
const CRC_TABLE: number[] = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
}

/** The redaction every output passes through: the key never appears in a table, a log line or the report. */
export function redact(s: string, key?: string): string {
  return key && key.length >= 4 ? s.split(key).join('[key]') : s;
}

const describe = (e: unknown): string => {
  if (e instanceof Error) {
    const code = (e as { code?: unknown }).code;
    return `${typeof code === 'string' ? `${code}: ` : ''}${e.message}`.slice(0, 160);
  }
  return String(e).slice(0, 160);
};

// ---------- the app's modules, through Vite ----------

/** Loads the app's modules with Vite's SSR loader, as the AI tests do. Read the environment before calling this. */
export async function loadServer(): Promise<{ server: Server; close: () => Promise<void> }> {
  const vite = await createServer({ root: REPO, logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  const load = async <T>(path: string): Promise<T> => (await vite.ssrLoadModule(path)) as T;
  const server: Server = {
    arms: await load<Server['arms']>('/src/lib/ai/arms.server.ts'),
    adapters: await load<Server['adapters']>('/src/lib/ai/adapters.ts'),
    tools: await load<Server['tools']>('/src/lib/ai/tools.server.ts'),
    prompt: await load<Server['prompt']>('/src/lib/ai/prompt.ts'),
    types: await load<Server['types']>('/src/lib/ai/types.ts'),
    canting: await load<Server['canting']>('/src/components/heraldry/canting.ts'),
    catalogue: await load<Server['catalogue']>('/src/components/heraldry/catalogue.ts'),
    tinctures: await load<Server['tinctures']>('/src/components/heraldry/tinctures.ts'),
    schema: await load<Server['schema']>('/src/components/heraldry/schema.ts'),
    fake: await load<Server['fake']>('/src/lib/ai/fake.ts'),
    models: await load<Server['models']>('/src/lib/ai/models.server.ts'),
    settings: await load<Server['settings']>('/src/lib/ai/settings.server.ts'),
    secret: await load<Server['secret']>('/src/lib/ai/secret.server.ts'),
    store: await load<Server['store']>('/src/lib/store/node.ts'),
  };
  return {
    server,
    close: async () => {
      server.store.closeAccounts();
      server.store.closeDatabases();
      await vite.close();
    },
  };
}

/** Writes the made-up family into `dataDir` with the real seed script, so the app's own tree code reads it. */
export function seedFamily(dataDir: string): void {
  const dir = join(dataDir, 'seed');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${TREE_ID}.json`);
  writeFileSync(file, JSON.stringify(FAMILY));
  execFileSync(process.execPath, [join(REPO, 'scripts', 'seed.ts'), file], { cwd: REPO, env: { ...process.env, KINDRED_DATA_DIR: dataDir }, stdio: 'pipe' });
}

// ---------- the tasks ----------

interface Cx { server: Server; adapter: AiAdapter; captured: Map<string, unknown> }
type ToolCtx = Parameters<Server['tools']['runTool']>[0];
type Lang = 'en' | 'de' | 'af';

/** Runs one item. A budget refusal is a skipped item; a dry run's stop is a planned one; anything else is a failed item. */
async function item(id: string, fn: () => Promise<{ pass: boolean; note?: string; repairs?: number }>): Promise<Item> {
  try {
    return { id, ...(await fn()) };
  } catch (e) {
    if (e instanceof BudgetStop) return { id, pass: false, skipped: true, note: 'budget' };
    if (e instanceof DryRunStop) return { id, pass: false, note: 'dry run' };
    return { id, pass: false, note: describe(e) };
  }
}

/** The assistant's loop, as sendMessage runs it: the app's prompt and tools, the reader's role `editor`, up to MAX_STEPS tool turns. */
async function converse(cx: Cx, question: string, locale: Lang): Promise<{ text: string; calls: string[]; proposals: Proposal[] }> {
  const { server, adapter } = cx;
  const { tools, proposals: canPropose } = server.tools.toolsFor('editor', false);
  const system = server.prompt.systemPrompt({ locale: locale as AiLocale, family: FAMILY.name, readerName: null, kinToReader: null, canPropose, role: 'editor', webSearch: false });
  const messages: AiMessage[] = [{ role: 'user', text: question }];
  const ctx: ToolCtx = { tree: TREE_ID, role: 'editor', me: null, locale: locale as AiLocale };
  const out: Proposal[] = [];
  const calls: string[] = [];
  let text = '';
  for (let step = 0; ; step++) {
    const reply = await adapter.complete({ system, messages, tools, maxTokens: 1200, timeoutMs: 60_000 });
    if (!reply.calls.length || step >= MAX_STEPS) {
      text = reply.text.trim();
      break;
    }
    messages.push({ role: 'assistant', text: reply.text, calls: reply.calls, ...(reply.reasoningDetails ? { reasoningDetails: reply.reasoningDetails } : {}) });
    for (const call of reply.calls) {
      calls.push(call.name);
      messages.push({ role: 'tool', callId: call.id, content: await server.tools.runTool(ctx, call.name, call.args, out) });
    }
  }
  return { text, calls, proposals: out };
}

/**
 * Repairs the arms need (charges the catalogue lacks, designs the model's tincture clashed on, designs the app dropped), and
 * the checks the designs must pass. Each failed check is named in the note, so a failure can be told from a false negative.
 */
export function scoreDesigns(server: Server, designs: NameDesign[], chosenIds: string[], raw: unknown): { pass: boolean; note: string; repairs: number } {
  const parsed = server.canting.cantingResponseSchema.safeParse(raw);
  const suggestions = parsed.success ? parsed.data.suggestions : [];
  const kind = (t: string) => server.tinctures.kindOf(t as TinctureV2);
  const unknown = suggestions.reduce((n, s) => n + (s.charges ?? []).filter((c) => !server.catalogue.CHARGE_BY_ID[c.charge]).length, 0);
  const clashes = suggestions.filter((s) => rawClash(s, kind)).length;
  const dropped = Math.max(0, suggestions.length - designs.length);
  const repairs = unknown + clashes + dropped;
  const failed = new Set<string>();
  if (!parsed.success) failed.add('answer not in the shape');
  if (designs.length < 3) failed.add(`fewer than three designs (${designs.length})`);
  for (const d of designs) {
    if (!server.schema.armsV2Schema.safeParse(d.arms).success) failed.add('arms schema');
    if (!d.arms.layers.every((l) => l.type !== 'charge' || !!server.catalogue.CHARGE_BY_ID[l.charge])) failed.add('unknown charge');
    if (!ruleHolds(d.arms, kind)) failed.add('tincture rule');
    if (!chosenIds.includes(d.meaningId) || d.meaning.trim() === '' || d.explanation.trim() === '') failed.add('no chosen meaning named');
  }
  const pass = failed.size === 0;
  return { pass, repairs, note: pass ? `${designs.length} designs, ${repairs} repairs` : `${designs.length} designs, not valid: ${[...failed].join('; ')}` };
}

const RUNNERS: Record<TaskId, (cx: Cx) => Promise<Item[]>> = {
  async names(cx) {
    const out: Item[] = [];
    for (const c of NAME_CASES) {
      out.push(await item(c.surname, async () => {
        const r = await cx.server.arms.researchName({ adapter: cx.adapter, webSearch: false, surname: c.surname, country: c.country, locale: 'en' });
        return scoreName(c, r.meanings);
      }));
    }
    return out;
  },
  async arms(cx) {
    const out: Item[] = [];
    for (const c of ARMS_CASES) {
      out.push(await item(c.surname, async () => {
        const research = await cx.server.arms.researchName({ adapter: cx.adapter, webSearch: false, surname: c.surname, country: c.country, locale: 'en' });
        const chosen: NameMeaning[] = research.meanings.slice(0, 2);
        if (chosen.length === 0) return { pass: false, note: 'no meanings to design from' };
        cx.captured.delete('arms_designs');
        const designs = await cx.server.arms.designArms({ adapter: cx.adapter, surname: c.surname, country: c.country, meanings: chosen, locale: 'en' });
        return scoreDesigns(cx.server, designs, chosen.map((m) => m.id), cx.captured.get('arms_designs'));
      }));
    }
    return out;
  },
  async tools(cx) {
    const out: Item[] = [];
    for (const sc of TOOL_CASES) {
      out.push(await item(sc.id, async () => {
        const r = await converse(cx, sc.question, 'en');
        // A year the tree or the question holds is recorded; any other year in the reply is invented.
        const allowed = new Set([...yearsIn(JSON.stringify(FAMILY)), ...yearsIn(sc.question)]);
        return scoreTool(sc, r, allowed);
      }));
    }
    return out;
  },
  async proposals(cx) {
    const out: Item[] = [];
    for (const sc of PROPOSAL_CASES) {
      out.push(await item(sc.id, async () => {
        const r = await converse(cx, sc.question, 'en');
        return scoreProposal(sc, r);
      }));
    }
    return out;
  },
  async language(cx) {
    const out: Item[] = [];
    for (const lc of LANGUAGE_CASES) {
      out.push(await item(lc.locale, async () => {
        const r = await converse(cx, lc.question, lc.locale);
        const s = languageOk(lc.locale, r.text);
        return { pass: s.ok, note: s.reason };
      }));
    }
    return out;
  },
  async vision(cx) {
    const schema = (() => {
      const { $schema: _drop, ...rest } = z.toJSONSchema(cx.server.types.faceResultSchema) as Record<string, unknown>;
      return rest;
    })();
    return [await item('face-box', async () => {
      const reply = await cx.adapter.complete({
        system: 'You find the faces in a picture. Answer only in the JSON shape you are given.',
        messages: [{ role: 'user', text: VISION_QUESTION, images: [{ mime: 'image/png', base64: testImageBase64() }] }],
        json: { name: 'faces', schema },
        maxTokens: 1500,
        timeoutMs: 60_000,
      });
      const parsed = cx.server.types.faceResultSchema.safeParse(reply.json);
      if (!parsed.success) return { pass: false, note: 'not the face-box shape' };
      const inside = parsed.data.faces.every((f) => [f.box.x, f.box.y, f.box.w, f.box.h].every((v) => v >= 0 && v <= 1));
      return { pass: inside, note: inside ? `${parsed.data.faces.length} face boxes` : 'a box is outside 0 to 1' };
    })];
  },
  async web(cx) {
    return [await item(WEB_CASE.surname, async () => {
      const r = await cx.server.arms.researchName({ adapter: cx.adapter, webSearch: true, surname: WEB_CASE.surname, country: WEB_CASE.country, locale: 'en' });
      const hit = r.meanings.some((m) => `${m.root} ${m.meaning}`.toLowerCase().includes(WEB_CASE.expect));
      const sourced = r.meanings.some((m) => (m.sources ?? []).length > 0);
      const pass = r.webSearched && hit && sourced;
      return { pass, note: [r.webSearched ? '' : 'no web search ran', hit ? '' : 'meaning missing', sourced ? '' : 'no cited page'].filter(Boolean).join('; ') || 'ok' };
    })];
  },
};

// ---------- scoring a model ----------

/** The share of the items that ran which passed; null when none ran (all skipped by the budget). */
export function passRate(items: Item[]): number | null {
  const ran = items.filter((i) => !i.skipped);
  return ran.length ? ran.filter((i) => i.pass).length / ran.length : null;
}

/** The overall score: the mean of each task's pass rate, a task that failed counts 0, one the budget skipped is left out. */
export function overall(tasks: TaskResult[]): number | null {
  const rates = tasks.map((t) => (t.error ? 0 : passRate(t.items))).filter((r): r is number => r !== null);
  return rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
}

const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
const usd = (micros: number) => `$${(micros / MICROS_PER_USD).toFixed(3)}`;

function cell(r: ModelResult, id: TaskId): string {
  if (r.error) return 'error';
  const t = r.tasks.find((x) => x.id === id);
  if (!t) return '—';
  if (t.error) return 'error';
  const ran = t.items.filter((i) => !i.skipped);
  const skipped = t.items.length - ran.length;
  if (!ran.length) return 'skipped';
  return `${ran.filter((i) => i.pass).length}/${ran.length}${skipped ? ` (${skipped} skipped)` : ''}`;
}

/** The results as a plain-text table, one row per model. */
export function renderTable(results: ModelResult[], web: boolean): string {
  const tasks = TASKS.filter((t) => web || !t.webOnly);
  const head = ['Model', ...tasks.map((t) => t.title), 'Overall', 'Latency', 'Cost'];
  const rows = results.map((r) => [
    r.model,
    ...tasks.map((t) => cell(r, t.id)),
    r.error ? '—' : pct(overall(r.tasks)),
    r.latencyMs === null ? '—' : `${Math.round(r.latencyMs)} ms`,
    usd(r.spentMicros),
  ]);
  const all = [head, ...rows];
  const widths = head.map((_, i) => Math.max(...all.map((row) => row[i]!.length)));
  const line = (row: string[]) => row.map((c, i) => c.padEnd(widths[i]!)).join('  ').trimEnd();
  const errors = results.filter((r) => r.error).map((r) => `  ${r.model}: ${r.error}`);
  return [line(head), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line), ...(errors.length ? ['', 'Failed models:', ...errors] : []), ''].join('\n');
}

/** The Markdown report: the date, the models, the method and the table. No raw answers, and no key. */
export function renderReport(run: { results: ModelResult[]; o: RunOptions; spentMicros: number; date: string }): string {
  const { results, o, date } = run;
  const tasks = TASKS.filter((t) => o.web || !t.webOnly);
  const md = (row: string[]) => `| ${row.join(' | ')} |`;
  const table = [
    md(['Model', ...tasks.map((t) => t.title), 'Overall', 'Latency', 'Cost']),
    md(['---', ...tasks.map(() => '---:'), '---:', '---:', '---:']),
    ...results.map((r) => md([`\`${r.model}\``, ...tasks.map((t) => cell(r, t.id)), r.error ? '—' : pct(overall(r.tasks)), r.latencyMs === null ? '—' : `${Math.round(r.latencyMs)} ms`, usd(r.spentMicros)])),
  ].join('\n');
  // Why each item failed: the scorer's short reason or the error, never the model's answer.
  const notes = results.flatMap((r) => [
    ...(r.error ? [`- \`${r.model}\`: ${r.error}`] : []),
    ...r.tasks.filter((t) => t.error).map((t) => `- \`${r.model}\`, ${t.id}: ${t.error}`),
    ...r.tasks.flatMap((t) => t.items.filter((i) => !i.pass && !i.skipped && i.note).map((i) => `- \`${r.model}\`, ${t.id} ${i.id}: ${i.note}`)),
  ]);
  return [
    '# Which models do Kindred’s AI jobs best',
    '',
    `Measured on ${date} with \`scripts/ai-eval.ts\`. Models: ${o.models.map((m) => `\`${m}\``).join(', ')} (${o.provider}).`,
    '',
    `The budget was ${usd(o.maxUsd * MICROS_PER_USD)} for the whole run, shared by all models. Spent: ${usd(run.spentMicros)}.`,
    '',
    '## Results',
    '',
    table,
    '',
    'Each cell is passed/run per task. "skipped" items were not sent because the budget would have been passed. The overall score is the mean of the tasks’ pass rates; a task that failed counts as 0, and a task the budget skipped is left out.',
    '',
    '## Method',
    '',
    `- **Made-up data only.** An invented family (${FAMILY.name}) is written into a temporary folder with \`scripts/seed.ts\`, and the surnames are common public names whose meanings are in dictionaries. Nothing is a real person. The cases are in \`scripts/ai-eval.fixtures.ts\`.`,
    '- **The app’s own code.** Each call goes through the provider adapter, and the prompts and functions are the app’s: \`researchName\` and \`designArms\` (arms), \`systemPrompt\`, \`toolsFor\` and \`runTool\` (the assistant), and the face-box schema.',
    '- **Names.** Nine surnames, eight with a known meaning and one made-up trap. A known name passes when each expected meaning appears among the candidates and no candidate is stated as well-attested without being expected. The trap passes only when no candidate is stated as well-attested.',
    '- **Arms.** Three surnames, two steps as the app runs them: the meanings, then the top two chosen for the designs. A design passes when the schema holds, its charges exist, the tincture rule holds and it names a chosen meaning. Repairs (unknown charges, clashes the app fixed, designs it dropped) are counted and not failed.',
    '- **Tools.** Three questions on the family: a fact that needs a tool, a kinship question, and a question the tree does not record, which must be said not to be recorded with no invented year.',
    '- **Proposals.** Three requests that must become a proposal card with the right kind and details. The reply must not say anything was saved, because nothing is written.',
    '- **Language.** The same kind of question in German (du) and Afrikaans (jy). A reply passes when it uses at least one word of that language, none of the other languages’ words the scorer lists, and no formal address.',
    '- **Vision.** One generated picture; the reply passes when it is the face-box shape with each box between 0 and 1. Nothing else is judged.',
    ...(o.web ? ['- **Web.** One research with web search, for the surname Schmidt: the meaning must be found, and a cited page must be listed.'] : []),
    `- **Cost.** Each call is estimated before it is sent, and a call that would pass the budget is not sent. The cost after a call is what the provider billed (OpenRouter reports its own), so the total is the real spend, not the estimate. Prices are those in \`src/lib/ai/prices.ts\`, checked ${PRICES_CHECKED} (${Object.values(PRICES_SOURCES).join(', ')}).`,
    '- **Latency.** The mean time of each successful call.',
    '- **Raw answers are not kept here.** Only the scores and short notes are written.',
    ...(notes.length ? ['', '## Notes', '', ...notes] : []),
    '',
  ].join('\n');
}

/** The dry run's plan: per model and task, the requests and their estimated cost, from the first request each item makes. */
export function renderPlan(plans: { model: string; rows: { task: TaskId; items: number; estMicros: number; callsPerItem: number }[] }[]): string {
  const lines: string[] = ['Dry run: nothing was sent. Each row is the planned requests (items × calls per item) and their estimated cost.', ''];
  let grand = 0;
  for (const p of plans) {
    lines.push(p.model);
    let total = 0;
    for (const r of p.rows) {
      const cost = r.estMicros * r.callsPerItem;
      total += cost;
      const n = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
      lines.push(`  ${(TASKS.find((t) => t.id === r.task)?.title ?? r.task).padEnd(10)} ${n(r.items, 'item').padStart(8)} × ${n(r.callsPerItem, 'call').padEnd(7)}  ~${usd(cost)}`);
    }
    lines.push(`  ${'total'.padEnd(10)} ${' '.repeat(22)} ~${usd(total)}`, '');
    grand += total;
  }
  lines.push(`Estimated total for ${plans.length} model(s): ~${usd(grand)} (an upper bound per call: a loop that calls a tool takes its second request, which this counts at the first one's size).`);
  return lines.join('\n') + '\n';
}

// ---------- the run ----------

/** Runs every task for every model, in order, against one budget. A model that fails is reported, and the rest still run. */
export async function runEval(o: RunOptions, deps: Deps): Promise<RunOutput> {
  const meter: Meter = { capMicros: o.dryRun ? Number.POSITIVE_INFINITY : o.maxUsd * MICROS_PER_USD, spentMicros: 0 };
  const results: ModelResult[] = [];
  const plans: { model: string; rows: { task: TaskId; items: number; estMicros: number; callsPerItem: number }[] }[] = [];
  const log = (line: string) => deps.log(redact(line, o.key));
  for (const model of o.models) {
    log(`${model}: starting`);
    const listed = o.provider === 'openrouter' && !o.dryRun && deps.listedFor ? await deps.listedFor(model).catch(() => undefined) : undefined;
    const price = resolvePrice(o.provider, model, {}, listed?.price).price;
    const cap = (req: AiRequest) => deps.server.adapters.outputCap(o.provider, model, req.maxTokens, listed?.reasoning);
    const stats: Stats = { started: 0, failures: 0, skipped: 0, latency: [] };
    const captured = new Map<string, unknown>();
    const planned = new Map<TaskId, { items: number; estMicros: number }>();
    let task: TaskId = 'names';
    const before = meter.spentMicros;
    let base: AiAdapter;
    try {
      base = o.dryRun
        ? {
          provider: o.provider,
          model,
          async complete(req: AiRequest): Promise<AiReply> {
            const p = planned.get(task) ?? { items: 0, estMicros: 0 };
            planned.set(task, { items: p.items + 1, estMicros: p.estMicros + estimateCall(req, price, cap(req), o.provider) });
            throw new DryRunStop();
          },
        }
        : deps.adapterFor(model, listed);
    } catch (e) {
      results.push({ model, tasks: [], error: redact(describe(e), o.key), spentMicros: 0, latencyMs: null, calls: 0, failures: 0 });
      continue;
    }
    const adapter = o.dryRun ? base : metered(base, { meter, price, cap, stats, captured, now: () => Date.now() });
    const cx: Cx = { server: deps.server, adapter, captured };
    const tasks: TaskResult[] = [];
    for (const t of TASKS) {
      if (t.webOnly && !o.web) continue;
      task = t.id;
      try {
        tasks.push({ id: t.id, items: await RUNNERS[t.id](cx) });
      } catch (e) {
        tasks.push({ id: t.id, items: [], error: redact(describe(e), o.key) });
      }
    }
    plans.push({ model, rows: [...planned.entries()].map(([id, p]) => ({ task: id, items: p.items, estMicros: p.estMicros, callsPerItem: TASKS.find((t) => t.id === id)?.callsPerItem ?? 1 })) });
    const lat = stats.latency;
    results.push({
      model,
      tasks,
      spentMicros: meter.spentMicros - before,
      latencyMs: lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : null,
      calls: lat.length,
      failures: stats.failures,
    });
    log(`${model}: done, ${stats.started} call(s) sent`);
  }
  if (o.dryRun) {
    return { results, table: '', plan: renderPlan(plans) };
  }
  const table = renderTable(results, o.web);
  const reportPath = resolve(o.out);
  mkdirSync(dirname(reportPath), { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const report = redact(renderReport({ results, o, spentMicros: meter.spentMicros, date }), o.key);
  if (o.key && report.includes(o.key)) throw new Error('the report would contain the key; it was not written');
  writeFileSync(reportPath, report);
  return { results, table: redact(table, o.key), plan: '', reportPath };
}

// ---------- the command line ----------

const USAGE = `Usage: mise run ai-eval -- --provider <anthropic|openai|openrouter> --models <a,b,c> [options]

  --models a,b,c       model ids, comma separated (required)
  --provider NAME      anthropic, openai or openrouter (required)
  --max-usd N          the hard budget for the whole run, in US dollars (default 1)
  --web                also run one web-search task per model
  --out PATH           the Markdown report (default ${DEFAULT_OUT})
  --dry-run            print the planned calls and their estimated cost; send nothing
  --saved-family ID    use the family's saved, sealed key (needs KINDRED_DATA_DIR, the family's folder)
  --help               this text

The key is KINDRED_AI_EVAL_KEY, or --saved-family. KINDRED_AI_FAKE=1 runs on the fake provider (nothing is sent).
`;

export interface CliOptions extends RunOptions { savedFamily?: string }

/** The command line, checked. Throws UsageError with a message a person can act on. */
export function parseArgs(argv: string[]): CliOptions {
  const known = ['--provider', '--models', '--max-usd', '--out', '--saved-family', '--dry-run', '--web', '--help'];
  const valued = ['--provider', '--models', '--max-usd', '--out', '--saved-family'];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) throw new UsageError(`unexpected argument ${a}`);
    if (!known.includes(a)) throw new UsageError(`unknown option ${a}`);
    if (valued.includes(a)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new UsageError(`${a} needs a value`);
      i++;
    }
  }
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i < 0 ? undefined : argv[i + 1];
  };
  const provider = get('--provider');
  if (!provider || !(PROVIDERS as readonly string[]).includes(provider)) throw new UsageError('--provider must be anthropic, openai or openrouter');
  const models = (get('--models') ?? '').split(',').map((m) => m.trim()).filter(Boolean);
  if (models.length === 0) throw new UsageError('--models needs at least one model id, comma separated');
  const maxUsd = get('--max-usd') === undefined ? 1 : Number(get('--max-usd'));
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) throw new UsageError('--max-usd must be a positive number of US dollars');
  return {
    provider: provider as Provider,
    models,
    maxUsd,
    web: argv.includes('--web'),
    out: get('--out') ?? DEFAULT_OUT,
    dryRun: argv.includes('--dry-run'),
    savedFamily: get('--saved-family'),
    key: undefined,
  };
}

/** The saved key of a family, opened with the family's own secret. Only the lead's real run uses this. */
async function readSavedKey(family: string, provider: Provider): Promise<string> {
  const { server, close } = await loadServer();
  try {
    const s = await server.settings.readSettings(family);
    if (!s.sealed) throw new UsageError(`no saved key for the family ${family}`);
    if (s.provider !== provider) throw new UsageError(`the saved key is for ${s.provider}; pass --provider ${s.provider}`);
    return await server.secret.openKey(family, s.sealed);
  } finally {
    await close();
  }
}

export async function main(argv: string[] = process.argv.slice(2), env: Record<string, string | undefined> = process.env): Promise<number> {
  if (argv.includes('--help')) {
    process.stdout.write(USAGE);
    return 0;
  }
  let o: CliOptions;
  try {
    o = parseArgs(argv);
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(`ai-eval: ${e.message}\n\n${USAGE}`);
      return 2;
    }
    throw e;
  }
  const fake = env.KINDRED_AI_FAKE === '1';
  let key: string | undefined;
  if (!o.dryRun && !fake) {
    if (o.savedFamily) {
      if (!env.KINDRED_DATA_DIR) {
        process.stderr.write('ai-eval: --saved-family reads the family’s own folder: set KINDRED_DATA_DIR to it\n');
        return 2;
      }
      try {
        key = await readSavedKey(o.savedFamily, o.provider);
      } catch (e) {
        process.stderr.write(`ai-eval: ${describe(e)}\n`);
        return 2;
      }
    } else {
      key = env.KINDRED_AI_EVAL_KEY?.trim() || undefined;
      if (!key) {
        process.stderr.write('ai-eval: no key: set KINDRED_AI_EVAL_KEY, or pass --saved-family <id>\n');
        return 2;
      }
    }
  }
  // The synthetic family lives in a folder of its own, removed at the end. The saved key was read before this.
  const dataDir = mkdtempSync(join(tmpdir(), 'kindred-ai-eval-'));
  process.env.KINDRED_DATA_DIR = dataDir;
  process.env.KINDRED_ACCOUNTS_DB = join(dataDir, 'accounts.db');
  try {
    seedFamily(dataDir);
    const { server, close } = await loadServer();
    try {
      const run = await runEval({ ...o, key }, {
        server,
        adapterFor: (model, listed) => (fake
          ? server.fake.fakeAdapter(model)
          : server.adapters.makeAdapter(o.provider, key!, model, { reasoning: listed?.reasoning })),
        listedFor: o.provider === 'openrouter' && !fake ? (model) => server.models.openRouterListed(model) : undefined,
        log: (line) => process.stderr.write(`${line}\n`),
      });
      if (o.dryRun) process.stdout.write(run.plan);
      else {
        process.stdout.write(run.table);
        process.stdout.write(`Report written to ${run.reportPath}\n`);
      }
      return 0;
    } finally {
      await close();
    }
  } catch (e) {
    process.stderr.write(`ai-eval: ${redact(describe(e), key)}\n`);
    return 1;
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  });
}
