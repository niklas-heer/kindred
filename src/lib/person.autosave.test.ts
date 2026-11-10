// node --test src/lib/person.autosave.test.ts — the Edit tab saving on its own: a pause or leaving a field writes once, one
// write runs at a time, a failed write is tried again and keeps what was typed, a conflict stops the writing, Undo takes
// back one change, and the guarded save tells the draft the exact revision to go on from. A scratch family under a temporary
// KINDRED_DATA_DIR (never data/); the environment is set before anything loads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'kindred-autosave-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');

const { openSqlite } = await import('./store/node.ts');
const { editSnapshot, savePersonEdit, CHANGED_SINCE_OPENED } = await import('./person.server.ts');
const {
  classifyFailure, clearJournal, createAutosaver, journalKey, JOURNAL_KEEP_MS, nextAfter, readJournal, undoStep, writeJournal,
} = await import('./fields/autosave.ts');
const { isBlankNew, keepShared, offersPersonal, openDraft, sendable, signatureOf, storedForm } = await import('./fields/edit-values.ts');
const { forgetLocalIdentity } = await import('./auth/client.ts');
const { rebaseDraft, rebaseFields } = await import('./fields/rebase.ts');
import type { Outcome, SaveState, Timers } from './fields/autosave.ts';
import type { EditValues } from './fields/edit-values.ts';
import type { DraftField } from '../components/fields/FieldEditor';
import type { EditSnapshot } from './person.server.ts';
import type { FieldInput } from './fields/model.ts';

const EDITOR = { account: 'editor-account', role: 'editor', guest: false } as const;
const TREE = 'autosave';
{
  const d = openSqlite(join(dir, `${TREE}.db`), 'tree', { create: true });
  d.exec(`INSERT INTO meta (key, value) VALUES ('id', '${TREE}'), ('name', 'Autosave'), ('tagline', ''), ('theme', 'codex'), ('focus', '')`);
  d.exec(`INSERT INTO person (id, given, born, living) VALUES ('ada', 'Ada', '1950', 1), ('bea', 'Bea', '1950', 1)`);
  d.close();
}
test.after(() => rmSync(dir, { recursive: true, force: true }));

test('Undo and the picker follow the server: Personal for its author and a new field, and not for a field someone else added', () => {
  const field = (id: string, visibility: DraftField['visibility'], authored?: boolean) => ({ key: id, id, type: 'notes', label: '', value: { text: id }, visibility, authored }) as DraftField;
  const values = (...fields: DraftField[]) => ({ fields }) as EditValues;
  assert.equal(offersPersonal(field('mine', 'family', true)), true);
  assert.equal(offersPersonal(field('theirs', 'family', false)), false);
  assert.equal(offersPersonal(field('older', 'family')), false);
  assert.equal(offersPersonal({ visibility: 'family' }), true, 'not saved yet');
  assert.equal(offersPersonal(field('own-older', 'personal')), true, 'already their own');
  const saved = values(field('a', 'family'), field('b', 'personal'), field('mine', 'family', true));
  const asked = values(field('a', 'personal'), field('b', 'personal'), field('mine', 'personal', true), { ...field('new', 'personal'), id: undefined });
  const kept = keepShared(asked, saved);
  assert.deepEqual(kept.fields.map((f) => f.visibility), ['family', 'personal', 'personal', 'personal']);
  const fine = values(field('b', 'personal'));
  assert.equal(keepShared(fine, saved), fine, 'nothing to change gives the same draft back');
});

test('a new field whose save answer was lost learns it is the reader’s from the latest version', () => {
  const draft = { key: 'k', type: 'notes', label: '', value: { text: 'x' }, visibility: 'family' } as DraftField;
  const [out] = rebaseFields([], [draft], [{ ...draft, key: 'server', id: 'f1', authored: true }]);
  assert.equal(out.id, 'f1');
  assert.equal(out.authored, true);
});

test('signing out clears the drafts kept on this device', () => {
  const kept = new Map([[journalKey('u', 'fam', 'ada'), '{"draft":"a private note"}'], ['kindred.theme', 'night']]);
  const local = { removeItem: (k: string) => kept.delete(k) };
  for (const k of kept.keys()) Object.defineProperty(local, k, { enumerable: true, value: '' });
  (globalThis as { localStorage?: unknown }).localStorage = local;
  try { forgetLocalIdentity(); } finally { delete (globalThis as { localStorage?: unknown }).localStorage; }
  assert.deepEqual([...kept.keys()], ['kindred.theme']);
});

/** Timers the test moves by hand. */
function clock() {
  let now = 0;
  let seq = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    set: (fn, ms) => { const id = ++seq; due.set(id, { at: now + ms, fn }); return id; },
    clear: (h) => { due.delete(h as number); },
  };
  return {
    timers,
    pending: () => due.size,
    async tick(ms: number) {
      const end = now + ms;
      for (;;) {
        const next = [...due.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at;
        due.delete(next[0]);
        next[1].fn();
        await settle();
      }
      now = end;
      await settle();
    },
  };
}
/** Lets promise callbacks run. */
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

/** A saver of plain strings, with a `send` the test controls. */
function saver(send: (v: string) => Promise<Outcome>) {
  const c = clock();
  const states: SaveState[] = [];
  const s = createAutosaver<string>({
    initial: 'a', signature: (v) => v, send, onState: (x) => states.push(x), delay: 900, retryDelays: [2000, 5000], timers: c.timers,
  });
  return { s, c, states };
}
const fail = () => Promise.reject(new Error('Load failed'));

test('a burst of typing is written once, after the pause, with the last value', async () => {
  const sent: string[] = [];
  const { s, c, states } = saver(async (v) => { sent.push(v); return 'saved'; });
  s.change('ab');
  await c.tick(500);
  s.change('abc');
  await c.tick(500);
  s.change('abcd');
  await c.tick(899);
  assert.deepEqual(sent, [], 'nothing is written while the reader types');
  assert.equal(s.state, 'waiting');
  await c.tick(1);
  assert.deepEqual(sent, ['abcd']);
  assert.deepEqual(states, ['waiting', 'saving', 'saved']);
});

test('leaving the field flushes at once and leaves no timer behind', async () => {
  const sent: string[] = [];
  const { s, c } = saver(async (v) => { sent.push(v); return 'saved'; });
  s.change('ab');
  assert.equal(await s.flush(), true);
  assert.deepEqual(sent, ['ab']);
  assert.equal(c.pending(), 0);
  await c.tick(5000);
  assert.deepEqual(sent, ['ab'], 'the pause does not write it again');
});

test('nothing is written when the value is what the server has', async () => {
  const sent: string[] = [];
  const { s, c } = saver(async (v) => { sent.push(v); return 'saved'; });
  s.change('ab');
  s.change('a');
  await c.tick(5000);
  assert.deepEqual(sent, []);
  assert.equal(s.state, 'saved');
});

test('one write at a time: typing during a write waits for its own pause', async () => {
  const sent: string[] = [];
  let release!: () => void;
  const { s, c } = saver((v) => { sent.push(v); return new Promise((r) => { release = () => r('saved'); }); });
  s.change('ab');
  await c.tick(900);
  assert.deepEqual(sent, ['ab']);
  s.change('abc');
  await c.tick(100);
  release();
  await settle();
  assert.deepEqual(sent, ['ab'], 'the write in flight did not trigger another one mid-pause');
  assert.equal(s.state, 'waiting');
  await c.tick(800);
  assert.deepEqual(sent, ['ab', 'abc']);
  release();
  await settle();
  assert.equal(s.state, 'saved');
});

test('a failed write is retried with backoff and keeps the value', async () => {
  const sent: string[] = [];
  let up = false;
  const { s, c, states } = saver((v) => { sent.push(v); return up ? Promise.resolve('saved') : fail(); });
  s.change('ab');
  await c.tick(900);
  assert.equal(s.state, 'retrying');
  await c.tick(2000);
  assert.deepEqual(sent, ['ab', 'ab']);
  up = true;
  await c.tick(5000);
  assert.deepEqual(sent, ['ab', 'ab', 'ab']);
  assert.equal(s.state, 'saved');
  assert.ok(states.includes('retrying'));
});

test('when the retries run out it waits, and coming back online tries again', async () => {
  const sent: string[] = [];
  let up = false;
  const { s, c } = saver((v) => { sent.push(v); return up ? Promise.resolve('saved') : fail(); });
  s.change('ab');
  await c.tick(900 + 2000 + 5000);
  assert.equal(sent.length, 3);
  assert.equal(s.state, 'failed');
  await c.tick(100_000);
  assert.equal(sent.length, 3, 'no write is scheduled any more');
  up = true;
  s.wake();
  await settle();
  assert.equal(s.state, 'saved');
  assert.deepEqual(sent, ['ab', 'ab', 'ab', 'ab']);
});

test('typing during the backoff replaces what is retried, so the newest text is what gets written', async () => {
  const sent: string[] = [];
  let up = false;
  const { s, c } = saver((v) => { sent.push(v); return up ? Promise.resolve('saved') : fail(); });
  s.change('ab');
  await c.tick(900);
  up = true;
  s.change('abc');
  await c.tick(900);
  assert.deepEqual(sent, ['ab', 'abc']);
  assert.equal(s.state, 'saved');
});

test('a refusal is not retried until the value changes', async () => {
  const sent: string[] = [];
  const { s, c } = saver(async (v) => { sent.push(v); return v === 'bad' ? 'refused' : 'saved'; });
  s.change('bad');
  await c.tick(900);
  assert.equal(s.state, 'failed');
  await c.tick(100_000);
  await s.flush();
  assert.deepEqual(sent, ['bad'], 'the same version is not sent again');
  s.change('good');
  await c.tick(900);
  assert.deepEqual(sent, ['bad', 'good']);
  assert.equal(s.state, 'saved');
});

test('a conflict stops the writing until the reader has chosen, and then what they typed is written', async () => {
  const sent: string[] = [];
  let first = true;
  const { s, c } = saver(async (v) => { sent.push(v); if (first) { first = false; return 'conflict'; } return 'saved'; });
  s.change('mine');
  await c.tick(900);
  assert.equal(s.state, 'paused');
  s.change('mine, more');
  await c.tick(100_000);
  assert.deepEqual(sent, ['mine'], 'nothing is written while the conflict is open');
  s.resume();
  await settle();
  assert.deepEqual(sent, ['mine', 'mine, more']);
  assert.equal(s.state, 'saved');
});

test('after a rebase with no clash the merged draft is written after its pause, without the reader doing anything', async () => {
  const sent: string[] = [];
  let first = true;
  let latest = 'x';
  const { s, c } = saver(async (v) => {
    sent.push(v);
    if (first) { first = false; latest = 'x merged'; s.baseline('server'); s.change(latest); return 'again'; }
    return 'saved';
  });
  s.change('x');
  await c.tick(900);
  await c.tick(900);
  assert.deepEqual(sent, ['x', 'x merged']);
  assert.equal(s.state, 'saved');
});

test('a rebase that keeps being overtaken backs off instead of spinning', async () => {
  let n = 0;
  const { s, c } = saver(async () => { n += 1; return 'again'; });
  s.change('x');
  await c.tick(900);
  assert.equal(n, 4, 'the first write and three rounds');
  assert.equal(s.state, 'retrying');
});

test('closing the form writes what is waiting, once, and schedules no retry', async () => {
  const sent: string[] = [];
  const { s, c } = saver((v) => { sent.push(v); return fail(); });
  s.change('ab');
  assert.equal(await s.close(), false);
  assert.deepEqual(sent, ['ab']);
  assert.equal(s.state, 'failed');
  assert.equal(c.pending(), 0);
});

test('closing while a write is in flight lets it finish and writes what came after', async () => {
  const sent: string[] = [];
  let release!: () => void;
  const { s, c } = saver((v) => { sent.push(v); return new Promise((r) => { release = () => r('saved'); }); });
  s.change('ab');
  await c.tick(900);
  s.change('abc');
  const closing = s.close();
  release();
  await settle();
  release();
  assert.equal(await closing, true);
  assert.deepEqual(sent, ['ab', 'abc']);
});

test('what a failed write means', () => {
  const known = (m: string) => m === 'Person not found.' || m === 'The family changed while this was being saved. Please try again.';
  assert.equal(classifyFailure(CHANGED_SINCE_OPENED, known), 'stale');
  assert.equal(classifyFailure('[{"code":"too_big"}]', known), 'refused');
  assert.equal(classifyFailure('Person not found.', known), 'refused');
  assert.equal(classifyFailure('The family changed while this was being saved. Please try again.', known), 'transient');
  assert.equal(classifyFailure('Load failed', known), 'transient');
  assert.equal(classifyFailure('', known), 'transient');
});

// ---------- the person's values ----------

const TODAY = '2026-11-09';
const none = { name: '' };
const field = (over: Partial<DraftField> & Pick<DraftField, 'key'>): DraftField => ({ type: 'notes', label: '', value: { text: 'x' }, visibility: 'family', ...over });
const values = (over: Partial<EditValues> = {}): EditValues => ({
  given: 'Ada', furtherGiven: [], surname: '', sameName: true, currentGiven: 'Ada', currentSurname: '', nickname: '', sex: '',
  born: '1950', bornPlace: none, died: '', diedPlace: none, living: true, title: '', epithet: '', occupation: '', occupationCode: '', bio: '',
  fields: [], ...over,
});

test('a half-typed email stays in the form while the server keeps the last good one and the rest is saved', () => {
  const had = field({ key: 'f', id: 'f', type: 'email', value: { address: 'a@b.de' } });
  const saved = values({ fields: [had] });
  const draft = values({ nickname: 'Addy', fields: [{ ...had, value: { address: 'a@b' } }] });
  const { values: out, held } = sendable(draft, saved, TODAY);
  assert.equal(held, true);
  assert.equal(out.nickname, 'Addy');
  assert.deepEqual(out.fields[0]!.value, { address: 'a@b.de' });
});

test('a new card nobody has written in is not sent and is not called a problem', () => {
  const blank = field({ key: 'n1', type: 'phone', value: { number: '' } });
  assert.equal(isBlankNew(blank), true);
  const { values: out, held } = sendable(values({ fields: [blank] }), values(), TODAY);
  assert.equal(held, false);
  assert.deepEqual(out.fields, []);
});

test('an empty given name and a date that is not real are held back', () => {
  const saved = values();
  const { values: out, held } = sendable(values({ given: ' ', born: '2999-01-01', nickname: 'N' }), saved, TODAY);
  assert.equal(held, true);
  assert.equal(out.given, 'Ada');
  assert.equal(out.born, '1950');
  assert.equal(out.nickname, 'N');
});

test('a death before the birth is held back, and a living person’s old death date is not reported as a problem', () => {
  assert.equal(sendable(values({ living: false, born: '1950', died: '1900' }), values(), TODAY).held, true);
  assert.equal(sendable(values({ living: true, died: 'nonsense' }), values(), TODAY).held, false);
});

test('learning a new field’s id is not a change, a level and a pin on the map are', () => {
  const f = field({ key: 'n1' });
  const base = signatureOf(values({ fields: [f] }));
  assert.equal(signatureOf(values({ fields: [{ ...f, id: 'real' }] })), base);
  assert.notEqual(signatureOf(values({ fields: [{ ...f, visibility: 'editors' }] })), base);
  assert.notEqual(signatureOf(values({ bornPlace: { name: '', lat: 1, lng: 2 }, fields: [f] })), base);
});

test('a further given name not typed yet is no change', () => {
  assert.equal(signatureOf(values({ furtherGiven: ['', ' '] })), signatureOf(values()));
});

test('what was written is compared as the server holds it, so a stray space never looks like someone else’s edit', () => {
  const draft = values({ given: 'Ada ', fields: [field({ key: 'n1', id: 'x', type: 'notes', value: { text: ' hi ' } })] });
  const held = storedForm(draft);
  const server = values({ fields: [field({ key: 'x', id: 'x', type: 'notes', value: { text: 'hi' } })] });
  const { conflicts } = rebaseDraft(held, draft, server);
  assert.deepEqual(conflicts, []);
});

test('a new field whose answer was lost is matched, not added twice', () => {
  const mine = field({ key: 'n1', value: { text: 'new' } });
  const there = field({ key: 'srv', id: 'srv', value: { text: 'new' } });
  const out = rebaseFields([], [mine], [there]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.id, 'srv');
  assert.equal(out[0]!.key, 'n1', 'the card keeps its key, so the reader does not lose the input');
});

// ---------- undo ----------

test('undo takes back one change and leaves what someone else did since', () => {
  const before = values({ nickname: '' });
  const after = values({ nickname: 'Addy' });
  const current = values({ nickname: 'Addy', title: 'Dr' });
  const { values: out, conflicts } = undoStep({ before, after }, current);
  assert.equal(out.nickname, '');
  assert.equal(out.title, 'Dr');
  assert.deepEqual(conflicts, []);
});

test('undo removes a field that the change added, and brings back one that it removed', () => {
  const kept = field({ key: 'k', id: 'k' });
  const added = field({ key: 'a', id: 'a', value: { text: 'added' } });
  assert.deepEqual(undoStep({ before: values({ fields: [kept] }), after: values({ fields: [kept, added] }) }, values({ fields: [kept, added] })).values.fields.map((f) => f.id), ['k']);
  const back = undoStep({ before: values({ fields: [kept, added] }), after: values({ fields: [kept] }) }, values({ fields: [kept] })).values.fields;
  assert.equal(back.length, 2);
  assert.equal(back[1]!.value.text, 'added');
  assert.equal(back[1]!.id, undefined, 'it comes back as a new field, its old row is gone');
});

test('undoing a change someone has since changed again is shown as a conflict', () => {
  const { conflicts } = undoStep({ before: values({ nickname: '' }), after: values({ nickname: 'Addy' }) }, values({ nickname: 'Theirs' }));
  assert.equal(conflicts.length, 1);
});

// ---------- the draft on this device ----------

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), size: () => m.size };
}

test('a draft is kept until it is written, per reader and person, and old ones are dropped', () => {
  const store = memory();
  const key = journalKey('u1', 't', 'p');
  assert.notEqual(key, journalKey('u2', 't', 'p'));
  writeJournal(store, key, { at: 1000, revision: 3, base: { fields: [] }, draft: { fields: [] } });
  assert.equal(readJournal(store, key, 2000)?.revision, 3);
  assert.equal(readJournal(store, key, 1000 + JOURNAL_KEEP_MS + 1), null);
  assert.equal(store.size(), 0, 'a draft past its time is removed');
  writeJournal(store, key, { at: 1000, revision: 3, base: { fields: [] }, draft: { fields: [] } });
  clearJournal(store, key);
  assert.equal(readJournal(store, key, 2000), null);
});

test('broken or missing storage never breaks the form', () => {
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); }, removeItem: () => { throw new Error('denied'); } };
  assert.equal(readJournal(broken, 'k', 1), null);
  writeJournal(broken, 'k', { at: 1, revision: 1, base: {}, draft: {} });
  clearJournal(broken, 'k');
  assert.equal(readJournal(undefined, 'k', 1), null);
  const store = memory();
  store.setItem('k', 'not json');
  assert.equal(readJournal(store, 'k', 1), null);
});

test('a draft left on this device is brought back, and still counts when the server already has it', () => {
  const server = values();
  assert.deepEqual(
    (({ restored, leftOver }) => ({ restored, leftOver }))(openDraft(server, null)),
    { restored: false, leftOver: false },
    'nothing kept: the form opens as the server has it',
  );

  // The write never reached the server: the draft comes back and is written again.
  const typed = values({ epithet: 'the Unsaved' });
  const back = openDraft(server, { at: 1, revision: 1, base: server, draft: typed });
  assert.equal(back.start.epithet, 'the Unsaved');
  assert.equal(back.restored, true);
  assert.equal(back.leftOver, true);

  // The write reached the server as the page went away, and its answer went with the page: nothing to write again, but the
  // reader typed this and never saw it confirmed, so the form must not open as if nothing had been typed.
  const landed = openDraft(typed, { at: 1, revision: 1, base: server, draft: typed });
  assert.equal(landed.start.epithet, 'the Unsaved');
  assert.equal(landed.restored, false, 'nothing is owed to the server');
  assert.equal(landed.leftOver, true, 'the status line confirms it is saved');
});

test('Next moves through the list and stops at the end', () => {
  assert.equal(nextAfter(['a', 'b'], 'a'), 'b');
  assert.equal(nextAfter(['a', 'b'], 'b'), null);
  assert.equal(nextAfter(['a'], 'x'), null);
});

// ---------- the guarded save ----------

const detailsOf = (s: EditSnapshot) => ({
  given: s.given, furtherGiven: s.furtherGiven, surname: s.surname, currentGiven: s.currentGiven, currentSurname: s.currentSurname, nickname: s.nickname, sex: s.sex,
  born: s.born, bornPlace: s.bornPlace, died: s.died, diedPlace: s.diedPlace, living: s.living, title: s.title, epithet: s.epithet, occupation: s.occupation, occupationCode: s.occupationCode, bio: s.bio,
});
const inputOf = (f: EditSnapshot['fields'][number]): FieldInput => ({ id: f.id, type: f.type, label: f.label, value: f.value, visibility: f.visibility });
const note = (text: string): FieldInput => ({ type: 'notes', label: '', value: { text }, visibility: 'family' });

test('the save answers with the exact revision it moved to, for every shape of change', async () => {
  const at = () => editSnapshot(TREE, 'ada', EDITOR);
  let snap = await at();

  // Only the person's row.
  let r = await savePersonEdit(TREE, 'ada', { ...detailsOf(snap), nickname: 'one' }, [], snap.revision, undefined, 'Editor', EDITOR);
  snap = await at();
  assert.equal(r.revision, snap.revision);

  // A new field and the row together: two steps.
  r = await savePersonEdit(TREE, 'ada', { ...detailsOf(snap), nickname: 'two' }, [note('a')], snap.revision, undefined, 'Editor', EDITOR);
  snap = await at();
  assert.equal(r.revision, snap.revision);
  assert.deepEqual(r.fieldIds, snap.fields.map((f) => f.id), 'the new field’s id comes back');

  // Two new fields, one changed, order moved.
  r = await savePersonEdit(TREE, 'ada', detailsOf(snap), [note('b'), { ...inputOf(snap.fields[0]!), value: { text: 'changed' } }, note('c')], snap.revision, undefined, 'Editor', EDITOR);
  snap = await at();
  assert.equal(r.revision, snap.revision);
  assert.equal(r.fieldIds.length, 3);

  // A removal.
  r = await savePersonEdit(TREE, 'ada', detailsOf(snap), [inputOf(snap.fields[0]!)], snap.revision, undefined, 'Editor', EDITOR);
  snap = await at();
  assert.equal(r.revision, snap.revision);

  // Nothing changed: the revision stands, so a redundant write costs no step.
  r = await savePersonEdit(TREE, 'ada', detailsOf(snap), snap.fields.map(inputOf), snap.revision, undefined, 'Editor', EDITOR);
  assert.equal(r.revision, snap.revision);
  assert.equal((await at()).revision, snap.revision);
});

test('saving twice in a row goes on from the answer without refusing itself, and a real interloper is refused', async () => {
  let snap = await editSnapshot(TREE, 'bea', EDITOR);
  const mine = detailsOf(snap);
  const first = await savePersonEdit(TREE, 'bea', { ...mine, nickname: 'B' }, [note('kept')], snap.revision, undefined, 'Editor', EDITOR);
  const second = await savePersonEdit(TREE, 'bea', { ...mine, nickname: 'Be' }, [{ ...note('kept'), id: first.fieldIds[0] }], first.revision, undefined, 'Editor', EDITOR);
  snap = await editSnapshot(TREE, 'bea', EDITOR);
  assert.equal(snap.nickname, 'Be');
  assert.equal(snap.fields.length, 1, 'the new field was updated, not added a second time');

  // Someone else writes; the next autosave from the old revision must not go through.
  await savePersonEdit(TREE, 'bea', { ...detailsOf(snap), title: 'Theirs' }, snap.fields.map(inputOf), snap.revision, undefined, 'Other', EDITOR);
  await assert.rejects(
    savePersonEdit(TREE, 'bea', { ...mine, nickname: 'overwrite' }, [], second.revision, undefined, 'Editor', EDITOR),
    (e: Error) => e.message === CHANGED_SINCE_OPENED,
  );
  const after = await editSnapshot(TREE, 'bea', EDITOR);
  assert.equal(after.title, 'Theirs', 'their change stands');
  assert.equal(after.nickname, 'Be', 'mine was not written over it');
});

test('a retried save with the same key replays the answer and writes nothing twice', async () => {
  const snap = await editSnapshot(TREE, 'bea', EDITOR);
  const op = { key: 'autosave-op-1', user: 'editor-account', payload: { x: 1 } };
  const fields = [...snap.fields.map(inputOf), note('once')];
  const a = await savePersonEdit(TREE, 'bea', detailsOf(snap), fields, snap.revision, op, 'Editor', EDITOR);
  const b = await savePersonEdit(TREE, 'bea', detailsOf(snap), fields, snap.revision, op, 'Editor', EDITOR);
  assert.deepEqual(b, a);
  assert.equal((await editSnapshot(TREE, 'bea', EDITOR)).fields.filter((f) => f.value.text === 'once').length, 1);
});
