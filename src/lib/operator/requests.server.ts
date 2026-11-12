// What people who are not members ask this server's operator (docs/hosting-many-families.md, migration 0035):
//
// - A family request (/request): someone asking for a family here while `family_creation` is `requests`. The operator
//   approves it (which makes the family and its steward invitation, src/lib/operator/operator.server.ts) or declines it.
// - A data request (/privacy-request): anyone, often a relative who never signed up, asking for access to, correction or
//   deletion of data about them. It lands with the operator, who may hand it to the family's stewards ("With the stewards"):
//   only then does it show on that family's Access page. GDPR gives a month to answer: the console counts the days.
//
// Both forms are open to the internet, so each is braked: a hidden field a person never fills (a bot that fills it is told
// "thanks" and nothing is stored), Cloudflare Turnstile when the server has its keys (turnstile.server.ts), and then one
// batch that reserves and stores together: its guards hold the limits per network (a short hash, never the address) and the
// server-wide ceiling of open requests (OPEN_REQUESTS_MAX), so no number of processes, isolates or networks gets past them.
// Kindred sends no email: the requester is told the operator will write to them, and the operator does, from their own mail.
// Each new request tells the operators' devices that asked for it (operator-push.server.ts), with nothing of its content.
import { AuthError } from '../auth/errors.ts';
import { families } from '../auth/trees.server.ts';
import { networkOf } from '../auth/join-rules.ts';
import { hashToken } from '../auth/tokens.server.ts';
import { translate } from '../i18n/dictionary.ts';
import { guard, isGuardError, q, store, type Query } from '../store/index.ts';
import type { UserRow } from '../auth/store.server.ts';
import { audit, familyCreation } from './settings.server.ts';
import { passesTurnstile } from './turnstile.server.ts';
import { makeFamilyFor, type MadeFamily } from './operator.server.ts';
import { notifyOperators } from './operator-push.server.ts';
import { OPEN_REQUESTS_MAX, REQUEST_PAGE, type DataRequest, type DataRequestKind, type DataRequestStatus, type FamilyRequest, type RequestStatus } from './shared.ts';
import type { FamilyTheme } from '../families.server.ts';

const accounts = () => store.accounts();
const invalid = (key: Parameters<typeof translate>[1]) => new AuthError('invalid', translate('en', key));
const actor = (u: UserRow) => ({ id: u.id, name: u.name });

/** Requests one network may send of each kind: in a day, and in an hour. Counted in the database, so they hold everywhere. */
export const REQUESTS_PER_DAY = 5;
export const REQUESTS_PER_HOUR = 3;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** One line, spaces folded, at most `max` characters. */
const line = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
/** Text with its line breaks, at most `max` characters. */
const text = (s: string, max: number) => s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);

/** What a public form brings besides its fields. */
export interface FormGuards { ip: string; honeypot?: string; turnstile?: string }

/** The short hash of the network a form came from: 4 characters, so it counts sends from one place and names nobody. */
const networkKey = async (kind: string, ip: string) => (await hashToken('share-ip', `request:${kind}:${networkOf(ip)}`)).slice(0, 4);

/**
 * The checks before anything is stored. Returns the network's key, or null for a bot that filled the hidden field: it is
 * answered as if all went well, and nothing is stored.
 */
async function checked(kind: 'family' | 'data', g: FormGuards): Promise<string | null> {
  if (g.honeypot?.trim()) return null;
  if (!(await passesTurnstile(g.turnstile, g.ip))) throw new AuthError('invalid', 'operator.err_turnstile');
  return networkKey(kind, g.ip);
}

/** The refusal for a form whose list is full: it is closed for now. */
const formFull = () => new AuthError('forbidden', 'operator.err_form_full');

/**
 * Stores one request in a batch whose guards are the limits: this network's hour and day, and the server's ceiling of open
 * requests. All or nothing, so two at once cannot both take the last place.
 */
async function reserved(table: 'family_request' | 'data_request', network: string, now: number, insert: Query): Promise<void> {
  const perNetwork = `(SELECT count(*) FROM ${table} WHERE network = ? AND created > ?) < ?`;
  try {
    await accounts().batch([
      guard(`(SELECT count(*) FROM ${table} WHERE status = 'open') < ?`, OPEN_REQUESTS_MAX),
      guard(perNetwork, network, now - HOUR, REQUESTS_PER_HOUR),
      guard(perNetwork, network, now - DAY, REQUESTS_PER_DAY),
      insert,
    ]);
  } catch (e) {
    if (!isGuardError(e)) throw e;
    const open = await accounts().get<{ n: number }>(`SELECT count(*) AS n FROM ${table} WHERE status = 'open'`);
    throw (open?.n ?? 0) >= OPEN_REQUESTS_MAX ? formFull() : new AuthError('throttled', 'operator.err_slow');
  }
}

const cleanEmail = (raw: string) => {
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalid('operator.err_email');
  return email;
};

// ---------- family requests ----------

export interface NewFamilyRequest { name: string; email: string; familyName: string; message: string; locale?: string }

/** Someone asks for a family here. Only while the instance takes requests (`family_creation` = `requests`). */
export async function submitFamilyRequest(input: NewFamilyRequest, g: FormGuards, now = Date.now()): Promise<{ email: string }> {
  if ((await familyCreation()) !== 'requests') throw new AuthError('forbidden', 'operator.err_requests_closed');
  const name = line(input.name, 120), familyName = line(input.familyName, 80);
  if (!name || !familyName) throw invalid('operator.err_required');
  const email = cleanEmail(input.email);
  const network = await checked('family', g);
  if (network === null) return { email };
  await reserved('family_request', network, now, q('INSERT INTO family_request (id, name, email, family_name, message, locale, created, network) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    crypto.randomUUID(), name, email, familyName, text(input.message, 2000), input.locale ?? null, now, network));
  await notifyOperators('family');
  return { email };
}

type FamilyRequestRow = { id: string; name: string; email: string; family_name: string; message: string; created: number; status: RequestStatus; decided_at: number | null; family: string | null };
const familyRequest = (r: FamilyRequestRow): FamilyRequest => ({
  id: r.id, name: r.name, email: r.email, familyName: r.family_name, message: r.message, created: r.created, status: r.status, decidedAt: r.decided_at, family: r.family,
});

/** One page of what the console lists below the open ones, and whether there is more. */
export interface RequestPage<T> { items: T[]; more: boolean }

/** Open requests, oldest first (the waiting list, at most OPEN_REQUESTS_MAX); then the first page of decided ones, newest first. */
export async function familyRequests(): Promise<{ open: FamilyRequest[]; decided: RequestPage<FamilyRequest> }> {
  const [open, decided] = (await accounts().readBatch([
    q("SELECT * FROM family_request WHERE status = 'open' ORDER BY created LIMIT ?", OPEN_REQUESTS_MAX),
    q("SELECT * FROM family_request WHERE status <> 'open' ORDER BY decided_at DESC, id LIMIT ?", REQUEST_PAGE + 1),
  ])) as unknown as [FamilyRequestRow[], FamilyRequestRow[]];
  return { open: open.map(familyRequest), decided: page(decided, familyRequest) };
}

const page = <R, T>(rows: R[], map: (r: R) => T): RequestPage<T> => ({ items: rows.slice(0, REQUEST_PAGE).map(map), more: rows.length > REQUEST_PAGE });

/** Older decided requests (or answered data requests), from `offset` on: the console's "Show older". */
export async function olderRequests(kind: 'family' | 'data', offset: number): Promise<RequestPage<FamilyRequest | DataRequest>> {
  if (kind === 'family') {
    return page(await accounts().all<FamilyRequestRow>("SELECT * FROM family_request WHERE status <> 'open' ORDER BY decided_at DESC, id LIMIT ? OFFSET ?", REQUEST_PAGE + 1, offset), familyRequest);
  }
  return page(await accounts().all<DataRequestRow>("SELECT * FROM data_request WHERE status = 'done' ORDER BY updated_at DESC, id LIMIT ? OFFSET ?", REQUEST_PAGE + 1, offset), dataRequest);
}

const openRequest = async (id: string) => {
  const r = await accounts().get<FamilyRequestRow>("SELECT * FROM family_request WHERE id = ? AND status = 'open'", id);
  if (!r) throw invalid('operator.err_request_gone');
  return r;
};

/** Approves a request: makes the family (with the id the operator chose) and the invitation for the person who asked. */
export async function approveFamilyRequest(op: UserRow, id: string, family: { id: string; name: string; theme?: FamilyTheme }): Promise<MadeFamily> {
  const r = await openRequest(id);
  const made = await makeFamilyFor(op, { id: family.id, name: family.name, theme: family.theme, stewardName: r.name, stewardEmail: r.email }, 'request.approve', { request: r.id });
  await accounts().run("UPDATE family_request SET status = 'approved', decided_at = ?, decided_by = ?, family = ? WHERE id = ?", Date.now(), op.id, made.id, r.id);
  return made;
}

export async function declineFamilyRequest(op: UserRow, id: string): Promise<void> {
  const r = await openRequest(id);
  await accounts().batch([
    q("UPDATE family_request SET status = 'declined', decided_at = ?, decided_by = ? WHERE id = ? AND status = 'open'", Date.now(), op.id, r.id),
    audit(actor(op), 'request.decline', null, { request: r.id, familyName: r.family_name }),
  ]);
}

// ---------- data requests ----------

export interface NewDataRequest { name: string; email: string; family: string; kind: DataRequestKind; message: string }

/**
 * The family a requester means, when it is one of this server's: its address (…/<id>/…), its id, or its exact name. Null
 * otherwise: the operator then finds it from what they wrote.
 */
export async function familyNamed(written: string): Promise<string | null> {
  const w = written.trim();
  if (!w) return null;
  const all = await families();
  let id = w.toLowerCase();
  try {
    if (/^https?:\/\//i.test(w)) id = new URL(w).pathname.split('/').filter(Boolean)[0]?.toLowerCase() ?? '';
  } catch {}
  return all.find((f) => f.id === id)?.id ?? all.find((f) => f.name.toLowerCase() === w.toLowerCase())?.id ?? null;
}

export async function submitDataRequest(input: NewDataRequest, g: FormGuards, now = Date.now()): Promise<{ email: string }> {
  const name = line(input.name, 120);
  if (!name) throw invalid('operator.err_required');
  const email = cleanEmail(input.email);
  const message = text(input.message, 4000);
  if (!message) throw invalid('operator.err_required');
  const network = await checked('data', g);
  if (network === null) return { email };
  const familyText = line(input.family, 200);
  await reserved('data_request', network, now, q('INSERT INTO data_request (id, name, email, family_text, family, kind, message, created, network) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    crypto.randomUUID(), name, email, familyText, await familyNamed(familyText), input.kind, message, now, network));
  await notifyOperators('data');
  return { email };
}

type DataRequestRow = { id: string; name: string; email: string; family_text: string; family: string | null; kind: DataRequestKind; message: string; created: number; status: DataRequestStatus; updated_at: number | null };
const dataRequest = (r: DataRequestRow): DataRequest => ({
  id: r.id, name: r.name, email: r.email, familyText: r.family_text, family: r.family, kind: r.kind, message: r.message, created: r.created, status: r.status, updatedAt: r.updated_at,
});

/** Data requests the stewards may show at most at once (those handed to them and not answered). */
const STEWARD_LIMIT = 100;
/** Data requests not done that the console lists at most: the open ones are capped by OPEN_REQUESTS_MAX, the forwarded ones not. */
const NOT_DONE_LIMIT = 500;

/** Every data request not done, oldest first (at most NOT_DONE_LIMIT); then the first page of answered ones, newest first. */
export async function dataRequests(): Promise<{ open: DataRequest[]; done: RequestPage<DataRequest> }> {
  const [open, done] = (await accounts().readBatch([
    q("SELECT * FROM data_request WHERE status <> 'done' ORDER BY created LIMIT ?", NOT_DONE_LIMIT),
    q("SELECT * FROM data_request WHERE status = 'done' ORDER BY updated_at DESC, id LIMIT ?", REQUEST_PAGE + 1),
  ])) as unknown as [DataRequestRow[], DataRequestRow[]];
  return { open: open.map(dataRequest), done: page(done, dataRequest) };
}

/**
 * The data requests the operator has handed to this family's stewards and nobody has answered yet, oldest first. A request
 * the operator has not forwarded (or answered without them) never shows here.
 */
export async function familyDataRequests(tree: string): Promise<DataRequest[]> {
  const rows = await accounts().all<DataRequestRow>(
    "SELECT * FROM data_request WHERE family = ? AND status = 'forwarded' AND forwarded_at IS NOT NULL ORDER BY created LIMIT ?", tree, STEWARD_LIMIT);
  return rows.map(dataRequest);
}

/**
 * The operator moves a data request on: forwarded (to the family's stewards, who see it from then on), done, or open again
 * (which takes it back from them). Logged.
 */
export async function setDataRequestStatus(op: UserRow, id: string, status: DataRequestStatus): Promise<void> {
  const r = await accounts().get<{ family: string | null }>('SELECT family FROM data_request WHERE id = ?', id);
  if (!r) throw invalid('operator.err_request_gone');
  const t = Date.now();
  // Forwarded keeps the first time it was; open clears it; done leaves it as it was (answered with or without the stewards).
  const forwarded = status === 'forwarded' ? q('COALESCE(forwarded_at, ?)', t) : status === 'open' ? q('NULL') : q('forwarded_at');
  await accounts().batch([
    q(`UPDATE data_request SET status = ?, updated_at = ?, updated_by = ?, forwarded_at = ${forwarded.sql} WHERE id = ?`, status, t, op.id, ...forwarded.params, id),
    audit(actor(op), 'data_request.status', r.family, { request: id, status }),
  ]);
}

/**
 * A steward of the family the request names marks it done (they answered it): only one the operator handed to them. Not the
 * operator's action, so not in their log.
 */
export async function stewardMarksDone(tree: string, user: string, id: string): Promise<void> {
  const r = await accounts().get<{ id: string }>("SELECT id FROM data_request WHERE id = ? AND family = ? AND status = 'forwarded'", id, tree);
  if (!r) throw invalid('operator.err_request_gone');
  await accounts().run("UPDATE data_request SET status = 'done', updated_at = ?, updated_by = ? WHERE id = ? AND status = 'forwarded'", Date.now(), user, id);
}

/** What waits for the operators: open family requests and data requests nobody has looked at. The account menu's badge. */
export async function waitingCount(): Promise<number> {
  const row = await accounts().get<{ n: number }>(
    "SELECT (SELECT count(*) FROM family_request WHERE status = 'open') + (SELECT count(*) FROM data_request WHERE status = 'open') AS n");
  return row?.n ?? 0;
}
