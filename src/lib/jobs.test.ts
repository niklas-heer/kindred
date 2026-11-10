// node --test src/lib/jobs.test.ts — the daily job runner: one failing job does not stop the others, log lines carry the
// job's name, the reminders job does nothing without VAPID keys, and a Worker's settings are read with a fallback.
// Runs on a scratch data folder and accounts database (never data/).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'kindred-jobs-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
delete process.env.KINDRED_VAPID_PUBLIC_KEY;
delete process.env.KINDRED_VAPID_PRIVATE_JWK;
delete process.env.KINDRED_VAPID_SUBJECT;
after(() => rmSync(dir, { recursive: true, force: true }));

const { DAILY_JOBS, runDailyJobs } = await import('./jobs/index.ts');
const { remindersJob } = await import('./jobs/reminders.ts');
const { runJobs, workerSetting } = await import('./jobs/run.server.ts');

const ctxFor = (logs: string[], env: (name: string) => string | undefined = () => undefined) => ({
  trees: [] as string[],
  now: new Date('2026-11-08T06:00:00Z'),
  env,
  log: (message: string) => logs.push(message),
});

test('the registry runs the reminders, the archive, the background AI job, the statistics clean-up, the ask-to-join clean-up, the campaign, the history and the feed’s leftovers, in that order', () => {
  assert.deepEqual(DAILY_JOBS.map((job) => job.name), ['reminders', 'archive', 'ai-tasks', 'stats', 'join', 'campaign', 'history', 'feed']);
});

test('a job that throws is logged with its name, and the jobs after it still run', async () => {
  const logs: string[] = [];
  const ran: string[] = [];
  await runDailyJobs(ctxFor(logs), [
    { name: 'first', run: async () => { ran.push('first'); } },
    { name: 'broken', run: async () => { throw new Error('the database is busy'); } },
    { name: 'last', run: async (ctx) => { ran.push('last'); ctx.log('done'); } },
  ]);
  assert.deepEqual(ran, ['first', 'last']);
  assert.deepEqual(logs, ['broken: failed: the database is busy', 'last: done']);
});

test('without VAPID keys the reminders job sends nothing and says why, once a day', async () => {
  const logs: string[] = [];
  await remindersJob.run({ ...ctxFor(logs), log: (message) => logs.push(message), trees: ['lindes'] });
  assert.equal(logs.length, 1);
  assert.match(logs[0], /VAPID keys are not set/);
});

test('a run with no families completes, and the reminders job reports it has nothing to do', async () => {
  const logs: string[] = [];
  await runJobs(new Date('2026-11-08T06:00:00Z'), () => undefined, (message) => logs.push(message));
  assert.ok(logs.some((line) => line.startsWith('reminders: the VAPID keys are not set')), logs.join('\n'));
});

test('a Worker reads its variables and secrets from env, then from process.env, and ignores blank values', () => {
  process.env.KINDRED_TEST_FROM_PROCESS = ' from-process ';
  try {
    const read = workerSetting({ KINDRED_VAPID_SUBJECT: ' mailto:family@example.org ', BLANK: '   ' });
    assert.equal(read('KINDRED_VAPID_SUBJECT'), 'mailto:family@example.org');
    assert.equal(read('BLANK'), undefined);
    assert.equal(read('KINDRED_TEST_FROM_PROCESS'), 'from-process');
    assert.equal(read('UNSET_SETTING'), undefined);
  } finally {
    delete process.env.KINDRED_TEST_FROM_PROCESS;
  }
});
