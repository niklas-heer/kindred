// "Who is this?" on the server (docs/who-is-this.md): the round of untagged pictures a member is shown, their answers, and
// confirming or declining what others proposed. The server functions in whois.functions.ts check the membership and role
// first; these keep the data true. A proposal and a pass are the game's (NOT_A_RECORD); a confirmation writes a tag, which is
// one of the family's records, with its `history` row in the same batch.
import type { Box } from '../photos/types.ts';
import { NOT_A_LEFTOVER } from '../photos.server.ts';
import { added, db, guard, NOT_A_RECORD, once, personExists, q, type Db } from '../db.server.ts';
import { readOnly } from '../read-only.ts';
import type { Role } from '../roles.ts';
import { mayConfirm, monthStart, onNaming, ROUND } from './rules.ts';
import type { WhoOutcome, WhoPhoto, WhoReview, WhoRound } from './types.ts';

/** The member playing: their account, the name shown on what they propose, and their role in the family. */
export interface Who { account: string; name: string; role: Role }

export type Answer =
  | { key: string; verdict: 'named'; person: string; box: Box | null }
  | { key: string; verdict: 'unknown' | 'skip' };

/** A picture nobody is confirmed in, as a condition on `m`. */
const UNTAGGED = 'NOT EXISTS (SELECT 1 FROM media_person t WHERE t.media = m.key AND t.confirmed = 1)';

/**
 * The next pictures for a member: untagged ones they have not named anyone in nor said "I don't know" to, and not among
 * `seen` (what this visit showed already, so a picture never comes twice in a row). Pictures they skipped before come last.
 * With the people waiting for this member's confirmation, and their month's count.
 */
export async function round(tree: string, who: Who, seen: readonly string[], now: Date = new Date()): Promise<WhoRound> {
  const d = db(tree);
  const notSeen = seen.length ? ` AND m.key NOT IN (${seen.map(() => '?').join(', ')})` : '';
  const [photos, month, review] = await Promise.all([
    d.all<{ key: string; width: number; height: number; taken: string | null; caption: string | null; skipped: number }>(
      `SELECT m.key, m.width, m.height, m.taken, m.caption, (p.kind IS NOT NULL) AS skipped
         FROM media m LEFT JOIN tag_pass p ON p.media = m.key AND p.account = ?
        WHERE ${NOT_A_LEFTOVER} AND ${UNTAGGED}
          AND NOT EXISTS (SELECT 1 FROM tag_proposal r WHERE r.media = m.key AND r.account = ?)
          AND (p.kind IS NULL OR p.kind = 'skip')${notSeen}
        ORDER BY skipped, p.at, m.uploaded_at DESC, m.key
        LIMIT ?`,
      who.account, who.account, ...seen, ROUND),
    d.get<{ named: number; confirmed: number | null }>(
      "SELECT count(*) AS named, sum(status = 'confirmed') AS confirmed FROM tag_proposal WHERE account = ? AND at >= ?", who.account, monthStart(now)),
    reviewFor(d, who),
  ]);
  return {
    photos: photos.map((p): WhoPhoto => ({ key: p.key, width: p.width, height: p.height, taken: p.taken, caption: p.caption, skipped: p.skipped === 1 })),
    review,
    month: { named: month?.named ?? 0, confirmed: month?.confirmed ?? 0 },
  };
}

/** The open proposals this member may confirm: others', one entry per picture and person, oldest first. */
async function reviewFor(d: Db, who: Who): Promise<WhoReview[]> {
  const rows = await d.all<{ id: number; media: string; person: string; account: string; name: string; x: number | null; y: number | null; w: number | null; h: number | null; width: number; height: number }>(
    `SELECT r.id, r.media, r.person, r.account, r.name, r.x, r.y, r.w, r.h, m.width, m.height
       FROM tag_proposal r JOIN media m ON m.key = r.media
      WHERE r.status = 'open' ORDER BY r.id LIMIT 200`);
  const groups = new Map<string, WhoReview>();
  for (const r of rows) {
    if (!mayConfirm(who.role, who.account, r.account)) continue;
    const k = `${r.media}\n${r.person}`;
    const g = groups.get(k);
    if (g) {
      g.names.push(r.name);
      continue;
    }
    const box = r.x !== null && r.y !== null && r.w !== null && r.h !== null ? { x: r.x, y: r.y, w: r.w, h: r.h } : null;
    groups.set(k, { id: r.id, key: r.media, width: r.width, height: r.height, person: r.person, box, names: [r.name] });
  }
  return [...groups.values()].slice(0, 10);
}

/** The writes that make `person` a confirmed tag on `key`: a suggestion already there is confirmed, else a new row. */
function tagWrites(key: string, person: string, box: Box | null, by: string, namedBy: string, at: string) {
  const b = box ?? { x: 0, y: 0, w: 1, h: 1 };
  return [
    q('UPDATE media_person SET confirmed = 1, tagged_by = ?, named_by = ? WHERE media = ? AND person = ? AND confirmed = 0', by, namedBy, key, person),
    q(`INSERT INTO media_person (media, person, x, y, w, h, confirmed, tagged_by, at, named_by)
       SELECT ?, ?, ?, ?, ?, ?, 1, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM media_person WHERE media = ? AND person = ?)`,
      key, person, b.x, b.y, b.w, b.h, by, at, namedBy, key, person),
  ];
}

interface OpenRow { id: number; account: string; name: string; x: number | null; y: number | null; w: number | null; h: number | null }
const boxOf = (r: Pick<OpenRow, 'x' | 'y' | 'w' | 'h'>): Box | null => (r.x !== null && r.y !== null && r.w !== null && r.h !== null ? { x: r.x, y: r.y, w: r.w, h: r.h } : null);

/** A member's answer to one picture. In a demo or a preview it is checked and nothing is kept. */
export async function answer(tree: string, who: Who, a: Answer, now: Date = new Date()): Promise<WhoOutcome> {
  const d = db(tree);
  const photo = await d.get<{ caption: string | null }>(`SELECT m.caption FROM media m WHERE m.key = ? AND ${NOT_A_LEFTOVER}`, a.key);
  if (!photo) throw new Error('photos.err.photo_gone');
  if (a.verdict === 'named' && !(await d.get('SELECT id FROM person WHERE id = ?', a.person))) throw new Error('photos.err.person_not_found');
  if (readOnly()) return 'not-stored';
  const at = now.toISOString();

  if (a.verdict !== 'named') {
    return once<WhoOutcome>(tree, undefined, 'whoPass', () => ({
      writes: [
        guard('EXISTS (SELECT 1 FROM media WHERE key = ?)', a.key),
        q('INSERT INTO tag_pass (media, account, kind, at) VALUES (?, ?, ?, ?) ON CONFLICT (media, account) DO UPDATE SET kind = excluded.kind, at = excluded.at', a.key, who.account, a.verdict, at),
      ],
      history: NOT_A_RECORD,
      result: 'noted',
    }));
  }

  return once<WhoOutcome>(tree, undefined, 'whoName', async (dd) => {
    const [tagged, open] = await Promise.all([
      dd.get('SELECT 1 FROM media_person WHERE media = ? AND person = ? AND confirmed = 1', a.key, a.person),
      dd.all<OpenRow>("SELECT id, account, name, x, y, w, h FROM tag_proposal WHERE media = ? AND person = ? AND status = 'open' AND account <> ? ORDER BY id", a.key, a.person, who.account),
    ]);
    const step = onNaming({ role: who.role, account: who.account, tagged: !!tagged, proposers: open.map((r) => r.account) });
    if (step === 'already') return { writes: [], history: NOT_A_RECORD, result: 'already' };
    const mine = (status: 'open' | 'confirmed') =>
      q(`INSERT INTO tag_proposal (media, person, account, name, x, y, w, h, at, status, decided_by, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (media, person, account) DO NOTHING`,
        a.key, a.person, who.account, who.name, a.box?.x ?? null, a.box?.y ?? null, a.box?.w ?? null, a.box?.h ?? null, at, status,
        status === 'confirmed' ? who.account : null, status === 'confirmed' ? at : null);
    if (step === 'propose') {
      return {
        writes: [guard('EXISTS (SELECT 1 FROM media WHERE key = ?)', a.key), personExists(a.person), mine('open')],
        history: NOT_A_RECORD,
        result: 'proposed',
      };
    }
    // Agreeing with an earlier proposal: the first member to name them is credited, at the box they tapped (or this one's).
    const first = open[0]!;
    return {
      writes: [
        ...confirmGuards(a.key, a.person, first.id),
        ...tagWrites(a.key, a.person, boxOf(first) ?? a.box, who.account, first.name, at),
        q("UPDATE tag_proposal SET status = 'confirmed', decided_by = ?, decided_at = ? WHERE media = ? AND person = ? AND status = 'open'", who.account, at, a.key, a.person),
        mine('confirmed'),
      ],
      history: [added('tag', a.key, { person: a.person, label: photo.caption })],
      result: 'confirmed',
    };
  });
}

/** What a confirmation relied on: the picture and the person are there, they are not tagged yet, the proposal is still open. */
const confirmGuards = (key: string, person: string, proposal: number) => [
  guard('EXISTS (SELECT 1 FROM media WHERE key = ?)', key),
  personExists(person),
  guard('NOT EXISTS (SELECT 1 FROM media_person WHERE media = ? AND person = ? AND confirmed = 1)', key, person),
  guard("EXISTS (SELECT 1 FROM tag_proposal WHERE id = ? AND status = 'open')", proposal),
];

/**
 * Confirms (`accept`) or declines a waiting proposal and every other open one naming the same person in the same picture.
 * Only someone who may tag pictures, and not the member who proposed it. Confirming makes the tag, credited to the first
 * member who named them; declining keeps the proposals as declined, so nobody is asked about them again.
 */
export async function decide(tree: string, who: Who, id: number, accept: boolean, now: Date = new Date()): Promise<'confirmed' | 'declined' | 'already' | 'not-stored'> {
  // A steward's preview shows what Confirm would do without doing it; a demo has no one who may confirm.
  if (readOnly()) return 'not-stored';
  return once(tree, undefined, accept ? 'whoConfirm' : 'whoDecline', async (d) => {
    const p = await d.get<OpenRow & { media: string; person: string; status: string; caption: string | null }>(
      'SELECT r.id, r.media, r.person, r.account, r.name, r.status, r.x, r.y, r.w, r.h, m.caption FROM tag_proposal r JOIN media m ON m.key = r.media WHERE r.id = ?', id);
    if (!p) throw new Error('whois.err.gone');
    if (!mayConfirm(who.role, who.account, p.account)) throw new Error('whois.err.not_yours');
    if (p.status !== 'open') throw new Error('whois.err.decided');
    const at = now.toISOString();
    const close = (status: 'confirmed' | 'declined') =>
      q('UPDATE tag_proposal SET status = ?, decided_by = ?, decided_at = ? WHERE media = ? AND person = ? AND status = \'open\'', status, who.account, at, p.media, p.person);
    if (!accept) {
      return { writes: [guard("EXISTS (SELECT 1 FROM tag_proposal WHERE id = ? AND status = 'open')", id), close('declined')], history: NOT_A_RECORD, result: 'declined' as const };
    }
    if (await d.get('SELECT 1 FROM media_person WHERE media = ? AND person = ? AND confirmed = 1', p.media, p.person)) {
      // Someone tagged them in the gallery meanwhile: the proposal was right, and there is nothing left to write but that.
      return { writes: [close('confirmed')], history: NOT_A_RECORD, result: 'already' as const };
    }
    const first = await d.get<OpenRow>("SELECT id, account, name, x, y, w, h FROM tag_proposal WHERE media = ? AND person = ? AND status = 'open' ORDER BY id LIMIT 1", p.media, p.person);
    const credit = first ?? p;
    return {
      writes: [...confirmGuards(p.media, p.person, id), ...tagWrites(p.media, p.person, boxOf(credit) ?? boxOf(p), who.account, credit.name, at), close('confirmed')],
      history: [added('tag', p.media, { person: p.person, label: p.caption })],
      result: 'confirmed' as const,
    };
  });
}
