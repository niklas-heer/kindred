// node --test scripts/portrait-bakeoff.test.ts — the bake-off tool, with the network stubbed: the list is read, the models
// are chosen per lab, a dry run sends nothing, an estimate over --max-usd stops before any call, a run writes each painting
// and the contact sheet, a non-image reply is an error row, the budget stops a run part-way, and the key is in no output.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseBakeArgs, runBakeoff, chooseModels, type BakeDeps, type Row } from './portrait-bakeoff.ts';
import { toBase64 } from '../src/lib/ai/portrait-rules.ts';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const KEY = 'sk-or-v1-SECRET-KEY-DO-NOT-PRINT-1234';

const LIST = {
  data: [
    { id: 'openai/gpt-image-1', created: 100, architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] }, pricing: { prompt: '0.00001', image_output: '0.00004' } },
    { id: 'openai/gpt-image-2', created: 300, architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] }, pricing: { prompt: '0.000008', image_output: '0.00003' } },
    { id: 'openai/gpt-image-1-mini', created: 200, architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] }, pricing: { image_output: '0.000008' } },
    { id: 'google/gemini-3-pro-image', created: 250, architecture: { input_modalities: ['text', 'image'], output_modalities: ['image', 'text'] }, pricing: { prompt: '0.000002', completion: '0.000012', image_output: '0.000012' } },
    { id: 'recraft/recraft-v4-vector', created: 400, architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] }, pricing: { image_output: '0.00001' } },
    { id: 'krea/krea-2-large', created: 50, architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] }, pricing: { image_output: '0.00001' } },
  ],
};

interface Sent { url: string; method: string; headers: Record<string, string>; body: any }

/** A fake OpenRouter: the list, and one reply per model (a function of the model id). */
function fakeProvider(reply: (model: string) => Response) {
  const sent: Sent[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/v1/models')) return new Response(JSON.stringify(LIST), { status: 200 });
    const body = JSON.parse(String(init?.body ?? '{}'));
    sent.push({ url, method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string>, body });
    return reply(body.model);
  }) as typeof fetch;
  return { f, sent };
}

const okReply = (cost: number) =>
  new Response(JSON.stringify({ created: 1, data: [{ b64_json: toBase64(PNG), media_type: 'image/png' }], usage: { cost } }), { status: 200 });

function setup(extra: Partial<BakeDeps> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kindred-bakeoff-'));
  const photo = join(dir, 'photo.png');
  writeFileSync(photo, PNG);
  const logs: string[] = [];
  const deps = (f: typeof fetch): BakeDeps => ({
    fetch: f,
    env: { PAINT_KEY: KEY },
    readFile: (p) => new Uint8Array(readFileSync(p)),
    writeFile: (p, d) => writeFileSync(p, d),
    mkdir: (p) => mkdirSync(p, { recursive: true }),
    now: () => 1_000,
    log: (l) => logs.push(l),
    ...extra,
  });
  return { dir, photo, logs, deps, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('the arguments are read, with the defaults, and bad ones are refused', () => {
  const a = parseBakeArgs(['--photo', 'x.jpg', '--key-env', 'PAINT_KEY', '--models', 'openai/gpt-image-2,google/gemini-3-pro-image', '--max-usd', '2', '--out', 'o']);
  assert.equal(a.photo, 'x.jpg');
  assert.equal(a.keyEnv, 'PAINT_KEY');
  assert.deepEqual(a.models, ['openai/gpt-image-2', 'google/gemini-3-pro-image']);
  assert.equal(a.maxUsd, 2);
  assert.equal(a.out, 'o');
  assert.equal(a.dryRun, false);
  const d = parseBakeArgs([], new Date('2026-11-08T10:11:12Z'));
  assert.equal(d.maxUsd, 3, 'the default hard stop is $3');
  assert.equal(d.out, 'portrait-bakeoff/2026-11-08T10-11-12');
  assert.throws(() => parseBakeArgs(['--max-usd', '-1']), /positive/);
  assert.throws(() => parseBakeArgs(['--models', 'openrouter/auto']), /not a picture model/);
  assert.throws(() => parseBakeArgs(['--photo']), /needs a value/);
  assert.throws(() => parseBakeArgs(['--nope']), /unknown argument/);
});

test('the default models are the newest two picture-editing models per lab, not vector or routers', async () => {
  const { f } = fakeProvider(() => okReply(0));
  const picked = (await chooseModels(parseBakeArgs([]), { fetch: f })).map((m) => m.id);
  assert.deepEqual(picked, ['google/gemini-3-pro-image', 'krea/krea-2-large', 'openai/gpt-image-2', 'openai/gpt-image-1-mini']);
});

test('a dry run lists the models and the estimate, and sends nothing to a picture model', async () => {
  const { f, sent } = fakeProvider(() => okReply(0));
  const s = setup();
  const r = await runBakeoff(parseBakeArgs(['--dry-run', '--key-env', 'PAINT_KEY']), s.deps(f));
  assert.equal(sent.length, 0, 'no request to a picture model');
  assert.ok(r.estimateUsd > 0);
  assert.ok(s.logs.some((l) => l.includes('estimated total')), 'the estimate is printed');
  assert.ok(s.logs.includes('dry run: nothing was sent'), 'and it says nothing was sent');
  assert.ok(!s.logs.join('\n').includes(KEY), 'the key is never printed');
  s.done();
});

test('an estimate over --max-usd stops the run before any call is made', async () => {
  const { f, sent } = fakeProvider(() => okReply(0));
  const s = setup();
  await assert.rejects(
    () => runBakeoff(parseBakeArgs(['--photo', s.photo, '--key-env', 'PAINT_KEY', '--max-usd', '0.01']), s.deps(f)),
    /is over --max-usd .* nothing was sent/,
  );
  assert.equal(sent.length, 0);
  s.done();
});

test('a run paints each model, writes the pictures, results and a contact sheet, and keeps the key out of all of them', async () => {
  const { f, sent } = fakeProvider((model) => (model === 'openai/gpt-image-1-mini' ? new Response('boom', { status: 500 }) : okReply(0.05)));
  const s = setup();
  const out = join(s.dir, 'out');
  const r = await runBakeoff(parseBakeArgs(['--photo', s.photo, '--key-env', 'PAINT_KEY', '--models', 'openai/gpt-image-2,google/gemini-3-pro-image,openai/gpt-image-1-mini', '--out', out, '--max-usd', '3']), s.deps(f));
  // The request: the picture model's endpoint, the fixed prompt, the photo as a reference, the key as a bearer token.
  assert.equal(sent.length, 3);
  assert.equal(sent[0]!.url, 'https://openrouter.ai/api/v1/images');
  assert.equal(sent[0]!.headers.authorization, `Bearer ${KEY}`);
  assert.match(sent[0]!.body.prompt, /Keep this exact person/);
  assert.ok(String(sent[0]!.body.input_references[0].image_url.url).startsWith('data:image/png;base64,'));
  const byId = Object.fromEntries(r.rows.map((x) => [x.id, x]));
  assert.equal(byId['openai/gpt-image-2']!.status, 'ok');
  assert.equal(byId['openai/gpt-image-2']!.costUsd, 0.05, 'booked at what OpenRouter reported');
  assert.equal(byId['openai/gpt-image-1-mini']!.status, 'error', 'a failing model is an error row, not a crash');
  const files = readdirSync(out);
  assert.ok(files.includes('index.html') && files.includes('results.json') && files.includes('source.png'));
  assert.ok(files.includes('openai_gpt_image_2.png'), 'each painting is named by its model');
  const sheet = readFileSync(join(out, 'index.html'), 'utf8');
  assert.ok(sheet.includes('openai/gpt-image-2'));
  assert.match(sheet, /OpenAI/);
  assert.ok(!sheet.includes(KEY) && !readFileSync(join(out, 'results.json'), 'utf8').includes(KEY), 'the key is in no file');
  assert.ok(!s.logs.join('\n').includes(KEY), 'nor in the log');
  s.done();
});

test('a reply that is not a picture is an error row, and the picture is not written', async () => {
  const { f } = fakeProvider(() => new Response(JSON.stringify({ choices: [{ message: { content: 'I cannot paint that.' } }] }), { status: 200 }));
  const s = setup();
  const out = join(s.dir, 'out');
  const r = await runBakeoff(parseBakeArgs(['--photo', s.photo, '--key-env', 'PAINT_KEY', '--models', 'openai/gpt-image-2', '--out', out]), s.deps(f));
  assert.equal(r.rows[0]!.status, 'error');
  assert.equal(r.rows[0]!.error, 'paint.err_no_image');
  assert.ok(!readdirSync(out).some((n) => n.startsWith('openai_')), 'no picture file for a model that sent none');
  s.done();
});

test('the budget stops a run part-way: a model whose estimate would pass --max-usd is skipped, not sent', async () => {
  // Each reply costs $1.20: after two, $2.40 is booked; the third (about $0.06 estimated) would take it past a $2.45 hard stop.
  const { f, sent } = fakeProvider(() => okReply(1.2));
  const s = setup();
  const r = await runBakeoff(
    parseBakeArgs(['--photo', s.photo, '--key-env', 'PAINT_KEY', '--models', 'openai/gpt-image-2,google/gemini-3-pro-image,krea/krea-2-large', '--max-usd', '2.45', '--out', join(s.dir, 'out')]),
    s.deps(f),
  );
  const status = r.rows.map((x: Row) => x.status);
  assert.deepEqual(status.slice(0, 2), ['ok', 'ok']);
  assert.equal(status[2], 'skipped');
  assert.equal(sent.length, 2, 'the skipped model is never sent');
  s.done();
});
