// "Ask to join": a share-link guest asks for an account of their own, and a steward says yes or no. Schema in
// migrations/accounts/0024_join_request.sql; rules on what a request may hold in ./join-rules.ts; the guest's and the steward's
// server functions in ./join.functions.ts. docs/roles-and-privacy.md says what is kept and for how long.
//
// The guest makes a passkey here, and with it a *pending* account: a user row with no membership, and a request. A pending
// account can never sign in (`signInAllowed`, checked by the sign-in route before any session starts), so it reaches nothing a
// guest could not already read. Only a steward's yes gives it a membership; a no, or 30 days without an answer, deletes the
// request, the account and its passkey together. The asking browser follows its request through a cookie of its own, kept here
// only as a hash, as the share link's tokens are.
//
// A guest's visit is measured for the request card: per guest browser (a random cookie, hashed) and link, as totals only. It is
// measured only where a request is possible at all, never under Do Not Track or Global Privacy Control, and not while the
// family has its statistics off.
import { generateRegistrationOptions, verifyRegistrationResponse, type RegistrationResponseJSON } from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { db } from '../db.server.ts';
import { translate } from '../i18n/dictionary.ts';
import type { Locale } from '../i18n/types.ts';
import { headersRefuseTracking, type StatsBatch } from '../stats/shared.ts';
import { onWorkers, type Query } from '../store/index.ts';
import type { Role } from '../roles.ts';
import { pushServiceAllowed, sendPush, type VapidConfig } from '../webpush.ts';
import { trustedProxies } from './client-address.ts';
import { AuthError } from './errors.ts';
import {
  addUsage, cleanLanguage, cleanMessage, cleanTimeZone, deviceFamily, JOINS_PER_IP, MAX_OPEN_PER_LINK, parseUsage, placeOf, REQUEST_DAYS, usageOf, VISITOR_KEEP_DAYS,
  type Place, type Usage, type UsageRow,
} from './join-rules.ts';
import { authMethod } from './method.server.ts';
import { onGuestHost, publicOrigin } from './origin.ts';
import { cleanName, deviceName, relyingParty } from './passkeys.server.ts';
import { readCookie, guestChoice, type Session } from './session.server.ts';
import { ATTEMPT_WINDOW_MS, BUMP_ATTEMPT_SQL, linkOpen, shareLinkOf, type GuestSession, type ShareLinkRow } from './share.server.ts';
import { accounts, commit, credentialById, guard, insertCredential, newUser, now, q, upsertMembership } from './store.server.ts';
import { hashToken, randomToken } from './tokens.server.ts';

const DAY = 86_400_000;
const CHALLENGE_MS = 5 * 60_000;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

const refuse = (key: string) => new AuthError('invalid', key);

// ---------- cookies ----------

const secure = (request: Request) => publicOrigin(request).protocol === 'https:';
const JOIN_COOKIE = 'kindred_join';
const VISITOR_COOKIE = 'kindred_visitor';
const named = (request: Request, base: string) => (secure(request) ? `__Host-${base}` : base);

function cookie(request: Request, base: string, value: string, maxAgeSeconds: number) {
  return [`${named(request, base)}=${value}`, 'Path=/', `Max-Age=${maxAgeSeconds}`, 'HttpOnly', 'SameSite=Lax', ...(secure(request) ? ['Secure'] : [])].join('; ');
}

const tokenIn = (request: Request, base: string) => {
  const t = readCookie(request, named(request, base));
  return t && TOKEN.test(t) ? t : undefined;
};

/** Whether this browser holds a request's cookie, live or not. */
export const hasJoinCookie = (request: Request) => !!tokenIn(request, JOIN_COOKIE);

/** The Set-Cookie value that forgets this browser's request. */
export const clearJoinCookie = (request: Request) => cookie(request, JOIN_COOKIE, '', 0);

// ---------- where a request is possible ----------

/** Whether this guest may ask through their link: Kindred's own sign-in, the site's own host, the link open and switched on. */
export function joinPossible(request: Request, guest: Pick<GuestSession, 'link'> | undefined, link: ShareLinkRow | undefined): link is ShareLinkRow {
  return authMethod() === 'kindred' && !onGuestHost(request) && !!guest && !!link && link.id === guest.link && linkOpen(link) && link.ask_to_join === 1;
}

/** A Node server may believe a country header only from a proxy it trusts (KINDRED_TRUSTED_PROXIES); a Worker reads `request.cf`. */
const trustCountryHeader = () => !onWorkers && (trustedProxies(process.env.KINDRED_TRUSTED_PROXIES) ?? 0) >= 1;

// ---------- requests ----------

export interface JoinRequestRow {
  id: string; tree: string; link: string; user: string; browser: string; visitor: string | null; status: 'open' | 'approved';
  name: string; person: string | null; message: string | null; city: string | null; region: string | null; country: string | null;
  time_zone: string | null; language: string | null; device: string | null; usage: string | null; created: number; expires: number;
}

/** The request this browser sent, if it still exists (open, unexpired, or approved and not yet used). */
export async function requestOfBrowser(request: Request): Promise<JoinRequestRow | undefined> {
  const t = tokenIn(request, JOIN_COOKIE);
  if (!t) return undefined;
  const row = await accounts().get<JoinRequestRow>('SELECT * FROM join_request WHERE browser = ?', await hashToken('join', t));
  return row && row.expires > now() ? row : undefined;
}

/** Open requests a link holds now. */
const openCount = async (link: string) =>
  (await accounts().get<{ n: number }>("SELECT count(*) AS n FROM join_request WHERE link = ? AND status = 'open' AND expires > ?", link, now()))!.n;

/** Open requests for a family: they count among what waits for a steward (the account menu's badge). */
export const openJoinCount = async (tree: string) =>
  (await accounts().get<{ n: number }>("SELECT count(*) AS n FROM join_request WHERE tree = ? AND status = 'open' AND expires > ?", tree, now()))!.n;

export type JoinState =
  | { available: false; request: null }
  | { available: boolean; request: null | { status: 'open' | 'approved'; name: string; created: number; expires: number } };

/** What a guest's pages show: the invitation, or the request this browser sent. Nothing for anyone but a guest of `tree`. */
export async function joinState(request: Request, session: Pick<Session, 'user' | 'guest'>, tree: string): Promise<JoinState> {
  if (session.user || session.guest?.tree !== tree) return { available: false, request: null };
  const mine = await requestOfBrowser(request);
  if (mine && mine.tree === tree) return { available: false, request: { status: mine.status, name: mine.name, created: mine.created, expires: mine.expires } };
  return { available: joinPossible(request, session.guest, await shareLinkOf(tree)), request: null };
}

/** Everything that must hold before a guest may ask, and again when they send. Returns the link. */
async function checkCanAsk(request: Request, session: Pick<Session, 'user' | 'guest'>, tree: string): Promise<{ link: ShareLinkRow; guest: GuestSession }> {
  const guest = session.guest;
  if (session.user || guest?.tree !== tree) throw refuse('join.err_unavailable');
  const link = await shareLinkOf(tree);
  if (!joinPossible(request, guest, link)) throw refuse('join.err_unavailable');
  if (await requestOfBrowser(request)) throw refuse('join.err_already');
  const visitor = tokenIn(request, VISITOR_COOKIE);
  if (visitor && (await accounts().get("SELECT 1 FROM join_request WHERE visitor = ? AND link = ? AND status = 'open' AND expires > ?", await hashToken('visitor', visitor), link.id, now()))) {
    throw refuse('join.err_already');
  }
  if ((await openCount(link.id)) >= MAX_OPEN_PER_LINK) throw refuse('join.err_full');
  return { link, guest };
}

/** One try to start a request from this address through this link, counted in the database like the password tries. */
async function spendJoinTry(link: string, ip: string): Promise<boolean> {
  const t = now();
  const cutoff = t - ATTEMPT_WINDOW_MS;
  await accounts().run('DELETE FROM share_attempt WHERE started <= ?', cutoff);
  const row = await accounts().get<{ count: number }>(BUMP_ATTEMPT_SQL, `${link}:join:${await hashToken('share-ip', ip)}`, t, cutoff, cutoff, t);
  return (row?.count ?? 1) <= JOINS_PER_IP;
}

export interface JoinInput { name: unknown; person: string | null; message?: unknown; timeZone?: unknown; language?: unknown }
interface Payload { tree: string; link: string; handle: string; name: string; person: string | null; message: string | null; timeZone: string | null; language: string | null }

async function cleanInput(tree: string, input: JoinInput): Promise<Omit<Payload, 'tree' | 'link' | 'handle'>> {
  const name = cleanName(input.name);
  const person = input.person && input.person !== '-' ? input.person : null;
  if (person && !(await db(tree).get('SELECT id FROM person WHERE id = ?', person))) throw refuse('join.err_person');
  return { name, person, message: cleanMessage(input.message), timeZone: cleanTimeZone(input.timeZone), language: cleanLanguage(input.language) };
}

/** Starts the passkey for a request: everything is checked first, and the try is counted before a passkey is made. */
export async function joinOptions(request: Request, session: Pick<Session, 'user' | 'guest'>, tree: string, input: JoinInput, ip: string) {
  const { link } = await checkCanAsk(request, session, tree);
  const clean = await cleanInput(tree, input);
  if (!(await spendJoinTry(link.id, ip))) throw new AuthError('throttled', 'join.err_slow');
  const handle = isoBase64URL.fromBuffer(crypto.getRandomValues(new Uint8Array(32)));
  const { rpID } = relyingParty(request);
  const options = await generateRegistrationOptions({
    rpName: 'Kindred', rpID, userName: clean.name, userDisplayName: clean.name, userID: isoBase64URL.toBuffer(handle),
    attestationType: 'none', supportedAlgorithmIDs: [-7, -257],
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  });
  const id = randomToken(24);
  const payload: Payload = { tree, link: link.id, handle, ...clean };
  await accounts().batch([
    q('DELETE FROM join_challenge WHERE expires < ?', now()),
    q('INSERT INTO join_challenge (id, challenge, payload, expires) VALUES (?, ?, ?, ?)', id, options.challenge, JSON.stringify(payload), now() + CHALLENGE_MS),
  ]);
  return { options, challengeId: id };
}

export interface NewPasskey { id: string; publicKey: Uint8Array; counter: number; transports: string[]; synced: boolean }
export type VerifyNew = (request: Request, challenge: string, response: RegistrationResponseJSON) => Promise<NewPasskey>;

/** The device's answer, checked against the challenge, this site's origin and its host name, as every other passkey is. */
export const verifyNewPasskey: VerifyNew = async (request, challenge, response) => {
  const { rpID, origin } = relyingParty(request);
  const failed = refuse('Your device’s passkey couldn’t be checked. Please try again.');
  let result;
  try {
    result = await verifyRegistrationResponse({ response, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false });
  } catch {
    throw failed;
  }
  if (!result.verified) throw failed;
  const { credential, credentialBackedUp } = result.registrationInfo;
  return { id: credential.id, publicKey: credential.publicKey, counter: credential.counter, transports: credential.transports ?? [], synced: credentialBackedUp };
};

/** What the request card holds about where and how the guest asked from, read once when they send. */
function context(request: Request) {
  return { place: placeOf(request, trustCountryHeader()), device: deviceFamily(request.headers.get('user-agent')) };
}

async function visitorUsage(request: Request, link: string): Promise<{ hash: string | null; usage: Usage | null }> {
  const token = tokenIn(request, VISITOR_COOKIE);
  if (!token) return { hash: null, usage: null };
  const hash = await hashToken('visitor', token);
  const row = await accounts().get<UsageRow>('SELECT * FROM guest_visitor WHERE hash = ? AND link = ?', hash, link);
  return { hash, usage: row ? usageOf(row) : null };
}

/** What the form shows before sending: exactly what the stewards will receive, apart from what the guest types. */
export async function joinPreview(request: Request, session: Pick<Session, 'user' | 'guest'>, tree: string): Promise<{ place: Place | null; device: string; usage: Usage | null }> {
  const { link } = await checkCanAsk(request, session, tree);
  const { place, device } = context(request);
  return { place, device, usage: (await visitorUsage(request, link.id)).usage };
}

/**
 * Finishes a request: the pending account, its passkey and the request, in one batch whose guards restate the link's switch, its
 * limit and this browser's single request. Returns the cookie that lets this browser follow it, and what the push should say.
 */
export async function finishJoin(
  request: Request, session: Pick<Session, 'user' | 'guest'>, challengeId: unknown, response: RegistrationResponseJSON, verify: VerifyNew = verifyNewPasskey,
): Promise<{ cookie: string; tree: string; name: string }> {
  if (authMethod() !== 'kindred') throw refuse('auth.passkeys_off');
  const c = typeof challengeId === 'string' && challengeId.length < 100
    ? await accounts().get<{ challenge: string; payload: string }>('DELETE FROM join_challenge WHERE id = ? AND expires > ? RETURNING challenge, payload', challengeId, now())
    : undefined;
  if (!c) throw refuse('That took too long. Please try again.');
  const p = JSON.parse(c.payload) as Payload;
  const { link } = await checkCanAsk(request, session, p.tree);
  if (link.id !== p.link) throw refuse('join.err_unavailable');
  const cred = await verify(request, c.challenge, response);
  if (await credentialById(cred.id)) throw refuse('This passkey is already saved.');
  const { place, device } = context(request);
  const { hash: visitor, usage } = await visitorUsage(request, link.id);
  const browserToken = randomToken(32);
  const browser = await hashToken('join', browserToken);
  return commit(async () => {
    const t = now();
    const { user, insert } = newUser(p.name, null, p.handle, guestChoice(request));
    const writes: Query[] = [
      guard('EXISTS (SELECT 1 FROM share_link WHERE id = ? AND tree = ? AND ask_to_join = 1 AND (expires IS NULL OR expires > ?))', link.id, p.tree, t),
      guard("(SELECT count(*) FROM join_request WHERE link = ? AND status = 'open' AND expires > ?) < ?", link.id, t, MAX_OPEN_PER_LINK),
      ...(visitor ? [guard("NOT EXISTS (SELECT 1 FROM join_request WHERE visitor = ? AND link = ? AND status = 'open' AND expires > ?)", visitor, link.id, t)] : []),
      insert,
      insertCredential({ ...cred, user: user.id, device: deviceName(request) }),
      q(`INSERT INTO join_request (id, tree, link, user, browser, visitor, status, name, person, message, city, region, country, time_zone, language, device, usage, created, expires)
         VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        crypto.randomUUID(), p.tree, link.id, user.id, browser, visitor, p.name, p.person, p.message, place?.city ?? null, place?.region ?? null, place?.country ?? null,
        p.timeZone, p.language, device, usage ? JSON.stringify(usage) : null, t, t + REQUEST_DAYS * DAY),
    ];
    return {
      writes,
      result: { cookie: cookie(request, JOIN_COOKIE, browserToken, REQUEST_DAYS * 86_400), tree: p.tree, name: p.name },
      refused: () => refuse('join.err_full'),
    };
  });
}

// ---------- signing in ----------

/**
 * Whether an account may start a session. A pending account may not: its request is still open (or ran out, and the account
 * is about to go). An approved request has done its work and is deleted at the first sign-in.
 */
export async function signInAllowed(user: string): Promise<'ok' | 'pending' | 'expired'> {
  const r = await accounts().get<{ status: string; expires: number }>('SELECT status, expires FROM join_request WHERE user = ?', user);
  if (!r) return 'ok';
  if (r.status === 'open') return r.expires > now() ? 'pending' : 'expired';
  await accounts().run("DELETE FROM join_request WHERE user = ? AND status = 'approved'", user);
  return 'ok';
}

// ---------- the steward's side ----------

export interface JoinRequestView {
  id: string; name: string; person: string | null; message: string | null; place: Place | null; timeZone: string | null; language: string | null;
  device: string | null; usage: Usage | null; created: number; expires: number;
  /** Members who already say they are this person. */
  claimedBy: { id: string; name: string }[];
}

/** A family's open requests, newest first. Expired ones are removed first. */
export async function listJoinRequests(tree: string): Promise<JoinRequestView[]> {
  await pruneJoin();
  const rows = await accounts().all<JoinRequestRow>("SELECT * FROM join_request WHERE tree = ? AND status = 'open' AND expires > ? ORDER BY created DESC", tree, now());
  return Promise.all(rows.map(async (r) => ({
    id: r.id, name: r.name, person: r.person, message: r.message,
    place: r.city || r.region || r.country ? { city: r.city, region: r.region, country: r.country } : null,
    timeZone: r.time_zone, language: r.language, device: r.device, usage: parseUsage(r.usage), created: r.created, expires: r.expires,
    claimedBy: r.person
      ? (await accounts().all<{ id: string; name: string }>('SELECT u.id, u.name FROM membership m JOIN user u ON u.id = m.user WHERE m.tree = ? AND m.person = ?', tree, r.person))
        .map(({ id, name }) => ({ id, name }))
      : [],
  })));
}

const openRequest = (tree: string, id: string) =>
  accounts().get<JoinRequestRow>("SELECT * FROM join_request WHERE id = ? AND tree = ? AND status = 'open' AND expires > ?", id, tree, now());

/**
 * A steward says yes: the account becomes a member with `role`, standing for `person` (a person id, '-' for just browsing, or
 * null to let them say later); a person the steward names is confirmed at once. What the request told the stewards is cleared;
 * the row stays only so the asking browser can see the answer, until the first sign-in. Works whatever became of the link.
 */
export async function approveJoinRequest(i: { tree: string; id: string; role: Role; person: string | null }): Promise<{ user: string }> {
  if (i.person && i.person !== '-' && !(await db(i.tree).get('SELECT id FROM person WHERE id = ?', i.person))) throw refuse('join.err_person');
  const gone = () => refuse('join.err_gone');
  return commit(async () => {
    const r = await openRequest(i.tree, i.id);
    if (!r) throw gone();
    const t = now();
    const writes: Query[] = [
      guard("EXISTS (SELECT 1 FROM join_request WHERE id = ? AND status = 'open' AND expires > ?)", r.id, t),
      q(`UPDATE join_request SET status = 'approved', visitor = NULL, person = NULL, message = NULL, city = NULL, region = NULL, country = NULL,
           time_zone = NULL, language = NULL, device = NULL, usage = NULL, expires = ? WHERE id = ?`, t + REQUEST_DAYS * DAY, r.id),
      upsertMembership(r.user, i.tree, i.role),
    ];
    if (i.person) writes.push(q('UPDATE membership SET person = ?, person_confirmed = ? WHERE user = ? AND tree = ?', i.person, i.person === '-' ? 0 : 1, r.user, i.tree));
    return { writes, result: { user: r.user }, refused: gone };
  });
}

/** The statements that remove a pending account with everything it has: never one that is a member anywhere. */
const removePending = (user: string): Query[] => [
  guard('NOT EXISTS (SELECT 1 FROM membership WHERE user = ?)', user),
  q('DELETE FROM session WHERE user = ?', user),
  q('DELETE FROM credential WHERE user = ?', user),
  q('DELETE FROM join_request WHERE user = ?', user),
  q('DELETE FROM user WHERE id = ?', user),
];

/** A steward says no: the request, the pending account and its passkey are deleted. */
export async function declineJoinRequest(tree: string, id: string): Promise<void> {
  const r = await openRequest(tree, id);
  if (!r) throw refuse('join.err_gone');
  await accounts().batch([guard("EXISTS (SELECT 1 FROM join_request WHERE id = ? AND status = 'open')", r.id), ...removePending(r.user)]);
}

/**
 * Removes what has run out: requests without an answer after 30 days (with their accounts and passkeys), approved requests nobody
 * signed in for, usage not seen for 90 days, and unfinished ceremonies. Daily (src/lib/jobs/join.ts), and before a steward reads.
 */
export async function pruneJoin(t = now()): Promise<void> {
  const expired = await accounts().all<{ user: string }>(
    "SELECT user FROM join_request WHERE status = 'open' AND expires <= ? AND NOT EXISTS (SELECT 1 FROM membership m WHERE m.user = join_request.user)", t,
  );
  for (const { user } of expired) await accounts().batch(removePending(user)).catch(() => {});
  await accounts().batch([
    q("DELETE FROM join_request WHERE status = 'approved' AND expires <= ?", t),
    q('DELETE FROM guest_visitor WHERE last_seen <= ?', t - VISITOR_KEEP_DAYS * DAY),
    q('DELETE FROM join_challenge WHERE expires <= ?', t),
  ]);
}

// ---------- telling the stewards ----------

interface PushTarget { id: string; endpoint: string; p256dh: string; auth: string; locale: Locale }

/**
 * A push to every device of the family's stewards that has reminders on: someone asked to join. Never throws, and logs nothing
 * that names anyone. Devices the push service reports gone are removed, as the daily reminders remove them.
 */
export async function notifyStewards(tree: string, name: string, vapid: VapidConfig | null, fetchImpl: typeof fetch = fetch): Promise<number> {
  if (!vapid) return 0;
  let sent = 0;
  try {
    const rows = await accounts().all<PushTarget>(
      "SELECT p.id, p.endpoint, p.p256dh, p.auth, p.locale FROM push_subscription p JOIN membership m ON m.user = p.user AND m.tree = p.tree WHERE p.tree = ? AND m.role = 'steward'",
      tree,
    );
    await Promise.allSettled(rows.filter((r) => pushServiceAllowed(r.endpoint)).map(async (r) => {
      const message = { title: translate(r.locale, 'join.push_title'), body: translate(r.locale, 'join.push_body', { name }), tag: `kindred-join-${tree}`, url: `/${tree}/access` };
      const response = await sendPush({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, message, vapid, fetchImpl);
      await response.body?.cancel();
      if (response.status === 404 || response.status === 410) await accounts().run('DELETE FROM push_subscription WHERE id = ?', r.id);
      else if (response.ok) sent++;
    }));
  } catch {}
  return sent;
}

// ---------- measuring a guest's visit ----------

/**
 * Adds one report from a guest's browser to that browser's usage of the link. Nothing when the browser refuses tracking, when no
 * request is possible through the link, or while the family has its statistics off. Returns a Set-Cookie value when this browser
 * gets its visitor cookie now.
 */
export async function recordGuestUsage(
  request: Request, guest: GuestSession, batch: StatsBatch, extras: { active: number; people: string[] }, t = now(),
): Promise<string | undefined> {
  if (headersRefuseTracking(request.headers)) return undefined;
  const link = await shareLinkOf(guest.tree);
  if (!joinPossible(request, guest, link)) return undefined;
  const { isCollecting } = await import('../stats/store.server.ts');
  if (!(await isCollecting(guest.tree))) return undefined;
  const views = batch.views ?? {};
  if (!batch.visit && !Object.keys(views).length && !extras.active && !extras.people.length) return undefined;
  let token = tokenIn(request, VISITOR_COOKIE);
  let setCookie: string | undefined;
  if (!token) {
    token = randomToken(32);
    setCookie = cookie(request, VISITOR_COOKIE, token, VISITOR_KEEP_DAYS * 86_400);
  }
  const hash = await hashToken('visitor', token);
  const row = await accounts().get<UsageRow>('SELECT * FROM guest_visitor WHERE hash = ? AND link = ?', hash, link.id);
  const next = addUsage(row, { visit: !!batch.visit || !row, views, active: extras.active, people: extras.people });
  await accounts().run(
    `INSERT INTO guest_visitor (hash, link, tree, first_seen, last_seen, visits, active_seconds, sections, people) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (hash, link) DO UPDATE SET last_seen = excluded.last_seen, visits = excluded.visits, active_seconds = excluded.active_seconds,
       sections = excluded.sections, people = excluded.people`,
    hash, link.id, guest.tree, row?.first_seen ?? t, t, next.visits, next.active_seconds, next.sections, next.people,
  );
  return setCookie;
}
