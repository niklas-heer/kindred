// node --test src/lib/arms-proposals/reads.test.ts — what each reader sees of arms proposals and arms votes: a guest gets no
// proposals read (and their read settles nothing), and in an arms vote only each option's id, label and shield; a member
// reads the open proposals with their shield, name, note, proposer and date, and their own in any state; a steward also
// what they may do and how many wait for each house. An arms vote's question and "keep" option are in the reader's language
// (the votes reads, the feed and "What's new") and in each device's (the pushes). Invented people only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';
import type { Reader } from '../auth/guard.server.ts';
import type { House } from '../types.ts';

const dir = mkdtempSync(join(tmpdir(), 'kindred-arms-reads-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
delete process.env.KINDRED_DEMO;

const vite = await createServer({ root: process.cwd(), logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const load = <T>(path: string) => vite.ssrLoadModule(path) as Promise<T>;
const { closeAccounts } = await load<typeof import('../store/node.ts')>('/src/lib/store/node.ts');
const db = await load<typeof import('../db.server.ts')>('/src/lib/db.server.ts');
const V = await load<typeof import('../votes/votes.server.ts')>('/src/lib/votes/votes.server.ts');
const P = await load<typeof import('./proposals.server.ts')>('/src/lib/arms-proposals/proposals.server.ts');
const S = await load<typeof import('./settle.server.ts')>('/src/lib/arms-proposals/settle.server.ts');
const F = await load<typeof import('../feed/feed.server.ts')>('/src/lib/feed/feed.server.ts');
const H = await load<typeof import('../history.server.ts')>('/src/lib/history.server.ts');
const R = await load<typeof import('../responses.server.ts')>('/src/lib/responses.server.ts');
const Push = await load<typeof import('../votes/vote-push.server.ts')>('/src/lib/votes/vote-push.server.ts');
const store = await load<typeof import('../auth/store.server.ts')>('/src/lib/auth/store.server.ts');
const { b64url, fromB64url } = await load<typeof import('../webpush.ts')>('/src/lib/webpush.ts');
const { ARMS_VOTE_DAYS } = await load<typeof import('./types.ts')>('/src/lib/arms-proposals/types.ts');

test.after(async () => {
  closeAccounts();
  await vite.close();
  rmSync(dir, { recursive: true, force: true });
});

type Role = 'viewer' | 'contributor' | 'editor' | 'steward';
type Arms = House['arms'];
const NOW = new Date('2026-11-15T10:00:00.000Z');
const DAY = 86_400_000;
const HOUR = 3_600_000;
const later = (ms: number, from = NOW) => new Date(from.getTime() + ms);
/** A day after an arms vote started at NOW has closed. */
const AFTER = later((ARMS_VOTE_DAYS + 1) * DAY);

const ARMS: Arms = { field: 'azure', division: 'plain', charge: 'lion', chargeTincture: 'or' };
const arms = (charge: Arms['charge'], field: Arms['field'] = 'gules'): Arms => ({ field, division: 'plain', charge, chargeTincture: 'or' });

let families = 0;
/** A fresh family for one test, with Ada in its tree and House Birch bearing a gold lion on blue. */
async function family(mode: 'steward' | 'vote' | 'choose' = 'choose'): Promise<string> {
  const id = `areads${++families}`;
  await db.store.ensureTree(id);
  const d = db.db(id);
  await d.run("INSERT INTO meta (key, value) VALUES ('id', ?), ('name', 'The Alders') ON CONFLICT (key) DO UPDATE SET value = excluded.value", id);
  await d.run("INSERT INTO person (id, given, surname, born, living) VALUES ('ada', 'Ada', 'Alder', '1950', 1)");
  await d.run("INSERT INTO house (id, name, motto, arms) VALUES ('h1', 'Birch', 'Bend, not break', ?)", JSON.stringify(ARMS));
  await d.run("INSERT INTO meta (key, value) VALUES ('arms_mode', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", mode);
  return id;
}
const who = (id: string, name: string, role: Role, person: string | null = null) => ({ id, name, role, person, personConfirmed: !!person });
const ada = who('acc-ada', 'Ada Alder', 'contributor', 'ada');
const bo = who('acc-bo', 'Bo Birch', 'contributor');
const carl = who('acc-carl', 'Carl Cedar', 'viewer');
const eve = who('acc-eve', 'Eve Elm', 'steward');
const guestWho = { id: '', name: '', role: 'viewer' as const, guest: true };
const member = (w: ReturnType<typeof who>) => ({ kind: 'member' as const, who: w });
const reader = (w: ReturnType<typeof who>): Reader => ({
  user: { id: w.id, name: w.name, email: null, handle: w.id, created: 0, last_seen: null, locale: null },
  role: w.role, person: w.person, personConfirmed: w.personConfirmed, guest: false, protectLiving: false,
});
const GUEST: Reader = { user: null, role: 'viewer', person: null, personConfirmed: false, guest: true, protectLiving: true };
/** Anything that would tell a guest who a member is: a name, an account, a face. */
const MEMBERS = /Ada|Bo |Bo"|Carl|Eve|acc-|"ada"/;
const refused = /access/i;

const propose = (t: string, w: ReturnType<typeof who>, name: string, a: Arms, note?: string, at = NOW) =>
  P.proposeArms(t, w, 'h1', { name, note, arms: a }, undefined, at);
const settledAt = async (t: string, vote: string) => (await db.db(t).get<{ s: string | null }>('SELECT settled_at AS s FROM vote WHERE id = ?', vote))?.s;
/** The vote's option ids by proposal (`keep` for the Keep option). */
async function optionsOf(t: string, vote: string): Promise<Record<string, string>> {
  const rows = await db.db(t).all<{ id: string; proposal: string | null }>('SELECT id, proposal FROM vote_option WHERE vote = ? ORDER BY ord', vote);
  return Object.fromEntries(rows.map((r) => [r.proposal ?? 'keep', r.id]));
}
/** A vote-mode family with Ada's stag (with a note) and Bo's eagle in the house's arms vote. */
async function stagAndEagle() {
  const t = await family('vote');
  const stag = await propose(t, ada, 'The stag', arms('stag'), 'For the forest we came from');
  const eagle = await propose(t, bo, 'The eagle', arms('eagle'), undefined, later(HOUR));
  assert.ok(stag.vote && eagle.vote === stag.vote);
  return { t, vote: stag.vote, stag: stag.id, eagle: eagle.id, o: await optionsOf(t, stag.vote) };
}

// ---------- guests ----------

test('a guest gets no proposals read and no counts, and a guest\'s read never settles', async () => {
  const { t, vote, stag, o } = await stagAndEagle();
  await V.castBallot(t, member(carl), vote, [o[stag]!], later(2 * HOUR));
  await assert.rejects(P.houseProposals(t, guestWho as never, 'h1', AFTER), refused);
  await assert.rejects(P.proposalCounts(t, guestWho as never), refused);
  assert.deepEqual(await S.settleForReader(t, GUEST, AFTER), { settled: 0, started: 0 });
  assert.equal(await settledAt(t, vote), null, 'a guest stores nothing');
  // The control: a member's read of the house's proposals settles the vote that closed.
  const read = await P.houseProposals(t, carl, 'h1', AFTER);
  assert.ok(await settledAt(t, vote));
  assert.deepEqual(read.proposals.map((p) => [p.name, p.status]), [], 'settled first: the stag is accepted, the eagle not chosen, neither open');
});

test('a guest\'s votes reads never settle an arms vote; a member\'s do', async () => {
  const { t, vote, stag, o } = await stagAndEagle();
  await V.castBallot(t, member(carl), vote, [o[stag]!], later(2 * HOUR));
  assert.equal((await V.listVotes(t, GUEST, undefined, AFTER)).length, 1);
  assert.ok(await V.voteView(t, GUEST, vote, undefined, AFTER));
  assert.equal(await settledAt(t, vote), null, 'a guest stores nothing');
  await V.listVotes(t, reader(carl), undefined, AFTER);
  assert.ok(await settledAt(t, vote), 'the control: a member\'s list settles it');
});

test('in an arms vote a guest gets each option\'s id, label and shield, and nothing of who proposed it or why', async () => {
  const { t, vote, stag, eagle, o } = await stagAndEagle();
  const v = await V.voteView(t, GUEST, vote, undefined, later(2 * HOUR));
  assert.ok(v);
  for (const option of v.options) assert.deepEqual(Object.keys(option).sort(), ['arms', 'id', 'label']);
  const byId = new Map(v.options.map((x) => [x.id, x]));
  assert.deepEqual(byId.get(o.keep!)?.arms, ARMS, 'Keep shows the arms the vote started from');
  assert.deepEqual(byId.get(o[stag]!), { id: o[stag], label: 'The stag', arms: arms('stag') });
  assert.deepEqual(byId.get(o[eagle]!)?.arms, arms('eagle'));
  const text = JSON.stringify(v) + JSON.stringify(await V.listVotes(t, GUEST, undefined, later(2 * HOUR)));
  assert.doesNotMatch(text, MEMBERS);
  assert.doesNotMatch(text, /forest/, 'no note');

  // A member sees the proposer of each design (Keep is nobody's).
  const m = await V.voteView(t, reader(carl), vote, undefined, later(2 * HOUR));
  const mine = new Map(m!.options.map((x) => [x.id, x]));
  assert.deepEqual(mine.get(o[stag]!), { id: o[stag], label: 'The stag', addedBy: 'Ada Alder', arms: arms('stag') });
  assert.equal(mine.get(o.keep!)?.addedBy, '');
});

test('an ordinary vote\'s options carry no shield', async () => {
  const t = await family();
  const { id } = await V.createVote(t, ada, { question: 'Cake or pie?', kind: 'single', secret: false, addOptions: false, guests: true, closesAt: later(DAY).toISOString(), options: ['Cake', 'Pie'] }, undefined, NOW);
  const v = await V.voteView(t, GUEST, id, undefined, later(HOUR));
  assert.deepEqual(v!.options.map((x) => Object.keys(x).sort()), [['addedBy', 'id', 'label'], ['addedBy', 'id', 'label']]);
  assert.equal(v!.question, 'Cake or pie?');
  assert.equal((await V.voteView(t, reader(carl), id, undefined, later(HOUR), 'de'))!.question, 'Cake or pie?', 'a family\'s own words are never translated');
});

// ---------- members ----------

test('a member reads the open proposals with shield, name, note, proposer and date, and their own in any state', async () => {
  const t = await family('choose');
  const stag = await propose(t, ada, 'The stag', arms('stag'), 'For the forest we came from');
  await propose(t, bo, 'The eagle', arms('eagle'), undefined, later(HOUR));
  const rose = await propose(t, ada, 'The rose', arms('rose'), undefined, later(2 * HOUR));
  await P.withdrawProposal(t, ada, rose.id, undefined, later(3 * HOUR));
  const boar = await propose(t, bo, 'The boar', arms('boar'), undefined, later(4 * HOUR));
  await P.declineProposal(t, eve, boar.id, 'Too fierce for us', undefined, later(5 * HOUR));
  const at = later(6 * HOUR);

  const forCarl = await P.houseProposals(t, carl, 'h1', at);
  assert.equal(forCarl.mode, 'choose');
  assert.deepEqual(forCarl.proposals.map((p) => p.name), ['The stag', 'The eagle'], 'open ones only: not another\'s withdrawn or declined');
  const s = forCarl.proposals[0]!;
  assert.deepEqual({ ...s, may: undefined }, {
    id: stag.id, house: 'h1', name: 'The stag', note: 'For the forest we came from', arms: arms('stag'), status: 'waiting', reason: null,
    author: { name: 'Ada Alder', person: 'ada' }, createdAt: NOW.toISOString(), decidedAt: null, inVote: null, mine: false, may: undefined,
  });
  assert.equal(forCarl.proposals[1]!.note, null, 'no note is null');
  assert.deepEqual(s.may, { withdraw: false, accept: false, decline: false, putToVote: false }, 'a viewer may do nothing');

  const forAda = await P.houseProposals(t, ada, 'h1', at);
  assert.deepEqual(forAda.proposals.map((p) => [p.name, p.status, p.mine]), [['The stag', 'waiting', true], ['The eagle', 'waiting', false], ['The rose', 'withdrawn', true]]);
  assert.deepEqual(forAda.proposals[0]!.may, { withdraw: true, accept: false, decline: false, putToVote: false });
  assert.equal(forAda.proposals[2]!.may.withdraw, false, 'withdrawn is withdrawn');

  const forBo = await P.houseProposals(t, bo, 'h1', at);
  const declined = forBo.proposals.find((p) => p.id === boar.id);
  assert.deepEqual([declined?.status, declined?.reason, declined?.decidedAt], ['declined', 'Too fierce for us', later(5 * HOUR).toISOString()], 'the proposer reads why');
  assert.ok(!forBo.proposals.some((p) => p.id === rose.id));

  // A steward: what they may do. Putting the stag to a vote freezes the arms, so nothing is accepted meanwhile.
  const forEve = await P.houseProposals(t, eve, 'h1', at);
  assert.deepEqual(forEve.proposals.map((p) => p.name), ['The stag', 'The eagle']);
  assert.deepEqual(forEve.proposals[0]!.may, { withdraw: false, accept: true, decline: true, putToVote: true });
  const { vote } = await P.putToVote(t, eve, stag.id, undefined, at);
  const voting = await P.houseProposals(t, eve, 'h1', later(HOUR, at));
  assert.deepEqual(voting.proposals.map((p) => [p.name, p.status, p.inVote]), [['The stag', 'voting', vote], ['The eagle', 'waiting', null]]);
  assert.deepEqual(voting.proposals[0]!.may, { withdraw: false, accept: false, decline: true, putToVote: false });
  assert.deepEqual(voting.proposals[1]!.may, { withdraw: false, accept: false, decline: true, putToVote: true }, 'the eagle may join the vote; nothing is accepted while it runs');
  assert.equal((await P.houseProposals(t, ada, 'h1', later(HOUR, at))).proposals[0]!.may.withdraw, true, 'out of a vote without a ballot');
  const o = await optionsOf(t, vote);
  await V.castBallot(t, member(carl), vote, [o[stag.id]!], later(2 * HOUR, at));
  const locked = await P.houseProposals(t, eve, 'h1', later(3 * HOUR, at));
  assert.deepEqual(locked.proposals.map((p) => p.may), [
    { withdraw: false, accept: false, decline: false, putToVote: false },
    { withdraw: false, accept: false, decline: true, putToVote: false },
  ], 'a ballot locks the vote: nothing leaves it or joins it');
});

test('a house not there is refused; steward mode offers no vote, and vote mode no Accept (its read puts the waiting to a vote)', async () => {
  const t = await family('steward');
  await propose(t, ada, 'The stag', arms('stag'));
  await assert.rejects(P.houseProposals(t, carl, 'nowhere', NOW), /arms\.err\.gone/);
  const steward = await P.houseProposals(t, eve, 'h1', NOW);
  assert.equal(steward.mode, 'steward');
  assert.deepEqual(steward.proposals[0]!.may, { withdraw: false, accept: true, decline: true, putToVote: false });
  await db.db(t).run("UPDATE meta SET value = 'vote' WHERE key = 'arms_mode'");
  const voting = (await P.houseProposals(t, eve, 'h1', NOW)).proposals[0]!;
  assert.equal(voting.status, 'voting', 'the read settled first, and vote mode started the waiting proposal\'s vote');
  assert.deepEqual(voting.may, { withdraw: false, accept: false, decline: true, putToVote: false });
});

test('a proposer demoted to viewer still may withdraw their own waiting proposal', async () => {
  const t = await family('choose');
  const p = await propose(t, ada, 'The stag', arms('stag'));
  const demoted = who('acc-ada', 'Ada Alder', 'viewer', 'ada');
  const read = await P.houseProposals(t, demoted, 'h1', later(HOUR));
  assert.deepEqual(read.proposals.map((x) => [x.id, x.mine, x.may.withdraw]), [[p.id, true, true]]);
  await P.withdrawProposal(t, demoted, p.id);
});

test('a steward sees how many proposals wait for each house; nobody else does', async () => {
  const t = await family('choose');
  await db.db(t).run("INSERT INTO house (id, name, motto, arms) VALUES ('h2', 'Cedar', NULL, ?)", JSON.stringify(ARMS));
  await propose(t, ada, 'The stag', arms('stag'));
  await propose(t, bo, 'The eagle', arms('eagle'));
  const rose = await propose(t, ada, 'The rose', arms('rose'));
  await P.putToVote(t, eve, rose.id, undefined, NOW);
  await P.proposeArms(t, bo, 'h2', { name: 'The tower', arms: arms('tower') }, undefined, NOW);
  assert.deepEqual(await P.proposalCounts(t, eve), { h1: 2, h2: 1 }, 'waiting ones: the rose is in a vote');
  assert.deepEqual(await P.proposalCounts(t, ada), {});
});

// ---------- the reader's language ----------

test('an arms vote\'s question and Keep are in the reader\'s language, with the house\'s name as it is now', async () => {
  const { t, vote, stag, o } = await stagAndEagle();
  const at = later(2 * HOUR);
  const en = await V.voteView(t, reader(carl), vote, undefined, at);
  assert.equal(en!.question, 'Which arms should House Birch bear?');
  const de = await V.voteView(t, reader(carl), vote, undefined, at, 'de');
  assert.equal(de!.question, 'Welches Wappen soll das Haus Birch führen?');
  assert.equal(de!.options.find((x) => x.id === o.keep)?.label, 'Unser jetziges Wappen behalten');
  assert.equal(de!.options.find((x) => x.id === o[stag])?.label, 'The stag', 'a proposal\'s name is the family\'s own');
  assert.equal((await V.voteView(t, GUEST, vote, undefined, at, 'fr'))!.question, 'Quelles armoiries la maison Birch doit-elle porter ?');
  await db.db(t).run("UPDATE house SET name = 'Beech' WHERE id = 'h1'");
  assert.deepEqual((await V.listVotes(t, reader(carl), undefined, at, 'de')).map((v) => v.question), ['Welches Wappen soll das Haus Beech führen?']);

  // Keep wins: the winner is named in the reader's language, in the list and in the feed.
  await V.castBallot(t, member(carl), vote, [o.keep!], at);
  const list = await V.listVotes(t, reader(carl), undefined, AFTER, 'de');
  assert.deepEqual(list.map((v) => v.winners), [['Unser jetziges Wappen behalten']]);
  const feed = await F.feedPage(t, carl, null, 20, AFTER, 'de');
  const entries = feed.items.filter((i) => i.type === 'vote' || i.type === 'vote_result');
  assert.deepEqual(entries.map((i) => [i.type, 'question' in i ? i.question : null]).sort(), [
    ['vote', 'Welches Wappen soll das Haus Beech führen?'], ['vote_result', 'Welches Wappen soll das Haus Beech führen?'],
  ]);
  const result = entries.find((i) => i.type === 'vote_result');
  assert.deepEqual(result && 'winners' in result ? result.winners : null, ['Unser jetziges Wappen behalten']);
});

test('a reply on an arms vote is news to its starter under the question in their language', async () => {
  const { t, vote } = await stagAndEagle();
  const since = Date.now() - 60_000;
  await R.addComment(t, bo, 'vote', vote, 'The stag, surely!');
  const news = await H.whatsNew(db.db(t), { account: ada.id, role: 'contributor', guest: false }, since, false, 'de');
  assert.deepEqual(news.replies.map((r) => [r.kind, r.target, r.label]), [['comment', 'vote', 'Welches Wappen soll das Haus Birch führen?']]);
  assert.deepEqual((await H.repliesTo(db.db(t), ada.id, since)).map((r) => r.label), ['Which arms should House Birch bear?'], 'English by default');
});

// ---------- pushes ----------

async function device(tree: string, user: string, name: string, locale: string) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const keys = { p256dh: b64url(await crypto.subtle.exportKey('raw', pair.publicKey)), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) };
  const endpoint = `https://web.push.apple.com/${tree}/${name}`;
  await store.accounts().run(
    `INSERT INTO push_subscription (id, user, tree, endpoint, p256dh, auth, offsets, kinds, locale, created, last_seen, votes)
     VALUES (?, ?, ?, ?, ?, ?, '[0]', '["birthday"]', ?, ?, ?, 1)`, crypto.randomUUID(), user, tree, endpoint, keys.p256dh, keys.auth, locale, NOW.getTime(), NOW.getTime());
  return { endpoint, pair, keys };
}
const enc = new TextEncoder();
async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, length: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}
/** What the device reads of a pushed message (RFC 8291, the receiver's side). */
async function open(body: Uint8Array<ArrayBuffer>, { pair, keys }: Awaited<ReturnType<typeof device>>) {
  const salt = body.slice(0, 16);
  const idLength = body[20]!;
  const senderPublic = body.slice(21, 21 + idLength);
  const sender = await crypto.subtle.importKey('raw', senderPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: sender }, pair.privateKey, 256));
  const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...fromB64url(keys.p256dh), ...senderPublic]);
  const ikm = await hkdf(fromB64url(keys.auth), shared, info, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.slice(21 + idLength)));
  return JSON.parse(new TextDecoder().decode(plain.slice(0, -1))) as { title: string; body: string };
}

test('the pushes about an arms vote name its question in each device\'s language', async () => {
  const t = await family('vote');
  const account = async (name: string, role: Role) => {
    const { user, insert } = store.newUser(name, null);
    await store.accounts().batch([insert, store.upsertMembership(user.id, t, role)]);
    return who(user.id, name, role);
  };
  const [proposer, german, english] = [await account('Ada Alder', 'contributor'), await account('Bo Birch', 'viewer'), await account('Carl Cedar', 'viewer')];
  const devices = [await device(t, german.id, 'bo', 'de'), await device(t, english.id, 'carl', 'en')];
  const signing = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const vapid = { publicKey: b64url(await crypto.subtle.exportKey('raw', signing.publicKey)), privateJwk: await crypto.subtle.exportKey('jwk', signing.privateKey), subject: 'mailto:family@example.org' };
  const sent: { url: string; body: Uint8Array<ArrayBuffer> }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), body: new Uint8Array(init!.body as Uint8Array) });
    return new Response(null, { status: 201 });
  }) as unknown as typeof fetch;
  const read = async () => {
    const out: Record<string, string> = {};
    for (const s of sent.splice(0)) {
      const d = devices.find((x) => x.endpoint === s.url)!;
      out[s.url.split('/').at(-1)!] = (await open(s.body, d)).body;
    }
    return out;
  };

  const { vote } = await propose(t, proposer, 'The stag', arms('stag'));
  assert.ok(vote);
  assert.equal(await Push.notifyVote(t, proposer, vote, { vapid, fetchImpl, now: NOW }), 2);
  const started = await read();
  assert.match(started.bo!, /Welches Wappen soll das Haus Birch führen\?/);
  assert.match(started.carl!, /Which arms should House Birch bear\?/);

  const closes = later(ARMS_VOTE_DAYS * DAY);
  assert.equal(await Push.remindVotes(t, later(-20 * HOUR, closes), { vapid, fetchImpl }), 2);
  const reminded = await read();
  assert.match(reminded.bo!, /Welches Wappen soll das Haus Birch führen\?/);
  assert.match(reminded.carl!, /Which arms should House Birch bear\?/);
});
