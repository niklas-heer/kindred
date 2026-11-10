// Reactions and comments on a memory or a gallery photo (migration 0027, docs/responses.md): the reads for the Chronicle,
// the gallery and a thread, the members' changes, and the opt-in push to the one who wrote or shared the thing.
//
// Members only: every function here refuses a share-link guest itself, besides the server functions' own checks
// (responses.functions.ts), and the reads that a guest can reach (the Chronicle, the gallery) carry none of this.
//   react           viewer       give or take back a reaction
//   comment         contributor  write a comment, and change your own
//   remove-comment  editor       remove anyone's comment (everyone may remove their own, whatever their role now)
// Every change is a `once` plan whose guards restate what it read (db.server.ts).
import { fail } from './auth/guard.server';
import { forbidden, notMember } from './auth/errors';
import { accounts, q as accountsQ } from './auth/store.server';
import { db, guard, once, q, type Db, type OpKey } from './db.server';
import { translate } from './i18n/dictionary';
import { STALE_DAYS, envSetting, subscriptionFrom, vapidFrom, type PushRow } from './reminders.server';
import {
  MAX_COMMENT,
  cleanComment,
  targetKey,
  type CommentView,
  type ReactionKind,
  type ResponseCounts,
  type TargetKind,
  type Thread,
} from './responses';
import { can, type Role } from './roles';
import { fitsPush, sendPush, type VapidConfig } from './webpush';

/** Who is asking: a member (their account id, the name they show, their role), or a guest, who gets nothing here. */
export interface Who { id: string; name: string; role: Role; guest?: boolean }

const now = () => new Date().toISOString();

function needsMember(who: Who) {
  if (who.guest || !who.id) throw fail(notMember());
}
function needs(who: Who, action: 'react' | 'comment' | 'remove-comment') {
  needsMember(who);
  if (!can(who.role, action)) throw fail(forbidden(action, action === 'react' ? 'viewer' : action === 'comment' ? 'contributor' : 'editor'));
}

const EXISTS: Record<TargetKind, string> = {
  story: 'EXISTS (SELECT 1 FROM story WHERE id = ?)',
  media: 'EXISTS (SELECT 1 FROM media WHERE key = ?)',
};
const targetThere = (d: Db, kind: TargetKind, target: string) => d.get(`SELECT ${EXISTS[kind]} AS ok`, target).then((r) => !!(r as { ok?: number } | undefined)?.ok);

// ---------- reads ----------

/**
 * The counts for every target in the family that has any, in two reads whatever the size of the list: the Chronicle and
 * the gallery show them on each entry without asking once per entry.
 */
export async function responseCounts(tree: string, who: Who): Promise<ResponseCounts> {
  needsMember(who);
  const [reactions, comments] = await db(tree).readBatch([
    q('SELECT target_kind, target, kind, count(*) AS n, max(account = ?) AS mine FROM reaction GROUP BY target_kind, target, kind', who.id),
    q('SELECT target_kind, target, count(*) AS n FROM comment GROUP BY target_kind, target'),
  ]) as [{ target_kind: TargetKind; target: string; kind: ReactionKind; n: number; mine: number }[], { target_kind: TargetKind; target: string; n: number }[]];
  const out: ResponseCounts = {};
  const at = (kind: TargetKind, target: string) => (out[targetKey(kind, target)] ??= { reactions: {}, mine: [], comments: 0 });
  for (const r of reactions) {
    const s = at(r.target_kind, r.target);
    s.reactions[r.kind] = r.n;
    if (r.mine) s.mine.push(r.kind);
  }
  for (const c of comments) at(c.target_kind, c.target).comments = c.n;
  return out;
}

interface CommentRow { id: string; account: string; author_name: string; body: string; created_at: string; edited_at: string | null }

/** A target's comments, oldest first, with the portrait of who each author stands for, and the names behind each reaction. */
export async function thread(tree: string, who: Who, kind: TargetKind, target: string): Promise<Thread> {
  needsMember(who);
  const [rows, given] = await db(tree).readBatch([
    q('SELECT id, account, author_name, body, created_at, edited_at FROM comment WHERE target_kind = ? AND target = ? ORDER BY created_at, id', kind, target),
    q('SELECT account, kind FROM reaction WHERE target_kind = ? AND target = ? ORDER BY created_at, account', kind, target),
  ]) as [CommentRow[], { account: string; kind: ReactionKind }[]];
  const people = new Set([...rows.map((r) => r.account), ...given.map((r) => r.account)]);
  const known = people.size
    ? await accounts().all<{ id: string; name: string; person: string | null }>(
        `SELECT u.id, u.name, m.person FROM user u LEFT JOIN membership m ON m.user = u.id AND m.tree = ?
         WHERE u.id IN (SELECT value FROM json_each(?))`,
        tree, JSON.stringify([...people]),
      )
    : [];
  const byId = new Map(known.map((u) => [u.id, u]));
  const removeAny = can(who.role, 'remove-comment');
  const reactors: Thread['reactors'] = {};
  // A reaction from an account that no longer exists still counts; it has no name to show.
  for (const r of given) (reactors[r.kind] ??= []).push(byId.get(r.account)?.name ?? '');
  return {
    comments: rows.map((r): CommentView => {
      const member = byId.get(r.account);
      const person = member?.person && member.person !== '-' ? member.person : null;
      const mine = r.account === who.id;
      return { id: r.id, authorName: r.author_name, person, body: r.body, createdAt: r.created_at, editedAt: r.edited_at, mine, removable: mine || removeAny };
    }),
    reactors,
  };
}

// ---------- changes ----------

/** Gives a reaction (`on`) or takes it back. Giving it twice is one reaction. Answers whether it was new. */
export async function react(tree: string, who: Who, kind: TargetKind, target: string, reaction: ReactionKind, on: boolean, op?: OpKey): Promise<{ added: boolean }> {
  needs(who, 'react');
  return once(tree, op, 'react', async (d) => {
    if (!(await targetThere(d, kind, target))) throw new Error('responses.err.gone');
    if (!on) {
      return { writes: [q('DELETE FROM reaction WHERE target_kind = ? AND target = ? AND account = ? AND kind = ?', kind, target, who.id, reaction)], result: { added: false } };
    }
    const had = await d.get('SELECT 1 AS x FROM reaction WHERE target_kind = ? AND target = ? AND account = ? AND kind = ?', kind, target, who.id, reaction);
    return {
      writes: [
        guard(EXISTS[kind], target),
        q('INSERT INTO reaction (target_kind, target, account, kind, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING', kind, target, who.id, reaction, now()),
      ],
      result: { added: !had },
    };
  });
}

function bodyOf(text: string): string {
  const body = cleanComment(text);
  if (!body) throw new Error('responses.err.empty');
  if (body.length > MAX_COMMENT) throw new Error('responses.err.long');
  return body;
}

/** Writes a comment under the member's own name. Answers its id. */
export async function addComment(tree: string, who: Who, kind: TargetKind, target: string, text: string, op?: OpKey): Promise<{ id: string }> {
  needs(who, 'comment');
  const body = bodyOf(text);
  return once(tree, op, 'addComment', async (d) => {
    if (!(await targetThere(d, kind, target))) throw new Error('responses.err.gone');
    const id = crypto.randomUUID();
    return {
      writes: [
        guard(EXISTS[kind], target),
        q('INSERT INTO comment (id, target_kind, target, account, author_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, kind, target, who.id, who.name, body, now()),
      ],
      result: { id },
    };
  });
}

/** Changes the member's own comment. Nobody changes anyone else's, an editor included. */
export async function editComment(tree: string, who: Who, id: string, text: string, op?: OpKey): Promise<void> {
  needs(who, 'comment');
  const body = bodyOf(text);
  return once(tree, op, 'editComment', async (d) => {
    const row = await d.get<{ account: string }>('SELECT account FROM comment WHERE id = ?', id);
    if (!row) throw new Error('responses.err.comment_gone');
    if (row.account !== who.id) throw fail(forbidden('comment', 'contributor'));
    return {
      writes: [guard('EXISTS (SELECT 1 FROM comment WHERE id = ? AND account = ?)', id, who.id), q('UPDATE comment SET body = ?, edited_at = ? WHERE id = ?', body, now(), id)],
      result: undefined,
    };
  });
}

/** Removes a comment: the member's own, whatever their role now, or anyone's for an editor or a steward. */
export async function removeComment(tree: string, who: Who, id: string, op?: OpKey): Promise<{ removed: boolean }> {
  needsMember(who);
  return once<{ removed: boolean }>(tree, op, 'removeComment', async (d) => {
    const row = await d.get<{ account: string }>('SELECT account FROM comment WHERE id = ?', id);
    if (!row) return { writes: [], result: { removed: false } };
    if (row.account !== who.id && !can(who.role, 'remove-comment')) throw fail(forbidden('remove-comment', 'editor'));
    return { writes: [q('DELETE FROM comment WHERE id = ?', id)], result: { removed: true } };
  });
}

// ---------- the push to the author ----------

/** Whether the member asked to be told when someone answers what they wrote or shared in this family. */
export async function responsePush(tree: string, who: Who): Promise<boolean> {
  needsMember(who);
  return !!(await db(tree).get<{ enabled: number }>('SELECT enabled FROM response_push WHERE account = ?', who.id))?.enabled;
}

export async function setResponsePush(tree: string, who: Who, on: boolean): Promise<void> {
  needsMember(who);
  await db(tree).run('INSERT INTO response_push (account, enabled) VALUES (?, ?) ON CONFLICT (account) DO UPDATE SET enabled = excluded.enabled', who.id, on ? 1 : 0);
}

/** Something new on a target, for its author's push. */
export type Response = { kind: TargetKind; target: string; by: Who } & ({ what: 'comment' } | { what: 'reaction'; reaction: ReactionKind });

const DAY_MS = 86_400_000;

/** Who wrote a story or shared a photo, and for a story the person it is about. */
interface Owner { author: string | null; person?: string; given?: string; surname?: string | null; current_given?: string | null; current_surname?: string | null }

/**
 * Tells the author of a memory or the one who shared a photo that someone answered it, when they turned this on and have
 * reminders on a device for this family. At most one a day: the claim is the day in `response_push`, written before the
 * send. Never to the one who answered, and never throws: a push that fails must not fail the comment. Returns how many
 * devices got it.
 */
export async function notifyAuthor(tree: string, r: Response, options: { now?: Date; vapid?: VapidConfig | null; fetchImpl?: typeof fetch } = {}): Promise<number> {
  const at = options.now ?? new Date();
  const vapid = options.vapid === undefined ? vapidFrom(envSetting) : options.vapid;
  if (!vapid) return 0;
  let sent = 0;
  try {
    const d = db(tree);
    const owner = r.kind === 'story'
      ? await d.get<Owner>('SELECT s.author_account AS author, s.person, p.given, p.surname, p.current_given, p.current_surname FROM story s JOIN person p ON p.id = s.person WHERE s.id = ?', r.target)
      : await d.get<Owner>('SELECT uploaded_by AS author FROM media WHERE key = ?', r.target);
    const author = owner?.author;
    if (!owner || !author || author === r.by.id) return 0;
    if (!(await d.get('SELECT 1 AS x FROM response_push WHERE account = ? AND enabled = 1', author))) return 0;
    // Only someone still in the family hears about it.
    if (!(await accounts().get('SELECT 1 AS x FROM membership WHERE user = ? AND tree = ?', author, tree))) return 0;
    const devices = (await accounts().all<PushRow>('SELECT * FROM push_subscription WHERE tree = ? AND user = ?', tree, author))
      .filter((row) => at.getTime() - row.last_seen < STALE_DAYS * DAY_MS);
    if (!devices.length) return 0;
    const day = at.toISOString().slice(0, 10);
    const claim = await d.run('UPDATE response_push SET last_day = ? WHERE account = ? AND enabled = 1 AND (last_day IS NULL OR last_day <> ?)', day, author, day);
    if (claim.changes !== 1) return 0;
    const person = owner.person ? [owner.current_given ?? owner.given, owner.current_surname ?? owner.surname].filter(Boolean).join(' ') : '';
    for (const row of devices) {
      // Who answered and about whom; never the comment's words, which stay in the family's app.
      const vars = { name: r.by.name, person, reaction: r.what === 'reaction' ? translate(row.locale, `responses.reaction.${r.reaction}`) : '' };
      const key = r.what === 'comment'
        ? (r.kind === 'story' ? 'responses.push.comment_story' : 'responses.push.comment_media')
        : (r.kind === 'story' ? 'responses.push.reaction_story' : 'responses.push.reaction_media');
      const message = {
        title: translate(row.locale, 'responses.push.title'),
        body: translate(row.locale, key, vars),
        tag: `kindred-responses-${tree}`,
        url: owner.person ? `/${tree}/person/${encodeURIComponent(owner.person)}` : `/${tree}/gallery`,
      };
      if (!fitsPush(message)) continue;
      try {
        const response = await sendPush(subscriptionFrom(row), message, vapid, options.fetchImpl ?? fetch);
        await response.body?.cancel();
        if (response.status === 404 || response.status === 410) await accounts().batch([accountsQ('DELETE FROM push_subscription WHERE id = ?', row.id)]);
        else if (response.ok) sent += 1;
      } catch {
        // An unreachable push service: the day's claim stays, since the message may have been delivered.
      }
    }
  } catch {
    // Reading the author or the devices failed: the comment stands without the message.
  }
  return sent;
}
