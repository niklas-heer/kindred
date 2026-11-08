// The assistant: one reader's conversation in one family. Each turn is a short loop: the model may call
// read tools and propose changes; the loop ends when it answers in plain text. Messages are stored per
// reader per family (accounts DB, ai_chat); a proposal's status is stored with its reply.
import { graph } from '../db.server';
import { fullName } from '../graph';
import { accounts } from '../auth/store.server';
import type { Role } from '../roles';
import type { AiMessage } from './adapters';
import { tr } from './labels';
import { systemPrompt } from './prompt';
import { adapterForFeature, spend } from './settings.server';
import { runTool, toolsFor } from './tools.server';
import { toAiLocale, type AiLocale, type ChatItem, type Proposal } from './types';

const HISTORY = 12;
const MAX_STEPS = 5;
const id = () => crypto.randomUUID();

interface ChatRow { id: string; role: 'user' | 'assistant'; body: string; at: number }

/** The reader's current conversation in this family (created on first use). */
async function currentConv(tree: string, user: string): Promise<string> {
  const r = await accounts().get<{ conv: string }>('SELECT conv FROM ai_conversation WHERE tree = ? AND user = ?', tree, user);
  if (r) return r.conv;
  const conv = id();
  await accounts().run('INSERT OR IGNORE INTO ai_conversation (tree, user, conv, started) VALUES (?, ?, ?, ?)', tree, user, conv, Date.now());
  return (await accounts().get<{ conv: string }>('SELECT conv FROM ai_conversation WHERE tree = ? AND user = ?', tree, user))!.conv;
}

const toItem = (r: ChatRow): ChatItem => {
  const b = JSON.parse(r.body) as { text: string; proposals?: Proposal[] };
  return { id: r.id, role: r.role, text: b.text, ...(b.proposals?.length && { proposals: b.proposals }), at: r.at };
};

/** The reader's current conversation, oldest first. */
export async function loadChat(tree: string, user: string): Promise<{ items: ChatItem[] }> {
  const conv = await currentConv(tree, user);
  const rows = await accounts().all<ChatRow>('SELECT id, role, body, at FROM ai_chat WHERE tree = ? AND user = ? AND conv = ? ORDER BY at, rowid', tree, user, conv);
  return { items: rows.map(toItem) };
}

/** "New conversation": the next message starts a fresh one. Earlier ones stay stored, for the family's records. */
export async function newConversation(tree: string, user: string): Promise<void> {
  await accounts().run('INSERT INTO ai_conversation (tree, user, conv, started) VALUES (?, ?, ?, ?) ON CONFLICT(tree, user) DO UPDATE SET conv = excluded.conv, started = excluded.started', tree, user, id(), Date.now());
}

/** Records the reader's decision on a card (done or dismissed), so a reload shows it as settled. */
export async function markProposal(tree: string, user: string, itemId: string, proposalId: string, status: 'done' | 'dismissed'): Promise<void> {
  const row = await accounts().get<ChatRow>('SELECT id, role, body, at FROM ai_chat WHERE id = ? AND tree = ? AND user = ?', itemId, tree, user);
  if (!row) return;
  const b = JSON.parse(row.body) as { text: string; proposals?: Proposal[] };
  const p = b.proposals?.find((x) => x.id === proposalId);
  if (!p) return;
  p.status = status;
  await accounts().run('UPDATE ai_chat SET body = ? WHERE id = ?', JSON.stringify(b), itemId);
}

/** One message from the reader, and the assistant's reply to it. */
export async function sendMessage(o: { tree: string; user: string; role: Role; me: string | null; text: string; locale: string }): Promise<{ items: ChatItem[] }> {
  const locale: AiLocale = toAiLocale(o.locale);
  const c = tr(locale);
  const { adapter } = await adapterForFeature(o.tree, 'assistant', locale);
  const conv = await currentConv(o.tree, o.user);

  const history = await accounts().all<ChatRow>('SELECT id, role, body, at FROM ai_chat WHERE tree = ? AND user = ? AND conv = ? ORDER BY at DESC, rowid DESC LIMIT ?', o.tree, o.user, conv, HISTORY);
  const past: AiMessage[] = history.reverse().map((r) => {
    const b = JSON.parse(r.body) as { text: string };
    return r.role === 'user' ? { role: 'user', text: b.text } : { role: 'assistant', text: b.text };
  });

  const userRow = { id: id(), role: 'user' as const, body: JSON.stringify({ text: o.text }), at: Date.now() };
  await accounts().run('INSERT INTO ai_chat (id, tree, user, conv, role, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)', userRow.id, o.tree, o.user, conv, userRow.role, userRow.body, userRow.at);

  try {
    const g = await graph(o.tree);
    const me = o.me && o.me !== '-' ? g.people.find((p) => p.id === o.me) : undefined;
    const { tools, proposals: canPropose } = toolsFor(o.role);
    const system = systemPrompt({
      locale, family: g.tree.name, readerName: me ? fullName(me) : null, kinToReader: null, canPropose, role: o.role,
    });
    const ctx = { tree: o.tree, role: o.role, me: me?.id ?? null, locale };
    const messages: AiMessage[] = [...past, { role: 'user', text: o.text }];
    const proposals: Proposal[] = [];
    let text = '';
    for (let step = 0; ; step++) {
      const reply = await adapter.complete({ system, messages, tools, maxTokens: 1200, timeoutMs: 60_000 });
      await spend(o.tree, reply.tokens);
      if (!reply.calls.length || step >= MAX_STEPS) {
        text = reply.text.trim();
        break;
      }
      messages.push({ role: 'assistant', text: reply.text, calls: reply.calls });
      for (const call of reply.calls) {
        messages.push({ role: 'tool', callId: call.id, content: await runTool(ctx, call.name, call.args, proposals) });
      }
    }
    if (!text) text = proposals.length ? '' : c('ai.notRecorded');
    const body = JSON.stringify({ text, ...(proposals.length && { proposals }) });
    const reply: ChatRow = { id: id(), role: 'assistant', body, at: Date.now() };
    await accounts().run('INSERT INTO ai_chat (id, tree, user, conv, role, body, at) VALUES (?, ?, ?, ?, ?, ?, ?)', reply.id, o.tree, o.user, conv, reply.role, reply.body, reply.at);
    return { items: [toItem(userRow), toItem(reply)] };
  } catch (e) {
    // The reader's message is kept in the input to send again; it must not stay in the history without an answer.
    await accounts().run('DELETE FROM ai_chat WHERE id = ?', userRow.id);
    throw e;
  }
}
