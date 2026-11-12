// What people who are not members ask this server's operator (docs/hosting-many-families.md, migration 0035):
//
// - A family request (/request): someone asking for a family here while `family_creation` is `requests`. The operator
//   approves it (which makes the family and its steward invitation, src/lib/operator/operator.server.ts) or declines it.
// - A data request (/privacy-request): anyone, often a relative who never signed up, asking for access to, correction or
//   deletion of data about them. It lands with the operator and, when it names a family here, with that family's stewards
//   too (the Access page). GDPR gives a month to answer: the console counts the days.
//
// Both forms are open to the internet, so each is braked three ways: a hidden field a person never fills (a bot that fills
// it is told "thanks" and nothing is stored), a limit per network (a short hash, never the address), and Cloudflare
// Turnstile when the server has its keys (turnstile.server.ts). Kindred sends no email: the requester is told the operator
// will write to them, and the operator does, from their own mail.
import { AuthError } from '../auth/errors.ts';
import { families } from '../auth/trees.server.ts';
import { networkOf } from '../auth/join-rules.ts';
import { hashToken } from '../auth/tokens.server.ts';
import { allow } from '../auth/throttle.server.ts';
import { translate } from '../i18n/dictionary.ts';
import { q, store } from '../store/index.ts';
import type { UserRow } from '../auth/store.server.ts';
import { audit, familyCreation } from './settings.server.ts';
import { passesTurnstile } from './turnstile.server.ts';
import { makeFamilyFor, type MadeFamily } from './operator.server.ts';
import type { DataRequest, DataRequestKind, DataRequestStatus, FamilyRequest, RequestStatus } from './shared.ts';
import type { FamilyTheme } from '../families.server.ts';

const accounts = () => store.accounts();
const invalid = (key: Parameters<typeof translate>[1]) => new AuthError('invalid', translate('en', key));
const actor = (u: UserRow) => ({ id: u.id, name: u.name });

/** Requests one network may send a day, of each kind, and in an hour (this process's brake, before the database's). */
export const REQUESTS_PER_DAY = 5;
const REQUESTS_PER_HOUR = 3;

/** One line, spaces folded, at most `max` characters. */
const line = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
/** Text with its line breaks, at most `max` characters. */
const text = (s: string, max: number) => s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);

/** What a public form brings besides its fields. */
export interface FormGuards { ip: string; honeypot?: string; turnstile?: string }

/** The short hash of the network a form came from: 4 characters, so it counts sends from one place and names nobody. */
const networkKey = async (kind: string, ip: string) => (await hashToken('share-ip', `request:${kind}:${networkOf(ip)}`)).slice(0, 4);

/**
 * The brakes every public form passes. Returns the network's key, or null for a bot that filled the hidden field: it is
 * answered as if all went well, and nothing is stored.
 */
async function braked(kind: 'family' | 'data', g: FormGuards, table: 'family_request' | 'data_request', now: number): Promise<string | null> {
  if (g.honeypot?.trim()) return null;
  const network = await networkKey(kind, g.ip);
  if (!allow(`request:${kind}:${network}`, REQUESTS_PER_HOUR, 3_600_000)) throw new AuthError('throttled', 'operator.err_slow');
  const sent = await accounts().get<{ n: number }>(`SELECT count(*) AS n FROM ${table} WHERE network = ? AND created > ?`, network, now - 86_400_000);
  if ((sent?.n ?? 0) >= REQUESTS_PER_DAY) throw new AuthError('throttled', 'operator.err_slow');
  if (!(await passesTurnstile(g.turnstile, g.ip))) throw new AuthError('invalid', 'operator.err_turnstile');
  return network;
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
  const network = await braked('family', g, 'family_request', now);
  if (network === null) return { email };
  await accounts().run('INSERT INTO family_request (id, name, email, family_name, message, locale, created, network) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    crypto.randomUUID(), name, email, familyName, text(input.message, 2000), input.locale ?? null, now, network);
  return { email };
}

type FamilyRequestRow = { id: string; name: string; email: string; family_name: string; message: string; created: number; status: RequestStatus; decided_at: number | null; family: string | null };
const familyRequest = (r: FamilyRequestRow): FamilyRequest => ({
  id: r.id, name: r.name, email: r.email, familyName: r.family_name, message: r.message, created: r.created, status: r.status, decidedAt: r.decided_at, family: r.family,
});

/** Open requests first, oldest first (the waiting list); then the last 100 decided ones. */
export async function familyRequests(): Promise<FamilyRequest[]> {
  const [open, decided] = (await accounts().readBatch([
    q("SELECT * FROM family_request WHERE status = 'open' ORDER BY created"),
    q("SELECT * FROM family_request WHERE status <> 'open' ORDER BY decided_at DESC LIMIT 100"),
  ])) as unknown as [FamilyRequestRow[], FamilyRequestRow[]];
  return [...open, ...decided].map(familyRequest);
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
  const network = await braked('data', g, 'data_request', now);
  if (network === null) return { email };
  const familyText = line(input.family, 200);
  await accounts().run('INSERT INTO data_request (id, name, email, family_text, family, kind, message, created, network) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    crypto.randomUUID(), name, email, familyText, await familyNamed(familyText), input.kind, message, now, network);
  return { email };
}

type DataRequestRow = { id: string; name: string; email: string; family_text: string; family: string | null; kind: DataRequestKind; message: string; created: number; status: DataRequestStatus; updated_at: number | null };
const dataRequest = (r: DataRequestRow): DataRequest => ({
  id: r.id, name: r.name, email: r.email, familyText: r.family_text, family: r.family, kind: r.kind, message: r.message, created: r.created, status: r.status, updatedAt: r.updated_at,
});

/** Every data request not done, oldest first; then the last 100 done. `tree`: only those naming that family (its stewards'). */
export async function dataRequests(tree?: string): Promise<DataRequest[]> {
  const where = tree ? 'family = ? AND ' : '';
  const p = tree ? [tree] : [];
  const [open, done] = (await accounts().readBatch([
    q(`SELECT * FROM data_request WHERE ${where}status <> 'done' ORDER BY created`, ...p),
    q(`SELECT * FROM data_request WHERE ${where}status = 'done' ORDER BY updated_at DESC LIMIT 100`, ...p),
  ])) as unknown as [DataRequestRow[], DataRequestRow[]];
  return [...open, ...done].map(dataRequest);
}

/** The operator moves a data request on: forwarded (to the family's stewards), done, or open again. Logged. */
export async function setDataRequestStatus(op: UserRow, id: string, status: DataRequestStatus): Promise<void> {
  const r = await accounts().get<{ family: string | null }>('SELECT family FROM data_request WHERE id = ?', id);
  if (!r) throw invalid('operator.err_request_gone');
  await accounts().batch([
    q('UPDATE data_request SET status = ?, updated_at = ?, updated_by = ? WHERE id = ?', status, Date.now(), op.id, id),
    audit(actor(op), 'data_request.status', r.family, { request: id, status }),
  ]);
}

/** A steward of the family the request names marks it done (they answered it). Not the operator's action, so not in their log. */
export async function stewardMarksDone(tree: string, user: string, id: string): Promise<void> {
  const r = await accounts().get<{ id: string }>('SELECT id FROM data_request WHERE id = ? AND family = ?', id, tree);
  if (!r) throw invalid('operator.err_request_gone');
  await accounts().run("UPDATE data_request SET status = 'done', updated_at = ?, updated_by = ? WHERE id = ?", Date.now(), user, id);
}
