// node --test src/lib/feedback.test.ts: steward feedback. What is stored (only what the schema lists), the size limits, the Markdown
// report, that every server function and the picture's route require a steward, and the element selector.
// Runs on a private data folder.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-feedback-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const shared = await load<typeof import('./feedback.ts')>('/src/lib/feedback.ts');
const client = await load<typeof import('./feedback-client.ts')>('/src/lib/feedback-client.ts');
const server = await load<typeof import('./feedback.server.ts')>('/src/lib/feedback.server.ts');
const { accounts } = await load<typeof import('./auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const { media } = await load<typeof import('./db.server.ts')>('/src/lib/db.server.ts');
const { closeAccounts } = await load<typeof import('./store/node.ts')>('/src/lib/store/node.ts');
const roles = await load<typeof import('./roles.ts')>('/src/lib/roles.ts');

after(async () => {
  await vite.close();
  closeAccounts();
  rmSync(dir, { recursive: true, force: true });
});

const TREE = 'feedback-test';
const user = { id: 'u1', name: 'Ada' };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const context = (over: Record<string, unknown> = {}) => ({
  page: '/feedback-test/people?x=1', selector: 'main > table.register', locale: 'de', theme: 'night', screen: '1440×900 window',
  browser: 'Mozilla/5.0', version: 'abc1234', errors: ['TypeError: nope'], ...over,
});
const form = (over: Record<string, unknown> = {}) => {
  const f = new FormData();
  const data: Record<string, unknown> = { tree: TREE, kind: 'bug', text: 'It broke', context: JSON.stringify(context()), ...over };
  for (const [k, v] of Object.entries(data)) if (v !== undefined) f.set(k, v as string | File);
  return f;
};
const refused = (f: FormData, key: string) => assert.throws(() => shared.parseFeedbackForm(f), (e: Error) => e.message === key, key);

test('what is attached: only the listed fields are accepted and stored', async () => {
  const parsed = shared.parseFeedbackForm(form());
  assert.deepEqual(Object.keys(parsed.context).sort(), ['browser', 'errors', 'locale', 'page', 'screen', 'selector', 'theme', 'version']);
  // A field's value, or anything else added to the context, is refused rather than stored.
  refused(form({ context: JSON.stringify(context({ fieldValues: { name: 'Anna' } })) }), 'feedback.err_invalid');
  refused(form({ context: JSON.stringify(context({ page: 'https://elsewhere.example/x' })) }), 'feedback.err_invalid');

  const id = await server.addFeedback(TREE, user, { kind: parsed.kind, text: parsed.text, context: parsed.context, picture: JPEG });
  const [report] = await server.listFeedback(TREE);
  assert.equal(report.id, id);
  assert.equal(report.status, 'new');
  assert.equal(report.by, 'Ada');
  assert.deepEqual(report.context, context());
  assert.equal(report.hasPicture, true);
  assert.ok(await media.get(TREE, `feedback/${id}.jpg`), 'the picture is in the family’s media storage');
  assert.equal(await server.feedbackPictureExists(TREE, `feedback/${id}.jpg`), true);
  assert.equal(await server.feedbackPictureExists('another-family', `feedback/${id}.jpg`), false, 'another family cannot reach it');
});

test('a report can leave the picture out, and deleting removes the picture too', async () => {
  const none = await server.addFeedback(TREE, user, { kind: 'idea', text: 'No picture', context: context() as never, picture: null });
  assert.equal((await server.listFeedback(TREE)).find((r) => r.id === none)?.hasPicture, false);
  const withPicture = await server.addFeedback(TREE, user, { kind: 'idea', text: 'Picture', context: context() as never, picture: JPEG });
  await server.deleteFeedback(TREE, withPicture);
  assert.equal(await media.get(TREE, `feedback/${withPicture}.jpg`), undefined);
  assert.equal((await server.listFeedback(TREE)).some((r) => r.id === withPicture), false);
});

test('status: only the three statuses, only within the family', async () => {
  const id = await server.addFeedback(TREE, user, { kind: 'confusing', text: 'Hm', context: context() as never, picture: null });
  await server.setFeedbackStatus(TREE, id, 'in-progress');
  assert.equal((await server.listFeedback(TREE)).find((r) => r.id === id)?.status, 'in-progress');
  await assert.rejects(() => server.setFeedbackStatus('another-family', id, 'resolved'), /feedback\.err_missing/);
  await assert.rejects(() => accounts().run("UPDATE feedback SET status = 'done' WHERE id = ?", id));
});

test('size limits', async () => {
  const { text, picture, errors, error, page, selector, browser, reports } = shared.FEEDBACK_LIMITS;
  refused(form({ text: '   ' }), 'feedback.err_empty');
  refused(form({ text: 'x'.repeat(text + 1) }), 'feedback.err_too_long');
  assert.equal(shared.parseFeedbackForm(form({ text: 'x'.repeat(text) })).text.length, text);
  refused(form({ kind: 'rant' }), 'feedback.err_invalid');
  refused(form({ context: 'not json' }), 'feedback.err_invalid');
  refused(form({ context: JSON.stringify(context({ errors: Array(errors + 1).fill('e') })) }), 'feedback.err_invalid');
  refused(form({ context: JSON.stringify(context({ errors: ['e'.repeat(error + 1)] })) }), 'feedback.err_invalid');
  refused(form({ context: JSON.stringify(context({ page: `/${'p'.repeat(page)}` })) }), 'feedback.err_invalid');
  refused(form({ context: JSON.stringify(context({ selector: 's'.repeat(selector + 1) })) }), 'feedback.err_invalid');
  refused(form({ context: JSON.stringify(context({ browser: 'b'.repeat(browser + 1) })) }), 'feedback.err_invalid');

  refused(form({ picture: new File([new Uint8Array(picture + 1)], 's.jpg', { type: 'image/jpeg' }) }), 'feedback.err_picture_big');
  refused(form({ picture: new File([JPEG], 's.png', { type: 'image/png' }) }), 'feedback.err_picture');
  assert.ok(shared.parseFeedbackForm(form({ picture: new File([JPEG], 's.jpg', { type: 'image/jpeg' }) })).picture);
  await assert.rejects(
    () => server.addFeedback(TREE, user, { kind: 'bug', text: 'fake', context: context() as never, picture: new TextEncoder().encode('<svg onload=alert(1)>') }),
    /feedback\.err_picture/, 'bytes that are not a JPEG are refused whatever the type says',
  );

  const FULL = 'feedback-full';
  const now = Date.now();
  await accounts().batch(Array.from({ length: reports }, (_, i) => ({
    sql: 'INSERT INTO feedback (id, tree, kind, body, context, user, user_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    params: [`r${i}`, FULL, 'bug', 'x', JSON.stringify(context()), 'u', 'U', now, now],
  })));
  await assert.rejects(() => server.addFeedback(FULL, user, { kind: 'bug', text: 'one more', context: context() as never, picture: null }), /feedback\.err_full/);
});

test('only a steward: the role table, every server function and the picture’s route', () => {
  for (const role of ['viewer', 'contributor', 'editor'] as const) assert.equal(roles.can(role, 'manage-access'), false, role);
  assert.equal(roles.can('steward', 'manage-access'), true);
  const source = readFileSync('src/lib/feedback.functions.ts', 'utf8');
  for (const name of ['submitFeedback', 'getFeedback', 'updateFeedbackStatus', 'removeFeedback']) {
    const start = source.indexOf(`export const ${name} =`);
    assert.ok(start >= 0, name);
    const next = source.indexOf('\nexport const ', start + 10);
    assert.ok(source.slice(start, next < 0 ? undefined : next).includes("requireCan(data.tree, 'manage-access')"), `${name} requires a steward`);
  }
  const route = readFileSync('src/routes/api/feedback.$tree.$key.ts', 'utf8');
  assert.ok(route.includes("requireCan(params.tree, 'manage-access')"), 'the picture requires a steward');
});

test('the report for a developer has everything, safely fenced, and not the steward’s name', () => {
  const md = shared.reportMarkdown({
    kind: 'bug', status: 'new', text: 'Line one\nLine two', hasPicture: true, created: Date.UTC(2026, 10, 8),
    context: context({ selector: 'a[href="`x`"]', errors: ['Oops ``` fence'] }) as never,
  });
  assert.match(md, /^## Feedback: bug\n\n> Line one\n> Line two\n/);
  assert.match(md, /\*\*Page:\*\* `\/feedback-test\/people\?x=1`/);
  assert.match(md, /\*\*Element:\*\* `` a\[href="`x`"\] ``/);
  assert.match(md, /\*\*Language:\*\* de/);
  assert.match(md, /\*\*Version:\*\* `abc1234`/);
  assert.match(md, /````text\nOops ``` fence\n````/, 'a fence longer than anything inside it');
  assert.ok(!md.includes('Ada'));
});

test('the selector is structure only: classes, position, a real id, never text', () => {
  const el = (tag: string, cls: string | null, parent: never | null, id = '', prev: never | null = null) =>
    ({ tagName: tag, id, parentElement: parent, previousElementSibling: prev, nextElementSibling: null, getAttribute: (n: string) => (n === 'class' ? cls : null), textContent: 'Anna Secret' }) as never;
  const html = el('HTML', null, null);
  const body = el('BODY', null, html);
  const main = el('MAIN', 'page', body, 'app');
  const first = el('DIV', 'row', main);
  const second = el('DIV', 'row odd thing', main, '', first);
  const button = el('BUTTON', 'btn primary', second);
  assert.equal(client.cssPath(button), '#app > div.row.odd:nth-of-type(2) > button.btn.primary');
  const reactId = el('SPAN', null, button, ':r5:');
  assert.equal(client.cssPath(reactId), '#app > div.row.odd:nth-of-type(2) > button.btn.primary > span', 'a generated id is not an id to rely on');
});

test('recent client errors are cut short and only the newest are kept', () => {
  const { errors, error } = shared.FEEDBACK_LIMITS;
  for (let i = 0; i < errors + 5; i++) client.recordClientError(`error ${i}`);
  client.recordClientError(`long ${'x'.repeat(error * 2)}`);
  const list = client.recentClientErrors();
  assert.equal(list.length, errors);
  assert.equal(list.at(-1)!.length, error);
  assert.ok(!list.includes('error 0'));
});
