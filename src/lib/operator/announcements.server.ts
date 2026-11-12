// Operator announcements (docs/hosting-many-families.md, "Announcements"): a banner from the operator to the stewards of
// every family, or to everyone signed in, from a start until an end. For maintenance, a change of subprocessor, or a breach
// notice. Plain text only: the banner shows the words as they were typed, never as HTML or Markdown.
import { AuthError } from '../auth/errors.ts';
import type { UserRow } from '../auth/store.server.ts';
import { translate } from '../i18n/dictionary.ts';
import { q, store } from '../store/index.ts';
import { ANNOUNCEMENT_BODY_MAX, ANNOUNCEMENT_TITLE_MAX, type Announcement, type AnnouncementAudience } from './policy.ts';
import { audit } from './settings.server.ts';

const accounts = () => store.accounts();
const invalid = (key: Parameters<typeof translate>[1]) => new AuthError('invalid', translate('en', key));

interface Row { id: string; title: string; body: string; audience: AnnouncementAudience; starts_at: number; ends_at: number | null; created_at: number }
const view = (r: Row): Announcement => ({ id: r.id, title: r.title, body: r.body, audience: r.audience, startsAt: r.starts_at, endsAt: r.ends_at, createdAt: r.created_at });

/** Text as plain text: control characters out (a line break stays), spaces at the ends trimmed. */
const plain = (s: string) => s.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').trim();

/** Every announcement, newest first, for the console. */
export async function allAnnouncements(): Promise<Announcement[]> {
  return (await accounts().all<Row>('SELECT * FROM announcement ORDER BY starts_at DESC, created_at DESC LIMIT 100')).map(view);
}

export interface AnnouncementInput { title: string; body: string; audience: AnnouncementAudience; startsAt: number; endsAt: number | null }

export async function createAnnouncement(op: UserRow, input: AnnouncementInput, now = Date.now()): Promise<Announcement> {
  const title = plain(input.title).slice(0, ANNOUNCEMENT_TITLE_MAX);
  const body = plain(input.body).slice(0, ANNOUNCEMENT_BODY_MAX);
  if (!title) throw invalid('policy.err.announcement_title');
  if (input.endsAt !== null && input.endsAt <= input.startsAt) throw invalid('policy.err.announcement_end');
  const row: Row = { id: crypto.randomUUID(), title, body, audience: input.audience, starts_at: input.startsAt, ends_at: input.endsAt, created_at: now };
  await accounts().batch([
    q('INSERT INTO announcement (id, title, body, audience, starts_at, ends_at, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      row.id, row.title, row.body, row.audience, row.starts_at, row.ends_at, row.created_at, op.id),
    audit({ id: op.id, name: op.name }, 'announcement.create', null, { id: row.id, audience: row.audience }, now),
  ]);
  return view(row);
}

/** Ends an announcement now (one not started yet is ended before it begins). It stays in the console's list. */
export async function endAnnouncement(op: UserRow, id: string, now = Date.now()): Promise<void> {
  await accounts().batch([
    q('UPDATE announcement SET ends_at = ? WHERE id = ? AND (ends_at IS NULL OR ends_at > ?)', now, id, now),
    audit({ id: op.id, name: op.name }, 'announcement.end', null, { id }, now),
  ]);
}

/**
 * The announcements one reader sees now: those for everyone, and those for stewards when the reader is a steward of a
 * family here or an operator. `steward` comes from the reader's memberships as the guard reads them, so a steward's "View
 * as" preview of a viewer sees only what that viewer would.
 */
export async function visibleAnnouncements(reader: { steward: boolean }, now = Date.now()): Promise<Announcement[]> {
  const rows = await accounts().all<Row>(
    `SELECT * FROM announcement WHERE starts_at <= ? AND (ends_at IS NULL OR ends_at > ?) AND (audience = 'everyone' OR ?)
     ORDER BY starts_at DESC LIMIT 5`, now, now, reader.steward ? 1 : 0);
  return rows.map(view);
}
