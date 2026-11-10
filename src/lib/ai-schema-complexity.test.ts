// Offline regression guard for Anthropic's schema compiler. Nineteen optional
// fields in look exceeded two minutes and were refused; keep a conservative
// budget of seventeen across the entire schema, including nested objects.
// 2026-11-08, fresh Anthropic Haiku 5.5 compiles via OpenRouter: designs (13 optional) 8.45s, revisions (17)
// 9.03s. This is a regression budget, not a provider-wide guarantee.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createServer } from 'vite';

type Schema = { properties?: Record<string, Schema>; required?: string[]; [key: string]: unknown };
const dir = mkdtempSync(join(tmpdir(), 'kindred-schema-audit-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_AI_FAKE = '1';
const root = process.cwd();
const sites = new Map<string, [string, string][]>();
for (const file of readdirSync(join(root, 'src/lib/ai'))) {
  if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
  const source = readFileSync(join(root, 'src/lib/ai', file), 'utf8');
  const entries: [string, string][] = [...source.matchAll(/json:\s*\{\s*name:\s*'([^']+)',\s*schema:\s*(\w+)/g)].map((m) => [m[1], m[2]]);
  // Fail closed when a new call uses a different spelling instead of skipping it.
  assert.equal(entries.length, [...source.matchAll(/json:\s*\{\s*name:/g)].length, `Unrecognised structured schema in ${file}`);
  if (entries.length) sites.set('/src/lib/ai/' + file, entries);
}
assert.ok(sites.size > 0, 'structured-output call sites discovered');
const vite = await createServer({ root, logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom', plugins: [{
  name: 'expose-schemas-for-test', enforce: 'pre',
  transform(code, id) {
    const entries = sites.get(id.replace(root, ''));
    if (entries) return code + '\nexport const __complexitySchemas = {' + entries.map(([name, variable]) => JSON.stringify(name) + ':' + variable).join(',') + '};';
    return undefined;
  },
}] });
after(async () => { await vite.close(); rmSync(dir, { recursive: true, force: true }); });
const { structuredSchema } = await vite.ssrLoadModule('/src/lib/ai/adapters.ts');
function optionalCount(node: unknown): number {
  if (!node || typeof node !== 'object') return 0;
  if (Array.isArray(node)) return node.reduce((n, item) => n + optionalCount(item), 0);
  const s = node as Schema;
  let count = s.properties ? Object.keys(s.properties).filter((key) => !s.required?.includes(key)).length : 0;
  for (const [key, value] of Object.entries(s)) {
    if (['enum', 'const', 'default', 'examples', 'required'].includes(key)) continue;
    count += optionalCount(value);
  }
  return count;
}
const collected: [string, unknown][] = [];
function guard(name: string, schema: unknown) {
  collected.push([name, schema]);
}
function check(name: string, schema: unknown) {
  test(`${name}: provider schema has at most seventeen optional properties`, () => {
    const count = optionalCount(structuredSchema(schema));
    assert.ok(count <= 17, `${name}: ${count} optional properties; make generation fields required (nullable when absence is meaningful), keeping the response parser lenient`);
  });
}
for (const [file] of sites) {
  const module = await vite.ssrLoadModule(file);
  for (const [name, schema] of Object.entries(module.__complexitySchemas)) guard(name, schema);
}
// Also protect the shared parser shape used by both design and revision calls.
const { cantingResponseSchema } = await vite.ssrLoadModule('/src/lib/heraldry/canting-schema.ts');
const { z } = await vite.ssrLoadModule('/node_modules/zod/index.js');
guard('cantingResponseSchema', z.toJSONSchema(cantingResponseSchema));

for (const [name, schema] of collected) check(name, schema);
