// Prints what axe found across the run, then removes the scratch data folder playwright.config.ts made.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

interface Finding { where: string; rule: string; impact: string; known: boolean; nodes: number; sample?: string; detail?: string; html?: string }

export default function teardown() {
  const data = process.env.KINDRED_E2E_DATA;
  if (!data) return;
  const log = join(data, 'axe.jsonl');
  const findings: Finding[] = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : [];
  console.log(`\naxe (serious and critical, WCAG A/AA): ${findings.length} finding(s)`);
  for (const f of findings) console.log(`  ${f.known ? 'known' : 'NEW  '} ${f.where}: ${f.rule} (${f.impact}, ${f.nodes}x) e.g. ${f.sample}\n        ${f.detail ?? ''}\n        ${f.html ?? ''}`);
  rmSync(data, { recursive: true, force: true });
}
