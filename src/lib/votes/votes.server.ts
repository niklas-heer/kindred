// Family votes on the server (tree migration 0037): starting, changing, closing and removing a vote, adding an option,
// casting a ballot and striking a guest's. Reads and counting come later; the count itself is `countVote` (count.ts).
//
//   vote          viewer       vote (and a share-link guest, in a vote that allows guests)
//   start-vote    contributor  start a vote; change or close your own; add an option where the vote allows it
//   remove-vote   editor       remove anyone's vote, close anyone's early (everyone may remove or close their own)
//   strike-voter  steward      strike or restore a guest's ballot while the vote is open
//
// What it promises:
// - A vote is the family talking, not a record: it writes no change history (NOT_A_RECORD).
// - The creator changes the question, description, rules and options only until the first ballot; after it only the
//   closing time, and never to before now.
// - A vote is open while `closed_at` is NULL and `closes_at` is in the future. Every write that needs it open restates
//   that in its guard, so a ballot, an option or an edit that arrives after the closing time is refused even when nothing
//   has marked the vote closed yet.
// - A secret vote's `ballot.voter` is an HMAC of the vote and the voter under the server's secret (`voterKey`), and its
//   `changed_at` stays NULL: a backup of the family's database lists who voted (`vote_voter`) and the ballots, never which
//   is whose. `vote_voter.id` is a random UUID, so nothing there derives from the key either.
// - Errors are translation keys (`votes.err.*`), translated where they are shown:
//     closed       the vote has closed           locked     it can no longer change that (a ballot exists, or no additions)
//     options      the options are not 2 to 20 distinct labels of at most 120 characters
//     choice       the ballot's choices do not fit the vote     too_many   too many votes started in an hour
//     guests       guests do not take part (this vote, or this guest was struck)
//     limit        too many guests from this network or link   not_yours  only its creator may change a vote
//     closes_at    the closing time is too soon or too far      question / description  empty or too long
//     name         a guest's name is empty or too long         gone       the vote (or the voter) is not there
import { fail } from '../auth/guard.server';
import { forbidden } from '../auth/errors';
import { serverHmac } from '../auth/seal.server';
import { guard, NOT_A_RECORD, once, q, type Db, type OpKey, type Query } from '../db.server';
import { needsMember, type Who } from '../feed/posts.server';
import { cleanComment } from '../responses';
import { can, needs as lowestRole, type Action } from '../roles';
import { b64url } from '../webpush';
import {
  GUEST_VOTERS_PER_LINK, GUEST_VOTERS_PER_NETWORK, MAX_CLOSE_DAYS, MAX_DESCRIPTION, MAX_GUEST_NAME, MAX_OPTION, MAX_OPTIONS,
  MAX_QUESTION, MAX_VOTES_AN_HOUR, MIN_CLOSE_MS, MIN_OPTIONS, type VoteKind,
} from './types';

/** What a vote is started with, or changed to. `closesAt` is an ISO time. */
export interface VoteInput {
  question: string;
  description?: string;
  kind: VoteKind;
  secret: boolean;
  addOptions: boolean;
  guests: boolean;
  closesAt: string;
  options: string[];
}

/**
 * Who casts a ballot: a member, or a share-link guest. A guest's `key` is `g:` and the SHA-256 of their `kindred_voter`
 * cookie, base64url; `link` is the guest link they came through and `net` their network, as the join requests count it.
 */
export type Voter =
  | { kind: 'member'; who: Who }
  | { kind: 'guest'; key: string; name: string; link: string; net: number };

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const marks = (xs: readonly unknown[]) => xs.map(() => '?').join(', ');
/** A membership's person, when it names one ("-" is "nobody in the tree"). */
const personOf = (p: string | null | undefined) => (p && p !== '-' ? p : null);
/** Text on one line: cleaned like a comment, every run of white space one space. */
const oneLine = (text: string) => cleanComment(text).replace(/\s+/g, ' ');
/** The person column's value: the id when that person is in the tree, else NULL. */
const PERSON = '(SELECT id FROM person WHERE id = ?)';
/** A guard condition on `vote`: this vote (`?`) is open at this time (`?`). */
const OPEN = 'id = ? AND closes_at > ? AND closed_at IS NULL';

function needs(who: Who, action: Action) {
  needsMember(who);
  if (!can(who.role, action)) throw fail(forbidden(action, lowestRole(action)));
}

/**
 * The key a ballot is stored under: the account id or guest key itself in an open vote, else an HMAC of the vote and it
 * under the server's secret, which is not in the family's database, so a backup cannot join a ballot to its voter.
 */
export async function voterKey(vote: string, secret: boolean, voterId: string): Promise<string> {
  if (!secret) return voterId;
  return b64url(await serverHmac('vote-voter', new TextEncoder().encode(`${vote}:${voterId}`)));
}

// ---------- checks ----------

interface VoteRow {
  id: string; account: string; question: string; description: string; kind: VoteKind; secret: number; add_options: number;
  guests: number; closes_at: string; closed_at: string | null; created_at: string;
}
const VOTE_COLUMNS = 'id, account, question, description, kind, secret, add_options, guests, closes_at, closed_at, created_at';
const isOpen = (row: Pick<VoteRow, 'closes_at' | 'closed_at'>, at: string) => !row.closed_at && row.closes_at > at;

function questionOf(text: string): string {
  const question = oneLine(text);
  if (!question || question.length > MAX_QUESTION) throw new Error('votes.err.question');
  return question;
}
function descriptionOf(text: string | undefined): string {
  const description = cleanComment(text ?? '');
  if (description.length > MAX_DESCRIPTION) throw new Error('votes.err.description');
  return description;
}
const sameLabel = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
/** One option's label, checked against the labels the vote has: present, short enough, and none of them in other letters' case. */
function labelOf(text: string, others: readonly string[]): string {
  const label = oneLine(text);
  if (!label || label.length > MAX_OPTION || others.some((o) => sameLabel(o, label))) throw new Error('votes.err.options');
  return label;
}
function optionsOf(texts: readonly string[]): string[] {
  if (texts.length < MIN_OPTIONS || texts.length > MAX_OPTIONS) throw new Error('votes.err.options');
  const labels: string[] = [];
  for (const text of texts) labels.push(labelOf(text, labels));
  return labels;
}
/** The closing time as stored: at least an hour from now, and at most ninety days from `from` (the vote's start). */
function closingOf(text: string, now: Date, from: Date): string {
  const at = new Date(text).getTime();
  if (!Number.isFinite(at) || at < now.getTime() + MIN_CLOSE_MS || at > from.getTime() + MAX_CLOSE_DAYS * DAY_MS) throw new Error('votes.err.closes_at');
  return new Date(at).toISOString();
}

async function voteOf(d: Db, id: string): Promise<VoteRow> {
  const row = await d.get<VoteRow>(`SELECT ${VOTE_COLUMNS} FROM vote WHERE id = ?`, id);
  if (!row) throw new Error('votes.err.gone');
  return row;
}
const labelsOf = async (d: Db, vote: string) => (await d.all<{ label: string }>('SELECT label FROM vote_option WHERE vote = ? ORDER BY ord', vote)).map((r) => r.label);
const optionRows = (vote: string, labels: readonly string[], who: Who, at: string, from = 0): Query[] =>
  labels.map((label, i) => q('INSERT INTO vote_option (id, vote, ord, label, added_by_account, added_by_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', crypto.randomUUID(), vote, from + i, label, who.id, who.name, at));

// ---------- changes ----------

/** Starts a vote under the member's own name, with its options in the order given. Answers the vote's id. */
export async function createVote(tree: string, who: Who, input: VoteInput, op?: OpKey, now: Date = new Date()): Promise<{ id: string }> {
  needs(who, 'start-vote');
  const question = questionOf(input.question);
  const description = descriptionOf(input.description);
  const labels = optionsOf(input.options);
  const closesAt = closingOf(input.closesAt, now, now);
  return once(tree, op, 'createVote', async (d) => {
    const hourAgo = new Date(now.getTime() - HOUR_MS).toISOString();
    const recent = await d.get<{ n: number }>('SELECT count(*) AS n FROM vote WHERE account = ? AND created_at > ?', who.id, hourAgo);
    if ((recent?.n ?? 0) >= MAX_VOTES_AN_HOUR) throw new Error('votes.err.too_many');
    // The person signs the vote only when a steward has confirmed the link, and only while they are in the tree.
    const author = who.personConfirmed ? personOf(who.person) : null;
    const id = crypto.randomUUID();
    const at = now.toISOString();
    return {
      writes: [
        // The hour's count as read: two votes sent at once cannot both be the fifth.
        guard('(SELECT count(*) FROM vote WHERE account = ? AND created_at > ?) < ?', who.id, hourAgo, MAX_VOTES_AN_HOUR),
        q(`INSERT INTO vote (id, account, author_name, author_person, question, description, kind, secret, add_options, guests, closes_at, created_at) VALUES (?, ?, ?, ${PERSON}, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id, who.id, who.name, author, question, description, input.kind, input.secret ? 1 : 0, input.addOptions ? 1 : 0, input.guests ? 1 : 0, closesAt, at),
        ...optionRows(id, labels, who, at),
      ],
      history: NOT_A_RECORD,
      result: { id },
    };
  });
}

/**
 * Changes the member's own open vote. Until the first ballot, anything; after it only the closing time (at least an hour
 * from now, at most ninety days from the start). A field sent unchanged is no change, so a form may send them all.
 */
export async function editVote(tree: string, who: Who, id: string, input: Partial<VoteInput>, op?: OpKey, now: Date = new Date()): Promise<void> {
  needs(who, 'start-vote');
  return once(tree, op, 'editVote', async (d) => {
    const row = await voteOf(d, id);
    if (row.account !== who.id) throw new Error('votes.err.not_yours');
    const at = now.toISOString();
    if (!isOpen(row, at)) throw new Error('votes.err.closed');
    const labels = await labelsOf(d, id);
    const question = input.question === undefined ? row.question : questionOf(input.question);
    const description = input.description === undefined ? row.description : descriptionOf(input.description);
    const options = input.options === undefined ? labels : optionsOf(input.options);
    const flags = { kind: input.kind ?? row.kind, secret: +(input.secret ?? !!row.secret), add_options: +(input.addOptions ?? !!row.add_options), guests: +(input.guests ?? !!row.guests) };
    const optionsChanged = options.length !== labels.length || options.some((l, i) => l !== labels[i]);
    const changed = optionsChanged || question !== row.question || description !== row.description || flags.kind !== row.kind
      || flags.secret !== row.secret || flags.add_options !== row.add_options || flags.guests !== row.guests;
    const sameClose = input.closesAt === undefined || Date.parse(input.closesAt) === Date.parse(row.closes_at);
    const closesAt = sameClose ? row.closes_at : closingOf(input.closesAt!, now, new Date(row.created_at));
    if (changed && (await d.get('SELECT 1 AS x FROM ballot WHERE vote = ? LIMIT 1', id))) throw new Error('votes.err.locked');
    return {
      writes: [
        guard(`EXISTS (SELECT 1 FROM vote WHERE ${OPEN} AND account = ?)`, id, at, who.id),
        ...(changed ? [
          // No ballot yet, as read: one cast meanwhile makes the plan decide again, and refuse.
          guard('NOT EXISTS (SELECT 1 FROM ballot WHERE vote = ?)', id),
          q('UPDATE vote SET question = ?, description = ?, kind = ?, secret = ?, add_options = ?, guests = ?, edited_at = ? WHERE id = ?',
            question, description, flags.kind, flags.secret, flags.add_options, flags.guests, at, id),
        ] : []),
        ...(optionsChanged ? [q('DELETE FROM vote_option WHERE vote = ?', id), ...optionRows(id, options, who, at)] : []),
        ...(closesAt === row.closes_at ? [] : [q('UPDATE vote SET closes_at = ? WHERE id = ?', closesAt, id)]),
      ],
      history: NOT_A_RECORD,
      result: undefined,
    };
  });
}

/** Closes an open vote now: its creator's, whatever their role now, or anyone's for an editor. A closed vote stays as it is. */
export async function closeVote(tree: string, who: Who, id: string, op?: OpKey, now: Date = new Date()): Promise<void> {
  needsMember(who);
  return once(tree, op, 'closeVote', async (d) => {
    const row = await voteOf(d, id);
    if (row.account !== who.id && !can(who.role, 'remove-vote')) throw fail(forbidden('remove-vote', 'editor'));
    const at = now.toISOString();
    if (!isOpen(row, at)) return { writes: [], history: NOT_A_RECORD, result: undefined };
    return {
      writes: [guard(`EXISTS (SELECT 1 FROM vote WHERE ${OPEN})`, id, at), q('UPDATE vote SET closed_at = ? WHERE id = ?', at, id)],
      history: NOT_A_RECORD,
      result: undefined,
    };
  });
}

/**
 * Removes a vote with its options, voters and ballots: its creator's, whatever their role now, or anyone's for an editor.
 * Its comments and reactions go with it (a trigger).
 */
export async function removeVote(tree: string, who: Who, id: string, op?: OpKey): Promise<{ removed: boolean }> {
  needsMember(who);
  return once<{ removed: boolean }>(tree, op, 'removeVote', async (d) => {
    const row = await d.get<{ account: string }>('SELECT account FROM vote WHERE id = ?', id);
    if (!row) return { writes: [], history: NOT_A_RECORD, result: { removed: false } };
    if (row.account !== who.id && !can(who.role, 'remove-vote')) throw fail(forbidden('remove-vote', 'editor'));
    return {
      // The foreign keys cascade, but each table is named, so no driver's foreign-key setting decides what stays.
      writes: ['ballot', 'vote_voter', 'vote_option', 'vote_reminded'].map((t) => q(`DELETE FROM ${t} WHERE vote = ?`, id)).concat(q('DELETE FROM vote WHERE id = ?', id)),
      history: NOT_A_RECORD,
      result: { removed: true },
    };
  });
}

/** Adds an option at the end of an open vote that allows additions, under the member's name. Answers the option's id. */
export async function addOption(tree: string, who: Who, id: string, label: string, op?: OpKey, now: Date = new Date()): Promise<{ id: string }> {
  needs(who, 'start-vote');
  return once(tree, op, 'addVoteOption', async (d) => {
    const row = await voteOf(d, id);
    const at = now.toISOString();
    if (!isOpen(row, at)) throw new Error('votes.err.closed');
    if (!row.add_options) throw new Error('votes.err.locked');
    const labels = await labelsOf(d, id);
    if (labels.length >= MAX_OPTIONS) throw new Error('votes.err.options');
    const text = labelOf(label, labels);
    const option = crypto.randomUUID();
    return {
      writes: [
        guard(`EXISTS (SELECT 1 FROM vote WHERE ${OPEN} AND add_options = 1)`, id, at),
        // The options as read: one added meanwhile (perhaps the same label) makes the plan decide again.
        guard('(SELECT count(*) FROM vote_option WHERE vote = ?) = ?', id, labels.length),
        q('INSERT INTO vote_option (id, vote, ord, label, added_by_account, added_by_name, created_at) VALUES (?, ?, (SELECT coalesce(max(ord), -1) + 1 FROM vote_option WHERE vote = ?), ?, ?, ?, ?)',
          option, id, id, text, who.id, who.name, at),
      ],
      history: NOT_A_RECORD,
      result: { id: option },
    };
  });
}

/**
 * Casts or changes a ballot: the voter's row in `vote_voter` (a member's name and face as they are now) and their one
 * `ballot`. A single-choice ballot names exactly one option, a ranked one one or more in order; each a different option of
 * this vote. A guest votes only where the vote allows guests, within the network's and the link's limits, and not once
 * struck.
 */
export async function castBallot(tree: string, voter: Voter, id: string, choices: string[], op?: OpKey, now: Date = new Date()): Promise<void> {
  if (voter.kind === 'member') needs(voter.who, 'vote');
  const name = voter.kind === 'member' ? voter.who.name : oneLine(voter.name);
  if (voter.kind === 'guest' && !voter.key.startsWith('g:')) throw new Error('votes.err.guests');
  if (voter.kind === 'guest' && (!name || name.length > MAX_GUEST_NAME)) throw new Error('votes.err.name');
  return once(tree, op, 'castBallot', async (d) => {
    const row = await voteOf(d, id);
    const at = now.toISOString();
    if (voter.kind === 'guest' && !row.guests) throw new Error('votes.err.guests');
    if (!isOpen(row, at)) throw new Error('votes.err.closed');
    const options = new Set((await d.all<{ id: string }>('SELECT id FROM vote_option WHERE vote = ?', id)).map((r) => r.id));
    const fits = (row.kind === 'single' ? choices.length === 1 : choices.length >= 1)
      && new Set(choices).size === choices.length && choices.every((c) => options.has(c));
    if (!fits) throw new Error('votes.err.choice');
    const voterId = voter.kind === 'member' ? voter.who.id : voter.key;
    const key = await voterKey(id, !!row.secret, voterId);
    const writes: Query[] = [
      guard(`EXISTS (SELECT 1 FROM vote WHERE ${OPEN}${voter.kind === 'guest' ? ' AND guests = 1' : ''})`, id, at),
      // The choices are still this vote's options (the creator may replace them until the first ballot).
      guard(`(SELECT count(*) FROM vote_option WHERE vote = ? AND id IN (${marks(choices)})) = ?`, id, ...choices, choices.length),
    ];
    if (voter.kind === 'member') {
      const { who } = voter;
      writes.push(q(`INSERT INTO vote_voter (id, vote, account, name, person) VALUES (?, ?, ?, ?, ${PERSON}) ON CONFLICT (vote, account) DO UPDATE SET name = excluded.name, person = excluded.person`,
        crypto.randomUUID(), id, who.id, who.name, who.personConfirmed ? personOf(who.person) : null));
    } else {
      const had = await d.get<{ struck: number }>('SELECT struck FROM vote_voter WHERE vote = ? AND guest_key = ?', id, voter.key);
      if (had?.struck) throw new Error('votes.err.guests');
      writes.push(guard('NOT EXISTS (SELECT 1 FROM vote_voter WHERE vote = ? AND guest_key = ? AND struck = 1)', id, voter.key));
      if (!had) {
        const counts = await d.get<{ net: number; link: number }>(
          'SELECT count(CASE WHEN net = ? THEN 1 END) AS net, count(CASE WHEN link = ? THEN 1 END) AS link FROM vote_voter WHERE vote = ? AND guest_key IS NOT NULL', voter.net, voter.link, id);
        if ((counts?.net ?? 0) >= GUEST_VOTERS_PER_NETWORK || (counts?.link ?? 0) >= GUEST_VOTERS_PER_LINK) throw new Error('votes.err.limit');
        writes.push(
          // The counts as read: two guests arriving at once cannot both be the thirteenth.
          guard('(SELECT count(*) FROM vote_voter WHERE vote = ? AND guest_key IS NOT NULL AND net = ?) < ?', id, voter.net, GUEST_VOTERS_PER_NETWORK),
          guard('(SELECT count(*) FROM vote_voter WHERE vote = ? AND guest_key IS NOT NULL AND link = ?) < ?', id, voter.link, GUEST_VOTERS_PER_LINK),
        );
      }
      writes.push(q('INSERT INTO vote_voter (id, vote, guest_key, name, link, net) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (vote, guest_key) DO NOTHING',
        crypto.randomUUID(), id, voter.key, name, voter.link, voter.net));
    }
    // A secret ballot keeps no time: nothing to line it up with who voted when.
    writes.push(q('INSERT INTO ballot (vote, voter, choices, changed_at) VALUES (?, ?, ?, ?) ON CONFLICT (vote, voter) DO UPDATE SET choices = excluded.choices, changed_at = excluded.changed_at',
      id, key, JSON.stringify(choices), row.secret ? null : at));
    return { writes, history: NOT_A_RECORD, result: undefined };
  });
}

/**
 * Strikes a guest's ballot from an open vote's count, or restores it: a steward's answer to a guest who voted twice. A
 * member's ballot is never struck, and a closed vote's result stays as it is.
 */
export async function strikeVoter(tree: string, who: Who, voteId: string, voterRowId: string, struck: boolean, op?: OpKey, now: Date = new Date()): Promise<void> {
  needs(who, 'strike-voter');
  return once(tree, op, 'strikeVoter', async (d) => {
    const row = await voteOf(d, voteId);
    const at = now.toISOString();
    if (!isOpen(row, at)) throw new Error('votes.err.closed');
    const voter = await d.get<{ guest_key: string | null }>('SELECT guest_key FROM vote_voter WHERE id = ? AND vote = ?', voterRowId, voteId);
    if (!voter) throw new Error('votes.err.gone');
    if (!voter.guest_key) throw fail(forbidden('strike-voter', 'steward'));
    return {
      writes: [
        guard(`EXISTS (SELECT 1 FROM vote WHERE ${OPEN})`, voteId, at),
        q('UPDATE vote_voter SET struck = ? WHERE id = ? AND vote = ? AND guest_key IS NOT NULL', struck ? 1 : 0, voterRowId, voteId),
      ],
      history: NOT_A_RECORD,
      result: undefined,
    };
  });
}
