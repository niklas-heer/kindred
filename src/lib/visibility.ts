// Who may see one of a person's fields or notes. This is the one rule: every read that lets a field leave the server
// (the person reads, Contacts, the assistant, the exports) asks it, so no path can have a looser idea of its own.
//
//   personal  only the account that added it. Not a steward, not the assistant, not an export.
//   editors   editors and stewards.
//   family    every member of the family. A share-link guest is not a member and sees no field at all.
//
// Only the account that created a field may make it personal, or personal again after sharing it (`mayBePersonal`): a personal
// field has one reader and goes when that account is removed, so nobody can take over someone else's. A field with no recorded
// author (from before authors were recorded) cannot be made personal.
import { can, type Role } from './roles.ts';

export const VISIBILITIES = ['personal', 'editors', 'family'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/** Who is reading. `account` is null for anything that is not one person's own eyes, such as the assistant. */
export interface Audience { account: string | null; role: Role | null; guest: boolean }

/** A reader of what every member may see, and nothing more. The default when a read names no one. */
export const PLAIN_MEMBER: Audience = { account: null, role: 'viewer', guest: false };

/** The audience of a signed-in member, or of a guest with a share link (see `requireReader`). */
export const audienceOf = (r: { user: { id: string } | null; role: Role; guest?: boolean }): Audience =>
  ({ account: r.user?.id ?? null, role: r.role, guest: r.guest === true });

/**
 * What the assistant may be given on a reader's behalf: the reader's role, but no account. So it can never receive a
 * personal field, even the reader's own: those are never sent to a provider.
 */
export const assistantAudience = (role: Role): Audience => ({ account: null, role, guest: false });

/** The same audience with their own personal fields left out: for anything that passes a field on (a suggestion to copy it, say). */
export const withoutPersonal = (a: Audience): Audience => ({ ...a, account: null });

/** A SQL condition on `person_field` for what this audience may see, and its parameters. A guest matches nothing. */
export function fieldsVisibleTo(a: Audience): { sql: string; params: string[] } {
  if (a.guest) return { sql: '0', params: [] };
  const parts = ["visibility = 'family'"];
  const params: string[] = [];
  if (can(a.role, 'edit-person')) parts.push("visibility = 'editors'");
  if (a.account) {
    parts.push("(visibility = 'personal' AND owner = ?)");
    params.push(a.account);
  }
  return { sql: `(${parts.join(' OR ')})`, params };
}

/** The same rule for a row already in hand. */
export function maySee(a: Audience, f: { visibility: string; owner: string | null }): boolean {
  if (a.guest) return false;
  if (f.visibility === 'family') return true;
  if (f.visibility === 'editors') return can(a.role, 'edit-person');
  return f.visibility === 'personal' && !!a.account && f.owner === a.account;
}

/**
 * Whether a field already stored may be saved as personal: when this reader created it, or it is already their own personal
 * field (one from before authors were recorded). `created_by` is set when the field is created and never changes.
 */
export const mayBePersonal = (a: Audience, f: { visibility: string; owner: string | null; created_by: string | null }): boolean =>
  !!a.account && (f.created_by === a.account || (f.visibility === 'personal' && f.owner === a.account));
