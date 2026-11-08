// node --test scripts/import-kindred.test.ts — the v1 archive importer on a two-person archive in a temp folder. The family
// view opens on the person named as the third argument, or else on the first person; an unknown name is an error. Nothing
// under data/ is read or written.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const work = mkdtempSync(join(tmpdir(), 'kindred-import-test-'));
test.after(() => rmSync(work, { recursive: true, force: true }));

const archive = join(work, 'archive');
mkdirSync(join(archive, 'people'), { recursive: true });
for (const [id, name] of [['ada-heer', 'Ada Heer'], ['bert-jones', 'Bert Jones']]) {
  writeFileSync(join(archive, 'people', `${id}.md`), `---\nid: ${id}\nname: ${name}\nliving: true\n---\n## Story\nA note.\n`);
}

const script = join(import.meta.dirname, 'import-kindred.ts');
const run = (out: string, ...extra: string[]) => spawnSync(process.execPath, [script, archive, out, ...extra], { encoding: 'utf8' });

test('the family view opens on the person named as the third argument, or else on the first person', () => {
  const first = join(work, 'first.json');
  const r1 = run(first);
  assert.equal(r1.status, 0, r1.stderr);
  const tree1 = JSON.parse(readFileSync(first, 'utf8'));
  assert.equal(tree1.focus, tree1.people[0].id, 'the first person in the archive');
  assert.ok(['ada-heer', 'bert-jones'].includes(tree1.focus));

  const second = join(work, 'second.json');
  const r2 = run(second, 'bert-jones');
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(JSON.parse(readFileSync(second, 'utf8')).focus, 'bert-jones');
});

test('a focus that names no note is an error, and nothing is written', () => {
  const out = join(work, 'unknown.json');
  const r = run(out, 'nobody-here');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no person note named nobody-here\.md/);
  assert.throws(() => readFileSync(out), /ENOENT/);
});
