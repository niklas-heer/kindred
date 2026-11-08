// Reading wrangler.jsonc and running wrangler, for the Cloudflare scripts.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export interface D1Binding { binding: string; database_name: string; database_id: string; migrations_dir?: string }
interface Config { d1_databases?: D1Binding[]; r2_buckets?: { binding: string; bucket_name: string }[]; env?: Record<string, Config> }

/** JSON with comments: drops // and /* *\/ comments outside strings, and trailing commas. */
function parseJsonc(text: string): unknown {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/** The bindings for an environment (`--env local`), or the top level. */
export function wranglerBindings(env?: string) {
  const config = parseJsonc(readFileSync('wrangler.jsonc', 'utf8')) as Config;
  const scope = env ? config.env?.[env] : config;
  if (!scope) throw new Error(`wrangler.jsonc has no environment "${env}"`);
  return { d1: scope.d1_databases ?? [], r2: scope.r2_buckets ?? [] };
}

/** The D1 binding that serves a tree: `my-family` → TREE_MY_FAMILY (as src/lib/store/cf.ts). */
export const treeBinding = (tree: string) => `TREE_${tree.toUpperCase().replace(/-/g, '_')}`;

/** Runs wrangler with the given arguments; throws when it fails. */
export function wrangler(args: string[], opts: { quiet?: boolean } = {}) {
  const r = spawnSync('npx', ['wrangler', ...args], { stdio: opts.quiet ? 'pipe' : 'inherit', encoding: 'utf8', env: { ...process.env, CI: 'true' } });
  if (r.status !== 0) throw new Error(`wrangler ${args.join(' ')} failed${opts.quiet ? `:\n${r.stdout}\n${r.stderr}` : ''}`);
  return r.stdout ?? '';
}

/** `--local` or `--remote`, plus `--env <name>` when given. */
export const where = (remote: boolean, env?: string) => [remote ? '--remote' : '--local', ...(env ? ['--env', env] : [])];
