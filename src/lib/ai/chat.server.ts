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
import { AiError, type AiMessage, type ImagePart } from './adapters';
import { checkChatImages } from './chat-images';
import { CONTINUATION_SYSTEM, continuationNote, decisionState, dropRepeats, LEASE_MS, type DecisionOutcome, type StoredCard, type Untold } from './continuation';
import { latestAnswers, mayRead, modelForTurn, parse, readableRows, readableTurns, requireThread, threadExists, tierForRole, toItem, toTurn, touchThread, type ChatRow, type ModelOverride, type ModelUsed } from './conversations.server';
import { blocksNote } from './blocks.server';
import type { ChatBlock } from './blocks';
import { tr } from './labels';
import { systemPrompt } from './prompt';
import { adapterForFeature } from './settings.server';
import { claimTurn, type TurnLease } from './turn-lease.server';
import type { TurnSink } from './chat-stream.server';
import { runTool, toolsFor, type Ctx } from './tools.server';
import { toAiLocale, type AiLocale, type ChatItem, type Proposal } from './types';

const HISTORY = 12;
const MAX_STEPS = 5;
const id = () => crypto.randomUUID();

/** The id of the reply to a message whose id the browser chose, so a repeated request finds the turn it already stored. */
const replyIdFor = (turnId: string) => `${turnId}-r`;

/** Ends a turn whose reader has stopped or left, or that has run past its limit, before anything more is spent. */
function throwIfEnded(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw (signal.reason as Error | undefined)?.name === 'TimeoutError' ? new AiError('timeout', 'ai.errTurnTimeout') : new AiError('aborted', 'ai.stopped');
}

/** Runs one turn holding its chat. A chat has one running turn at a time, whoever asks; other chats are not held up. */
async function holdingChat<T>(conv: string, run: (lease: TurnLease) => Promise<T>): Promise<T> {
  const lease = await claimTurn(conv);
  if (!lease) throw new AiError('busy', 'ai.errTurnBusy');
  try {
    return await run(lease);
  } finally {
    await lease.release().catch(() => {});
  }
}

export { loadChat, loadChatImage, mayRead } from './conversations.server';

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
export async function markProposal(tree: string, user: string, role: Role, conv: string, itemId: string, proposalId: string, status: 'done' | 'dismissed' | 'failed', outcome?: DecisionOutcome): Promise<{ due: boolean }> {
  await requireThread(tree, user, conv);
  const row = await accounts().get<ChatRow>('SELECT id, role, body, at FROM ai_chat WHERE id = ? AND tree = ? AND user = ? AND conv = ?', itemId, tree, user, conv);
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
  return { due: decisionState(await readableTurns(tree, user, conv, role), Date.now()).due };
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

/** The conversation so far, as the model reads it: up to `before` (a turn's time) when a question is asked again. */
async function historyFor(tree: string, user: string, conv: string, role: Role, before?: number): Promise<AiMessage[]> {
  const recent = await accounts().all<ChatRow>(`SELECT id, role, body, at FROM ai_chat WHERE tree = ? AND user = ? AND conv = ?${before === undefined ? '' : ' AND at < ?'} ORDER BY at DESC, rowid DESC LIMIT ?`, ...[tree, user, conv, ...(before === undefined ? [] : [before]), HISTORY * 4]);
  // A question asked again has one answer in the model's history: the newest, in the first answer's place.
  return latestAnswers(recent.filter((r) => mayRead(parse(r), role)).reverse())
    .slice(-HISTORY)
    .flatMap((r): AiMessage[] => {
      const b = parse(r);
      // A continuation has no message from the reader. What it was told goes back in that place, so the turns still alternate.
      if (b.continuation) return [{ role: 'user', text: b.continuation.note }, { role: 'assistant', text: b.text }];
      // A family session's transcript is long and was already drafted: the model sees a note of it, not the whole talk.
      if (r.role === 'user' && b.session) return [{ role: 'user', text: `[A family session was drafted here: ${b.text.split('\n').length} lines.]` }];
      // A picture is sent once. Later turns are told it was there, and work from the reply that read it.
      const pictures = r.role === 'user' && b.images ? `[The reader attached ${b.images.count} picture(s) here. They are not shown again.]` : '';
      // The model is reminded what it asked and showed; a widget's contents are not sent again.
      return [r.role === 'user' ? { role: 'user', text: [b.text, pictures].filter(Boolean).join('\n') } : { role: 'assistant', text: [b.text, blocksNote(b.blocks)].filter(Boolean).join('\n') }];
    });
}

/** One turn of the model: it may call read tools and propose changes, and ends when it answers in plain text. Every call goes through the family's route, role and budget. */
async function modelTurn(o: {
  tree: string; role: Role; me: string | null; locale: AiLocale; past: AiMessage[]; text: string;
  session?: boolean; attached?: ImagePart[]; continuation?: boolean;
  /** The reader's account: whose own research is whose. */
  user?: string;
  /** What the reader is looking at. A person id that is not in this family is ignored. */
  page?: { path: string; personId?: string } | null;
  /** A steward's choice of model for this turn, already checked (conversations.server.ts). */
  modelOverride?: ModelOverride | null;
  /** Where the reply goes as it is written. Without it the turn runs to the end and only its result counts. */
  sink?: TurnSink;
  lease?: TurnLease;
}): Promise<{ text: string; proposals: Proposal[]; blocks: ChatBlock[]; sources: { url: string; title?: string }[]; model: ModelUsed }> {
  const attached = o.attached ?? [];
  const { adapter, webSearch, settings } = await adapterForFeature(o.tree, 'assistant', o.locale, 'assistant', o.modelOverride);
  const faces = settings.features.faces;
  const avatar = settings.features.avatar;
  const g = await graph(o.tree);
  const me = o.me && o.me !== '-' ? g.people.find((p) => p.id === o.me) : undefined;
  const { tools, proposals: canPropose } = toolsFor(o.role, { web: webSearch, faces, avatar });
  const viewing = o.page?.personId ? g.people.find((p) => p.id === o.page!.personId) : undefined;
  const base = systemPrompt({
    locale: o.locale, family: g.tree.name, tree: o.tree, readerName: me ? fullName(me) : null, readerId: me?.id ?? null, kinToReader: null, canPropose, role: o.role, webSearch,
    faces, avatar, session: o.session, pictures: attached.length,
    page: o.page ? { path: o.page.path, ...(viewing && { personId: viewing.id, personName: fullName(viewing) }) } : null,
  });
  const system = o.continuation ? `${base}\n${CONTINUATION_SYSTEM}` : base;
  // The sources of the web lookups this turn ran. The chat's own requests never search: a lookup is its own request.
  const sources: { url: string; title?: string }[] = [];
  const images: ImagePart[] = [];
  const blocks: ChatBlock[] = [];
  const ctx: Ctx = { tree: o.tree, role: o.role, me: me?.id ?? null, user: o.user, blocks, session: o.session, pictures: attached.length > 0, locale: o.locale, faces, avatar, images, search: webSearch ? { adapter, sources, lookups: 0 } : undefined };
  const messages: AiMessage[] = [...o.past, { role: 'user', text: o.text, ...(attached.length && { images: attached }) }];
  const proposals: Proposal[] = [];
  let text = '';
  // A family draft's reply carries a whole set of people in one tool call, so it may run longer than a chat answer.
  const maxTokens = o.session || attached.length ? 4000 : 1200;
  for (let step = 0; ; step++) {
    // Each call is booked against the family's budget by the adapter, so a loop cannot outspend it.
    throwIfEnded(o.sink?.signal);
    await o.lease?.beat();
    const onDelta = o.sink && ((piece: string) => {
      o.sink!.emit({ type: 'delta', text: piece });
      void o.lease?.beat().catch(() => {});
    });
    const reply = await adapter.complete({ system, messages, tools, maxTokens, timeoutMs: 60_000, ...(onDelta && { onDelta, signal: o.sink!.signal }) });
    if (!reply.calls.length || step >= MAX_STEPS) {
      text = reply.text.trim();
      break;
    }
    // Only the last step's text is the answer: what was written before these calls is cleared from the screen, as it is from the stored reply.
    o.sink?.emit({ type: 'step', tools: reply.calls.map((c) => c.name) });
    // The reply's reasoning blocks go back with its calls, unchanged: OpenRouter needs them to continue a reasoning model's tool turn.
    messages.push({ role: 'assistant', text: reply.text, calls: reply.calls, ...(reply.reasoningDetails && { reasoningDetails: reply.reasoningDetails }) });
    for (const call of reply.calls) {
      throwIfEnded(o.sink?.signal);
      await o.lease?.beat();
      messages.push({ role: 'tool', callId: call.id, content: await runTool(ctx, call.name, call.args, proposals) });
    }
    // Pictures a tool asked for (describe_photo) go to the model as the next message, after its tool results.
    if (images.length) messages.push({ role: 'user', text: 'Here is the picture you asked to look at.', images: images.splice(0) });
  }
  return { text, proposals, blocks, sources, model: { provider: adapter.provider, model: adapter.model } };
}

interface SendInput {
  tree: string; user: string; role: Role; me: string | null; text: string; locale: string;
  /** The browser's id for this message, kept across a retry: a repeated request finds the turn already stored instead of paying again. */
  turnId?: string;
  sink?: TurnSink;
  /** The chat this message goes in. It must be this reader's. */
  conv: string;
  /** What the reader is looking at as they send it. */
  page?: { path: string; personId?: string } | null;
  /** A steward's choice of model for this one message. Refused from anyone else. Without it, the chat's own choice applies. */
  modelOverride?: { provider: string; model: string } | null;
  /** A family session: the text is a transcript, and the reply drafts the family from it (see prompt.ts). */
  session?: boolean;
  /** The person speaking in a family session (an id in the tree), who "my" and "I" mean. */
  speaker?: string | null;
  /** Pictures attached to this message. They go to the provider once and are not stored unless `keepImages` is set. */
  images?: readonly { base64: string }[];
  keepImages?: boolean;
}

/**
 * One message from the reader, and the assistant's reply to it. Nothing is stored unless the turn completes, so a reply that
 * is stopped, or whose connection drops, leaves the chat as it was and the message can simply be sent again.
 */
export async function sendMessage(o: SendInput): Promise<{ items: ChatItem[] }> {
  if (o.turnId) {
    const stored = await accounts().all<ChatRow>('SELECT id, role, body, at FROM ai_chat WHERE id IN (?, ?) AND tree = ? AND user = ? AND conv = ? ORDER BY at, rowid', o.turnId, replyIdFor(o.turnId), o.tree, o.user, o.conv);
    if (stored.length) return { items: stored.filter((r) => mayRead(parse(r), o.role)).map((r) => toItem(r, o.role)) };
  }
  return holdingChat(o.conv, (lease) => runMessage(o, lease));
}

async function runMessage(o: SendInput, lease: TurnLease): Promise<{ items: ChatItem[] }> {
  // A session costs far more than a message and can only end in a draft. Refused before anything is spent for a role that could not apply one.
  // Pictures have the same rule, and the same reason.
  if ((o.session || o.images?.length) && !can(o.role, 'add-person')) throw new Error('ai.famRefused');
  const attached = checkChatImages(o.images ?? []);
  if (!o.text.trim() && !attached.length) throw new Error('ai.err_empty_message');
  const locale: AiLocale = toAiLocale(o.locale);
  const c = tr(locale);
  const conv = o.conv;
  const thread = await requireThread(o.tree, o.user, conv);
  const modelOverride = await modelForTurn(o.tree, o.role, thread, o.modelOverride);
  const started = Date.now();
  const past = await historyFor(o.tree, o.user, conv, o.role);
  // Decisions no reply has been told about go with this message, so the reader who writes first does not get a continuation as well.
  const decided = o.session ? [] : decisionState(await readableTurns(o.tree, o.user, conv, o.role), started).untold;
  const said = o.text || 'See the attached pictures.';
  // In a family session the speaker is who "I" and "my" mean; otherwise it is the reader's own person.
  const turn = await modelTurn({
    user: o.user, page: o.page,
    tree: o.tree, role: o.role, me: o.session && o.speaker ? o.speaker : o.me, locale, past, session: o.session, attached, modelOverride, sink: o.sink, lease,
    text: decided.length ? `${continuationNote(decided)}\n\nThe reader then wrote:\n${said}` : said,
  });
  const { proposals, sources } = turn;
  const text = turn.text || (proposals.length || turn.blocks.length ? '' : c('ai.notRecorded'));

  const tier = tierForRole(o.role);
  const keep = o.keepImages ? attached.map((img) => ({ id: id(), img })) : [];
  const userRow: ChatRow = {
    id: o.turnId ?? id(), role: 'user', at: started,
    body: JSON.stringify({ text: o.text, tier, ...(o.session && { session: true }), ...(attached.length && { images: { count: attached.length, kept: keep.map((k) => k.id) } }) }),
  };
  const reply: ChatRow = {
    id: o.turnId ? replyIdFor(o.turnId) : id(), role: 'assistant', body: JSON.stringify({ text, ...(proposals.length && { proposals }), ...(turn.blocks.length && { blocks: turn.blocks }), ...(sources.length && { sources }), tier, model: turn.model }), at: Date.now(),
  };
  // Both turns or neither: a message is never stored without its answer, and a failed turn leaves nothing to resend.
  const insert = (r: ChatRow) => q('INSERT INTO ai_chat (id, tree, user, conv, role, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)', r.id, o.tree, o.user, conv, r.role, r.body, r.at);
  const keptRows = keep.map((k) => q('INSERT INTO ai_chat_image (id, item, tree, user, mime, data, at) VALUES (?, ?, ?, ?, ?, ?, ?)', k.id, userRow.id, o.tree, o.user, k.img.mime, k.img.base64, started));
  await accounts().batch([threadExists(o.tree, o.user, conv), insert(userRow), insert(reply), ...keptRows, ...toldStatements(decided), touchThread(o.tree, o.user, conv, reply.at)]);
  return { items: [toItem(userRow, o.role), toItem(reply, o.role)] };
}

/**
 * The assistant carries on after the reader's decisions, if any are due. Two tabs or two cards can ask at once, so the
 * newest decided turn is claimed first, and only the holder spends anything. If the model fails, the decisions stay
 * untold and the claim is let go, so the same continuation can be tried again; the approvals themselves are already saved.
 */
export async function continueAfterDecisions(o: ContinueInput): Promise<{ items: ChatItem[] }> {
  // A reply already running in this chat will be told, or the next one will. Nothing is due from this request.
  const lease = await claimTurn(o.conv);
  if (!lease) return { items: [] };
  try {
    return await runContinuation(o, lease);
  } finally {
    await lease.release().catch(() => {});
  }
}

interface ContinueInput { tree: string; user: string; role: Role; me: string | null; locale: string; conv: string; sink?: TurnSink }

async function runContinuation(o: ContinueInput, lease: TurnLease): Promise<{ items: ChatItem[] }> {
  const locale: AiLocale = toAiLocale(o.locale);
  const conv = o.conv;
  const thread = await requireThread(o.tree, o.user, conv);
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
    const modelOverride = await modelForTurn(o.tree, o.role, thread);
    const turn = await modelTurn({ user: o.user, tree: o.tree, role: o.role, me: o.me, locale, past: await historyFor(o.tree, o.user, conv, o.role), text: note, continuation: true, modelOverride, sink: o.sink, lease });
    // The loop guard: a card this conversation has already shown is not shown again, and if that was all it had, it stops here.
    const { kept, repeated } = dropRepeats(turn.proposals, turns);
    const onlyRepeats = repeated > 0 && kept.length === 0;
    const text = onlyRepeats || !turn.text ? (kept.length ? '' : tr(locale)('ai.continueStopped')) : turn.text;
    const tier = tierForRole(o.role);
    const reply: ChatRow = {
      id: id(), role: 'assistant', at: Date.now(),
      body: JSON.stringify({ text, ...(kept.length && { proposals: kept }), ...(turn.blocks.length && { blocks: turn.blocks }), ...(turn.sources.length && { sources: turn.sources }), tier, continuation: { note }, model: turn.model }),
    };
    await accounts().batch([
      threadExists(o.tree, o.user, conv),
      q('INSERT INTO ai_chat (id, tree, user, conv, role, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)', reply.id, o.tree, o.user, conv, reply.role, reply.body, reply.at),
      ...toldStatements(state.untold, first.claimItem),
      touchThread(o.tree, o.user, conv, reply.at),
    ]);
    return { items: [toItem(reply, o.role)] };
  } catch (err) {
    await release().catch(() => {});
    throw err;
  }
}

/**
 * "Try with a stronger model", for stewards: the same question goes to another model, and its answer is kept beside the
 * first. No new message from the reader is stored, so the model's history has the question once. Read tools may run again
 * and that changes nothing. Proposals are only cards: a card this chat has already shown, open or decided, is not shown a
 * second time, so one change cannot be approved twice, and a different card simply joins the others for the reader to decide.
 */
export async function retryWithModel(o: RetryInput): Promise<{ items: ChatItem[] }> {
  return holdingChat(o.conv, (lease) => runRetry(o, lease));
}

interface RetryInput { tree: string; user: string; role: Role; me: string | null; locale: string; conv: string; itemId: string; modelOverride: { provider: string; model: string } }

async function runRetry(o: RetryInput, lease: TurnLease): Promise<{ items: ChatItem[] }> {
  const locale: AiLocale = toAiLocale(o.locale);
  const thread = await requireThread(o.tree, o.user, o.conv);
  const modelOverride = await modelForTurn(o.tree, o.role, thread, o.modelOverride);
  const rows = await readableRows(o.tree, o.user, o.conv, o.role);
  const target = rows.find((r) => r.id === o.itemId && r.role === 'assistant');
  if (!target) throw new Error('ai.err_no_chat');
  const baseId = parse(target).alternateOf ?? target.id;
  const answered = rows.filter((r) => !parse(r).alternateOf);
  const at = answered.findIndex((r) => r.id === baseId);
  const question = answered[at - 1];
  const asked = question && parse(question);
  // A continuation answers no question; a family session or a picture cannot be sent again, because it was not kept.
  if (at < 1 || !asked || question.role !== 'user' || asked.session || asked.images || parse(answered[at]).continuation) throw new Error('ai.err_retry_turn');
  const past = await historyFor(o.tree, o.user, o.conv, o.role, question.at);
  const turn = await modelTurn({ user: o.user, tree: o.tree, role: o.role, me: o.me, locale, past, text: asked.text, modelOverride, lease });
  const { kept, repeated } = dropRepeats(turn.proposals, rows.map(toTurn));
  const text = turn.text || (repeated > 0 && !kept.length ? tr(locale)('ai.retrySameCards') : tr(locale)('ai.notRecorded'));
  const reply: ChatRow = {
    id: id(), role: 'assistant', at: Date.now(),
    body: JSON.stringify({ text, ...(kept.length && { proposals: kept }), ...(turn.blocks.length && { blocks: turn.blocks }), ...(turn.sources.length && { sources: turn.sources }), tier: tierForRole(o.role), model: turn.model, alternateOf: baseId }),
  };
  await accounts().batch([
    threadExists(o.tree, o.user, o.conv),
    q('INSERT INTO ai_chat (id, tree, user, conv, role, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)', reply.id, o.tree, o.user, o.conv, reply.role, reply.body, reply.at),
    touchThread(o.tree, o.user, o.conv, reply.at),
  ]);
  return { items: [toItem(reply, o.role)] };
}
