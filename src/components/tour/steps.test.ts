import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { advance, chaptersDone, chaptersFor, findStep, GRAND_TOUR, NO_PROGRESS, nextChapterStart, placeCard, readProgress, resumeChapter, scriptFor, stepsFor, WELCOME_TOUR, type TourContext, type TourStep } from './steps.ts';

const ctx = (over: Partial<TourContext> = {}): TourContext => ({ role: 'viewer', assistant: false, people: 10, houses: 2, ...over });
const ids = (c: TourContext) => stepsFor(c).map((s) => s.id);
const grand = (c: TourContext) => scriptFor('grand', c);
const ROLES = ['viewer', 'contributor', 'editor', 'steward'] as const;

// Welcome.

test('a viewer gets no writing or steward steps', () => {
  const got = ids(ctx());
  for (const hidden of ['memory', 'access']) assert.ok(!got.includes(hidden), hidden);
  for (const shown of ['welcome', 'today', 'find', 'tree', 'panel', 'chronicle', 'almanac', 'help']) assert.ok(got.includes(shown), shown);
});

test('Welcome is short: eight steps for a new relative, one more for a steward', () => {
  assert.equal(ids(ctx()).length, 8);
  assert.equal(ids(ctx({ role: 'contributor' })).length, 8);
  assert.equal(ids(ctx({ role: 'editor' })).length, 8);
  assert.equal(ids(ctx({ role: 'steward' })).length, 9);
});

test('whoever may write is shown how to add a memory; a viewer is shown where to read them', () => {
  for (const role of ['contributor', 'editor', 'steward'] as const) {
    const got = ids(ctx({ role }));
    assert.ok(got.includes('memory') && !got.includes('chronicle'), role);
  }
  const viewer = ids(ctx());
  assert.ok(viewer.includes('chronicle') && !viewer.includes('memory'));
});

test('only a steward is shown how to invite the family', () => {
  assert.ok(ids(ctx({ role: 'steward' })).includes('access'));
  assert.ok(!ids(ctx({ role: 'editor' })).includes('access'));
});

const step = (id: string, over: Partial<TourStep>): TourStep => ({ id, title: 'tour.welcome.title', body: 'tour.welcome.body', ...over });

test('a step for the assistant needs the assistant to be on', () => {
  const steps = [step('assistant', { feature: 'assistant' })];
  assert.equal(stepsFor(ctx(), steps).length, 0);
  assert.equal(stepsFor(ctx({ assistant: true }), steps).length, 1);
});

test('a family with nobody in it, or no houses, skips what it does not have', () => {
  const empty = ids(ctx({ role: 'steward', people: 0, houses: 0 }));
  for (const hidden of ['tree', 'panel']) assert.ok(!empty.includes(hidden), hidden);
  assert.ok(empty.includes('welcome') && empty.includes('access'));
  const none = grand(ctx({ role: 'steward', people: 0, houses: 0 })).map((s) => s.id);
  for (const hidden of ['g-select', 'g-profile', 'g-edit', 'g-arms']) assert.ok(!none.includes(hidden), hidden);
  assert.ok(none.includes('g-houses'));
});

test('Welcome begins and ends the same way for every role', () => {
  for (const role of ROLES) {
    const got = ids(ctx({ role }));
    assert.equal(got[0], 'welcome');
    assert.equal(got[got.length - 1], 'help');
  }
});

// The grand tour.

test('the grand tour is about twenty-five steps, more for those who may do more', () => {
  const n = Object.fromEntries(ROLES.map((role) => [role, grand(ctx({ role })).length]));
  assert.deepEqual(n, { viewer: 24, contributor: 25, editor: 32, steward: 36 });
});

test('a viewer is told nothing about editing, and only stewards get the stewards\' chapter', () => {
  const viewer = grand(ctx()).map((s) => s.id);
  for (const hidden of ['g-add', 'g-edit', 'g-fields', 'g-address', 'g-life', 'g-look', 'g-memory', 'g-export', 'g-access', 'g-share', 'g-viewas', 'g-games']) assert.ok(!viewer.includes(hidden), hidden);
  for (const role of ['viewer', 'contributor', 'editor'] as const) assert.ok(!chaptersFor(ctx({ role })).some((c) => c.id === 'stewards'), role);
  assert.equal(chaptersFor(ctx({ role: 'steward' })).at(-1)?.id, 'stewards');
});

test('every step of the grand tour carries its chapter, and the chapters come in order', () => {
  const steps = grand(ctx({ role: 'steward' }));
  assert.ok(steps.every((s) => !!s.chapter));
  assert.deepEqual([...new Set(steps.map((s) => s.chapter))], GRAND_TOUR.map((c) => c.id));
  assert.ok(scriptFor('welcome', ctx()).every((s) => !s.chapter));
});

test('step ids are unique across both tours', () => {
  const all = [...WELCOME_TOUR, ...GRAND_TOUR.flatMap((c) => c.steps)].map((s) => s.id);
  assert.equal(new Set(all).size, all.length);
});

test('a step that waits for the reader points at what "Show me" presses, so there is always something to press', () => {
  for (const s of [...WELCOME_TOUR, ...GRAND_TOUR.flatMap((c) => c.steps)]) {
    if (s.task) assert.ok(s.targets?.length, s.id);
    if (s.opener) assert.ok(s.targets?.length, s.id);
  }
});

// Chapters: ticking off, skipping, and picking up again.

const CHAPTERS = ['today', 'tree', 'person'];
const SCRIPT: TourStep[] = [
  step('a1', { chapter: 'today' }), step('a2', { chapter: 'today' }),
  step('b1', { chapter: 'tree' }), step('b2', { chapter: 'tree' }),
  step('c1', { chapter: 'person' }),
];

test('a reader who has not begun has nothing to continue', () => {
  assert.equal(resumeChapter(NO_PROGRESS, CHAPTERS), null);
});

test('going on inside a chapter ticks nothing; leaving it by its last step ticks it', () => {
  const inside = advance(NO_PROGRESS, SCRIPT, 0, 1);
  assert.deepEqual(inside, { done: [], at: 'today' });
  const left = advance(inside, SCRIPT, 1, 2);
  assert.deepEqual(left, { done: ['today'], at: 'tree' });
  assert.equal(resumeChapter(left, CHAPTERS), 'tree');
  assert.equal(chaptersDone(left, CHAPTERS), 1);
});

test('a skipped chapter is not ticked, and waits for another day', () => {
  const at = nextChapterStart(SCRIPT, 0);
  assert.equal(at, 2);
  const skipped = advance(NO_PROGRESS, SCRIPT, 0, at, true);
  assert.deepEqual(skipped, { done: [], at: 'tree' });
  // Walk the rest to the end: the skipped chapter is what "Continue" opens next.
  const end = advance(advance(skipped, SCRIPT, 3, 4), SCRIPT, 4, SCRIPT.length);
  assert.deepEqual(end, { done: ['tree', 'person'], at: null });
  assert.equal(resumeChapter(end, CHAPTERS), 'today');
  assert.equal(nextChapterStart(SCRIPT, 4), SCRIPT.length);
});

test('chapters passed over because nothing in them could be shown count as walked', () => {
  assert.deepEqual(advance(NO_PROGRESS, SCRIPT, 1, 4), { done: ['today', 'tree'], at: 'person' });
});

test('the whole tour walked leaves nothing to continue', () => {
  const all = advance(NO_PROGRESS, SCRIPT, 0, SCRIPT.length);
  assert.deepEqual(all, { done: CHAPTERS, at: null });
  assert.equal(resumeChapter(all, CHAPTERS), null);
  assert.equal(chaptersDone(all, CHAPTERS), 3);
});

test('"Continue" opens where the reader stopped, unless that chapter is no longer theirs', () => {
  assert.equal(resumeChapter({ done: ['today'], at: 'person' }, CHAPTERS), 'person');
  // A steward who became an editor stopped in a chapter they no longer have.
  assert.equal(resumeChapter({ done: ['today'], at: 'stewards' }, CHAPTERS), 'tree');
  // Stopped in a chapter that is ticked already (walked again from the list): the first one still open.
  assert.equal(resumeChapter({ done: ['today', 'tree'], at: 'today' }, CHAPTERS), 'person');
});

test('what a browser kept is read back, and nonsense is no progress', () => {
  assert.deepEqual(readProgress(JSON.stringify({ done: ['today', 'today', 7], at: 'tree' })), { done: ['today'], at: 'tree' });
  for (const raw of [null, '', 'seen', '[]', '{"done":"all"}', '42']) assert.deepEqual(readProgress(raw), NO_PROGRESS, String(raw));
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

/**
 * Every name a step points at is still set as a `data-tour` somewhere in the app, so a renamed or removed element fails
 * here instead of quietly dropping a step. `tour="…"` is how a tab passes its name on (ui/Tabs.tsx).
 */
test('every target is a data-tour name the app still sets', () => {
  const root = new URL('../../', import.meta.url).pathname;
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'library' ? [] : walk(p);
    return /\.tsx$/.test(e.name) && !p.includes('/tour/') ? [p] : [];
  });
  const set = new Set<string>();
  for (const file of walk(root)) {
    const source = readFileSync(file, 'utf8');
    // data-tour="name", data-tour={cond ? 'name' : undefined}, tour="name", and tour={`person-tab-${tb}`} with its tabs.
    for (const [, value] of source.matchAll(/\btour=(?:"([^"]+)"|\{[^}]*\})/g)) if (value) set.add(value);
    for (const [expr] of source.matchAll(/\btour=\{[^}]*\}/g)) for (const [, name] of expr.matchAll(/'([a-z][a-z0-9-]*)'/g)) set.add(name);
    if (source.includes('tour={`person-tab-${tb}`}')) for (const [, tb] of source.matchAll(/\['(overview|family|stories|everyday|edit)',/g)) set.add(`person-tab-${tb}`);
  }
  const names = (s: TourStep) => [...(s.targets ?? []), ...(s.opener ? [s.opener] : []), ...(s.task ? [s.task.until, s.task.click] : [])];
  for (const s of [...WELCOME_TOUR, ...GRAND_TOUR.flatMap((c) => c.steps)]) {
    for (const name of names(s)) assert.ok(set.has(name), `${s.id}: nothing in src/ sets data-tour="${name}"`);
  }
});
