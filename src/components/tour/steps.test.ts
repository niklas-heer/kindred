import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { findStep, placeCard, stepsFor, TOUR_STEPS, type TourContext, type TourStep } from './steps.ts';

const ctx = (over: Partial<TourContext> = {}): TourContext => ({ role: 'viewer', assistant: false, people: 10, houses: 2, ...over });
const ids = (c: TourContext) => stepsFor(c).map((s) => s.id);

test('a viewer gets no editing or steward steps', () => {
  const got = ids(ctx());
  for (const hidden of ['add', 'memory', 'access']) assert.ok(!got.includes(hidden), hidden);
  for (const shown of ['welcome', 'tree', 'panel', 'find', 'today', 'chronicle', 'almanac', 'again']) assert.ok(got.includes(shown), shown);
});

test('the tour is short: nine steps for a new relative, a few more for those who run the family', () => {
  assert.equal(ids(ctx()).length, 9);
  assert.equal(ids(ctx({ role: 'contributor' })).length, 9);
  assert.equal(ids(ctx({ role: 'editor' })).length, 10);
  assert.equal(ids(ctx({ role: 'steward' })).length, 11);
});

test('whoever may write is shown how to add a memory; a viewer is shown where to read them', () => {
  for (const role of ['contributor', 'editor', 'steward'] as const) {
    const got = ids(ctx({ role }));
    assert.ok(got.includes('memory') && !got.includes('chronicle'), role);
  }
  const viewer = ids(ctx());
  assert.ok(viewer.includes('chronicle') && !viewer.includes('memory'));
});

test('an editor is shown how to add a relative but gets no steward steps', () => {
  const got = ids(ctx({ role: 'editor' }));
  assert.ok(got.includes('add'));
  assert.ok(!got.includes('access'));
});

test('a steward is shown how to invite the family', () => {
  assert.ok(ids(ctx({ role: 'steward' })).includes('access'));
});

// The rules below are kept for steps that may come back; no step in today's short tour uses them.
const step = (id: string, over: Partial<TourStep>): TourStep => ({ id, title: 'tour.welcome.title', body: 'tour.welcome.body', ...over });

test('a step for the assistant needs the assistant to be on', () => {
  const steps = [step('assistant', { feature: 'assistant' })];
  assert.equal(stepsFor(ctx(), steps).length, 0);
  assert.equal(stepsFor(ctx({ assistant: true }), steps).length, 1);
});

test('a family with nobody in it, or no houses, skips what it does not have', () => {
  const empty = ids(ctx({ role: 'steward', people: 0, houses: 0 }));
  for (const hidden of ['tree', 'views', 'add', 'panel']) assert.ok(!empty.includes(hidden), hidden);
  assert.ok(empty.includes('welcome') && empty.includes('access'));
  const steps = [step('arms', { requires: 'house' })];
  assert.equal(stepsFor(ctx({ houses: 0 }), steps).length, 0);
  assert.equal(stepsFor(ctx(), steps).length, 1);
});

test('every step begins and ends the same way for every role', () => {
  for (const role of ['viewer', 'contributor', 'editor', 'steward'] as const) {
    const got = ids(ctx({ role }));
    assert.equal(got[0], 'welcome');
    assert.equal(got[got.length - 1], 'again');
  }
});

test('a step whose element is missing is passed over, forwards and backwards', async () => {
  const there = new Set(['a', 'c', 'e']);
  const present = async (s: string) => there.has(s);
  const steps = ['a', 'b', 'c', 'd', 'e'];
  assert.equal(await findStep(steps, 1, 1, present), 2);
  assert.equal(await findStep(steps, 3, -1, present), 2);
});

test('running out of steps ends the search instead of hanging', async () => {
  assert.equal(await findStep(['a', 'b'], 0, 1, async () => false), -1);
  assert.equal(await findStep(['a', 'b'], 1, -1, async () => false), -1);
  assert.equal(await findStep(['a'], 1, 1, async () => true), -1);
});

test('leaving the tour stops the search at once', async () => {
  let tried = 0;
  const found = await findStep(['a', 'b', 'c'], 0, 1, async () => { tried++; return false; }, () => tried >= 1);
  assert.equal(found, -1);
  assert.equal(tried, 1);
});

test('the card goes beside its target, on screen', () => {
  const view = { w: 1200, h: 800 };
  const card = { w: 380, h: 200 };
  assert.deepEqual(placeCard({ x: 500, y: 60, w: 200, h: 40 }, card, view), { left: 410, top: 114 });
  // No room below: above.
  assert.equal(placeCard({ x: 500, y: 700, w: 200, h: 40 }, card, view).top, 486);
  // Near the right edge it stays on screen.
  assert.ok(placeCard({ x: 1150, y: 60, w: 40, h: 40 }, card, view).left + card.w <= view.w);
});

test('with nothing to point at, or no side free, the card can still be read', () => {
  const view = { w: 1200, h: 800 };
  const card = { w: 380, h: 200 };
  assert.deepEqual(placeCard(null, card, view), { left: 410, top: 300 });
  const big = placeCard({ x: 0, y: 0, w: 1200, h: 800 }, card, view);
  assert.ok(big.left >= 0 && big.top >= 0 && big.top + card.h <= view.h);
});

test('on a phone the card docks away from its target', () => {
  const view = { w: 390, h: 800 };
  const card = { w: 366, h: 220 };
  assert.deepEqual(placeCard({ x: 10, y: 40, w: 100, h: 40 }, card, view), { left: 12, top: 568 });
  assert.deepEqual(placeCard({ x: 10, y: 700, w: 100, h: 40 }, card, view), { left: 12, top: 12 });
});

/** Every class a step points at still exists in the app, so a rename fails here instead of quietly dropping a step. */
test('every target still names real classes', () => {
  const root = new URL('../../', import.meta.url).pathname;
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'library' ? [] : walk(p);
    return /\.(tsx|css)$/.test(e.name) && !p.includes('/tour/') ? [p] : [];
  });
  const source = walk(root).map((f) => readFileSync(f, 'utf8')).join('\n');
  for (const step of TOUR_STEPS) {
    for (const selector of step.targets ?? []) {
      for (const [, name] of selector.matchAll(/\.([a-z][a-z0-9-]*)/g)) {
        assert.ok(source.includes(name), `${step.id}: .${name} is gone`);
      }
    }
  }
});
