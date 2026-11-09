import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closeTab, EMPTY_TABS, forgetChat, MAX_DRAFTS, MAX_TABS, openTab, parseTabs, withDraft, type TabsState } from './chat-tabs.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const opened = (n: number): TabsState => Array.from({ length: n }, (_, i) => id(i)).reduce((s, c) => openTab(s, c)!, EMPTY_TABS);

test('opening a chat that is already open only brings it to the front', () => {
  const s = opened(3);
  assert.deepEqual(openTab(s, id(0)), { ...s, active: id(0) });
});

test('with every tab taken, a tab that is not running makes way, and the front one stays', () => {
  const full = openTab(opened(MAX_TABS), id(0))!;
  const next = openTab(full, id(99), (c) => c === id(1))!;
  assert.equal(next.tabs.length, MAX_TABS);
  assert.ok(next.tabs.includes(id(1)), 'the running tab stays');
  assert.ok(next.tabs.includes(id(0)), 'the tab in front stays');
  assert.equal(next.active, id(99));
});

test('with every tab running, nothing is replaced', () => {
  assert.equal(openTab(opened(MAX_TABS), id(99), () => true), null);
});

test('closing the front tab brings its neighbour forward', () => {
  const s = { ...opened(3), active: id(1) };
  assert.equal(closeTab(s, id(1)).active, id(2));
  assert.equal(closeTab({ ...s, active: id(2) }, id(2)).active, id(1));
  assert.equal(closeTab(closeTab(closeTab(s, id(0)), id(1)), id(2)).active, null);
});

test('drafts are per chat, cleared when emptied, and the oldest go first past the limit', () => {
  let s = withDraft(EMPTY_TABS, id(1), 'hello', 1);
  s = withDraft(s, id(2), 'other', 2);
  assert.deepEqual(Object.values(s.drafts).map((d) => d.text), ['hello', 'other']);
  assert.equal(withDraft(s, id(1), '', 3).drafts[id(1)], undefined);
  let many = EMPTY_TABS;
  for (let i = 0; i <= MAX_DRAFTS; i++) many = withDraft(many, id(i), 'x', i);
  assert.equal(Object.keys(many.drafts).length, MAX_DRAFTS);
  assert.equal(many.drafts[id(0)], undefined);
});

test('forgetting a chat removes its tab, draft and place', () => {
  const s = forgetChat({ ...withDraft(opened(2), id(0), 'x', 1), scroll: { [id(0)]: { y: 5, atEnd: false } } }, id(0));
  assert.deepEqual([s.tabs, s.drafts, s.scroll], [[id(1)], {}, {}]);
});

test('what survives a reload survives it whole, and anything else starts clean', () => {
  const s = { ...withDraft(openTab(opened(2), id(0))!, id(1), 'half a thought', 7), listOpen: true, scroll: { [id(1)]: { y: 120, atEnd: false } } };
  assert.deepEqual(parseTabs(JSON.stringify(s)), s);
  for (const bad of [null, 'nope', '{"tabs":"x"}', '{"tabs":["not-an-id"],"active":"x"}']) assert.deepEqual(parseTabs(bad).tabs, []);
  assert.equal(parseTabs(JSON.stringify({ ...s, active: id(55) })).active, s.tabs[0], 'an active tab that is not open falls back');
});
