// node --test server/jobs.test.ts — the Node server's daily job timer: 06:00 UTC each day, never at startup.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextJobsAt, scheduleDailyJobs } from './jobs.ts';

test('the next run is 06:00 UTC, today if it is still ahead and tomorrow once it has passed', () => {
  assert.equal(nextJobsAt(new Date('2026-11-08T05:59:59.999Z')).toISOString(), '2026-11-08T06:00:00.000Z');
  assert.equal(nextJobsAt(new Date('2026-11-08T06:00:00.000Z')).toISOString(), '2026-11-09T06:00:00.000Z', 'at 06:00 itself, the run is already due: the next is tomorrow');
  assert.equal(nextJobsAt(new Date('2026-11-08T23:30:00Z')).toISOString(), '2026-11-09T06:00:00.000Z');
  assert.equal(nextJobsAt(new Date('2026-12-31T12:00:00Z')).toISOString(), '2027-01-01T06:00:00.000Z', 'across the year end');
  assert.equal(nextJobsAt(new Date('2028-02-28T07:00:00Z')).toISOString(), '2028-02-29T06:00:00.000Z', 'a leap day');
});

test('the timer waits for 06:00 UTC, runs once a day after that, and stops when asked', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = new Date('2026-11-08T05:00:00Z');
  const runs: string[] = [];
  const stop = scheduleDailyJobs(async (at) => {
    runs.push(at.toISOString());
  }, () => now);
  assert.deepEqual(runs, [], 'nothing runs at startup');
  t.mock.timers.tick(60 * 60_000 - 1);
  assert.deepEqual(runs, []);
  now = new Date('2026-11-08T06:00:00Z');
  t.mock.timers.tick(1);
  assert.deepEqual(runs, ['2026-11-08T06:00:00.000Z']);
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(24 * 60 * 60_000 - 1);
  assert.equal(runs.length, 1, 'not again before the next day');
  now = new Date('2026-11-09T06:00:00Z');
  t.mock.timers.tick(1);
  assert.deepEqual(runs, ['2026-11-08T06:00:00.000Z', '2026-11-09T06:00:00.000Z']);
  stop();
  await new Promise((resolve) => setImmediate(resolve));
  now = new Date('2026-11-10T06:00:00Z');
  t.mock.timers.tick(24 * 60 * 60_000);
  assert.equal(runs.length, 2, 'a stopped timer does not run again');
});

test('a run that throws is logged, and the next day still runs', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const errors = t.mock.method(console, 'error', () => {});
  let now = new Date('2026-11-08T05:00:00Z');
  let calls = 0;
  const stop = scheduleDailyJobs(async (at) => {
    calls += 1;
    now = at;
    throw new Error('the archive is unreachable');
  }, () => now);
  now = new Date('2026-11-08T06:00:00Z');
  t.mock.timers.tick(60 * 60_000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(errors.mock.callCount(), 1);
  assert.match(String(errors.mock.calls[0].arguments[0]), /daily jobs failed: the archive is unreachable/);
  t.mock.timers.tick(24 * 60 * 60_000);
  assert.equal(calls, 2, 'the failure does not end the schedule');
  stop();
});
