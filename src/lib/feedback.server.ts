// Steward feedback on the server: the rows in the accounts database and the pictures in the family's media storage (the
// Gallery's, on Node and on R2). The permission checks are in feedback.functions.ts and the picture's route.
import { q, guard, isGuardError } from './store/db.ts';
import { accounts } from './auth/store.server';
import { media } from './db.server';
import { sniff } from './photos.server';
import { FEEDBACK_LIMITS, feedbackContextSchema, type FeedbackContext, type FeedbackKind, type FeedbackReport, type FeedbackStatus } from './feedback.ts';

interface Row { id: string; kind: FeedbackKind; status: FeedbackStatus; body: string; context: string; picture: string | null; user_name: string; created_at: number; updated_at: number }

const toReport = (r: Row): FeedbackReport => ({
  id: r.id, kind: r.kind, status: r.status, text: r.body, context: feedbackContextSchema.parse(JSON.parse(r.context)),
  hasPicture: !!r.picture, by: r.user_name, created: r.created_at, updated: r.updated_at,
});

export interface NewFeedback { kind: FeedbackKind; text: string; context: FeedbackContext; picture: Uint8Array | null }

export async function addFeedback(tree: string, user: { id: string; name: string }, input: NewFeedback): Promise<string> {
  const count = await accounts().get<{ n: number }>('SELECT count(*) AS n FROM feedback WHERE tree = ?', tree);
  if (count && count.n >= FEEDBACK_LIMITS.reports) throw new Error('feedback.err_full');
  if (input.picture && (input.picture.byteLength > FEEDBACK_LIMITS.picture || sniff(input.picture) !== 'image/jpeg')) throw new Error('feedback.err_picture');
  const id = crypto.randomUUID();
  const key = input.picture ? `feedback/${id}.jpg` : null;
  if (key) await media.put(tree, key, input.picture!, 'image/jpeg');
  const now = Date.now();
  try {
    // The count again, in the write: two reports sent at once cannot pass the limit together.
    await accounts().batch([
      guard('(SELECT count(*) FROM feedback WHERE tree = ?) < ?', tree, FEEDBACK_LIMITS.reports),
      q(
        'INSERT INTO feedback (id, tree, kind, body, context, picture, user, user_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id, tree, input.kind, input.text, JSON.stringify(input.context), key, user.id, user.name, now, now,
      ),
    ]);
  } catch (e) {
    if (key) await media.delete(tree, key).catch(() => {});
    if (isGuardError(e)) throw new Error('feedback.err_full');
    throw e;
  }
  return id;
}

export async function listFeedback(tree: string): Promise<FeedbackReport[]> {
  const rows = await accounts().all<Row>('SELECT * FROM feedback WHERE tree = ? ORDER BY created_at DESC LIMIT 500', tree);
  return rows.map(toReport);
}

export async function setFeedbackStatus(tree: string, id: string, status: FeedbackStatus): Promise<void> {
  const r = await accounts().run('UPDATE feedback SET status = ?, updated_at = ? WHERE id = ? AND tree = ?', status, Date.now(), id, tree);
  if (!r.changes) throw new Error('feedback.err_missing');
}

export async function deleteFeedback(tree: string, id: string): Promise<void> {
  const row = await accounts().get<{ picture: string | null }>('SELECT picture FROM feedback WHERE id = ? AND tree = ?', id, tree);
  if (!row) return;
  await accounts().run('DELETE FROM feedback WHERE id = ? AND tree = ?', id, tree);
  if (row.picture) await media.delete(tree, row.picture).catch(() => {});
}

/** Whether `key` is the picture of a report in this family. The picture's route serves nothing else. */
export async function feedbackPictureExists(tree: string, key: string): Promise<boolean> {
  return !!(await accounts().get('SELECT 1 AS ok FROM feedback WHERE tree = ? AND picture = ?', tree, key));
}
