// The operator console's work (src/routes/operator.tsx, docs/hosting-many-families.md). An operator runs the server for
// families that are not theirs: they see each family's administration (its name, members, stewards, storage, activity,
// status), never its records, and every change they make is written to the audit log in the same batch.
//
// Nothing here opens a family's records. A family's name comes from the families list every page uses; everything else is
// read from the accounts database. The operator is not added to any family they make: its first steward is invited.
import { AuthError } from '../auth/errors.ts';
import { families } from '../auth/trees.server.ts';
import { createInvite, inviteById, renewInvite, type UserRow } from '../auth/store.server.ts';
import { createFamily, deleteFamily, type FamilyTheme } from '../families.server.ts';
import { translate } from '../i18n/dictionary.ts';
import { guard, isGuardError, q, store } from '../store/index.ts';
import { audit, instanceSettings, saveSettings } from './settings.server.ts';
import { recount } from './storage.server.ts';
import type { FamilyStatus, InstanceSettings, OperatorAccount, OperatorFamily } from './shared.ts';

const accounts = () => store.accounts();
const invalid = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => new AuthError('invalid', translate('en', key, vars));
const actor = (u: UserRow) => ({ id: u.id, name: u.name });

/** Every family on the server, as the operator sees it. */
export async function operatorFamilies(now = Date.now()): Promise<OperatorFamily[]> {
  const all = await families();
  const [members, stewards, used, admin, activity, invites] = (await accounts().readBatch([
    q('SELECT tree, count(*) AS n, min(created) AS first FROM membership GROUP BY tree'),
    q("SELECT m.tree, u.name, u.email FROM membership m JOIN user u ON u.id = m.user WHERE m.role = 'steward' ORDER BY m.created"),
    q('SELECT tree, sum(bytes) AS n FROM media_usage GROUP BY tree'),
    q('SELECT tree, status, closed, cap_bytes, created_at FROM family_admin'),
    q('SELECT tree, max(last_seen) AS at FROM family_visit GROUP BY tree'),
    q("SELECT tree, email, expires FROM invite WHERE role = 'steward' AND used_at IS NULL AND revoked_at IS NULL AND expires > ? ORDER BY created DESC", now),
  ])) as unknown as [
    { tree: string; n: number; first: number }[], { tree: string; name: string; email: string | null }[], { tree: string; n: number }[],
    { tree: string; status: 'active' | 'suspended'; closed: number; cap_bytes: number | null; created_at: number | null }[], { tree: string; at: number | null }[],
    { tree: string; email: string | null; expires: number }[],
  ];
  const by = <T extends { tree: string }>(rows: T[]) => new Map(rows.map((r) => [r.tree, r]));
  const m = by(members), u = by(used), a = by(admin), act = by(activity);
  return all.map((f) => {
    const count = m.get(f.id)?.n ?? 0;
    const invite = count === 0 ? invites.find((i) => i.tree === f.id) : undefined;
    return {
      id: f.id, name: f.name,
      created: a.get(f.id)?.created_at ?? m.get(f.id)?.first ?? null,
      members: count,
      stewards: stewards.filter((s) => s.tree === f.id).map(({ name, email }) => ({ name, email })),
      usedBytes: Number(u.get(f.id)?.n ?? 0),
      capBytes: a.get(f.id)?.cap_bytes ?? null,
      lastActivity: act.get(f.id)?.at ?? null,
      status: statusOf(a.get(f.id)),
      pendingSteward: invite ? { email: invite.email, expires: invite.expires } : null,
    };
  }).sort((x, y) => x.name.localeCompare(y.name));
}

/** A family's level as the console shows it: closed is stored as suspended with `closed` set (accounts migration 0037). */
const statusOf = (row: { status: 'active' | 'suspended'; closed: number } | undefined): FamilyStatus =>
  row?.status === 'suspended' ? (row.closed === 1 ? 'closed' : 'suspended') : 'active';

export interface MadeFamily { id: string; token: string; expires: number }

/**
 * Makes a family for someone else, with no members, and the one-time invitation that makes `steward` its first steward. The
 * operator copies the link to them (Kindred sends no email). Logged.
 */
export async function makeFamilyFor(
  op: UserRow,
  input: { id: string; name: string; tagline?: string; theme?: FamilyTheme; stewardName: string; stewardEmail: string | null },
  logAs: 'family.create' | 'request.approve' = 'family.create', extra?: Record<string, unknown>,
): Promise<MadeFamily> {
  const stewardName = input.stewardName.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!stewardName) throw invalid('operator.err_steward_name');
  const id = await createFamily(op, { id: input.id, name: input.name, tagline: input.tagline ?? '', theme: input.theme ?? 'codex' }, { member: false, invitedName: stewardName });
  const { invite, token } = await createInvite({ tree: id, role: 'steward', email: input.stewardEmail, createdBy: op.id, byOperator: true });
  await accounts().batch([audit(actor(op), logAs, id, { name: input.name, steward: stewardName, email: input.stewardEmail, ...extra })]);
  return { id, token, expires: invite.expires };
}

/**
 * A fresh link for a family's waiting first-steward invitation (the old one stops working). Only an invitation an operator
 * made with the family (`by_operator`), and only while the family has no members: an invitation a steward made (a co-steward)
 * is theirs, and a link to a family with members would let whoever holds it in, since an invitation link is all it takes
 * (docs/hosting-many-families.md, "Invitations"). The renewal is refused, with nothing changed, as soon as either holds.
 */
export async function renewStewardLink(op: UserRow, tree: string): Promise<{ token: string; expires: number }> {
  const [[open], [members]] = (await accounts().readBatch([
    q("SELECT id FROM invite WHERE tree = ? AND role = 'steward' AND by_operator = 1 AND used_at IS NULL AND revoked_at IS NULL ORDER BY created DESC LIMIT 1", tree),
    q('SELECT count(*) AS n FROM membership WHERE tree = ?', tree),
  ])) as unknown as [[{ id: string } | undefined], [{ n: number }]];
  if (members!.n > 0) throw invalid('operator.err_has_members');
  if (!open) throw invalid('operator.err_no_invite');
  const token = await renewInvite(open.id, undefined, tree);
  if (!token) throw invalid('operator.err_has_members');
  const renewed = await inviteById(open.id);
  await accounts().batch([audit(actor(op), 'family.invite_renewed', tree)]);
  return { token, expires: renewed?.expires ?? Date.now() };
}

const known = async (tree: string) => {
  if (!(await families()).some((f) => f.id === tree)) throw invalid('operator.err_no_family');
};

const STATUS_ACTION: Record<FamilyStatus, string> = { active: 'family.resume', suspended: 'family.suspend', closed: 'family.close' };

/**
 * Sets how a family may be used: `suspended` (read-only for its members, with a bar; its guests keep reading), `closed`
 * (nobody opens it: its members see a page, its share links and guests are refused) or `active` again. Logged.
 */
export async function setFamilyStatus(op: UserRow, tree: string, status: FamilyStatus): Promise<void> {
  await known(tree);
  const stored = status === 'active' ? 'active' : 'suspended';
  const closed = status === 'closed' ? 1 : 0;
  await accounts().batch([
    q('INSERT INTO family_admin (tree, status, closed) VALUES (?, ?, ?) ON CONFLICT(tree) DO UPDATE SET status = excluded.status, closed = excluded.closed', tree, stored, closed),
    // A closed family's guests leave now, not when their visit would have ended.
    ...(closed ? [q('DELETE FROM share_session WHERE link IN (SELECT id FROM share_link WHERE tree = ?)', tree)] : []),
    audit(actor(op), STATUS_ACTION[status], tree),
  ]);
}

/** Sets a family's storage cap in bytes (null: none). Files already stored stay; new ones are refused while it is over. */
export async function setFamilyCap(op: UserRow, tree: string, capBytes: number | null): Promise<void> {
  await known(tree);
  await accounts().batch([
    q('INSERT INTO family_admin (tree, cap_bytes) VALUES (?, ?) ON CONFLICT(tree) DO UPDATE SET cap_bytes = excluded.cap_bytes', tree, capBytes),
    audit(actor(op), 'family.cap', tree, { capBytes }),
  ]);
}

export async function recountFamily(op: UserRow, tree: string): Promise<number> {
  await known(tree);
  const used = await recount(tree);
  await accounts().batch([audit(actor(op), 'family.recount', tree, { usedBytes: used })]);
  return used;
}

/**
 * Deletes a family with everything that belongs to it, as its stewards can (families.server.ts deleteFamily, with the same
 * typed confirmation); the server function has asked for a fresh passkey proof. Logged before, so the log has it even when
 * the deletion stops part-way.
 */
export async function deleteFamilyAsOperator(op: UserRow, tree: string, confirm: string): Promise<void> {
  if (confirm.trim() !== tree) throw invalid('families.err_confirm', { id: tree });
  const name = (await families()).find((f) => f.id === tree)?.name ?? null;
  await accounts().batch([audit(actor(op), 'family.delete', tree, { name })]);
  await deleteFamily(tree, confirm);
}

// ---------- the instance ----------

export async function updateSettings(op: UserRow, next: InstanceSettings): Promise<void> {
  const before = await instanceSettings();
  const changed = (Object.keys(next) as (keyof InstanceSettings)[]).filter((k) => next[k] !== before[k]);
  if (!changed.length) return;
  await accounts().batch([...saveSettings(next, op.id), audit(actor(op), 'settings', null, { changed })]);
}

// ---------- operators ----------

export async function operators(self: string): Promise<OperatorAccount[]> {
  const rows = await accounts().all<{ id: string; name: string; email: string | null }>('SELECT id, name, email FROM user WHERE operator = 1 ORDER BY created');
  return rows.map((r) => ({ ...r, self: r.id === self }));
}

/** Makes the account with this email an operator too. The account must exist: they sign up (or are invited) first. */
export async function addOperator(op: UserRow, email: string): Promise<void> {
  const target = await accounts().get<{ id: string; name: string; operator: number }>('SELECT id, name, operator FROM user WHERE email = ?', email.trim());
  if (!target) throw invalid('operator.err_no_account');
  if (target.operator === 1) return;
  await accounts().batch([
    q('UPDATE user SET operator = 1 WHERE id = ?', target.id),
    audit(actor(op), 'operator.add', null, { account: target.id, name: target.name }),
  ]);
}

/** Ends an account's operator role (the operator's own, to step down), never the last one's. */
export async function removeOperator(op: UserRow, account: string): Promise<void> {
  const target = await accounts().get<{ id: string; name: string }>('SELECT id, name FROM user WHERE id = ? AND operator = 1', account);
  if (!target) return;
  try {
    await accounts().batch([
      guard('(SELECT count(*) FROM user WHERE operator = 1) > 1'),
      q('UPDATE user SET operator = 0 WHERE id = ?', target.id),
      audit(actor(op), target.id === op.id ? 'operator.step_down' : 'operator.remove', null, { account: target.id, name: target.name }),
    ]);
  } catch (e) {
    if (isGuardError(e)) throw invalid('operator.err_last_operator');
    throw e;
  }
}
