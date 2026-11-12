// node --test src/lib/operator/update-workflow.test.ts: the copy's update workflow (.github/workflows/update.yml) refuses a
// release older than the one the copy has (`.kindred-release`), so a leaked token that can start the workflow cannot move the
// install back to a release with known holes. The step's own script runs here in bash, in a scratch folder: no git, no network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const STEP = 'Refuse a release older than the copy has';

/** The `run: |` block of the step with this name, unindented. */
function stepScript(name: string): string {
  const lines = readFileSync('.github/workflows/update.yml', 'utf8').split('\n');
  const at = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  assert.ok(at >= 0, `update.yml has the step "${name}"`);
  const run = lines.findIndex((l, i) => i > at && /^\s+run: \|\s*$/.test(l));
  const indent = (lines[run + 1]!.match(/^\s*/)?.[0] ?? '').length;
  const body: string[] = [];
  for (const l of lines.slice(run + 1)) {
    if (l.trim() && (l.match(/^\s*/)?.[0] ?? '').length < indent) break;
    body.push(l.slice(indent));
  }
  return body.join('\n');
}

function runStep(tag: string, release: string | null): { status: number | null; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'kindred-update-step-'));
  try {
    if (release !== null) writeFileSync(join(dir, '.kindred-release'), `${release}\n`);
    const r = spawnSync('bash', ['-eo', 'pipefail', '-c', stepScript(STEP)], { cwd: dir, env: { PATH: process.env.PATH, TAG: tag }, encoding: 'utf8' });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the update workflow refuses a release older than the copy has, and takes the same or a newer one', () => {
  const older = runStep('v2.3.9', 'v2.4.0');
  assert.equal(older.status, 1, older.out);
  assert.match(older.out, /::error::.*older/);
  assert.equal(runStep('v2.4.0', 'v2.4.0').status, 0, 'the same release: the run finds nothing to change');
  assert.equal(runStep('v2.10.0', 'v2.9.3').status, 0, 'compared as numbers, not as text');
  assert.equal(runStep('v2.9.3', 'v2.10.0').status, 1);
  assert.equal(runStep('v3.0.0', 'v2.99.99').status, 0);
  assert.equal(runStep('v2.4.0', null).status, 0, 'a copy that has no record yet takes any release');
  assert.equal(runStep('v2.4.0', 'not a tag').status, 0, 'nor does an unreadable record stop it');
});
