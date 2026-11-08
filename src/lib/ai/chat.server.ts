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
import { tr } from './labels';
import { systemPrompt } from './prompt';
import { adapterForFeature } from './settings.server';
import { runTool, toolsFor, type Ctx } from './tools.server';
import { toAiLocale, type AiLocale, type ChatItem, type Proposal } from './types';

const HISTORY = 12;
const MAX_STEPS = 5;
const id = () => crypto.randomUUID();

type Tier = 'member' | 'editor';
interface Body { text: string; proposals?: Proposal[]; tier?: Tier; sources?: { url: string; title?: string }[]; session?: boolean }
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
  return { id: r.id, role: r.role, text: b.text, ...(b.session && { session: true }), ...(b.proposals?.length && { proposals: b.proposals }), ...(b.sources?.length && { sources: b.sources }), at: r.at };
};

/** The reader's current conversation, oldest first, without the turns their role may no longer read. */
export async function loadChat(tree: string, user: string, role: Role): Promise<{ items: ChatItem[] }> {
  const conv = await currentConv(tree, user);
  const rows = await accounts().all<ChatRow>('SELECT id, role, body, at FROM ai_chat WHERE tree = ? AND user = ? AND conv = ? ORDER BY at, rowid', tree, user, conv);
  return { items: rows.filter((r) => mayRead(parse(r), role)).map(toItem) };
}

/** "New conversation": the next message starts a fresh one. Earlier ones stay stored, for the family's records. */
export async function newConversation(tree: string, user: string): Promise<void> {
  await accounts().run('INSERT INTO ai_conversation (tree, user, conv, started) VALUES (?, ?, ?, ?) ON CONFLICT(tree, user) DO UPDATE SET conv = excluded.conv, started = excluded.started', tree, user, id(), Date.now());
}

/** Records the reader's decision on a card (done or dismissed), so a reload shows it as settled. */
export async function markProposal(tree: string, user: string, role: Role, itemId: string, proposalId: string, status: 'done' | 'dismissed'): Promise<void> {
  const row = await accounts().get<ChatRow>('SELECT id, role, body, at FROM ai_chat WHERE id = ? AND tree = ? AND user = ?', itemId, tree, user);
  if (!row || !mayRead(parse(row), role)) return;
  const b = parse(row);
  const p = b.proposals?.find((x) => x.id === proposalId);
  if (!p) return;
  p.status = status;
  await accounts().run('UPDATE ai_chat SET body = ? WHERE id = ?', JSON.stringify(b), itemId);
}

/** One message from the reader, and the assistant's reply to it. Nothing is stored unless the turn completes. */
export async function sendMessage(o: {
  tree: string; user: string; role: Role; me: string | null; text: string; locale: string;
  /** A family session: the text is a transcript, and the reply drafts the family from it (see prompt.ts). */
  session?: boolean;
  /** The person speaking in a family session (an id in the tree), who "my" and "I" mean. */
  speaker?: string | null;
}): Promise<{ items: ChatItem[] }> {
  const locale: AiLocale = toAiLocale(o.locale);
  const c = tr(locale);
  const { adapter, webSearch, settings } = await adapterForFeature(o.tree, 'assistant', locale);
  const faces = settings.features.faces;
  const avatar = settings.features.avatar;
  const conv = await currentConv(o.tree, o.user);
  const started = Date.now();

  const recent = await accounts().all<ChatRow>('SELECT id, role, body, at FROM ai_chat WHERE tree = ? AND user = ? AND conv = ? ORDER BY at DESC, rowid DESC LIMIT ?', o.tree, o.user, conv, HISTORY * 4);
  const past: AiMessage[] = recent
    .filter((r) => mayRead(parse(r), o.role))
    .slice(0, HISTORY)
    .reverse()
    .map((r) => {
      const b = parse(r);
      // A family session's transcript is long and was already drafted: the model sees a note of it, not the whole talk.
      if (r.role === 'user' && b.session) return { role: 'user', text: `[A family session was drafted here: ${b.text.split('\n').length} lines.]` };
      return r.role === 'user' ? { role: 'user', text: b.text } : { role: 'assistant', text: b.text };
    });

  const g = await graph(o.tree);
  // In a family session the speaker is who "I" and "my" mean; otherwise it is the reader's own person.
  const meId = o.session && o.speaker ? o.speaker : o.me;
  const me = meId && meId !== '-' ? g.people.find((p) => p.id === meId) : undefined;
  const { tools, proposals: canPropose } = toolsFor(o.role, { web: webSearch, faces, avatar });
  const system = systemPrompt({
    locale, family: g.tree.name, readerName: me ? fullName(me) : null, kinToReader: null, canPropose, role: o.role, webSearch,
    faces, avatar, session: o.session,
  });
  // The sources of the web lookups this turn ran. The chat's own requests never search: a lookup is its own request.
  const sources: { url: string; title?: string }[] = [];
  const images: ImagePart[] = [];
  const ctx: Ctx = { tree: o.tree, role: o.role, me: me?.id ?? null, locale, faces, avatar, images, search: webSearch ? { adapter, sources, lookups: 0 } : undefined };
  const messages: AiMessage[] = [...past, { role: 'user', text: o.text }];
  const proposals: Proposal[] = [];
  let text = '';
  // A family draft's reply carries a whole set of people in one tool call, so it may run longer than a chat answer.
  const maxTokens = o.session ? 4000 : 1200;
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
  if (!text) text = proposals.length ? '' : c('ai.notRecorded');

  const tier: Tier = can(o.role, 'edit-person') ? 'editor' : 'member';
  const userRow: ChatRow = { id: id(), role: 'user', body: JSON.stringify({ text: o.text, tier, ...(o.session && { session: true }) }), at: started };
  const reply: ChatRow = {
    id: id(), role: 'assistant', body: JSON.stringify({ text, ...(proposals.length && { proposals }), ...(sources.length && { sources }), tier }), at: Date.now(),
  };
  // Both turns or neither: a message is never stored without its answer, and a failed turn leaves nothing to resend.
  const insert = (r: ChatRow) => q('INSERT INTO ai_chat (id, tree, user, conv, role, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)', r.id, o.tree, o.user, conv, r.role, r.body, r.at);
  await accounts().batch([insert(userRow), insert(reply)]);
  return { items: [toItem(userRow), toItem(reply)] };
}
