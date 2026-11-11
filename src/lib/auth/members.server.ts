// How a membership ends, in one place. A steward removes a member (removeMember in functions.ts, the Access page; a steward
// who removes themselves is the one way to "leave"), and that is the only way: no account is ever deleted while it is a
// member, a declined request deletes only an account with no membership (join.server.ts), and deleting a family deletes its
// database with it (families.server.ts).
//
// The accounts database and the family's database share no transaction (D1 has none), so this is two steps:
//   1. The accounts step, one atomic batch: the membership goes, with the reminder devices, the visit marker and the
//      assistant chats for that family. It starts first so that nobody who is no longer a member can add anything while the
//      second step runs, and a device is never left that could still be sent a push about the family.
//   2. The family step (`forgetInFamily`): one `once` plan in the family's database. It runs on every call, even when the
//      membership was already gone, so a failure after step 1 is finished by removing the person again, and it changes
//      nothing twice (every statement is a DELETE by account). It does nothing for someone who has become a member again.
// If step 2 fails, the person is already out and what is left behind is only game rows and reactions that nobody can reach.
//
// What happens to what they left (docs/data-model.md, "When a membership ends"):
//   stays   memories (`story`, with `author_account` kept: it is only used to tell an author about a reply, and only a
//           member can be told), answers to the question of the week (memories), comments (they keep `author_name`, the name
//           they were written under; the reader shows "a former member" when there is none), their posts in the feed with
//           the pictures and the comments under them (`post` keeps `author_name` and `author_person`, the person they stood
//           for, so a post stays signed and keeps its face; `account` is kept and matches nobody: only its writer may
//           change a post, so it can then only be removed, by an editor), the change history with their name, the
//           Campaign's chronicle (`campaign_log`: names, not accounts), join requests as history, their confirmed "Who is
//           this?" proposals (they are tags, "Named by" them).
//   goes    reactions, the daily quiz's answers (so standings and streaks), the Campaign's reigns (so their lines in the
//           weekly and all-time tables) and its old member rows and push claims, their opt-in for response pushes, their devices' choice to be
//           told about new posts (with the devices, in step 1), their unconfirmed "Who is this?" proposals (open or declined)
//           and the pictures they passed on (`tag_pass`), the items they kept for themselves (Personal fields) and the
//           history rows of those.
import { fail } from './guard.server';
import { AuthError } from './errors';
import * as s from './store.server';
import { once, q } from '../db.server';

const lastSteward = 'A family always needs at least one steward. Make someone else a steward first.';

/** What the family's database forgets about an account that is no longer a member. Safe to run again. */
export async function forgetInFamily(tree: string, user: string): Promise<void> {
  // Someone invited back in the meantime must keep what they have made since.
  if (await s.membership(user, tree)) return;
  await once(tree, undefined, 'forgetMember', () => ({
    writes: [
      q('DELETE FROM reaction WHERE account = ?', user),
      q('DELETE FROM quiz_answer WHERE account = ?', user),
      q('DELETE FROM campaign_member WHERE account = ?', user),
      q('DELETE FROM campaign_push WHERE account = ?', user),
      q('DELETE FROM campaign_run WHERE account = ?', user),
      q('DELETE FROM response_push WHERE account = ?', user),
      // "Who is this?": a proposal nobody confirmed (open, or declined) and the pictures they passed on. A confirmed one is a tag.
      q("DELETE FROM tag_proposal WHERE account = ? AND status <> 'confirmed'", user),
      q('DELETE FROM tag_pass WHERE account = ?', user),
      // What they kept for themselves: nobody else could ever read or remove it, nor the history of it.
      q("DELETE FROM person_field WHERE visibility = 'personal' AND owner = ? AND (created_by = ? OR created_by IS NULL)", user, user),
      q("DELETE FROM history WHERE level = 'personal' AND owner = ?", user),
    ],
    // Not a change to the family's records a reader would want in the history: it only removes what was private to them.
    history: [],
    result: undefined,
  }));
}

/** Ends a member's membership. Refuses to remove the last steward. Safe to call again for someone already removed. */
export async function endMembership(tree: string, user: string): Promise<void> {
  await s.commit(async () => {
    const m = await s.membership(user, tree);
    if (!m) return { writes: [], result: undefined };
    if (m.role === 'steward' && (await s.stewardCount(tree)) <= 1) throw fail(new AuthError('invalid', lastSteward));
    return {
      writes: [
        s.q('DELETE FROM membership WHERE user = ? AND tree = ?', user, tree), s.keepsASteward(tree),
        // Their reminder devices for this family (migrations/accounts/0005_push.sql), and so their choices of what to be told,
        // and the assistant chats and the pictures kept in them: inviting them back must not bring back what they could read then.
        s.q('DELETE FROM push_subscription WHERE user = ? AND tree = ?', user, tree),
        s.q('DELETE FROM family_visit WHERE user = ? AND tree = ?', user, tree),
        s.q('DELETE FROM presence WHERE account = ? AND tree = ?', user, tree),
        ...['ai_chat_image', 'ai_chat', 'ai_thread', 'ai_conversation'].map((table) => s.q(`DELETE FROM ${table} WHERE user = ? AND tree = ?`, user, tree)),
      ],
      result: undefined,
      refused: () => fail(new AuthError('invalid', lastSteward)),
    };
  });
  await forgetInFamily(tree, user);
}
