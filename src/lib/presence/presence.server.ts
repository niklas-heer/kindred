// Live presence: who of the family is here right now, on which page, and (only between members who both share it) whom
// they have selected. One row per open tab in the accounts database (migrations/accounts/0032_presence.sql), rewritten by
// a heartbeat and ignored once it is older than EXPIRY_MS. Not a record of the family and not history: no `once`, no op
// key, so a heartbeat every 15 s does not grow the op table. Nothing here runs in a demo or a "View as" preview.
import { accounts } from '../auth/store.server.ts';
import { db, q } from '../db.server.ts';
import { readOnly } from '../read-only.ts';
import { EXPIRY_MS, FOCUS_ROUTES, hueOf, OFF, type LastHere, type Present, type PresenceRoute, type Roster } from './shared.ts';

export interface Beat {
  tab: string;
  route: PresenceRoute;
  focus: string | null;
  editing: boolean;
  shadows: boolean;
}

/** Rows this much older than expiry are deleted by the next heartbeat, of any family. */
const SWEEP_MS = 5 * 60_000;

/** The focus as it may be stored: a person of this family, on a page that may share one, from someone who shares. */
async function checkedFocus(tree: string, b: Beat): Promise<string | null> {
  if (!b.shadows || !b.focus || !FOCUS_ROUTES.includes(b.route)) return null;
  // Every member sees every person of their family (only fields are kept back), so being in the family is being visible.
  const row = await db(tree).get('SELECT 1 AS ok FROM person WHERE id = ?', b.focus);
  return row ? b.focus : null;
}

/** Notes that a member's tab is here, then answers who else is. Writes nothing in a demo or a preview. */
export async function beat(tree: string, account: string, b: Beat, now = Date.now()): Promise<Roster> {
  if (readOnly()) return OFF;
  const focus = await checkedFocus(tree, b);
  const editing = !!focus && b.editing;
  await accounts().batch([
    q(
      `INSERT INTO presence (tree, account, tab, route, focus, editing, shadows, seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (tree, account, tab) DO UPDATE SET route = excluded.route, focus = excluded.focus, editing = excluded.editing,
              shadows = excluded.shadows, seen = excluded.seen`,
      tree, account, b.tab, b.route, focus, editing ? 1 : 0, b.shadows ? 1 : 0, now,
    ),
    q('DELETE FROM presence WHERE seen < ?', now - SWEEP_MS),
  ]);
  return roster(tree, account, now);
}

/** The tab was closed or hidden: it is gone at once rather than after the expiry. */
export async function leave(tree: string, account: string, tab: string): Promise<void> {
  if (readOnly()) return;
  await accounts().run('DELETE FROM presence WHERE tree = ? AND account = ? AND tab = ?', tree, account, tab);
}

interface Row { account: string; route: PresenceRoute; focus: string | null; editing: number; shadows: number; seen: number; name: string; person: string | null }

/**
 * Everyone else in the family now, one entry per member however many tabs they have open (the most recent tab speaks for
 * them). Only current members count: someone removed a moment ago is gone with their membership. Focus is reciprocal: a
 * reader who does not share their own sees nobody's.
 */
export async function roster(tree: string, account: string, now = Date.now()): Promise<Roster> {
  if (readOnly()) return OFF;
  const rows = await accounts().all<Row>(
    `SELECT p.account, p.route, p.focus, p.editing, p.shadows, p.seen, u.name, m.person
       FROM presence p JOIN membership m ON m.user = p.account AND m.tree = p.tree JOIN user u ON u.id = p.account
      WHERE p.tree = ? AND p.seen >= ?
      ORDER BY p.seen DESC`,
    tree, now - EXPIRY_MS,
  );
  const mine = rows.filter((r) => r.account === account);
  // The reader shares while their latest tab does; a reader with no live tab yet (the first poll) shares by default.
  const sharing = mine.length ? mine[0]!.shadows === 1 : true;
  const seen = new Set<string>();
  const here: Present[] = [];
  for (const r of rows) {
    if (r.account === account || seen.has(r.account)) continue;
    seen.add(r.account);
    const shows = sharing && r.shadows === 1;
    here.push({
      account: r.account, name: r.name, person: personOf(r.person), route: r.route,
      focus: shows ? r.focus : null, editing: shows && r.editing === 1, seen: r.seen, hue: hueOf(r.account),
    });
  }
  return { on: true, here, sharing, last: here.length ? null : await lastHere(tree, account) };
}

const personOf = (p: string | null) => (p && p !== '-' ? p : null);

/** The member who was in the family most recently before now, from their visits (accounts migration 0026). */
async function lastHere(tree: string, account: string): Promise<LastHere | null> {
  const r = await accounts().get<{ name: string; person: string | null; last_seen: number }>(
    `SELECT u.name, m.person, v.last_seen FROM family_visit v
       JOIN membership m ON m.user = v.user AND m.tree = v.tree JOIN user u ON u.id = v.user
      WHERE v.tree = ? AND v.user <> ? ORDER BY v.last_seen DESC LIMIT 1`,
    tree, account,
  );
  return r ? { name: r.name, person: personOf(r.person), at: r.last_seen } : null;
}
