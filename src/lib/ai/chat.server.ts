// The assistant: one reader's conversation in one family. Each turn is a short loop: the model may call
// read tools and propose changes; the loop ends when it answers in plain text. Messages are stored per
// reader per family (accounts DB, ai_chat); a proposal's status is stored with its reply.
//
// Each stored turn carries the tier it needed to be read: "editor" for a turn by a reader who can see private
// fields (its answers may quote them), "member" for any other turn. A reader only gets back the turns their role
// may read now, and only those go to the model as history, so a reader demoted from editor loses the earlier
// editor turns, private details included.
import { graph } from '../db.server';
import { fullName } from '../graph';
import { accounts, q } from '../auth/store.server';
import { can, type Role } from '../roles';
import type { AiMessage, ImagePart } from './adapters';
import { checkChatImages } from './chat-images';
import { CONTINUATION_SYSTEM, continuationNote, decisionState, dropRepeats, LEASE_MS, type DecisionOutcome, type StoredCard, type Turn, type Untold } from './continuation';
import { tr } from './labels';
import { systemPrompt } from './prompt';
import { adapterForFeature } from './settings.server';
import { runTool, toolsFor, type Ctx } from './tools.server';
import { toAiLocale, type AiLocale, type ChatItem, type Proposal } from './types';

const HISTORY = 12;
const MAX_STEPS = 5;
const id = () => crypto.randomUUID();

type Tier = 'member' | 'editor';
interface Body {
  text: string; proposals?: StoredCard[]; tier?: Tier; sources?: { url: string; title?: string }[]; session?: boolean; images?: { count: number; kept: string[] };
  /** A reply nobody asked for in words: what it was told about the reader's decisions, which the model reads back in place of a message. */
  continuation?: { note: string };
  /** A continuation is running from this turn: when it started, and whose it is. */
  continuing?: string;
}
interface ChatRow { id: string; role: 'user' | 'assistant'; body: string; at: number }

const parse = (r: ChatRow): Body => JSON.parse(r.body) as Body;
/** Turns stored before tiers were kept count as editor turns: a demoted reader does not get them back. */
const tierOf = (b: Body): Tier => (b.tier === 'member' ? 'member' : 'editor');

/** Whether a reader whose role is `role` may read a stored turn now. */
export const mayRead = (b: Body, role: Role): boolean => tierOf(b) === 'member' || can(role, 'edit-person');

/** The reader's current conversation in this family (created on first use). */
async function currentConv(tree: string, user: string): Promise<string> {
  const r = await accounts().get<{ conv: string }>('SELECT conv FROM ai_conversation WHERE tree = ? AND user = ?', tree, user);
  if (r) return r.conv;
  const conv = id();
  await accounts().run('INSERT OR IGNORE INTO ai_conversation (tree, user, conv, started) VALUES (?, ?, ?, ?)', tree, user, conv, Date.now());
  return (await accounts().get<{ conv: string }>('SELECT conv FROM ai_conversation WHERE tree = ? AND user = ?', tree, user))!.conv;
}

const toItem = (r: ChatRow): ChatItem => {
  const b = parse(r);
  return { id: r.id, role: r.role, text: b.text, ...(b.session && { session: true }), ...(b.images && { images: b.images }), ...(b.proposals?.length && { proposals: b.proposals }), ...(b.sources?.length && { sources: b.sources }), at: r.at };
};

const toTurn = (r: ChatRow): Turn => {
  const b = parse(r);
  return { id: r.id, role: r.role, proposals: b.proposals, continuation: !!b.continuation, continuing: b.continuing };
};

/** The reader's current conversation, oldest first, without the turns their role may no longer read. `continueDue` is a continuation still owed. */
export async function loadChat(tree: string, user: string, role: Role): Promise<{ items: ChatItem[]; continueDue: boolean }> {
  const conv = await currentConv(tree, user);
  const rows = await accounts().all<ChatRow>('SELECT id, role, body, at FROM ai_chat WHERE tree = ? AND user = ? AND conv = ? ORDER BY at, rowid', tree, user, conv);
  const readable = rows.filter((r) => mayRead(parse(r), role));
  return { items: readable.map(toItem), continueDue: decisionState(readable.map(toTurn), Date.now()).due };
}

/** A picture the reader kept with a message: only theirs, and only while their role may read that message. */
export async function loadChatImage(tree: string, user: string, role: Role, imageId: string): Promise<{ mime: string; base64: string } | null> {
  const row = await accounts().get<{ mime: string; data: string; body: string }>(
    'SELECT i.mime, i.data, c.body FROM ai_chat_image i JOIN ai_chat c ON c.id = i.item WHERE i.id = ? AND i.tree = ? AND i.user = ? AND c.tree = ? AND c.user = ?',
    imageId, tree, user, tree, user,
  );
  if (!row || !mayRead(JSON.parse(row.body) as Body, role)) return null;
  return { mime: row.mime, base64: row.data };
}

/** "New conversation": the next message starts a fresh one. Earlier ones stay stored, for the family's records. */
export async function newConversation(tree: string, user: string): Promise<void> {
  await accounts().run('INSERT INTO ai_conversation (tree, user, conv, started) VALUES (?, ?, ?, ?) ON CONFLICT(tree, user) DO UPDATE SET conv = excluded.conv, started = excluded.started', tree, user, id(), Date.now());
}

/** The turns this reader may read in this conversation, oldest first, as the continuation rules see them. */
async function readableTurns(tree: string, user: string, conv: string, role: Role): Promise<Turn[]> {
  const rows = await accounts().all<ChatRow>('SELECT id, role, body, at FROM ai_chat WHERE tree = ? AND user = ? AND conv = ? ORDER BY at, rowid', tree, user, conv);
  return rows.filter((r) => mayRead(parse(r), role)).map(toTurn);
}

/** Only what the card can vouch for: a family draft's refs must be in that draft. */
function cleanOutcome(card: StoredCard, o: DecisionOutcome | undefined): DecisionOutcome | undefined {
  if (!o) return undefined;
  const refs = new Set(((card.args as { people?: { ref?: string }[] }).people ?? []).flatMap((p) => (p.ref ? [p.ref] : [])));
  const known = (list?: string[]) => list?.filter((r) => refs.has(r));
  return { ...o, added: known(o.added), failed: known(o.failed) };
}

/**
 * Records the reader's decision on a card, so a reload shows it as settled and the assistant can be told about it. Says
 * whether the assistant should carry on now. Each write is one statement on the stored JSON: two cards decided at the
 * same moment must not overwrite each other. A card already decided is left alone, so a retried mark raises nothing twice.
 */
export async function markProposal(tree: string, user: string, role: Role, itemId: string, proposalId: string, status: 'done' | 'dismissed' | 'failed', outcome?: DecisionOutcome): Promise<{ due: boolean }> {
  const row = await accounts().get<ChatRow>('SELECT id, role, body, at FROM ai_chat WHERE id = ? AND tree = ? AND user = ?', itemId, tree, user);
  if (!row || !mayRead(parse(row), role)) return { due: false };
  const b = parse(row);
  const i = b.proposals?.findIndex((x) => x.id === proposalId) ?? -1;
  if (i < 0) return { due: false };
  const card = b.proposals![i];
  if (card.status === 'open') {
    const at = `$.proposals[${i}]`;
    const clean = cleanOutcome(card, outcome);
    if (status === 'failed') {
      // A card that keeps failing is reported once. It is reported again only when the reader settles it.
      const raise = card.failureTold ? '' : `, '${at}.untold', json('true')`;
      await accounts().run(`UPDATE ai_chat SET body = json_set(body, '${at}.outcome', json(?)${raise}) WHERE id = ?`, JSON.stringify(clean ?? {}), itemId);
    } else {
      const keep = clean ? `, '${at}.outcome', json(?)` : '';
      await accounts().run(
        `UPDATE ai_chat SET body = json_set(json_remove(body, '${at}.outcome', '${at}.failureTold'), '${at}.status', ?, '${at}.untold', json('true')${keep}) WHERE id = ?`,
        ...(clean ? [status, JSON.stringify(clean), itemId] : [status, itemId]),
      );
    }
  }
  return { due: decisionState(await readableTurns(tree, user, await currentConv(tree, user), role), Date.now()).due };
}

/** The statements that record these decisions as told, and let go of a claim. They go in one batch with the reply that told them. */
function toldStatements(untold: Untold[], claimItem?: string) {
  const byItem = new Map<string, Untold[]>();
  for (const u of untold) byItem.set(u.itemId, [...(byItem.get(u.itemId) ?? []), u]);
  if (claimItem && !byItem.has(claimItem)) byItem.set(claimItem, []);
  return [...byItem].map(([itemId, cards]) => {
    const removed = [...cards.map((u) => `$.proposals[${u.index}].untold`), ...(itemId === claimItem ? ['$.continuing'] : [])];
    const stripped = `json_remove(body, ${removed.map((p) => `'${p}'`).join(', ')})`;
    // A failed card has been reported once it is told; settling it later is news, retrying it is not.
    const failed = cards.filter((u) => u.card.status === 'open').map((u) => `'$.proposals[${u.index}].failureTold', json('true')`);
    const body = failed.length ? `json_set(${stripped}, ${failed.join(', ')})` : stripped;
    return q(`UPDATE ai_chat SET body = ${body} WHERE id = ?`, itemId);
  });
}

/** The conversation so far, as the model reads it. */
async function historyFor(tree: string, user: string, conv: string, role: Role): Promise<AiMessage[]> {
  const recent = await accounts().all<ChatRow>('SELECT id, role, body, at FROM ai_chat WHERE tree = ? AND user = ? AND conv = ? ORDER BY at DESC, rowid DESC LIMIT ?', tree, user, conv, HISTORY * 4);
  return recent
    .filter((r) => mayRead(parse(r), role))
    .slice(0, HISTORY)
    .reverse()
    .flatMap((r): AiMessage[] => {
      const b = parse(r);
      // A continuation has no message from the reader. What it was told goes back in that place, so the turns still alternate.
      if (b.continuation) return [{ role: 'user', text: b.continuation.note }, { role: 'assistant', text: b.text }];
      // A family session's transcript is long and was already drafted: the model sees a note of it, not the whole talk.
      if (r.role === 'user' && b.session) return [{ role: 'user', text: `[A family session was drafted here: ${b.text.split('\n').length} lines.]` }];
      // A picture is sent once. Later turns are told it was there, and work from the reply that read it.
      const pictures = r.role === 'user' && b.images ? `[The reader attached ${b.images.count} picture(s) here. They are not shown again.]` : '';
      return [r.role === 'user' ? { role: 'user', text: [b.text, pictures].filter(Boolean).join('\n') } : { role: 'assistant', text: b.text }];
    });
}

/** One turn of the model: it may call read tools and propose changes, and ends when it answers in plain text. Every call goes through the family's route, role and budget. */
async function modelTurn(o: {
  tree: string; role: Role; me: string | null; locale: AiLocale; past: AiMessage[]; text: string;
  session?: boolean; attached?: ImagePart[]; continuation?: boolean;
}): Promise<{ text: string; proposals: Proposal[]; sources: { url: string; title?: string }[] }> {
  const attached = o.attached ?? [];
  const { adapter, webSearch, settings } = await adapterForFeature(o.tree, 'assistant', o.locale);
  const faces = settings.features.faces;
  const avatar = settings.features.avatar;
  const g = await graph(o.tree);
  const me = o.me && o.me !== '-' ? g.people.find((p) => p.id === o.me) : undefined;
  const { tools, proposals: canPropose } = toolsFor(o.role, { web: webSearch, faces, avatar });
  const base = systemPrompt({
    locale: o.locale, family: g.tree.name, readerName: me ? fullName(me) : null, kinToReader: null, canPropose, role: o.role, webSearch,
    faces, avatar, session: o.session, pictures: attached.length,
  });
  const system = o.continuation ? `${base}\n${CONTINUATION_SYSTEM}` : base;
  // The sources of the web lookups this turn ran. The chat's own requests never search: a lookup is its own request.
  const sources: { url: string; title?: string }[] = [];
  const images: ImagePart[] = [];
  const ctx: Ctx = { tree: o.tree, role: o.role, me: me?.id ?? null, session: o.session, pictures: attached.length > 0, locale: o.locale, faces, avatar, images, search: webSearch ? { adapter, sources, lookups: 0 } : undefined };
  const messages: AiMessage[] = [...o.past, { role: 'user', text: o.text, ...(attached.length && { images: attached }) }];
  const proposals: Proposal[] = [];
  let text = '';
  // A family draft's reply carries a whole set of people in one tool call, so it may run longer than a chat answer.
  const maxTokens = o.session || attached.length ? 4000 : 1200;
  for (let step = 0; ; step++) {
    // Each call is booked against the family's budget by the adapter, so a loop cannot outspend it.
    const reply = await adapter.complete({ system, messages, tools, maxTokens, timeoutMs: 60_000 });
    if (!reply.calls.length || step >= MAX_STEPS) {
      text = reply.text.trim();
      break;
    }
    // The reply's reasoning blocks go back with its calls, unchanged: OpenRouter needs them to continue a reasoning model's tool turn.
    messages.push({ role: 'assistant', text: reply.text, calls: reply.calls, ...(reply.reasoningDetails && { reasoningDetails: reply.reasoningDetails }) });
    for (const call of reply.calls) {
      messages.push({ role: 'tool', callId: call.id, content: await runTool(ctx, call.name, call.args, proposals) });
    }
    // Pictures a tool asked for (describe_photo) go to the model as the next message, after its tool results.
    if (images.length) messages.push({ role: 'user', text: 'Here is the picture you asked to look at.', images: images.splice(0) });
  }
  return { text, proposals, sources };
}

/** One message from the reader, and the assistant's reply to it. Nothing is stored unless the turn completes. */
export async function sendMessage(o: {
  tree: string; user: string; role: Role; me: string | null; text: string; locale: string;
  /** A family session: the text is a transcript, and the reply drafts the family from it (see prompt.ts). */
  session?: boolean;
  /** The person speaking in a family session (an id in the tree), who "my" and "I" mean. */
  speaker?: string | null;
  /** Pictures attached to this message. They go to the provider once and are not stored unless `keepImages` is set. */
  images?: readonly { base64: string }[];
  keepImages?: boolean;
}): Promise<{ items: ChatItem[] }> {
  // A session costs far more than a message and can only end in a draft. Refused before anything is spent for a role that could not apply one.
  // Pictures have the same rule, and the same reason.
  if ((o.session || o.images?.length) && !can(o.role, 'add-person')) throw new Error('ai.famRefused');
  const attached = checkChatImages(o.images ?? []);
  if (!o.text.trim() && !attached.length) throw new Error('ai.err_empty_message');
  const locale: AiLocale = toAiLocale(o.locale);
  const c = tr(locale);
  const conv = await currentConv(o.tree, o.user);
  const started = Date.now();
  const past = await historyFor(o.tree, o.user, conv, o.role);
  // Decisions no reply has been told about go with this message, so the reader who writes first does not get a continuation as well.
  const decided = o.session ? [] : decisionState(await readableTurns(o.tree, o.user, conv, o.role), started).untold;
  const said = o.text || 'See the attached pictures.';
  // In a family session the speaker is who "I" and "my" mean; otherwise it is the reader's own person.
  const turn = await modelTurn({
    tree: o.tree, role: o.role, me: o.session && o.speaker ? o.speaker : o.me, locale, past, session: o.session, attached,
    text: decided.length ? `${continuationNote(decided)}\n\nThe reader then wrote:\n${said}` : said,
  });
  const { proposals, sources } = turn;
  const text = turn.text || (proposals.length ? '' : c('ai.notRecorded'));

  const tier: Tier = can(o.role, 'edit-person') ? 'editor' : 'member';
  const keep = o.keepImages ? attached.map((img) => ({ id: id(), img })) : [];
  const userRow: ChatRow = {
    id: id(), role: 'user', at: started,
    body: JSON.stringify({ text: o.text, tier, ...(o.session && { session: true }), ...(attached.length && { images: { count: attached.length, kept: keep.map((k) => k.id) } }) }),
  };
  const reply: ChatRow = {
    id: id(), role: 'assistant', body: JSON.stringify({ text, ...(proposals.length && { proposals }), ...(sources.length && { sources }), tier }), at: Date.now(),
  };
  // Both turns or neither: a message is never stored without its answer, and a failed turn leaves nothing to resend.
  const insert = (r: ChatRow) => q('INSERT INTO ai_chat (id, tree, user, conv, role, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)', r.id, o.tree, o.user, conv, r.role, r.body, r.at);
  const keptRows = keep.map((k) => q('INSERT INTO ai_chat_image (id, item, tree, user, mime, data, at) VALUES (?, ?, ?, ?, ?, ?, ?)', k.id, userRow.id, o.tree, o.user, k.img.mime, k.img.base64, started));
  await accounts().batch([insert(userRow), insert(reply), ...keptRows, ...toldStatements(decided)]);
  return { items: [toItem(userRow), toItem(reply)] };
}

/**
 * The assistant carries on after the reader's decisions, if any are due. Two tabs or two cards can ask at once, so the
 * newest decided turn is claimed first, and only the holder spends anything. If the model fails, the decisions stay
 * untold and the claim is let go, so the same continuation can be tried again; the approvals themselves are already saved.
 */
export async function continueAfterDecisions(o: { tree: string; user: string; role: Role; me: string | null; locale: string }): Promise<{ items: ChatItem[] }> {
  const locale: AiLocale = toAiLocale(o.locale);
  const conv = await currentConv(o.tree, o.user);
  const first = decisionState(await readableTurns(o.tree, o.user, conv, o.role), Date.now());
  if (!first.due || !first.claimItem) return { items: [] };

  const now = Date.now();
  const claim = `${now}:${id()}`;
  const claimed = await accounts().run(
    "UPDATE ai_chat SET body = json_set(body, '$.continuing', ?) WHERE id = ? AND (json_extract(body, '$.continuing') IS NULL OR CAST(json_extract(body, '$.continuing') AS INTEGER) <= ?)",
    claim, first.claimItem, now - LEASE_MS,
  );
  if (claimed.changes !== 1) return { items: [] };
  const release = () => accounts().run("UPDATE ai_chat SET body = json_remove(body, '$.continuing') WHERE id = ? AND json_extract(body, '$.continuing') = ?", first.claimItem, claim);

  try {
    // Looked at again now that it is ours: another run may have finished between the first look and the claim.
    const turns = (await readableTurns(o.tree, o.user, conv, o.role)).map((t) => (t.id === first.claimItem ? { ...t, continuing: undefined } : t));
    const state = decisionState(turns, now);
    if (!state.due) {
      await release();
      return { items: [] };
    }
    const note = continuationNote(state.untold);
    const turn = await modelTurn({ tree: o.tree, role: o.role, me: o.me, locale, past: await historyFor(o.tree, o.user, conv, o.role), text: note, continuation: true });
    // The loop guard: a card this conversation has already shown is not shown again, and if that was all it had, it stops here.
    const { kept, repeated } = dropRepeats(turn.proposals, turns);
    const onlyRepeats = repeated > 0 && kept.length === 0;
    const text = onlyRepeats || !turn.text ? (kept.length ? '' : tr(locale)('ai.continueStopped')) : turn.text;
    const tier: Tier = can(o.role, 'edit-person') ? 'editor' : 'member';
    const reply: ChatRow = {
      id: id(), role: 'assistant', at: Date.now(),
      body: JSON.stringify({ text, ...(kept.length && { proposals: kept }), ...(turn.sources.length && { sources: turn.sources }), tier, continuation: { note } }),
    };
    await accounts().batch([
      q('INSERT INTO ai_chat (id, tree, user, conv, role, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)', reply.id, o.tree, o.user, conv, reply.role, reply.body, reply.at),
      ...toldStatements(state.untold, first.claimItem),
    ]);
    return { items: [toItem(reply)] };
  } catch (err) {
    await release().catch(() => {});
    throw err;
  }
}
