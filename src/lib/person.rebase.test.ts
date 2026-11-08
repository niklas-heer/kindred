// node --test src/lib/person.rebase.test.ts — "Load the latest and keep my changes": the Edit draft is rebased onto the
// person as it is now. The reader's changes stay, everything else takes the latest value, and no one else's addition is lost.
// Where the reader and someone else changed the same thing to different values, the reader's version is kept and the case
// is returned as a conflict, so the Edit tab can show both and the reader chooses (takeTheirs settles one).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rebaseDraft, rebaseFields, takeTheirs, type Conflict, type RebaseField } from '../components/fields/rebase.ts';

const field = (id: string | undefined, over: Partial<RebaseField> = {}): RebaseField => ({
  key: id ?? `new-${over.label ?? 'x'}`, id, type: 'notes', label: 'General', value: { text: 'first' }, private: false, ...over,
});
type V = { given: string; nickname: string; living: boolean; fields: RebaseField[] };
const values = (over: Partial<V> = {}): V => ({ given: 'Ada', nickname: '', living: true, fields: [], ...over });

type Full = {
  given: string; nickname: string; bio: string; title: string; occupation: string; occupationCode: string; fields: RebaseField[];
};
const full = (over: Partial<Full> = {}): Full => ({
  given: 'Ada', nickname: '', bio: '', title: '', occupation: '', occupationCode: '', fields: [], ...over,
});

test('a scalar the reader changed keeps their value; one they did not change takes the latest', () => {
  const base = values();
  const draft = values({ nickname: 'Addy' });
  const latest = values({ given: 'Ada Lovelace' });
  const { values: out, conflicts } = rebaseDraft(base, draft, latest);
  assert.equal(out.nickname, 'Addy', 'the reader’s change is kept');
  assert.equal(out.given, 'Ada Lovelace', 'the name someone else changed is not written back as it was');
  assert.deepEqual(conflicts, [], 'changes on different keys are not a conflict');
});

test('when both the reader and someone else changed the same scalar, the reader’s version is kept and listed as a conflict', () => {
  const { values: out, conflicts } = rebaseDraft(values(), values({ given: 'Ada K.' }), values({ given: 'Ada Lovelace' }));
  assert.equal(out.given, 'Ada K.');
  assert.deepEqual(conflicts, [{ kind: 'value', keys: ['given'], mine: { given: 'Ada K.' }, theirs: { given: 'Ada Lovelace' } }]);
});

test('the same change made on both sides is not a conflict', () => {
  const { conflicts } = rebaseDraft(values(), values({ given: 'Ada L.' }), values({ given: 'Ada L.' }));
  assert.deepEqual(conflicts, []);
});

test('a biography changed by both is listed with both versions, and the reader’s stays until they choose', () => {
  const base = full({ bio: 'Old.' });
  const draft = full({ bio: 'My bio paragraph.' });
  const latest = full({ bio: 'Their bio paragraph.' });
  const { values: out, conflicts } = rebaseDraft(base, draft, latest);
  assert.equal(out.bio, 'My bio paragraph.');
  assert.deepEqual(conflicts, [{ kind: 'value', keys: ['bio'], mine: { bio: 'My bio paragraph.' }, theirs: { bio: 'Their bio paragraph.' } }]);
});

test('remote changes the reader did not touch are merged in, and only the real conflicts are listed', () => {
  const base = full({ bio: 'Old.', title: 'Dr' });
  const draft = full({ bio: 'Mine.', title: 'Dr' });
  const latest = full({ bio: 'Old.', title: 'Prof', nickname: 'Ada' });
  const { values: out, conflicts } = rebaseDraft(base, draft, latest);
  assert.equal(out.title, 'Prof', 'a title only someone else changed is merged in');
  assert.equal(out.nickname, 'Ada', 'a nickname only someone else set is merged in');
  assert.equal(out.bio, 'Mine.', 'the reader’s own change stays');
  assert.deepEqual(conflicts, [], 'nothing changed on both sides, so nothing to choose');
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

test('a field both changed is listed as a conflict, with both versions', () => {
  const base = [field('a', { value: { text: 'first' } })];
  const draft = [field('a', { value: { text: 'mine' } })];
  const latest = [field('a', { value: { text: 'theirs' } })];
  const { values: out, conflicts } = rebaseDraft(full({ fields: base }), full({ fields: draft }), full({ fields: latest }));
  assert.equal(out.fields[0]!.value.text, 'mine');
  assert.equal(conflicts.length, 1);
  const c = conflicts[0]!;
  assert.equal(c.kind, 'field');
  if (c.kind !== 'field') return;
  assert.equal(c.id, 'a');
  assert.equal(c.mine?.value.text, 'mine');
  assert.equal(c.theirs?.value.text, 'theirs');
});

test('a field the reader changed that someone else removed is a conflict: the reader’s words are kept as a new field', () => {
  const base = [field('a')];
  const draft = [field('a', { value: { text: 'my words' } })];
  const { values: out, conflicts } = rebaseDraft(full({ fields: base }), full({ fields: draft }), full({ fields: [] }));
  assert.equal(out.fields.length, 1);
  assert.equal(out.fields[0]!.id, undefined, 'saved as a new field');
  assert.equal(out.fields[0]!.value.text, 'my words');
  assert.deepEqual(conflicts.map((c) => (c.kind === 'field' ? [c.id, !!c.mine, !!c.theirs] : null)), [['a', true, false]]);
});

test('a field the reader removed that someone else changed is a conflict; the reader’s removal stays until they choose', () => {
  const base = [field('a'), field('b')];
  const draft = [field('a')];
  const latest = [field('a'), field('b', { value: { text: 'changed by someone else' } })];
  const { values: out, conflicts } = rebaseDraft(full({ fields: base }), full({ fields: draft }), full({ fields: latest }));
  assert.deepEqual(out.fields.map((f) => f.id), ['a']);
  assert.deepEqual(conflicts.map((c) => (c.kind === 'field' ? [c.id, !!c.mine, !!c.theirs] : null)), [['b', false, true]]);
});

test('an untouched field takes the latest copy, so a change made elsewhere is not reverted', () => {
  const base = [field('a', { label: 'Mobile' })];
  const latest = [field('a', { label: 'Work' })];
  const { values: out, conflicts } = rebaseDraft(full({ fields: base }), full({ fields: [field('a', { label: 'Mobile' })] }), full({ fields: latest }));
  assert.deepEqual(out.fields.map((f) => f.label), ['Work']);
  assert.deepEqual(conflicts, []);
});

test('a field another reader added since the draft was opened is kept at the end, so the save does not delete it', () => {
  const base = [field('a')];
  const draft = [field('a', { value: { text: 'mine' } })];
  const latest = [field('a'), field('c', { value: { text: 'added elsewhere' } })];
  const out = rebaseFields(base, draft, latest);
  assert.deepEqual(out.map((f) => f.id), ['a', 'c']);
  assert.equal(out[1]!.value.text, 'added elsewhere');
});

test('a field the reader removed, and nobody else changed, is simply gone', () => {
  assert.deepEqual(rebaseFields([field('a')], [field('a')], []), []);
});

test('a field the reader added in the draft is kept, in their place in the list', () => {
  const base = [field('a')];
  const draft = [field('a'), field(undefined, { label: 'New', value: { text: 'fresh' } })];
  const out = rebaseFields(base, draft, [field('a'), field('c')]);
  assert.deepEqual(out.map((f) => f.label), ['General', 'New', 'General']);
  assert.equal(out[1]!.id, undefined);
});

test('occupation text and its vocabulary code are one unit: the reader’s own words never get someone else’s code', () => {
  const base = full({ occupation: 'Pflegerin', occupationCode: 'nurse' });
  const draft = full({ occupation: 'Pflegehelferin im Heim', occupationCode: '' });
  const latest = full({ occupation: 'Krankenpfleger', occupationCode: 'nurse' });
  const { values: out, conflicts } = rebaseDraft(base, draft, latest);
  assert.equal(out.occupation, 'Pflegehelferin im Heim');
  assert.equal(out.occupationCode, '', 'not the other editor’s code');
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0]!.kind, 'value');
  if (conflicts[0]!.kind === 'value') assert.deepEqual(conflicts[0]!.keys, ['occupation', 'occupationCode']);
});

test('when only someone else changed the occupation, both its parts come from the latest', () => {
  const base = full({ occupation: 'Pflegerin', occupationCode: 'nurse' });
  const draft = full({ occupation: 'Pflegerin', occupationCode: 'nurse', bio: 'Mine.' });
  const latest = full({ occupation: 'Lehrer', occupationCode: 'teacher' });
  const { values: out, conflicts } = rebaseDraft(base, draft, latest);
  assert.deepEqual([out.occupation, out.occupationCode], ['Lehrer', 'teacher']);
  assert.deepEqual(conflicts, []);
});

test('takeTheirs settles a scalar conflict on the other person’s version, and nothing else', () => {
  const draft = full({ bio: 'Mine.', title: 'Mine too' });
  const conflict: Conflict = { kind: 'value', keys: ['bio'], mine: { bio: 'Mine.' }, theirs: { bio: 'Theirs.' } };
  const next = takeTheirs(draft, conflict);
  assert.equal(next.bio, 'Theirs.');
  assert.equal(next.title, 'Mine too');
});

test('takeTheirs settles a unit as one: the occupation text and code both come from the other person', () => {
  const draft = full({ occupation: 'Mein Beruf', occupationCode: '' });
  const conflict: Conflict = {
    kind: 'value', keys: ['occupation', 'occupationCode'],
    mine: { occupation: 'Mein Beruf', occupationCode: '' }, theirs: { occupation: 'Krankenpfleger', occupationCode: 'nurse' },
  };
  const next = takeTheirs(draft, conflict);
  assert.deepEqual([next.occupation, next.occupationCode], ['Krankenpfleger', 'nurse']);
});

test('takeTheirs puts a field back in its place with the other person’s version, and a removed field stays gone when theirs is removed', () => {
  const draft = full({ fields: [field('a', { value: { text: 'mine' } }), field('b')] });
  const replaced = takeTheirs(draft, { kind: 'field', id: 'a', mine: draft.fields[0]!, theirs: field('a', { value: { text: 'theirs' } }) });
  assert.deepEqual(replaced.fields.map((f) => [f.id, f.value.text]), [['a', 'theirs'], ['b', 'first']]);
  const removed = takeTheirs(draft, { kind: 'field', id: 'a', mine: draft.fields[0]!, theirs: null });
  assert.deepEqual(removed.fields.map((f) => f.id), ['b']);
});

test('takeTheirs restores a field the reader removed, when someone else changed it', () => {
  const draft = full({ fields: [field('b')] });
  const restored = takeTheirs(draft, { kind: 'field', id: 'a', mine: null, theirs: field('a', { value: { text: 'theirs' } }) });
  assert.deepEqual(restored.fields.map((f) => f.id), ['b', 'a']);
});
