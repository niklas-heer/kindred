// node --test src/lib/gdpr/gdpr.test.ts: data protection (docs/gdpr.md). The schema reader; the calendar-month deadline and its
// extension; deleting an account (generic over every table that names it, the last-steward and last-operator refusals, what
// stays under "A former member"); downloading an account's data (its own rows, no secrets, nobody else's); erasing a living
// non-member from a family (a row seeded in every place they can be, and nothing left after, in either database); restriction;
// the retention job (report first, then deletion); the breach register's 72-hour clock and its notice; the Art. 30 record and
// the subprocessor list; the processing agreement accepted with the terms; and the statement of reasons on suspension.
// A private data folder; invented names only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { createServer, type Plugin } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'kindred-gdpr-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
process.env.KINDRED_SECRET = 'gdpr-test-secret';
for (const k of ['KINDRED_DEMO', 'KINDRED_DEFAULT_TREE', 'KINDRED_AUTH', 'KINDRED_TURNSTILE_SITE_KEY', 'KINDRED_TURNSTILE_SECRET', 'KINDRED_VAPID_PUBLIC_KEY']) delete process.env[k];

const STUB_START = '\0stub-start';
const STUB_START_SERVER = '\0stub-start-server';
const STUB_SESSION = '\0stub-session';
const framework: Plugin = {
  name: 'stub-framework',
  enforce: 'pre',
  resolveId(source, importer) {
    if (source === '@tanstack/react-start') return STUB_START;
    if (source === '@tanstack/react-start/server') return STUB_START_SERVER;
    if (source === './session.server' && importer?.endsWith('guard.server.ts')) return STUB_SESSION;
    return undefined;
  },
  load(id) {
    if (id === STUB_START) return `export const createServerFn = () => { const b = { validator: () => b, handler: (fn) => { const f = (o) => fn(o ?? {}); f.isServerFn = true; return f; } }; return b; };`;
    if (id === STUB_START_SERVER) return `
      export const getRequest = () => globalThis.__request ?? (globalThis.__request = new Request('http://localhost/'));
      export const getRequestIP = () => '203.0.113.1';
      export const setResponseStatus = () => {};
      export const appendResponseHeader = () => {};
      export const getRequestHeader = () => undefined;`;
    if (id === STUB_SESSION) return `export const getSession = async () => ({ user: globalThis.__signedIn ?? null, via: globalThis.__signedIn ? 'passkey' : null });`;
    return undefined;
  },
};
const vite = await createServer({
  configFile: false, root: process.cwd(), logLevel: 'error', plugins: [framework],
  resolve: { alias: { '~': resolve('src') } }, ssr: { noExternal: [/^@tanstack\/react-start/] },
  server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom',
});
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;

const schema = await load<typeof import('./schema.ts')>('/src/lib/gdpr/schema.ts');
const account = await load<typeof import('./account.server.ts')>('/src/lib/gdpr/account.server.ts');
const subject = await load<typeof import('./subject.server.ts')>('/src/lib/gdpr/subject.server.ts');
const retention = await load<typeof import('./retention.server.ts')>('/src/lib/gdpr/retention.server.ts');
const breach = await load<typeof import('./breach.server.ts')>('/src/lib/gdpr/breach.server.ts');
const record = await load<typeof import('./record.server.ts')>('/src/lib/gdpr/record.server.ts');
const subs = await load<typeof import('./subprocessors.ts')>('/src/lib/gdpr/subprocessors.ts');
const shared = await load<typeof import('../operator/shared.ts')>('/src/lib/operator/shared.ts');
const reqs = await load<typeof import('../operator/requests.server.ts')>('/src/lib/operator/requests.server.ts');
const ops = await load<typeof import('../operator/operator.server.ts')>('/src/lib/operator/operator.server.ts');
const settings = await load<typeof import('../operator/settings.server.ts')>('/src/lib/operator/settings.server.ts');
const fam = await load<typeof import('../families.server.ts')>('/src/lib/families.server.ts');
const dbs = await load<typeof import('../db.server.ts')>('/src/lib/db.server.ts');
const acc = await load<typeof import('../auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const { closeDatabases } = await load<typeof import('../store/node.ts')>('/src/lib/store/node.ts');

after(async () => {
  await vite.close();
  closeDatabases();
  rmSync(dir, { recursive: true, force: true });
});

type P = string | number | null | Uint8Array;
const a = () => acc.accounts();
const run = (s: string, ...p: P[]) => a().run(s, ...p);
const one = <R>(s: string, ...p: P[]) => a().get<R>(s, ...p);
const T = Date.now();
const DAY = 86_400_000;
type U = { id: string; name: string; email: string | null; handle: string; created: number; last_seen: number | null; locale: null; operator: number };
const user = (n: number, name: string, operator = 0, lastSeen: number | null = T): U =>
  ({ id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`, name, email: `${name.toLowerCase().replace(/\s/g, '.')}@example.org`, handle: `h-${n}`, created: T - 1000 * DAY, last_seen: lastSeen, locale: null, operator });
const addUser = (u: U) => run('INSERT INTO user (id, name, email, handle, created, last_seen, operator) VALUES (?, ?, ?, ?, ?, ?, ?)', u.id, u.name, u.email, u.handle, u.created, u.last_seen, u.operator);
const member = (u: U, tree: string, role: string, person: string | null = null) => run('INSERT INTO membership (user, tree, role, person, created) VALUES (?, ?, ?, ?, ?)', u.id, tree, role, person, T);

const OP = user(1, 'Orla Opsahl', 1);
const STEW = user(2, 'Sten Ashgrove');
const ROSA = user(3, 'Rosa Ashgrove');
const LONE = user(4, 'Lone Brackwell');
const OP2 = user(5, 'Otto Opsahl', 1);

before(async () => {
  for (const u of [OP, STEW, ROSA, LONE]) await addUser(u);
  await dbs.provisionFamily('ashgrove', 'The Ashgroves');
  await dbs.provisionFamily('brackwell', 'The Brackwells');
  await member(STEW, 'ashgrove', 'steward');
  await member(ROSA, 'ashgrove', 'steward');
  await member(LONE, 'brackwell', 'steward');
});

// ---------- the schema ----------

test('the schema reader finds columns, keys and types, and ignores comments with quotes and commas', () => {
  const cols = schema.columnsOf(`CREATE TABLE life_event (
    id TEXT PRIMARY KEY,
    label TEXT,          -- what it was ("Teacher", "St Mary's"); required (sometimes)
    person TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
    n INTEGER NOT NULL DEFAULT 0 CHECK (n IN (0, 1)),
    "end" TEXT,
    PRIMARY KEY (id), CHECK (n <> 2)
  )`);
  assert.deepEqual(cols.map((c) => c.name), ['id', 'label', 'person', 'n', 'end']);
  assert.deepEqual(cols.map((c) => c.key), [true, false, false, false, false]);
  assert.deepEqual(cols.map((c) => c.type), ['TEXT', 'TEXT', 'TEXT', 'INTEGER', 'TEXT']);
  assert.equal(cols[2]!.notNull, true);
  const pair = schema.columnsOf('CREATE TABLE reaction (target TEXT NOT NULL, account TEXT NOT NULL, PRIMARY KEY (target, account)) WITHOUT ROWID');
  assert.deepEqual(pair.map((c) => c.key), [true, true]);
});

// ---------- deadlines ----------

test('a data request is due a calendar month later (the month\'s last day when it has no such date), three once extended', () => {
  const at = (s: string) => Date.parse(s);
  assert.equal(new Date(shared.dueAt({ created: at('2026-01-31T10:00:00Z') })).toISOString().slice(0, 10), '2026-02-28');
  assert.equal(new Date(shared.dueAt({ created: at('2028-01-31T10:00:00Z') })).toISOString().slice(0, 10), '2028-02-29');
  assert.equal(new Date(shared.dueAt({ created: at('2026-03-15T10:00:00Z') })).toISOString().slice(0, 10), '2026-04-15');
  assert.equal(new Date(shared.dueAt({ created: at('2026-03-15T10:00:00Z'), extendedAt: at('2026-03-20T00:00:00Z') })).toISOString().slice(0, 10), '2026-06-15');
  assert.equal(shared.daysLeft({ created: at('2026-03-15T10:00:00Z') }, at('2026-04-14T12:00:00Z')), 2);
  const r = { created: at('2026-03-15T10:00:00Z'), status: 'open' as const };
  assert.equal(shared.mayExtend(r, at('2026-04-15T20:00:00Z')), true);
  assert.equal(shared.mayExtend(r, at('2026-04-16T00:00:01Z')), false);
  assert.equal(shared.mayExtend({ ...r, extendedAt: at('2026-03-20T00:00:00Z') }, at('2026-03-21T00:00:00Z')), false);
});

test('the operator extends a request once, with a reason, within the first month', async () => {
  const id = crypto.randomUUID();
  await run("INSERT INTO data_request (id, name, email, kind, message, created) VALUES (?, 'Ina Requester', 'ina@example.org', 'access', 'What do you keep?', ?)", id, T - 5 * DAY);
  await assert.rejects(reqs.extendDataRequest(OP, id, '  '), /reason/i);
  await reqs.extendDataRequest(OP, id, 'Many records to go through.');
  const row = await one<{ extended_at: number; extension_reason: string }>('SELECT extended_at, extension_reason FROM data_request WHERE id = ?', id);
  assert.ok(row!.extended_at);
  assert.equal(row!.extension_reason, 'Many records to go through.');
  await assert.rejects(reqs.extendDataRequest(OP, id, 'Again.'), /only once/);
  const late = crypto.randomUUID();
  await run("INSERT INTO data_request (id, name, email, kind, message, created) VALUES (?, 'Ina Requester', 'ina@example.org', 'access', 'x', ?)", late, T - 40 * DAY);
  await assert.rejects(reqs.extendDataRequest(OP, late, 'Too late.'), /only once, within the first month/);
  assert.ok(await one("SELECT 1 FROM operator_audit WHERE action = 'data_request.extend'"));
});

// ---------- an account ----------

/** Every value in every table of a database that contains `needle`, as "table.column". */
async function containing(d: import('../store/index.ts').Db, needle: string, skip: Set<string> = new Set()): Promise<string[]> {
  const out: string[] = [];
  for (const t of await schema.tablesOf(d)) {
    if (skip.has(t.name)) continue;
    for (const row of await d.all<Record<string, unknown>>(`SELECT * FROM ${schema.ident(t.name)}`)) {
      for (const [k, v] of Object.entries(row)) if (typeof v === 'string' && v.includes(needle)) out.push(`${t.name}.${k}`);
    }
  }
  return [...new Set(out)];
}

test('deleting an account: refused for the last steward and the last operator', async () => {
  await assert.rejects(account.deleteAccount(LONE, LONE.name), /last steward of The Brackwells/);
  await assert.rejects(account.deleteAccount(OP, OP.name), /only operator/);
  await assert.rejects(account.deleteAccount(STEW, 'someone else'), /Type your name/);
  assert.ok(await one('SELECT 1 FROM user WHERE id = ?', LONE.id));
});

test('deleting an account removes every row that is its own, keeps what it wrote under a pseudonym, and leaves others alone', async () => {
  const s = STEW.id, r = ROSA.id;
  // The accounts database: a row in every kind of table that names an account.
  await run("INSERT INTO credential (id, user, public_key, created) VALUES ('cred-s', ?, x'00', ?), ('cred-r', ?, x'00', ?)", s, T, r, T);
  await run("INSERT INTO session (hash, user, created, expires, refreshed) VALUES ('sess-s', ?, ?, ?, ?), ('sess-r', ?, ?, ?, ?)", s, T, T + DAY, T, r, T, T + DAY, T);
  await run("INSERT INTO ai_thread (tree, user, conv, title, created, updated) VALUES ('ashgrove', ?, 'conv-s', 'My chat', ?, ?)", s, T, T);
  await run("INSERT INTO ai_chat (id, tree, user, conv, role, body, at) VALUES ('chat-s', 'ashgrove', ?, 'conv-s', 'user', '{\"text\":\"hello\"}', ?)", s, T);
  await run("INSERT INTO ai_turn (conv, claim, at) VALUES ('conv-s', 'x', ?)", T);
  await run("INSERT INTO push_subscription (id, user, tree, endpoint, p256dh, auth, offsets, kinds, created, last_seen) VALUES ('push-s', ?, 'ashgrove', 'https://push.example/s', 'k', 'a', '[]', '[]', ?, ?)", s, T, T);
  await run('INSERT INTO family_visit (user, tree, since, last_seen) VALUES (?, ?, ?, ?)', s, 'ashgrove', T, T);
  await run("INSERT INTO feedback (id, tree, kind, body, context, user, user_name, created_at, updated_at) VALUES ('fb-s', 'ashgrove', 'idea', 'More colours', '{}', ?, ?, ?, ?)", s, STEW.name, T, T);
  await run("INSERT INTO presence (tree, account, tab, route, seen) VALUES ('ashgrove', ?, 't1', '/ashgrove', ?)", s, T);
  await run("INSERT INTO invite (id, hash, tree, role, email, expires, created, created_by) VALUES ('inv-s', 'h-inv-s', 'ashgrove', 'viewer', 'guest@example.org', ?, ?, ?)", T + DAY, T, s);
  await run("INSERT INTO operator_audit (at, account, name, action) VALUES (?, ?, ?, 'test')", T, s, STEW.name);
  await run("INSERT INTO terms_acceptance (user, version, at, action, family) VALUES (?, 'v1', ?, 'family.create', 'ashgrove')", s, T);
  await run("INSERT INTO challenge (id, challenge, purpose, subject, expires) VALUES ('ch-s', 'c', 'add', ?, ?)", s, T + DAY);
  // The family: what Sten wrote, what was only his, and Rosa's own.
  const d = dbs.db('ashgrove');
  await d.batch([
    dbs.q("INSERT INTO person (id, given, surname, living) VALUES ('gran', 'Greta', 'Ashgrove', 0)"),
    dbs.q("INSERT INTO story (id, person, kind, title, body, author, author_account, at) VALUES ('st-s', 'gran', 'memory', 'Her garden', 'Roses everywhere.', ?, ?, '2026-01-01')", STEW.name, s),
    dbs.q("INSERT INTO post (id, account, author_name, body, created_at) VALUES ('post-s', ?, ?, 'Hello all', '2026-01-01'), ('post-r', ?, ?, 'Hi Sten', '2026-01-02')", s, STEW.name, r, ROSA.name),
    dbs.q("INSERT INTO comment (id, target_kind, target, account, author_name, body, created_at) VALUES ('com-s', 'post', 'post-r', ?, ?, 'Hi Rosa', '2026-01-03')", s, STEW.name),
    dbs.q("INSERT INTO reaction (target_kind, target, account, kind, created_at) VALUES ('post', 'post-r', ?, 'heart', '2026-01-03'), ('post', 'post-s', ?, 'heart', '2026-01-03')", s, r),
    dbs.q("INSERT INTO person_field (id, person, type, label, value, visibility, owner, created_by) VALUES ('pf-s', 'gran', 'notes', '', '{\"text\":\"my note\"}', 'personal', ?, ?)", s, s),
    dbs.q("INSERT INTO history (at, account, name, kind, record, action, level, owner) VALUES ('2026-01-01', ?, ?, 'story', 'st-s', 'added', 'family', NULL), ('2026-01-01', ?, ?, 'field', 'pf-s', 'added', 'personal', ?)", s, STEW.name, s, STEW.name, s),
    dbs.q("INSERT INTO quiz_day (day, kind, question, answer) VALUES ('2026-01-01', 'born', 'q', 'a')"),
    dbs.q("INSERT INTO quiz_answer (day, account, choice, correct, at) VALUES ('2026-01-01', ?, 'a', 1, '2026-01-01')", s),
    dbs.q("INSERT INTO media (key, mime, uploaded_by, uploaded_at) VALUES ('gallery/s.jpg', 'image/jpeg', ?, '2026-01-01')", STEW.name),
    dbs.q("INSERT INTO op (key, fn, result, at, user) VALUES ('op-s', 'x', '\"secret result\"', '2026-01-01', ?)", s),
  ]);

  const report = await account.deleteAccount(STEW, STEW.email!);
  assert.equal(report.families, 1);
  // Nothing in the accounts database names Sten any more, but the operator's two records.
  assert.deepEqual((await containing(a(), s, new Set(['operator_audit', 'terms_acceptance']))), []);
  assert.ok(await one('SELECT 1 FROM operator_audit WHERE account = ?', s), 'the audit log is kept');
  assert.ok(await one('SELECT 1 FROM terms_acceptance WHERE user = ?', s), 'the acceptance record is kept');
  assert.equal(await one('SELECT 1 FROM ai_turn WHERE conv = ?', 'conv-s'), undefined, 'a turn found only through his chat goes too');
  assert.equal(await one("SELECT 1 FROM challenge WHERE id = 'ch-s'"), undefined);
  assert.equal((await one<{ created_by: string | null }>("SELECT created_by FROM invite WHERE id = 'inv-s'"))!.created_by, null, 'an invitation he made stays, without him');
  // Rosa is untouched.
  assert.ok(await one("SELECT 1 FROM credential WHERE id = 'cred-r'"));
  assert.ok(await one("SELECT 1 FROM session WHERE hash = 'sess-r'"));
  // The family: no value names his account; his writing stays as "A former member"; what was only his is gone.
  assert.deepEqual(await containing(d, s), []);
  assert.deepEqual(await containing(d, STEW.name), [], 'his name was unique in the family, so it is gone from plain-text columns too');
  const post = await d.get<{ account: string; author_name: string }>("SELECT account, author_name FROM post WHERE id = 'post-s'");
  assert.match(post!.account, /^former-/);
  assert.equal(post!.author_name, 'A former member');
  assert.equal((await d.get<{ author: string }>("SELECT author FROM story WHERE id = 'st-s'"))!.author, 'A former member');
  assert.equal((await d.get<{ author_name: string }>("SELECT author_name FROM comment WHERE id = 'com-s'"))!.author_name, 'A former member');
  assert.equal(await d.get("SELECT 1 FROM reaction WHERE account LIKE 'former-%'"), undefined, 'his reactions go');
  assert.ok(await d.get('SELECT 1 FROM reaction WHERE account = ?', r), 'hers stay');
  assert.equal(await d.get("SELECT 1 FROM person_field WHERE id = 'pf-s'"), undefined, 'his personal note goes');
  assert.equal(await d.get("SELECT 1 FROM history WHERE level = 'personal'"), undefined);
  assert.equal((await d.get<{ name: string }>("SELECT name FROM history WHERE record = 'st-s'"))!.name, 'A former member');
  assert.equal(await d.get('SELECT 1 FROM quiz_answer'), undefined);
  assert.equal(await d.get("SELECT 1 FROM op WHERE key = 'op-s'"), undefined);
  assert.ok(await one('SELECT 1 FROM user WHERE id = ?', r));
  assert.equal(await one('SELECT 1 FROM user WHERE id = ?', s), undefined);
});

test('downloading an account: its own rows, no secrets, nothing of anyone else', async () => {
  await run("INSERT INTO credential (id, user, public_key, created, device) VALUES ('cred-l', ?, x'0102', ?, 'Phone')", LONE.id, T);
  await run("INSERT INTO session (hash, user, created, expires, refreshed) VALUES ('sess-l', ?, ?, ?, ?)", LONE.id, T, T + DAY, T);
  await run("INSERT INTO ai_chat (id, tree, user, conv, role, body, at) VALUES ('l-1', 'brackwell', ?, 'cl', 'user', 'my question', ?), ('l-2', 'brackwell', ?, 'cl', 'assistant', 'about your aunt', ?)", LONE.id, T, LONE.id, T);
  const d = dbs.db('brackwell');
  await d.batch([
    dbs.q("INSERT INTO post (id, account, author_name, body, created_at) VALUES ('p-l', ?, ?, 'Mine', '2026-01-01'), ('p-o', 'someone-else', 'Other', 'Not mine', '2026-01-01')", LONE.id, LONE.name),
    dbs.q("INSERT INTO history (at, account, name, kind, record, person, person_name, label, action) VALUES ('2026-01-01', ?, ?, 'person', 'aunt', 'aunt', 'Aunt Name', 'Aunt Name', 'added')", LONE.id, LONE.name),
  ]);
  const x = await account.exportAccount(LONE.id);
  assert.equal(x.account.email, LONE.email);
  assert.equal(x.accounts.credential![0]!.device, 'Phone');
  assert.equal(x.accounts.credential![0]!.public_key, undefined, 'no key material');
  assert.equal(x.accounts.session![0]!.hash, undefined, 'no session hash');
  assert.deepEqual(x.accounts.ai_chat!.map((c) => c.body), ['my question'], 'the assistant\'s answers about the family are not included');
  assert.deepEqual(x.families.brackwell!.tables.post!.map((p) => p.body), ['Mine']);
  assert.deepEqual(Object.keys(x.families.brackwell!.tables.history![0]!).sort(), ['action', 'at', 'kind'], 'the history keeps what they did, not about whom');
  assert.ok(!JSON.stringify(x).includes('Aunt Name'));
  assert.ok(!JSON.stringify(x).includes('Not mine'));
});

// ---------- a person in the tree ----------

test('erasing a living non-member: a row in every place they can be, and nothing left in either database', async () => {
  const tree = 'ashgrove';
  const d = dbs.db(tree);
  const C = 'cleo_x1y2z3';
  await d.batch([
    dbs.q("INSERT INTO person (id, given, surname, current_surname, living, born, bio) VALUES (?, 'Cleo', 'Grey', 'Vale', 1, '1990-04-02', 'Teacher in Bonn')", C),
    dbs.q("INSERT INTO person (id, given, surname, living) VALUES ('mia_aaaaaa', 'Mia', 'Vale', 1), ('tom_bbbbbb', 'Tom', 'Vale', 1)"),
    dbs.q("INSERT INTO parent (child, parent) VALUES ('mia_aaaaaa', ?)", C),
    dbs.q("INSERT INTO partnership (id, a, b) VALUES ('pa-1', ?, 'tom_bbbbbb')", C),
    dbs.q("INSERT INTO person_field (id, person, type, label, value) VALUES ('pf-c', ?, 'phone', '', '{\"number\":\"+49 1\"}')", C),
    dbs.q("INSERT INTO person_field (id, person, type, label, value) VALUES ('pf-rel', 'tom_bbbbbb', 'related', '', json_object('person', ?, 'name', ''))", C),
    dbs.q("INSERT INTO person_field (id, person, type, label, value) VALUES ('pf-note', 'tom_bbbbbb', 'notes', '', '{\"text\":\"Met Cleo Vale in 2010\"}')"),
    dbs.q("INSERT INTO life_event (id, person, type, label, created_at, updated_at) VALUES ('ev-c', ?, 'graduation', 'University', '2026-01-01', '2026-01-01')", C),
    dbs.q("INSERT INTO story (id, person, kind, title, body, author, at) VALUES ('st-c', ?, 'memory', 'Cleo at school', 'She sang.', 'Rosa', '2026-01-01')", C),
    dbs.q("INSERT INTO story (id, person, kind, title, body, author, at) VALUES ('st-t', 'tom_bbbbbb', 'memory', 'Wedding', 'Tom married Cleo Grey in June.', 'Rosa', '2026-01-01')"),
    dbs.q("INSERT INTO photo (person, mime, key, at) VALUES (?, 'image/png', 'photo/cleo.png', '2026-01-01')", C),
    dbs.q("INSERT INTO portrait (key, person, mime, source, model, created_by, created_at) VALUES ('portrait/cleo.png', ?, 'image/png', 'photo/cleo.png', 'm', 'u', '2026-01-01')", C),
    dbs.q("INSERT INTO media (key, mime, uploaded_by, uploaded_at, caption, thumb) VALUES ('gallery/only-cleo.jpg', 'image/jpeg', 'Rosa', '2026-01-01', 'Cleo Vale at 30', 'thumb/only-cleo.jpg'), ('gallery/both.jpg', 'image/jpeg', 'Rosa', '2026-01-01', 'Tom and Cleo Vale', NULL)"),
    dbs.q("INSERT INTO media_person (media, person, x, y, w, h, confirmed, tagged_by, at) VALUES ('gallery/only-cleo.jpg', ?, 0.1, 0.1, 0.2, 0.2, 1, 'Rosa', '2026-01-01'), ('gallery/both.jpg', ?, 0.1, 0.1, 0.2, 0.2, 1, 'Rosa', '2026-01-01'), ('gallery/both.jpg', 'tom_bbbbbb', 0.5, 0.1, 0.2, 0.2, 1, 'Rosa', '2026-01-01')", C, C),
    dbs.q("INSERT INTO comment (id, target_kind, target, account, author_name, body, created_at) VALUES ('com-pic', 'media', 'gallery/only-cleo.jpg', ?, 'Rosa', 'Lovely', '2026-01-02')", ROSA.id),
    dbs.q("INSERT INTO post (id, account, author_name, author_person, body, created_at) VALUES ('post-c', ?, 'Rosa', NULL, 'Happy birthday Cleo Vale!', '2026-01-03')", ROSA.id),
    dbs.q("INSERT INTO post_person (post, person) VALUES ('post-c', ?)", C),
    dbs.q("INSERT INTO comment (id, target_kind, target, account, author_name, body, created_at) VALUES ('com-c', 'post', 'post-c', ?, 'Rosa', 'Say hi to Cleo Vale', '2026-01-03')", ROSA.id),
    dbs.q("INSERT INTO research_project (id, title, created_by, created_at, updated_at) VALUES ('rp-1', 'The Vale line', ?, '2026-01-01', '2026-01-01')", ROSA.id),
    dbs.q("INSERT INTO research_person (project, person, created_by, created_at) VALUES ('rp-1', ?, ?, '2026-01-01')", C, ROSA.id),
    dbs.q("INSERT INTO history (at, account, name, kind, record, person, person_name, label, action) VALUES ('2026-01-01', ?, 'Rosa', 'person', ?, ?, 'Cleo Vale', 'Cleo Vale', 'added')", ROSA.id, C, C),
    dbs.q("INSERT INTO history (at, account, name, kind, record, person, person_name, label, action) VALUES ('2026-01-01', ?, 'Rosa', 'link', ?, 'mia_aaaaaa', 'Mia Vale', NULL, 'added')", ROSA.id, `mia_aaaaaa>${C}`),
    dbs.q("INSERT INTO history (at, account, name, kind, record, person, person_name, label, action, fields) VALUES ('2026-01-01', ?, 'Rosa', 'story', 'st-t', 'tom_bbbbbb', 'Tom Vale', 'Wedding', 'changed', '{\"f\":{\"body\":[\"\",\"Tom married Cleo Grey in June.\"]}}')", ROSA.id),
    dbs.q("INSERT INTO quiz_day (day, kind, about, question, answer) VALUES ('2026-02-02', 'born', ?, 'When was Cleo Vale born?', '1990')", C),
    dbs.q("INSERT INTO op (key, fn, result, at, user) VALUES ('op-c', 'savePersonEdit', json_object('id', ?, 'name', 'Cleo Vale'), '2026-01-01', ?)", C, ROSA.id),
  ]);
  const bytes = new Uint8Array([1, 2, 3]);
  for (const k of ['photo/cleo.png', 'portrait/cleo.png', 'gallery/only-cleo.jpg', 'thumb/only-cleo.jpg', 'gallery/both.jpg']) await dbs.media.put(tree, k, bytes, 'image/png');
  // The accounts database.
  await run("INSERT INTO ai_thread (tree, user, conv, title, created, updated) VALUES (?, ?, 'conv-c', 'About Cleo Vale', ?, ?), (?, ?, 'conv-o', 'Recipes', ?, ?)", tree, ROSA.id, T, T, tree, ROSA.id, T, T);
  await run("INSERT INTO ai_chat (id, tree, user, conv, role, body, at) VALUES ('c-1', ?, ?, 'conv-c', 'user', '{\"text\":\"Who is Cleo Vale?\"}', ?), ('c-2', ?, ?, 'conv-c', 'assistant', '{\"text\":\"She teaches in Bonn.\"}', ?), ('c-3', ?, ?, 'conv-o', 'user', '{\"text\":\"Soup\"}', ?)", tree, ROSA.id, T, tree, ROSA.id, T, tree, ROSA.id, T);
  await run("INSERT INTO ai_chat_image (id, item, tree, user, mime, data, at) VALUES ('img-1', 'c-1', ?, ?, 'image/png', 'AAAA', ?)", tree, ROSA.id, T);
  await run("INSERT INTO ai_turn (conv, claim, at) VALUES ('conv-c', 'x', ?)", T);
  await run("INSERT INTO ai_conversation (tree, user, conv, started) VALUES (?, ?, 'conv-c', ?)", tree, ROSA.id, T);
  await run("INSERT INTO share_link (id, tree, token_hash, created) VALUES ('link-1', ?, 'th', ?)", tree, T);
  await run("INSERT INTO guest_visitor (hash, link, tree, first_seen, last_seen, people) VALUES ('g1', 'link-1', ?, ?, ?, json_object(?, 3, 'mia_aaaaaa', 1))", tree, T, T, C);
  const pending = user(20, 'Cleo Vale');
  await addUser(pending);
  await run("INSERT INTO join_request (id, tree, link, user, browser, name, person, message, created, expires) VALUES ('jr-1', ?, 'link-1', ?, 'b1', 'Cleo Vale', ?, 'It is me, Cleo Vale', ?, ?)", tree, pending.id, C, T, T + DAY);
  await run("INSERT INTO feedback (id, tree, kind, body, context, user, user_name, created_at, updated_at) VALUES ('fb-c', ?, 'bug', 'Cleo Vale has the wrong birthday', ?, ?, 'Rosa', ?, ?)", tree, JSON.stringify({ route: `/ashgrove/person/${C}` }), ROSA.id, T, T);
  await run("INSERT INTO presence (tree, account, tab, route, focus, seen) VALUES (?, ?, 't9', ?, ?, ?)", tree, ROSA.id, `/ashgrove/person/${C}`, C, T);
  await run("INSERT INTO ai_task_giveup (tree, task, item, failures) VALUES (?, 'names', ?, 2)", tree, `${C}:given`);
  const request = crypto.randomUUID();
  await run("INSERT INTO data_request (id, name, email, family, kind, message, created, status, forwarded_at) VALUES (?, 'Cleo Vale', 'cleo@example.org', ?, 'deletion', 'Please remove me.', ?, 'forwarded', ?)", request, tree, T, T);

  // The steward's view first: where she appears, and what erasure would delete.
  const hits = await subject.findPeople(tree, 'cleo vale');
  assert.deepEqual(hits.map((h) => h.id), [C]);
  const before = await subject.subjectReport(tree, C);
  assert.deepEqual(before.names.sort(), ['Cleo Grey', 'Cleo Vale']);
  assert.deepEqual(before.pictures.map((p) => [p.key, p.deleted]), [['gallery/only-cleo.jpg', true], ['gallery/both.jpg', false]]);
  const places = new Set(before.traces.map((t) => `${t.db}.${t.table}`));
  for (const p of ['family.parent', 'family.partnership', 'family.person_field', 'family.story', 'family.photo', 'family.portrait', 'family.media_person', 'family.post',
    'family.post_person', 'family.comment', 'family.research_person', 'family.life_event', 'family.history', 'family.quiz_day', 'family.op', 'family.media',
    'accounts.ai_chat', 'accounts.ai_thread', 'accounts.guest_visitor', 'accounts.join_request', 'accounts.feedback', 'accounts.presence', 'accounts.ai_task_giveup']) {
    assert.ok(places.has(p), `the report finds ${p}`);
  }
  // A copy for her: her own record, her links with names, nothing more of the relatives.
  const copy = await subject.subjectCopy(tree, C);
  assert.equal(copy.person.bio, 'Teacher in Bonn');
  assert.equal(copy.related.mia_aaaaaa, 'Mia Vale');
  assert.ok(copy.records.story?.some((s) => s.title === 'Cleo at school'));
  assert.ok(!JSON.stringify(copy).includes('Tom married'), 'another person\'s story is not hers');

  await subject.erasePerson(tree, C, ROSA.id, request);

  assert.deepEqual(await subject.traces(tree, { id: C, names: before.names }), [], 'the report finds her nowhere');
  // And a brute-force look at every value of every table of both databases (the request itself is the record of the answer).
  for (const needle of [C, 'Cleo Vale', 'Cleo Grey']) {
    assert.deepEqual(await containing(d, needle), [], `nothing in the family holds ${needle}`);
    assert.deepEqual(await containing(a(), needle, new Set(['data_request', 'user'])), [], `nothing in the accounts holds ${needle}`);
  }
  // Files: hers and the picture only she was in are gone; the shared picture stays, with Tom's tag.
  for (const k of ['photo/cleo.png', 'portrait/cleo.png', 'gallery/only-cleo.jpg', 'thumb/only-cleo.jpg']) assert.equal(await dbs.media.get(tree, k), undefined, `${k} is gone`);
  assert.ok(await dbs.media.get(tree, 'gallery/both.jpg'));
  assert.equal((await d.get<{ n: number }>("SELECT count(*) AS n FROM media_person WHERE media = 'gallery/both.jpg'"))!.n, 1);
  assert.equal((await d.get<{ caption: string }>("SELECT caption FROM media WHERE key = 'gallery/both.jpg'"))!.caption, 'Tom and [—]');
  assert.equal(await d.get("SELECT 1 FROM comment WHERE id = 'com-pic'"), undefined, 'a comment on a deleted picture goes with it');
  // The rest of the family is intact, with the text that named her rewritten.
  assert.ok(await d.get("SELECT 1 FROM person WHERE id = 'mia_aaaaaa'"));
  assert.equal((await d.get<{ body: string }>("SELECT body FROM story WHERE id = 'st-t'"))!.body, 'Tom married [—] in June.');
  assert.equal((await d.get<{ body: string }>("SELECT body FROM post WHERE id = 'post-c'"))!.body, 'Happy birthday [—]!');
  assert.ok(await d.get("SELECT 1 FROM history WHERE record = 'st-t'"), 'other history rows stay');
  assert.ok(await one("SELECT 1 FROM ai_chat WHERE id = 'c-3'"), 'a conversation that never named her stays');
  assert.equal(await one("SELECT 1 FROM ai_chat_image WHERE id = 'img-1'"), undefined);
  assert.deepEqual(JSON.parse((await one<{ people: string }>("SELECT people FROM guest_visitor WHERE hash = 'g1'"))!.people), { mia_aaaaaa: 1 });
  const req = await one<{ status: string; outcome: string }>('SELECT status, outcome FROM data_request WHERE id = ?', request);
  assert.deepEqual({ ...req }, { status: 'done', outcome: 'erased' });
  const action = await one<{ kind: string; counts: string }>("SELECT kind, counts FROM subject_action WHERE tree = ? AND kind = 'erase'", tree);
  assert.ok(Object.keys(JSON.parse(action!.counts)).length > 10);
  assert.ok(!action!.counts.includes('Cleo'));
});

test('an erasure that failed between the two databases is finished by trying again', async () => {
  const tree = 'ashgrove';
  const d = dbs.db(tree);
  const P = 'pia_eeeeee';
  await d.run("INSERT INTO person (id, given, surname, living) VALUES (?, 'Pia', 'Quell', 1), ('ola_ffffff', 'Ola', 'Ashgrove', 1)", P);
  await d.run("INSERT INTO story (id, person, kind, title, body, author, at) VALUES ('st-pia', 'ola_ffffff', 'memory', 'Cousins', 'Rosa and Pia Quell at the lake.', 'Rosa', '2026-01-01')");
  await run("INSERT INTO feedback (id, tree, kind, body, context, user, user_name, created_at, updated_at) VALUES ('fb-p', ?, 'bug', 'Pia Quell is listed twice', '{}', ?, 'Rosa', ?, ?)", tree, ROSA.id, T, T);
  const request = crypto.randomUUID();
  await run("INSERT INTO data_request (id, name, email, family, kind, message, created, status, forwarded_at) VALUES (?, 'Pia Quell', 'pia@example.org', ?, 'deletion', 'Please remove me.', ?, 'forwarded', ?)", request, tree, T, T);
  // The accounts database fails as the erasure records that it is done: after the family's records are gone.
  const accountsDb = a();
  const batch = accountsDb.batch.bind(accountsDb);
  let failed = false;
  accountsDb.batch = (async (qs: { sql: string }[]) => {
    if (!failed && qs.some((x) => x.sql.includes("outcome = 'erased'"))) { failed = true; throw new Error('the accounts database went away'); }
    return batch(qs as never);
  }) as typeof accountsDb.batch;
  try {
    await assert.rejects(subject.erasePerson(tree, P, ROSA.id, request), /went away/);
  } finally {
    accountsDb.batch = batch;
  }
  assert.ok(failed, 'the failure was injected');
  assert.equal(await d.get('SELECT 1 FROM person WHERE id = ?', P), undefined, 'the family was done');
  // The steward tries again: it finishes.
  await subject.erasePerson(tree, P, ROSA.id, request);
  assert.deepEqual({ ...(await one<object>('SELECT status, outcome FROM data_request WHERE id = ?', request)) }, { status: 'done', outcome: 'erased' });
  assert.equal(await one("SELECT 1 FROM feedback WHERE id = 'fb-p' AND instr(body, 'Pia Quell') > 0"), undefined, 'the accounts database is clean');
  assert.equal((await one<{ n: number }>("SELECT count(*) AS n FROM subject_action WHERE tree = ? AND kind = 'erase' AND request = ?", tree, request))!.n, 1, 'recorded once');
  for (const needle of [P, 'Pia Quell']) {
    assert.deepEqual(await containing(d, needle), []);
    assert.deepEqual(await containing(a(), needle, new Set(['data_request', 'user'])), []);
  }
  // A person who was never there is still refused.
  await assert.rejects(subject.erasePerson(tree, 'nobody_zzzzzz', ROSA.id), /no longer in the family/);
});

test('a member\'s own person is not erased, and a restricted person cannot be changed until it is lifted', async () => {
  const tree = 'brackwell';
  const d = dbs.db(tree);
  await d.run("INSERT INTO person (id, given, surname, living) VALUES ('lone_cccccc', 'Lone', 'Brackwell', 1), ('ivo_dddddd', 'Ivo', 'Brackwell', 1)");
  await run("UPDATE membership SET person = 'lone_cccccc' WHERE user = ? AND tree = ?", LONE.id, tree);
  await assert.rejects(subject.erasePerson(tree, 'lone_cccccc', LONE.id), /is a member/);
  await subject.restrictPerson(tree, 'ivo_dddddd', LONE.id);
  await assert.rejects(subject.refuseRestricted(tree, 'ivo_dddddd'), /restricted/);
  assert.ok((await subject.subjectReport(tree, 'ivo_dddddd')).restrictedSince);
  await subject.liftRestriction(tree, 'ivo_dddddd', LONE.id);
  await subject.refuseRestricted(tree, 'ivo_dddddd');
  assert.deepEqual((await a().all<{ kind: string }>('SELECT kind FROM subject_action WHERE tree = ? ORDER BY id', tree)).map((r) => r.kind), ['restrict', 'lift']);
});

// ---------- retention ----------

test('retention: reports first, deletes only once switched on, and only what the rules name', async () => {
  const old = user(30, 'Old Unused', 0, T - 800 * DAY);
  const fresh = user(31, 'Fresh Unused', 0, T - 10 * DAY);
  const oldOp = user(32, 'Old Operator', 1, T - 800 * DAY);
  for (const u of [old, fresh, oldOp]) await addUser(u);
  await run("INSERT INTO invite (id, hash, tree, role, email, expires, created) VALUES ('inv-old', 'h-old', 'ashgrove', 'viewer', 'x@example.org', ?, ?), ('inv-new', 'h-new', 'ashgrove', 'viewer', 'y@example.org', ?, ?)", T - 100 * DAY, T - 120 * DAY, T + DAY, T);
  await run("INSERT INTO family_request (id, name, email, family_name, created, status, decided_at) VALUES ('fr-old', 'A', 'a@example.org', 'F', ?, 'declined', ?), ('fr-new', 'B', 'b@example.org', 'G', ?, 'declined', ?)", T - 200 * DAY, T - 100 * DAY, T, T);
  await run("INSERT INTO data_request (id, name, email, kind, message, created, status, updated_at) VALUES ('dr-old', 'C', 'c@example.org', 'access', 'm', ?, 'done', ?)", T - 1200 * DAY, T - 1150 * DAY);
  await run("INSERT INTO terms_acceptance (user, version, at, action) VALUES ('gone-account', 'v0', ?, 'family.create')", T - 1200 * DAY);
  const report = await retention.runRetention(T);
  assert.equal(report.mode, 'report');
  assert.equal(report.deleted, false);
  assert.deepEqual(report.counts, { accounts: 1, invites: 1, familyRequests: 1, dataRequests: 1, termsRecords: 1 });
  assert.ok(await one('SELECT 1 FROM user WHERE id = ?', old.id), 'nothing deleted in report mode');
  assert.deepEqual((await retention.lastReport())?.counts, report.counts);
  await retention.setRetentionMode(OP, 'delete');
  const done = await retention.runRetention(T);
  assert.equal(done.deleted, true);
  assert.equal(await one('SELECT 1 FROM user WHERE id = ?', old.id), undefined);
  assert.ok(await one('SELECT 1 FROM user WHERE id = ?', fresh.id));
  assert.ok(await one('SELECT 1 FROM user WHERE id = ?', oldOp.id), 'an operator is never deleted by it');
  assert.equal(await one("SELECT 1 FROM invite WHERE id = 'inv-old'"), undefined);
  assert.ok(await one("SELECT 1 FROM invite WHERE id = 'inv-new'"));
  assert.equal(await one("SELECT 1 FROM family_request WHERE id = 'fr-old'"), undefined);
  assert.ok(await one("SELECT 1 FROM family_request WHERE id = 'fr-new'"));
  assert.equal(await one("SELECT 1 FROM data_request WHERE id = 'dr-old'"), undefined);
  assert.deepEqual(await retention.retentionCounts(T), { accounts: 0, invites: 0, familyRequests: 0, dataRequests: 0, termsRecords: 0 });
  await retention.setRetentionMode(OP, 'report');
});

// ---------- breaches ----------

test('a breach: the 72-hour clock, the reasons for a late notification, and the notice for the families it affects', async () => {
  const base = {
    title: 'Backup bucket was public', awareAt: T - 10 * 3_600_000, occurredAt: null, description: 'd', dataCategories: 'names', subjects: 'about 40', consequences: 'c',
    measures: 'm', risk: 'risk' as const, authorityAt: null, authorityRef: '', lateReason: '', subjectsAt: null, notice: 'Check your shared links.', noticeUntil: null, closedAt: null,
    families: ['ashgrove'],
  };
  const id = await breach.saveBreach(OP, base, undefined, T);
  let [b] = await breach.breaches(T);
  assert.equal(b!.clock, 'running');
  assert.equal(b!.deadline, base.awareAt + 72 * 3_600_000);
  assert.equal(breach.clockOf(b!, T + 80 * 3_600_000), 'late');
  assert.equal(breach.clockOf({ ...b!, risk: 'none' }, T + 80 * 3_600_000), 'none');
  assert.deepEqual((await breach.noticesFor('ashgrove', T)).map((n) => n.notice), ['Check your shared links.']);
  assert.deepEqual(await breach.noticesFor('brackwell', T), []);
  await assert.rejects(breach.saveBreach(OP, { ...base, authorityAt: base.awareAt + 80 * 3_600_000 }, id, T), /reasons for the delay/);
  await breach.saveBreach(OP, { ...base, authorityAt: base.awareAt + 80 * 3_600_000, lateReason: 'Found on a weekend.', closedAt: T }, id, T);
  [b] = await breach.breaches(T);
  assert.equal(b!.clock, 'none');
  assert.deepEqual(await breach.noticesFor('ashgrove', T), [], 'a closed breach shows no notice');
  assert.ok(await one("SELECT 1 FROM operator_audit WHERE action = 'breach.update'"));
});

// ---------- the record and the subprocessors ----------

test('the subprocessors follow the configuration, and the Art. 30 record lists them', async () => {
  const none = subs.subprocessorsOf({ workers: false, aiProviders: [], addressLookup: false, githubArchive: false, push: false, turnstile: false });
  assert.deepEqual(none, []);
  const all = subs.subprocessorsOf({ workers: true, aiProviders: ['anthropic'], addressLookup: true, githubArchive: true, push: true, turnstile: true });
  assert.deepEqual(all.map((s) => s.id), ['cloudflare', 'cloudflare-storage', 'turnstile', 'anthropic', 'photon', 'github', 'push']);
  await run("INSERT INTO ai_provider (tree, provider, key_sealed, key_tail) VALUES ('ashgrove', 'openai', 'x', 'abcd')");
  const c = await subs.configuration((n) => (n === 'KINDRED_ARCHIVE_ASHGROVE_REPO' ? 'o/r' : n === 'KINDRED_ARCHIVE_ASHGROVE_TOKEN' ? 't' : undefined),
    { KINDRED_ARCHIVE_ASHGROVE_REPO: 'o/r', KINDRED_ARCHIVE_ASHGROVE_TOKEN: 't', KINDRED_ADDRESS_LOOKUP: 'off' });
  assert.deepEqual(c.aiProviders, ['openai']);
  assert.equal(c.githubArchive, true);
  assert.equal(c.addressLookup, false);
  const r = await record.processingRecord(new Date(T));
  assert.ok(r.activities.some((x) => x.role === 'processor' && /Family trees/.test(x.name)));
  assert.ok(r.subprocessors.some((s) => s.id === 'openai'));
  const md = record.recordMarkdown(r);
  assert.match(md, /^# Record of processing activities/);
  assert.match(md, /## Technical and organisational measures/);
  assert.match(md, /OpenAI/);
  const legal = await settings.legalTexts();
  assert.ok(legal.subprocessors.some((s) => s.id === 'openai'), 'the legal page lists them too');
  // The operator's own AI keys (operator-funded AI) name providers too.
  await run("INSERT INTO operator_ai_provider (provider, key_sealed, key_tail, updated, updated_by) VALUES ('openrouter', 'x', 'abcd', ?, ?)", T, OP.id);
  assert.deepEqual((await subs.configuration(() => undefined, {})).aiProviders, ['openai', 'openrouter']);
  assert.ok((await settings.legalTexts()).subprocessors.some((s) => s.id === 'openrouter'), 'on /legal');
  assert.ok((await record.processingRecord(new Date(T))).subprocessors.some((s) => s.id === 'openrouter'), 'in the Art. 30 record');
  await run("DELETE FROM operator_ai_provider WHERE provider = 'openrouter'");
});

// ---------- the processing agreement ----------

test('the processing agreement is accepted with the terms, and recorded as its own kind', async () => {
  await settings.saveSettings({ ...(await settings.instanceSettings()), terms: 'Be kind.', processingAgreement: 'We process on your instructions.' }, OP.id).reduce(async (p, x) => { await p; await a().run(x.sql, ...x.params); }, Promise.resolve());
  const maker = user(40, 'Mara Maker');
  await addUser(maker);
  await assert.rejects(fam.createFamily(maker as never, { id: 'makers', name: 'The Makers', tagline: '', theme: 'codex' }), /accept/i);
  await fam.createFamily(maker as never, { id: 'makers', name: 'The Makers', tagline: '', theme: 'codex' }, { acceptedTerms: true });
  const rows = (await a().all<{ kind: string; family: string }>('SELECT kind, family FROM terms_acceptance WHERE user = ? ORDER BY kind', maker.id)).map((r) => ({ ...r }));
  assert.deepEqual(rows, [{ kind: 'dpa', family: 'makers' }, { kind: 'terms', family: 'makers' }]);
  const { legalAcceptance, legalToAccept } = await load<typeof import('./dpa.server.ts')>('/src/lib/gdpr/dpa.server.ts');
  assert.deepEqual(await legalToAccept(false), { terms: true, agreement: true });
  assert.deepEqual(await legalToAccept(true), { terms: false, agreement: false });
  assert.equal((await legalAcceptance({ id: maker.id }, true, 'makers')).length, 2);
});

// ---------- statement of reasons ----------

test('suspending or closing needs a statement of reasons, which its members read; resuming clears it', async () => {
  await assert.rejects(ops.setFamilyStatus(OP as never, 'brackwell', 'suspended'), /statement of reasons/);
  await ops.setFamilyStatus(OP as never, 'brackwell', 'closed', { reason: 'Reported content: a picture of a stranger.', ground: 'terms' });
  assert.deepEqual(await ops.statusStatement('brackwell').then((s) => s && { status: s.status, reason: s.reason, ground: s.ground }),
    { status: 'closed', reason: 'Reported content: a picture of a stranger.', ground: 'terms' });
  const logged = await one<{ detail: string }>("SELECT detail FROM operator_audit WHERE action = 'family.close' ORDER BY id DESC");
  assert.match(logged!.detail, /terms/);
  await ops.setFamilyStatus(OP as never, 'brackwell', 'active');
  assert.equal(await ops.statusStatement('brackwell'), null);
  void OP2;
});
