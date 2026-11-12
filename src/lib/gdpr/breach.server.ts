// The operator's breach register (GDPR Art. 33(5): document every personal data breach, its effects and the remedy, whether or
// not it was notified). accounts migration 0045; docs/gdpr.md, "When something goes wrong".
//
// The clock: a breach that is likely to put people at risk is notified to the supervisory authority within 72 hours of the
// operator becoming aware of it (Art. 33(1)); later only with the reasons for the delay. Until the operator has assessed the
// risk ('unknown') the clock runs too. A high risk also means telling the people affected (Art. 34). Kindred sends nothing: the
// operator notifies and records here when they did. A breach can carry a notice for the stewards of the families it affects,
// shown as a banner on their family's pages until a date or until the breach is closed.
import { AuthError } from '../auth/errors.ts';
import { translate } from '../i18n/dictionary.ts';
import { q, store, type Query } from '../store/index.ts';
import { audit } from '../operator/settings.server.ts';

const accounts = () => store.accounts();
const HOUR = 3_600_000;
export const NOTIFY_HOURS = 72;

export const BREACH_RISKS = ['unknown', 'none', 'risk', 'high'] as const;
export type BreachRisk = (typeof BREACH_RISKS)[number];

export interface BreachInput {
  title: string;
  awareAt: number;
  occurredAt: number | null;
  description: string;
  dataCategories: string;
  subjects: string;
  consequences: string;
  measures: string;
  risk: BreachRisk;
  authorityAt: number | null;
  authorityRef: string;
  lateReason: string;
  subjectsAt: number | null;
  notice: string;
  noticeUntil: number | null;
  closedAt: number | null;
  /** The families it affects; empty for all of them. */
  families: string[];
}

export interface Breach extends BreachInput {
  id: string;
  createdAt: number;
  updatedAt: number;
  /** When the authority must have been told by: 72 hours after the operator became aware. */
  deadline: number;
  /** 'none' (no notification owed, or done), 'running' (owed, within 72 hours), 'late' (owed, past 72 hours). */
  clock: 'none' | 'running' | 'late';
  /** How many of the stewards its current notice is for it reached by email (accounts `breach_mail`); null without a notice sent. */
  noticeReach: { reached: number; total: number } | null;
}

type Row = {
  id: string; title: string; aware_at: number; occurred_at: number | null; description: string; data_categories: string; subjects: string; consequences: string;
  measures: string; risk: BreachRisk; authority_at: number | null; authority_ref: string | null; late_reason: string | null; subjects_at: number | null;
  notice: string; notice_until: number | null; closed_at: number | null; created_at: number; updated_at: number;
};

/** Where the 72-hour clock stands for a breach, as of `now`. */
export function clockOf(b: { awareAt: number; risk: BreachRisk; authorityAt: number | null; closedAt?: number | null }, now: number): Breach['clock'] {
  if (b.risk === 'none' || b.authorityAt) return 'none';
  return now > b.awareAt + NOTIFY_HOURS * HOUR ? 'late' : 'running';
}

const toBreach = (r: Row, families: string[], now: number, reach: Breach['noticeReach'] = null): Breach => {
  const b: BreachInput = {
    title: r.title, awareAt: r.aware_at, occurredAt: r.occurred_at, description: r.description, dataCategories: r.data_categories, subjects: r.subjects,
    consequences: r.consequences, measures: r.measures, risk: r.risk, authorityAt: r.authority_at, authorityRef: r.authority_ref ?? '', lateReason: r.late_reason ?? '',
    subjectsAt: r.subjects_at, notice: r.notice, noticeUntil: r.notice_until, closedAt: r.closed_at, families,
  };
  return { ...b, id: r.id, createdAt: r.created_at, updatedAt: r.updated_at, deadline: r.aware_at + NOTIFY_HOURS * HOUR, clock: clockOf(b, now), noticeReach: reach };
};

/** Every breach, newest first. */
export async function breaches(now = Date.now()): Promise<Breach[]> {
  const [rows, fams, reach] = (await accounts().readBatch([
    q('SELECT * FROM breach ORDER BY aware_at DESC'),
    q('SELECT breach, family FROM breach_family ORDER BY family'),
    q('SELECT breach, count(sent_at) AS reached, count(*) AS total FROM breach_mail GROUP BY breach'),
  ])) as unknown as [Row[], { breach: string; family: string }[], { breach: string; reached: number; total: number }[]];
  const reachOf = new Map(reach.map((x) => [x.breach, { reached: Number(x.reached), total: Number(x.total) }]));
  return rows.map((r) => toBreach(r, fams.filter((f) => f.breach === r.id).map((f) => f.family), now, reachOf.get(r.id) ?? null));
}

const line = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const text = (s: string, max: number) => s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim().slice(0, max);

/** Records a breach (no `id`) or updates one. Logged, without its text. Returns its id. */
export async function saveBreach(op: { id: string; name: string }, input: BreachInput, id?: string, now = Date.now()): Promise<string> {
  const title = line(input.title, 200);
  if (!title) throw new AuthError('invalid', translate('en', 'gdpr.err.breach_title'));
  if (!Number.isFinite(input.awareAt) || input.awareAt > now + HOUR) throw new AuthError('invalid', translate('en', 'gdpr.err.breach_aware'));
  const late = input.authorityAt && input.authorityAt > input.awareAt + NOTIFY_HOURS * HOUR;
  if (late && !text(input.lateReason, 2000)) throw new AuthError('invalid', translate('en', 'gdpr.err.breach_late_reason'));
  const key = id ?? crypto.randomUUID();
  const v = [
    title, input.awareAt, input.occurredAt, text(input.description, 8000), text(input.dataCategories, 2000), text(input.subjects, 2000), text(input.consequences, 4000),
    text(input.measures, 4000), input.risk, input.authorityAt, line(input.authorityRef, 200) || null, text(input.lateReason, 2000) || null, input.subjectsAt,
    text(input.notice, 1000), input.noticeUntil, input.closedAt,
  ];
  const families = [...new Set(input.families.map((f) => f.trim()).filter(Boolean))].slice(0, 500);
  const writes: Query[] = id
    ? [q(`UPDATE breach SET title = ?, aware_at = ?, occurred_at = ?, description = ?, data_categories = ?, subjects = ?, consequences = ?, measures = ?, risk = ?,
          authority_at = ?, authority_ref = ?, late_reason = ?, subjects_at = ?, notice = ?, notice_until = ?, closed_at = ?, updated_at = ?, updated_by = ? WHERE id = ?`, ...v, now, op.id, key)]
    : [q(`INSERT INTO breach (title, aware_at, occurred_at, description, data_categories, subjects, consequences, measures, risk, authority_at, authority_ref, late_reason,
          subjects_at, notice, notice_until, closed_at, created_at, created_by, updated_at, updated_by, id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ...v, now, op.id, now, op.id, key)];
  const before = id ? await accounts().get<{ notice: string }>('SELECT notice FROM breach WHERE id = ?', id) : undefined;
  if (id && !before) throw new AuthError('invalid', translate('en', 'gdpr.err.breach_gone'));
  // A new or changed notice of an open breach also goes to the affected families' stewards by email, when the server sends
  // email (src/lib/email/notify.server.ts): one row each, so the register shows whom it reached and the daily job retries the
  // rest. The banner shows it either way.
  const notice = text(input.notice, 1000);
  const mail = !!notice && !input.closedAt && notice !== before?.notice;
  const notify = mail ? await import('../email/notify.server.ts') : null;
  await accounts().batch([
    ...writes,
    q('DELETE FROM breach_family WHERE breach = ?', key),
    ...(families.length ? [q('INSERT INTO breach_family (breach, family) SELECT ?, value FROM json_each(?)', key, JSON.stringify(families))] : []),
    ...(notify ? notify.queueBreachNotice(key, families.length ? families : null, now) : []),
    audit(op, id ? 'breach.update' : 'breach.record', null, { breach: key, risk: input.risk, families: families.length || 'all' }, now),
  ]);
  notify?.emailBreachNotice(key, now);
  return key;
}

/** The notices a family's stewards see now: open breaches with a notice that affect this family (or every family). */
export async function noticesFor(tree: string, now = Date.now()): Promise<{ id: string; notice: string; awareAt: number }[]> {
  return accounts().all<{ id: string; notice: string; awareAt: number }>(
    `SELECT id, notice, aware_at AS awareAt FROM breach b WHERE notice <> '' AND closed_at IS NULL AND (notice_until IS NULL OR notice_until > ?)
       AND (NOT EXISTS (SELECT 1 FROM breach_family f WHERE f.breach = b.id) OR EXISTS (SELECT 1 FROM breach_family f WHERE f.breach = b.id AND f.family = ?))
     ORDER BY aware_at DESC LIMIT 5`, now, tree);
}
