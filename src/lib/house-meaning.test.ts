// node --test src/lib/house-meaning.test.ts — a house's name meaning and its arms review, on the real server functions with a
// signed-in request, a private accounts database and a private family file. Checked: who may read and save the research (a
// viewer reads, an editor and a viewer are refused the save, only stewards read the reviews), that a retry with the same key
// stores nothing twice, that a dismissed review comes back when the arms or the meanings change, and the badge rules.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { AsyncLocalStorage } from 'node:async_hooks';
import { createServer } from 'vite';
import { chosenMeanings, generatedArms, meaningLine, reviewBadge, sortKeys, type ArmsReview, type SavedMeaning } from './house-meaning.ts';

const dir = mkdtempSync(join(tmpdir(), 'kindred-house-meaning-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_SECRET = 'house-meaning-test-secret';

const TREE = 'family';
const HOUSE = 'h1';
const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
/** A module from the app, loaded the way Vite serves it. */
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { openSqlite, closeAccounts } = await load<typeof import('./store/node.ts')>('/src/lib/store/node.ts');
const { store } = await load<typeof import('./store/index.ts')>('/src/lib/store/index.ts');
const { startSession } = await load<typeof import('./auth/session.server.ts')>('/src/lib/auth/session.server.ts');
const { newUser, upsertMembership } = await load<typeof import('./auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const { saveHouseMeaning, getArmsReviews, getHouseMeanings, dismissArmsReview } = await load<typeof import('./house-meaning.functions.ts')>('/src/lib/house-meaning.functions.ts');
const { readReviews } = await load<typeof import('./house-meaning.server.ts')>('/src/lib/house-meaning.server.ts');
const { dismissReview, readMeanings } = await load<typeof import('./house-meaning.server.ts')>('/src/lib/house-meaning.server.ts');

// TanStack Start keeps each request in two AsyncLocalStorage stores; set them the way a request does (see houses.test.ts).
type Store<T> = AsyncLocalStorage<T>;
const registry = globalThis as unknown as Record<symbol, Store<unknown> | undefined>;
await load<unknown>('@tanstack/react-start/server');
const events = registry[Symbol.for('tanstack-start:event-storage')] as Store<{ request: Request; requestUrl: URL }>;
const contexts = registry[Symbol.for('tanstack-start:start-storage-context')] as Store<{ startOptions: object }>;

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

const ARMS = { field: 'gules', division: 'plain', charge: 'none', chargeTincture: 'or' };
const family = openSqlite(join(dir, `${TREE}.db`), 'tree', { create: true });
family.exec(`
  INSERT INTO meta (key, value) VALUES ('id', '${TREE}'), ('name', 'Family'), ('tagline', ''), ('theme', 'codex'), ('focus', 'ada');
  INSERT INTO house (id, name, arms) VALUES ('${HOUSE}', 'House Heer', '${JSON.stringify(ARMS)}');
  INSERT INTO person (id, given, house) VALUES ('ada', 'Ada', '${HOUSE}');
`);
family.close();

/** A signed-in member of the family with `role`; the session cookie they would send, and their user id. */
async function memberWith(role: 'viewer' | 'editor' | 'steward') {
  const { user, insert } = newUser(role, null);
  await store.accounts().batch([insert, upsertMembership(user.id, TREE, role)]);
  const set = await startSession(new Request('http://localhost:4791/'), user.id);
  return { cookie: set.split(';')[0], id: user.id };
}

/** Calls a server function as the request carrying `cookie` (none for a stranger). */
function asReader<T>(cookie: string | undefined, call: () => Promise<T>): Promise<T> {
  const request = new Request('http://localhost:4791/', { headers: cookie ? { cookie } : {} });
  return events.run({ request, requestUrl: new URL(request.url) }, () => contexts.run({ startOptions: {} }, call));
}

type Research = {
  tree: string; house: string; opKey: string; name: string; familyWords: string; webSearched: boolean; note: string;
  meanings: { id: string; language: string; root: string; meaning: string; attestation: 'well-attested' | 'speculative' | 'family'; ideas: { kind: 'quality' | 'object' | 'trade' | 'sound'; idea: string }[]; chosen: boolean }[];
};
const research = (overrides: Partial<Research> = {}): Research => ({
  tree: TREE,
  house: HOUSE,
  opKey: 'meaning-key-1',
  name: 'Heer',
  familyWords: 'Gentle lords of the heath',
  webSearched: false,
  note: '',
  meanings: [
    { id: 'm1', language: 'Dutch and German', root: 'heer', meaning: 'lord, gentleman', attestation: 'well-attested', ideas: [{ kind: 'quality', idea: 'a lord’s courage' }], chosen: true },
    { id: 'm2', language: 'German', root: 'hehr', meaning: 'noble, honourable', attestation: 'speculative', ideas: [], chosen: false },
  ],
  ...overrides,
});

const savedRow = async () => (await store.tree(TREE).get<{ name: string; saved_at: number; saved_by: string }>('SELECT name, saved_at, saved_by FROM house_meaning WHERE house = ?', HOUSE));
const rowCount = async (table: string) => (await store.tree(TREE).get<{ n: number }>(`SELECT count(*) AS n FROM ${table}`))!.n;

// ---------- who may read and save ----------

test('a viewer reads the saved meaning and cannot save one; nothing is written', async () => {
  const steward = await memberWith('steward');
  const viewer = await memberWith('viewer');
  await asReader(steward.cookie, () => saveHouseMeaning({ data: research({ opKey: 'viewer-setup-key' }) }));
  const before = await savedRow();
  const read = await asReader(viewer.cookie, () => getHouseMeanings({ data: { tree: TREE } }));
  assert.equal(read[HOUSE]?.name, 'Heer');
  assert.equal(read[HOUSE]?.meanings.filter((m) => m.chosen).length, 1);
  await assert.rejects(
    asReader(viewer.cookie, () => saveHouseMeaning({ data: research({ opKey: 'viewer-key-0001', name: 'Other' }) })),
    (e: { code?: string; status?: number }) => e.code === 'forbidden' && e.status === 403,
  );
  assert.deepEqual(await savedRow(), before);
});

test('an editor cannot save a meaning and gets no review of the arms', async () => {
  const editor = await memberWith('editor');
  await assert.rejects(
    asReader(editor.cookie, () => saveHouseMeaning({ data: research({ opKey: 'editor-key-0001', name: 'Editor' }) })),
    (e: { status?: number }) => e.status === 403,
  );
  await assert.rejects(asReader(editor.cookie, () => getArmsReviews({ data: { tree: TREE } })), (e: { status?: number }) => e.status === 403);
  await assert.rejects(asReader(editor.cookie, () => dismissArmsReview({ data: { tree: TREE, house: HOUSE, opKey: 'editor-dismiss-1' } })), (e: { status?: number }) => e.status === 403);
  assert.equal((await savedRow())?.name, 'Heer');
});

test('a stranger is signed out, and a steward reads the reviews', async () => {
  await assert.rejects(asReader(undefined, () => getHouseMeanings({ data: { tree: TREE } })), (e: { status?: number }) => e.status === 401);
  const steward = await memberWith('steward');
  assert.deepEqual(await asReader(steward.cookie, () => getArmsReviews({ data: { tree: TREE } })), {});
});

test('a steward saves a research, and the saved meanings name who and when', async () => {
  const steward = await memberWith('steward');
  const saved = await asReader(steward.cookie, () => saveHouseMeaning({ data: research({ opKey: 'steward-save-01', name: 'Heer' }) }));
  assert.equal(saved.house, HOUSE);
  assert.equal(saved.meanings.length, 2);
  const row = await savedRow();
  assert.equal(row?.name, 'Heer');
  assert.equal(row?.saved_by, steward.id);
  assert.ok(row && row.saved_at > 0);
});

test('a research with no chosen meaning, or two of the same id, is refused and nothing is written', async () => {
  const steward = await memberWith('steward');
  const before = await savedRow();
  await assert.rejects(
    asReader(steward.cookie, () => saveHouseMeaning({ data: research({ opKey: 'none-chosen-01', meanings: research().meanings.map((m) => ({ ...m, chosen: false })) }) })),
    (e: Error) => e.message === 'houses.meaning.err_none_chosen',
  );
  await assert.rejects(
    asReader(steward.cookie, () => saveHouseMeaning({ data: research({ opKey: 'dup-ids-000001', meanings: research().meanings.map((m) => ({ ...m, id: 'm1' })) }) })),
    (e: Error) => e.message === 'houses.meaning.err_bad_input',
  );
  assert.deepEqual(await savedRow(), before);
});

// ---------- the retry key ----------

test('a retry with the same key gets the saved research back and writes nothing twice', async () => {
  const steward = await memberWith('steward');
  const body = research({ opKey: 'retry-key-0001', name: 'Retry' });
  const first = await asReader(steward.cookie, () => saveHouseMeaning({ data: body }));
  const again = await asReader(steward.cookie, () => saveHouseMeaning({ data: body }));
  assert.deepEqual(again, first);
  assert.equal(await rowCount('house_meaning'), 1);
});

test('a key sent again for a different change is refused, not replayed', async () => {
  const steward = await memberWith('steward');
  await asReader(steward.cookie, () => saveHouseMeaning({ data: research({ opKey: 'shared-key-0001', name: 'Shared' }) }));
  await assert.rejects(
    asReader(steward.cookie, () => saveHouseMeaning({ data: research({ opKey: 'shared-key-0001', name: 'Changed' }) })),
    (e: Error) => /already sent as something else/.test(e.message),
  );
  assert.equal((await savedRow())?.name, 'Shared');
});

// ---------- the review: dismissed until the arms or the meanings change ----------

/** Puts a check on the house, as the arms-fit check would, so the dismissal can be tested without the model. */
async function writeReview(verdict: 'fits' | 'partly' | 'reconsider') {
  const { fingerprint } = await load<typeof import('./house-meaning.server.ts')>('/src/lib/house-meaning.server.ts');
  const house = await store.tree(TREE).get<{ arms: string }>('SELECT arms FROM house WHERE id = ?', HOUSE);
  const meaning = await savedRow();
  const rows = await store.tree(TREE).all<{ meanings: string; family_words: string }>('SELECT meanings, family_words FROM house_meaning WHERE house = ?', HOUSE);
  const chosen = JSON.parse(rows[0].meanings).filter((m: { chosen: boolean }) => m.chosen);
  const fp = await fingerprint(JSON.parse(house!.arms), rows[0].family_words, chosen);
  await store.tree(TREE).run(
    `INSERT INTO house_arms_review (house, fingerprint, verdict, reason, advice, locale, checked_at, checked_by, dismissed_fingerprint)
     VALUES (?, ?, ?, 'Reason.', 'Advice.', 'en', ?, '', '') ON CONFLICT(house) DO UPDATE SET fingerprint = excluded.fingerprint, verdict = excluded.verdict, dismissed_fingerprint = ''`,
    HOUSE, fp, verdict, meaning!.saved_at,
  );
}

test('a kept review stays kept while the arms and the meanings are the same, and comes back when the arms change', async () => {
  const steward = await memberWith('steward');
  await asReader(steward.cookie, () => saveHouseMeaning({ data: research({ opKey: 'review-setup-01', name: 'Review' }) }));
  await writeReview('partly');
  let review = (await readReviews(TREE))[HOUSE] as ArmsReview;
  assert.equal(review.current, true);
  assert.equal(review.dismissed, false);

  const kept = await asReader(steward.cookie, () => dismissArmsReview({ data: { tree: TREE, house: HOUSE, opKey: 'dismiss-key-01' } }));
  assert.equal(kept.dismissed, true);
  review = (await readReviews(TREE))[HOUSE] as ArmsReview;
  assert.equal(review.dismissed, true, 'kept while nothing changed');

  // The arms change: the kept review is out of date, and it is no longer kept.
  await store.tree(TREE).run('UPDATE house SET arms = ? WHERE id = ?', JSON.stringify({ ...ARMS, v2: { changed: true } }), HOUSE);
  review = (await readReviews(TREE))[HOUSE] as ArmsReview;
  assert.equal(review.current, false);
  assert.equal(review.dismissed, false, 'a change to the arms brings it back');
  await store.tree(TREE).run('UPDATE house SET arms = ? WHERE id = ?', JSON.stringify(ARMS), HOUSE);
});

test('a review is kept only while current: a change to the chosen meanings brings it back too', async () => {
  const steward = await memberWith('steward');
  await asReader(steward.cookie, () => saveHouseMeaning({ data: research({ opKey: 'review-setup-02', name: 'Meaning' }) }));
  await writeReview('reconsider');
  await asReader(steward.cookie, () => dismissArmsReview({ data: { tree: TREE, house: HOUSE, opKey: 'dismiss-key-02' } }));
  assert.equal((await readReviews(TREE))[HOUSE]?.dismissed, true);
  // The steward picks a different meaning and saves: the chosen set changes, so the review is no longer current.
  await asReader(steward.cookie, () => saveHouseMeaning({ data: research({ opKey: 'review-setup-03', name: 'Meaning', meanings: research().meanings.map((m) => ({ ...m, chosen: m.id === 'm2' })) }) }));
  const review = (await readReviews(TREE))[HOUSE] as ArmsReview;
  assert.equal(review.current, false);
  assert.equal(review.dismissed, false);
});

test('a review cannot be kept when there is none, or when it is out of date', async () => {
  const steward = await memberWith('steward');
  await store.tree(TREE).run('DELETE FROM house_arms_review WHERE house = ?', HOUSE);
  await assert.rejects(asReader(steward.cookie, () => dismissArmsReview({ data: { tree: TREE, house: HOUSE, opKey: 'dismiss-none-01' } })), (e: Error) => e.message === 'houses.meaning.err_no_review');
});

test('a retry of a dismissal with its key replays the stored result, and does not dismiss twice', async () => {
  const steward = await memberWith('steward');
  await writeReview('partly');
  const op = { key: 'direct-dismiss-01', user: steward.id, payload: { house: HOUSE } };
  const researchBefore = (await readMeanings(TREE))[HOUSE];
  const first = await dismissReview(TREE, HOUSE, op);
  const replay = await dismissReview(TREE, HOUSE, op);
  assert.deepEqual(replay, first);
  assert.equal(replay.dismissed, true);
  assert.deepEqual((await readMeanings(TREE))[HOUSE], researchBefore, 'the dismissal does not touch the research');
});

// ---------- the badge rules, on plain values ----------

const review = (over: Partial<ArmsReview> = {}): ArmsReview => ({ house: HOUSE, verdict: 'partly', reason: '', advice: '', locale: 'en', checkedAt: 1, current: true, dismissed: false, ...over });

test('the badge a steward sees: one per house, the arms to review first', () => {
  assert.equal(reviewBadge({ aiOn: true, researched: true, generated: false, review: review() }), 'arms-review');
  assert.equal(reviewBadge({ aiOn: true, researched: true, generated: false, review: review({ dismissed: true }) }), null);
  assert.equal(reviewBadge({ aiOn: true, researched: true, generated: false, review: review({ current: false }) }), null, 'out of date: no badge');
  assert.equal(reviewBadge({ aiOn: true, researched: true, generated: false, review: review({ verdict: 'fits' }) }), null);
  assert.equal(reviewBadge({ aiOn: true, researched: false, generated: true, review: review() }), 'arms-review', 'arms to review beat the name');
});

test('the name badge needs the arms feature (it is the only way to research); generated arms show until a check settles them', () => {
  assert.equal(reviewBadge({ aiOn: true, researched: false, generated: false }), 'name-unresearched');
  assert.equal(reviewBadge({ aiOn: false, researched: false, generated: false }), null);
  assert.equal(reviewBadge({ aiOn: false, researched: false, generated: true }), 'generated-arms');
  assert.equal(reviewBadge({ aiOn: true, researched: true, generated: true }), 'generated-arms');
  assert.equal(reviewBadge({ aiOn: true, researched: true, generated: true, review: review({ verdict: 'fits' }) }), null, 'a fit settles them');
  assert.equal(reviewBadge({ aiOn: true, researched: true, generated: false }), null);
});

test('generated arms are those the designer never stored a design for', () => {
  assert.equal(generatedArms({ field: 'or' }), true);
  assert.equal(generatedArms({ field: 'or', v2: { shield: 'heater' } }), false);
});

test('the list line is the family’s words, else the first chosen meaning; saved research is read as chosen only', () => {
  const s: SavedMeaning = {
    house: HOUSE, name: 'Heer', familyWords: '', webSearched: false, note: '', savedAt: 1,
    meanings: [{ id: 'm1', language: '', root: 'heer', meaning: 'lord', attestation: 'well-attested', ideas: [], chosen: false }, { id: 'm2', language: '', root: 'x', meaning: 'host', attestation: 'speculative', ideas: [], chosen: true }],
  };
  assert.equal(meaningLine(s), 'host');
  assert.equal(meaningLine({ ...s, familyWords: 'Their own words' }), 'Their own words');
  assert.equal(meaningLine(undefined), '');
  assert.deepEqual(chosenMeanings(s).map((m) => m.id), ['m2']);
});

test('the fingerprint input does not depend on the order of the arms’ keys', () => {
  assert.deepEqual(sortKeys({ b: 1, a: { d: 2, c: 3 } }), { a: { c: 3, d: 2 }, b: 1 });
  assert.equal(JSON.stringify(sortKeys({ b: 1, a: 2 })), JSON.stringify(sortKeys({ a: 2, b: 1 })));
});
