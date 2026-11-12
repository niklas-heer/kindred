// Sign-up: someone starts a family on a server that hosts families (docs/hosting-many-families.md, "Hosting and sign-up").
//
// One step makes the account (with a passkey; a password plugs in here once that sign-in method is on, see `NewAccount`),
// the family and its first steward. Before anything is written: the server must take sign-ups (or the person brings a usable
// code), be ready for them (Turnstile, the legal texts, a storage cap: readiness in settings.server.ts), and Cloudflare
// Turnstile must accept the form (checked by the server, once, when the passkey ceremony starts). The person gives their name,
// the family's name and address, a contact email, accepts the terms and the processing agreement, and says they are 16 or
// older; all of it is recorded.
//
// The limits are held in the batch that makes the family (createFamily's last batch, families.server.ts), so no number of
// processes, isolates or tabs gets past them: the day's sign-ups, the server's ceiling of signed-up families, the sign-ups
// from one network (a short hash, never the address), the families one account may make by sign-up, and a code's uses.
// When the day's or the server's limit is reached, the page sends people to the request form instead (/request).
//
// The email is not verified (only a single sign-on provider could say it is, and none is here yet): it is the operator's
// way to reach the family, kept with the sign-up, never the account's own email, so it can never be taken as proof of who
// someone is (a later move to Cloudflare Access recognises accounts by email). With "unverified sign-ups go to the waiting
// list", the form becomes a request instead (`waitlist`) and no account is made.
import { AuthError } from '../auth/errors.ts';
import { networkOf } from '../auth/join-rules.ts';
import { hashToken } from '../auth/tokens.server.ts';
import { insertCredential, newUser, userByEmail, type UserRow } from '../auth/store.server.ts';
import { createFamily, idProblem, type FamilyTheme } from '../families.server.ts';
import { translate } from '../i18n/dictionary.ts';
import { audit, instanceSettings } from '../operator/settings.server.ts';
import { submitFamilyRequest } from '../operator/requests.server.ts';
import { termsVersion } from '../operator/terms.server.ts';
import { passesSignupTurnstile } from '../operator/turnstile.server.ts';
import { guard, q, store, type Query } from '../store/index.ts';
import { codeHash, codeRow, codeUsable, hostingSettings, saveHosting, signupCounts, signupState, readiness } from './settings.server.ts';
import {
  SIGNUPS_PER_NETWORK, missingForSignup, type HostingSettings, type RecentSignup, type SignupCode, type SignupReason, type SignupState,
} from './shared.ts';

const accounts = () => store.accounts();
const DAY = 86_400_000;
const err = (code: 'invalid' | 'forbidden' | 'throttled', key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  new AuthError(code, translate('en', key, vars));

/** The refusal for each reason sign-up is not open; the page offers the request form beside it when it is open. */
export function closedError(reason: SignupReason | undefined): AuthError {
  switch (reason) {
    case 'day': return err('forbidden', 'signup.err.day');
    case 'full': return err('forbidden', 'signup.err.full');
    case 'code': return err('invalid', 'signup.err.code');
    case 'not_ready': return err('forbidden', 'signup.err.not_ready');
    default: return err('forbidden', 'signup.err.closed');
  }
}

/** What the sign-up form sends, as typed. */
export interface SignupForm {
  name?: string;
  familyName: string;
  familyId: string;
  email: string;
  theme?: FamilyTheme;
  /** "I accept the terms of use and the processing agreement". */
  accept: boolean;
  /** "I am 16 or older" (Kindred's policy for whoever starts a family). */
  age16: boolean;
  code?: string;
  locale?: string;
}

export interface CleanForm { name: string; familyName: string; familyId: string; email: string; theme: FamilyTheme; code?: string }

/** One line, spaces folded, at most `max` characters. */
const line = (s: string | undefined, max: number) => (s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** Checks the fields; throws the reader's sentence for the first that is wrong. `needName`: a new account needs a name. */
export function cleanForm(f: SignupForm, needName: boolean): CleanForm {
  const name = line(f.name, 60);
  if (needName && !name) throw err('invalid', 'signup.err.name');
  const familyName = line(f.familyName, 80);
  if (!familyName) throw err('invalid', 'signup.err.family_name');
  const familyId = f.familyId.trim().toLowerCase();
  const problem = idProblem(familyId);
  if (problem) throw problem;
  const email = f.email.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw err('invalid', 'signup.err.email');
  if (!f.accept) throw err('invalid', 'signup.err.accept');
  if (!f.age16) throw err('invalid', 'signup.err.age');
  const code = f.code?.trim() ? f.code.trim().slice(0, 64) : undefined;
  return { name, familyName, familyId, email, theme: f.theme === 'modern' ? 'modern' : 'codex', ...(code ? { code } : {}) };
}

/** The short hash of the network a sign-up came from: 4 characters, so it counts sign-ups from one place and names nobody. */
export const networkKey = async (ip: string) => (await hashToken('share-ip', `signup:${networkOf(ip)}`)).slice(0, 4);

/** What a sign-up brings besides its fields: where it came from, the hidden field, Turnstile's token. */
export interface SignupGuards { ip: string; honeypot?: string; turnstile?: string }

/**
 * Everything checked before a passkey is made or a family written: sign-up open (or a usable code), not the waiting list,
 * Turnstile, and this network's count. Returns the state (so the caller knows about the waiting list) and the network key,
 * or null for a bot that filled the hidden field: it is answered as if all went well, and nothing is made.
 */
export async function precheck(form: CleanForm, g: SignupGuards, now = Date.now()): Promise<{ state: SignupState; network: string } | null> {
  if (g.honeypot?.trim()) return null;
  const state = await signupState(form.code, now);
  if (!state.open) throw closedError(state.reason);
  if (!(await passesSignupTurnstile(g.turnstile, g.ip))) throw new AuthError('invalid', 'operator.err_turnstile');
  const network = await networkKey(g.ip);
  const row = await accounts().get<{ n: number }>('SELECT count(*) AS n FROM signup WHERE network = ? AND created > ?', network, now - DAY);
  if ((row?.n ?? 0) >= SIGNUPS_PER_NETWORK) throw err('throttled', 'signup.err.slow');
  return { state, network };
}

/**
 * The record of the processing agreement accepted with the terms. The `gdpr` lane adds `terms_acceptance.kind`; until its
 * migration runs, the column is not there and the terms' own row (createFamily) is the record. The agreement's version is the
 * terms' version: it is part of the terms until the server has its own text for it.
 */
export async function dpaAcceptance(user: string, family: string, at: number): Promise<Query[]> {
  const version = await termsVersion();
  if (version === null) return [];
  const table = await accounts().get<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'terms_acceptance'");
  if (!table || !/[(,]\s*"?kind"?\s/i.test(table.sql)) return [];
  return [q("INSERT INTO terms_acceptance (user, version, at, action, family, kind) VALUES (?, ?, ?, 'family.create', ?, 'dpa')", user, version, at, family)];
}

/**
 * Who signs up. `passkey`: a new account and the passkey its device just made (verified by passkeys.server.ts). An account
 * signed in already starts another family with its own account (`existing`), within its families per account.
 * A password account plugs in here as another kind once the password sign-in method is on (lane `auth`).
 */
export type NewAccount =
  | { kind: 'passkey'; name: string; handle: string; locale: UserRow['locale']; credential: Omit<Parameters<typeof insertCredential>[0], 'user'> }
  | { kind: 'existing'; user: UserRow };

/**
 * Makes the family, and the account when it is new, in one step whose last batch holds every limit. `verified`: the email
 * was verified by whoever signed the person in (a single sign-on provider); false for every sign-up this round.
 */
export async function completeSignup(who: NewAccount, form: CleanForm, network: string, { verified = false, now = Date.now() }: { verified?: boolean; now?: number } = {}): Promise<{ tree: string; user: string }> {
  const state = await signupState(form.code, now);
  if (!state.open) throw closedError(state.reason);
  if (state.waitlist && !verified) throw closedError('closed');
  const h = await hostingSettings();
  const code = form.code ? await codeRow(form.code) : undefined;
  const withCode = codeUsable(code, now) ? code : undefined;

  let user: UserRow;
  const before: Query[] = [];
  if (who.kind === 'passkey') {
    // A verified email becomes the account's (if nobody has it); an unverified one never does.
    const email = verified && !(await userByEmail(form.email)) ? form.email : null;
    const made = newUser(who.name, email, who.handle, who.locale);
    user = made.user;
    before.push(made.insert, insertCredential({ ...who.credential, user: user.id }));
  } else {
    user = who.user;
  }
  // The limits, again, in the batch: two sign-ups at once cannot both take the last place.
  before.push(guard('(SELECT count(*) FROM signup WHERE network = ? AND created > ?) < ?', network, now - DAY, SIGNUPS_PER_NETWORK));
  if (withCode) {
    before.push(guard('EXISTS (SELECT 1 FROM signup_code WHERE id = ? AND revoked_at IS NULL AND uses < uses_max AND (expires IS NULL OR expires > ?))', withCode.id, now));
  } else {
    before.push(guard('(SELECT count(*) FROM signup WHERE created > ?) < ?', now - DAY, h.perDay));
    if (h.total !== null) before.push(guard('(SELECT count(*) FROM family_admin WHERE self_signed = 1) < ?', h.total));
  }
  const id = form.familyId;
  const after: Query[] = [
    q('UPDATE family_admin SET self_signed = 1 WHERE tree = ?', id),
    q('INSERT INTO signup (id, user, family, name, email, verified, age_confirmed, code, network, created) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)',
      crypto.randomUUID(), user.id, id, who.kind === 'passkey' ? who.name : user.name, form.email, verified ? 1 : 0, withCode?.id ?? null, network, now),
    ...(withCode ? [q('UPDATE signup_code SET uses = uses + 1 WHERE id = ?', withCode.id)] : []),
    ...(await dpaAcceptance(user.id, id, now)),
  ];
  const refused = async (): Promise<Error> => {
    const again = await signupState(form.code, Date.now());
    if (!again.open) return closedError(again.reason);
    const mine = await accounts().get<{ n: number }>('SELECT count(*) AS n FROM family_admin WHERE created_by = ?', user.id);
    if (user.operator !== 1 && (mine?.n ?? 0) >= h.perAccount) return err('forbidden', 'signup.err.per_account', { max: h.perAccount });
    return err('throttled', 'signup.err.slow');
  };
  const tree = await createFamily(user, { id, name: form.familyName, tagline: '', theme: form.theme }, {
    acceptedTerms: true, before, after, limit: h.perAccount, refused,
  });
  return { tree, user: user.id };
}

/** Unverified sign-ups wait (the operator's choice): the form becomes a request on the waiting list. No account is made. */
export async function signupToWaitlist(form: CleanForm, g: SignupGuards): Promise<{ email: string }> {
  return submitFamilyRequest({ name: form.name, email: form.email, familyName: form.familyName, message: '' }, { ip: g.ip, honeypot: g.honeypot, turnstile: g.turnstile });
}

// ---------- the operator ----------

const actor = (u: UserRow) => ({ id: u.id, name: u.name });

/**
 * Saves the hosting settings. Turning `hosting` off while sign-up is on is refused (sign-up needs it); the mode changes
 * nothing else: no family is hidden or deleted. Logged.
 */
export async function updateHosting(op: UserRow, next: HostingSettings): Promise<void> {
  const before = await hostingSettings();
  const changed = (Object.keys(next) as (keyof HostingSettings)[]).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(before[k]));
  if (!changed.length) return;
  if (next.mode !== 'hosting' && (await instanceSettings()).familyCreation === 'signup') throw err('invalid', 'signup.err.mode_signup');
  await accounts().batch([...saveHosting(next, op.id), audit(actor(op), 'hosting.settings', null, { changed })]);
}

/**
 * The operator's settings may turn sign-up on only when the server is ready for it: hosting mode, Kindred's own sign-in,
 * Turnstile, the Impressum, a privacy policy, terms and a storage cap for new families. Called before the settings are
 * saved (operator.server.ts), with the settings about to be saved.
 */
export async function refuseUnreadySignup(next: Awaited<ReturnType<typeof instanceSettings>>): Promise<void> {
  if (next.familyCreation !== 'signup') return;
  const missing = missingForSignup(await readiness({ settings: next }));
  if (missing.length) throw err('invalid', 'signup.err.not_ready_for', { missing: missing.join(', ') });
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** A code to read out or type: 12 characters in three groups, about 60 bits. */
function newCode(): string {
  const limit = 256 - (256 % CODE_ALPHABET.length);
  const chars: string[] = [];
  const b = new Uint8Array(1);
  while (chars.length < 12) {
    crypto.getRandomValues(b);
    if (b[0]! < limit) chars.push(CODE_ALPHABET[b[0]! % CODE_ALPHABET.length]!);
  }
  return chars.join('').replace(/(.{4})(?!$)/g, '$1-');
}

/** Makes a code that opens sign-up for `usesMax` sign-ups, until `expires` (null: no end). The code is returned once. Logged. */
export async function makeCode(op: UserRow, input: { label: string; usesMax: number; expires: number | null }): Promise<{ id: string; code: string }> {
  const code = newCode();
  const id = crypto.randomUUID();
  const label = line(input.label, 80);
  await accounts().batch([
    q('INSERT INTO signup_code (id, hash, label, uses_max, uses, expires, created, created_by) VALUES (?, ?, ?, ?, 0, ?, ?, ?)',
      id, await codeHash(code), label, input.usesMax, input.expires, Date.now(), op.id),
    audit(actor(op), 'signup_code.create', null, { code: id, label, usesMax: input.usesMax, expires: input.expires }),
  ]);
  return { id, code };
}

export async function revokeCode(op: UserRow, id: string): Promise<void> {
  const row = await accounts().get<{ label: string }>('SELECT label FROM signup_code WHERE id = ? AND revoked_at IS NULL', id);
  if (!row) return;
  await accounts().batch([
    q('UPDATE signup_code SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', Date.now(), id),
    audit(actor(op), 'signup_code.revoke', null, { code: id, label: row.label }),
  ]);
}

export async function codes(): Promise<SignupCode[]> {
  const rows = await accounts().all<{ id: string; label: string; uses_max: number; uses: number; expires: number | null; created: number; revoked_at: number | null }>(
    'SELECT id, label, uses_max, uses, expires, created, revoked_at FROM signup_code ORDER BY created DESC LIMIT 200');
  return rows.map((r) => ({ id: r.id, label: r.label, usesMax: r.uses_max, uses: r.uses, expires: r.expires, created: r.created, revoked: r.revoked_at !== null }));
}

/** The latest sign-ups: who, how to reach them, the family. For the operator, who answers for the service. */
export async function recentSignups(limit = 50): Promise<RecentSignup[]> {
  const rows = await accounts().all<{ id: string; name: string; email: string; family: string | null; verified: number; code: string | null; created: number }>(
    'SELECT id, name, email, family, verified, code, created FROM signup ORDER BY created DESC LIMIT ?', limit);
  return rows.map((r) => ({ ...r, verified: r.verified === 1 }));
}

/** The console's Hosting tab: the settings, the checklist, today's count against the limits, the codes and recent sign-ups. */
export async function hostingConsole() {
  const [settings, ready, counts, list, recent] = await Promise.all([hostingSettings(), readiness(), signupCounts(), codes(), recentSignups()]);
  return { settings, readiness: ready, counts, codes: list, recent };
}
