// node --test src/lib/person.rebase.test.ts — "Load the latest and keep my changes": the Edit draft is rebased onto the
// person as it is now. The reader's changes stay, everything else takes the latest value, and no one else's addition is lost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rebaseDraft, rebaseFields, type RebaseField } from '../components/fields/rebase.ts';

const field = (id: string | undefined, over: Partial<RebaseField> = {}): RebaseField => ({
  key: id ?? `new-${over.label ?? 'x'}`, id, type: 'notes', label: 'General', value: { text: 'first' }, private: false, ...over,
});
type V = { given: string; nickname: string; living: boolean; fields: RebaseField[] };
const values = (over: Partial<V> = {}): V => ({ given: 'Ada', nickname: '', living: true, fields: [], ...over });

test('a scalar the reader changed keeps their value; one they did not change takes the latest', () => {
  const base = values();
  const draft = values({ nickname: 'Addy' });
  const latest = values({ given: 'Ada Lovelace' });
  const out = rebaseDraft(base, draft, latest);
  assert.equal(out.nickname, 'Addy', 'the reader’s change is kept');
  assert.equal(out.given, 'Ada Lovelace', 'the name someone else changed is not written back as it was');
});

test('when both the reader and someone else changed the same scalar, the reader’s version is the one saved', () => {
  const out = rebaseDraft(values(), values({ given: 'Ada K.' }), values({ given: 'Ada Lovelace' }));
  assert.equal(out.given, 'Ada K.');
});

test('a field the reader changed keeps their version; one only someone else changed takes theirs', () => {
  const a = field('a', { value: { text: 'first' } });
  const b = field('b', { label: 'Old' });
  const aNow = field('a', { value: { text: 'first' }, label: 'Fine' });
  const bNow = field('b', { value: { text: 'second' } });
  const out = rebaseFields([a, b], [field('a', { value: { text: 'mine' } }), b], [aNow, bNow]);
  assert.equal(out.find((f) => f.id === 'a')?.value.text, 'mine', 'the reader’s edit to a is kept');
  assert.equal(out.find((f) => f.id === 'a')?.label, 'General', 'a field the reader did not touch keeps the reader’s copy of it as the base has it');
  assert.equal(out.find((f) => f.id === 'b')?.value.text, 'second', 'b, changed only by someone else, is the latest');
});

test('an untouched field takes the latest copy, so a change made elsewhere is not reverted', () => {
  const base = [field('a', { label: 'Mobile' })];
  const latest = [field('a', { label: 'Work' })];
  const out = rebaseFields(base, [field('a', { label: 'Mobile' })], latest);
  assert.deepEqual(out.map((f) => f.label), ['Work']);
});

test('a field another reader added since the draft was opened is kept at the end, so the save does not delete it', () => {
  const base = [field('a')];
  const draft = [field('a', { value: { text: 'mine' } })];
  const latest = [field('a'), field('c', { value: { text: 'added elsewhere' } })];
  const out = rebaseFields(base, draft, latest);
  assert.deepEqual(out.map((f) => f.id), ['a', 'c']);
  assert.equal(out[1]!.value.text, 'added elsewhere');
});

test('a field the reader removed stays removed, even when someone else changed it', () => {
  const base = [field('a'), field('b')];
  const draft = [field('a')];
  const latest = [field('a'), field('b', { value: { text: 'changed by someone else' } })];
  assert.deepEqual(rebaseFields(base, draft, latest).map((f) => f.id), ['a']);
});

test('a field the reader changed, which someone else has since removed, is kept as a new field rather than lost', () => {
  const base = [field('a')];
  const draft = [field('a', { value: { text: 'my words' } })];
  const out = rebaseFields(base, draft, []);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.id, undefined, 'saved as a new field');
  assert.equal(out[0]!.value.text, 'my words');
});

test('a field removed by someone else and not changed by the reader is simply gone', () => {
  assert.deepEqual(rebaseFields([field('a')], [field('a')], []), []);
});

test('a field the reader added in the draft is kept, in their place in the list', () => {
  const base = [field('a')];
  const draft = [field('a'), field(undefined, { label: 'New', value: { text: 'fresh' } })];
  const out = rebaseFields(base, draft, [field('a'), field('c')]);
  assert.deepEqual(out.map((f) => f.label), ['General', 'New', 'General']);
  assert.equal(out[1]!.id, undefined);
});
