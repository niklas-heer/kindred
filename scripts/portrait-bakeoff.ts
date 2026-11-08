// The painted-portrait bake-off: paints one photo with several picture models through OpenRouter, so the owner can pick
// the model by eye. It writes each painting, the photo, results.json and an index.html contact sheet (model, lab, cost,
// time). It uses the same prompt, request and reply reading as the app (src/lib/ai/portrait-rules.ts).
//
//   node scripts/portrait-bakeoff.ts --photo <file> --key-env <VAR> [--models a,b,c] [--max-usd 3] [--out <dir>]
//   node scripts/portrait-bakeoff.ts --dry-run [--models a,b,c] [--max-usd 3]
//
// Without --models it reads OpenRouter's live list and runs the newest two picture-editing models per lab (see
// benchModels). --max-usd is a hard stop: when the estimate of the models to run is over it, nothing is sent; while it
// runs, a model is skipped when the reported spend plus its estimate would pass it. The key is read from the named
// environment variable and is never printed, written to a file or put in an error. --dry-run sends nothing.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  OPENROUTER_IMAGE_MODELS_URL,
  OPENROUTER_IMAGES_URL,
  ReplyError,
  UNPRICED_USD,
  benchModels,
  imageModels,
  parsePortraitReply,
  portraitRequest,
  sniffImage,
  type ImageModel,
  type RawImageModel,
} from '../src/lib/ai/portrait-rules.ts';

export interface BakeArgs {
  photo?: string;
  keyEnv?: string;
  models: string[];
  maxUsd: number;
  out: string;
  dryRun: boolean;
}

export interface Row {
  id: string;
  name: string;
  lab: string;
  labName: string;
  status: 'planned' | 'ok' | 'error' | 'skipped';
  /** What the run was booked at: the provider's reported cost, else the estimate. */
  costUsd: number | null;
  estimateUsd: number;
  ms: number | null;
  file?: string;
  error?: string;
}

export interface BakeDeps {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  readFile: (path: string) => Uint8Array;
  writeFile: (path: string, data: string | Uint8Array) => void;
  mkdir: (path: string) => void;
  now: () => number;
  log: (line: string) => void;
}

const MODEL_ID = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._:/-]{1,120}$/;

/** The arguments, checked. Throws Error with a plain message for a bad or missing one. */
export function parseBakeArgs(argv: string[], now: Date = new Date()): BakeArgs {
  const args: BakeArgs = { models: [], maxUsd: 3, out: '', dryRun: false };
  const take = (i: number, flag: string): string => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    switch (flag) {
      case '--photo': args.photo = take(i++, flag); break;
      case '--key-env': args.keyEnv = take(i++, flag); break;
      case '--models': {
        const ids = take(i++, flag).split(',').map((s) => s.trim()).filter(Boolean);
        const bad = ids.find((id) => !MODEL_ID.test(id) || id.startsWith('openrouter/'));
        if (bad) throw new Error(`not a picture model id: ${bad}`);
        args.models = ids;
        break;
      }
      case '--max-usd': {
        const n = Number(take(i++, flag));
        if (!Number.isFinite(n) || n <= 0) throw new Error('--max-usd must be a positive number of dollars');
        args.maxUsd = n;
        break;
      }
      case '--out': args.out = take(i++, flag); break;
      case '--dry-run': args.dryRun = true; break;
      default: throw new Error(`unknown argument ${flag}`);
    }
  }
  if (!args.out) args.out = join('portrait-bakeoff', now.toISOString().replace(/[:.]/g, '-').slice(0, 19));
  return args;
}

/** A model id as a file name. */
const slug = (id: string) => id.replace(/[^A-Za-z0-9]+/g, '_');
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

async function fetchList(f: typeof fetch): Promise<ImageModel[]> {
  let res: Response;
  try {
    res = await f(OPENROUTER_IMAGE_MODELS_URL, { headers: { accept: 'application/json' } });
  } catch {
    throw new Error('the list of picture models could not be read');
  }
  if (!res.ok) throw new Error(`the list of picture models could not be read (HTTP ${res.status})`);
  const json = (await res.json()) as { data?: RawImageModel[] };
  return imageModels(json.data ?? []);
}

/** The models to run: the named ones, or the bake-off's choice from the live list. */
export async function chooseModels(args: BakeArgs, deps: Pick<BakeDeps, 'fetch'>): Promise<ImageModel[]> {
  const list = await fetchList(deps.fetch);
  if (!args.models.length) return benchModels(list);
  return args.models.map((id) => {
    const known = list.find((m) => m.id === id);
    if (known) return known;
    const lab = id.split('/')[0]!;
    return { id, name: id, lab, labName: lab, created: 0, takesImage: true, givesImage: true, vectorOnly: false, router: false, priceUsd: null };
  });
}

/**
 * Runs the bake-off. Returns one row per model. Throws before sending anything when the estimate is over --max-usd, or
 * when a real run lacks its photo or key.
 */
export async function runBakeoff(args: BakeArgs, deps: BakeDeps): Promise<{ rows: Row[]; spentUsd: number; estimateUsd: number; sheet: string | null }> {
  const models = await chooseModels(args, deps);
  const estimate = (m: ImageModel) => m.priceUsd ?? UNPRICED_USD;
  const total = models.reduce((n, m) => n + estimate(m), 0);
  const rows: Row[] = models.map((m) => ({
    id: m.id,
    name: m.name,
    lab: m.lab,
    labName: m.labName,
    status: 'planned',
    costUsd: null,
    estimateUsd: estimate(m),
    ms: null,
  }));

  if (args.dryRun) {
    models.forEach((m, i) => {
      const r = rows[i]!;
      deps.log(`${r.id}  (${r.labName})  about $${r.estimateUsd.toFixed(3)}${m.priceUsd === null ? '  (no listed price: reserved at the default)' : ''}`);
    });
    deps.log(`estimated total: about $${total.toFixed(2)} for ${rows.length} model${rows.length === 1 ? '' : 's'}; --max-usd is $${args.maxUsd}`);
    deps.log('dry run: nothing was sent');
    return { rows, spentUsd: 0, estimateUsd: total, sheet: null };
  }

  if (total > args.maxUsd) {
    throw new Error(`the estimate, about $${total.toFixed(2)}, is over --max-usd $${args.maxUsd}: nothing was sent. Name fewer models, or raise --max-usd.`);
  }
  if (!args.photo) throw new Error('--photo <file> is needed to paint');
  if (!args.keyEnv) throw new Error('--key-env <VAR> is needed: the name of the environment variable that holds the OpenRouter key');
  const key = deps.env[args.keyEnv];
  if (!key) throw new Error(`the environment variable ${args.keyEnv} is empty or not set`);

  const photo = deps.readFile(resolve(args.photo));
  const mime = sniffImage(photo);
  if (!mime) throw new Error('the photo is not a jpeg, png or webp picture');
  deps.mkdir(args.out);
  deps.writeFile(join(args.out, `source.${EXT[mime]}`), photo);

  let spent = 0;
  for (const r of rows) {
    if (spent + r.estimateUsd > args.maxUsd) {
      r.status = 'skipped';
      r.error = 'would pass --max-usd';
      continue;
    }
    const req = portraitRequest(r.id, { mime, bytes: photo });
    const started = deps.now();
    try {
      const res = await deps.fetch(OPENROUTER_IMAGES_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, 'x-title': 'Kindred bake-off' },
        body: JSON.stringify(req.body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const img = parsePortraitReply(await res.json());
      const cost = img.costUsd ?? r.estimateUsd;
      spent += cost;
      r.costUsd = cost;
      r.file = `${slug(r.id)}.${EXT[img.mime]}`;
      deps.writeFile(join(args.out, r.file), img.bytes);
      r.status = 'ok';
    } catch (e) {
      // The message is a plain status or a dictionary key, never the key and never the request. A 4xx is not billed;
      // anything else (a 5xx, a timeout, an unreadable reply) may have been, so it is kept at its estimate.
      r.status = 'error';
      r.error = e instanceof Error ? e.message : 'failed';
      const notBilled = e instanceof Error && !(e instanceof ReplyError) && /^HTTP 4\d\d$/.test(e.message);
      if (!notBilled) spent += r.estimateUsd;
    }
    r.ms = deps.now() - started;
    deps.log(`${r.status.padEnd(7)} ${r.id}  ${r.costUsd !== null ? `$${r.costUsd.toFixed(3)}` : ''}  ${r.ms} ms${r.error ? `  ${r.error}` : ''}`);
  }

  deps.writeFile(join(args.out, 'results.json'), JSON.stringify({ photo: photo.byteLength, mime, spentUsd: spent, rows }, null, 2));
  const sheet = contactSheet(rows, `source.${EXT[mime]}`, args.maxUsd, spent);
  deps.writeFile(join(args.out, 'index.html'), sheet);
  deps.log(`spent about $${spent.toFixed(3)} of $${args.maxUsd}; contact sheet: ${join(args.out, 'index.html')}`);
  return { rows, spentUsd: spent, estimateUsd: total, sheet };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The contact sheet: the photo, then each painting with its model, lab, cost and time. Nothing secret is in it. */
export function contactSheet(rows: Row[], source: string, maxUsd: number, spent: number): string {
  const cards = rows.map((r) => `
    <figure class="card ${r.status}">
      ${r.file ? `<img src="${esc(r.file)}" alt="${esc(r.id)}">` : `<div class="none">${esc(r.status)}</div>`}
      <figcaption>
        <strong>${esc(r.id)}</strong>
        <span>${esc(r.labName)}</span>
        <span>${r.costUsd !== null ? `$${r.costUsd.toFixed(3)} (reported or estimated)` : `about $${r.estimateUsd.toFixed(3)} (estimate)`}</span>
        <span>${r.ms !== null ? `${(r.ms / 1000).toFixed(1)} s` : '—'}</span>
        ${r.error ? `<span class="err">${esc(r.error)}</span>` : ''}
      </figcaption>
    </figure>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Painted portrait bake-off</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f3ec; --ink: #201b14; --line: #d9d0bd; }
  @media (prefers-color-scheme: dark) { :root { --bg: #15130f; --ink: #efe8d8; --line: #3a3426; } }
  body { margin: 0; padding: 16px; background: var(--bg); color: var(--ink); font: 15px/1.4 system-ui, sans-serif; }
  h1 { font-size: 1.2rem; margin: 0 0 8px; }
  .meta { color: var(--ink); opacity: .75; margin-bottom: 16px; }
  .source { max-width: 240px; border: 1px solid var(--line); border-radius: 6px; margin-bottom: 16px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
  .card { margin: 0; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
  .card img { display: block; width: 100%; aspect-ratio: 1 / 1; object-fit: cover; }
  .card figcaption { display: grid; gap: 2px; padding: 8px; font-size: 13px; }
  .card .none { aspect-ratio: 1 / 1; display: grid; place-items: center; opacity: .6; }
  .err { color: #b03a2e; }
  .skipped, .error { opacity: .8; }
</style></head>
<body>
  <h1>Painted portrait bake-off</h1>
  <p class="meta">Spent about $${spent.toFixed(3)} of $${maxUsd}. Each painting was made from the same photo with the same prompt.</p>
  <img class="source" src="${esc(source)}" alt="The photo painted from">
  <div class="grid">${cards}</div>
</body></html>
`;
}

async function main(argv: string[]): Promise<number> {
  let args: BakeArgs;
  try {
    args = parseBakeArgs(argv);
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }
  const deps: BakeDeps = {
    fetch: globalThis.fetch,
    env: process.env,
    readFile: (p) => new Uint8Array(readFileSync(p)),
    writeFile: (p, d) => writeFileSync(p, d),
    mkdir: (p) => mkdirSync(p, { recursive: true }),
    now: () => Date.now(),
    log: (l) => console.log(l),
  };
  try {
    await runBakeoff(args, deps);
    return 0;
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
