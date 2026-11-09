// A reader's chats in one family (accounts DB, ai_thread, with the messages in ai_chat). Every path into a chat names it,
// and the server checks here that it is this reader's and this family's. A chat one reader cannot reach looks exactly like
// a chat that does not exist.
//
// Each stored turn carries the tier it needed to be read: "editor" for a turn by a reader who can see private fields (its
// answers may quote them), "member" for any other. A reader only gets back the turns their role may read now, so a chat
// with nothing readable is not listed, and its title and search hits come only from turns they may read.
import { accounts, guard, q } from '../auth/store.server';
import { can, type Role } from '../roles';
import type { Query } from '../store/index.ts';
import { chatModelId, searchesOnItsOwn } from './adapters';
import { decisionState, type StoredCard, type Turn } from './continuation';
import { blendedPrice, costHint, type ModelChoice, type ModelChoices } from './model-choice';
import { listModels } from './models.server';
import { connectedProviders, keyFor, resolveRoute, validModel } from './providers.server';
import { RECOMMENDED } from './recommended';
import { foldText, snippetAround, threadTitle } from './thread-title';
import type { ChatBlock } from './blocks';
import { PROVIDERS, type ChatItem, type Provider, type ThreadSummary } from './types';

export type Tier = 'member' | 'editor';
export interface ModelUsed { provider: string; model: string }
export interface Body {
  text: string; proposals?: StoredCard[]; tier?: Tier; sources?: { url: string; title?: string }[]; session?: boolean; images?: { count: number; kept: string[] };
  /** A reply nobody asked for in words: what it was told about the reader's decisions, which the model reads back in place of a message. */
  continuation?: { note: string };
  /** A continuation is running from this turn: when it started, and whose it is. */
  continuing?: string;
  /** Which model wrote this reply. Shown to stewards only. */
  model?: ModelUsed;
  /** This reply's question and widgets (ai/blocks.ts). */
  blocks?: ChatBlock[];
  /** A second answer to the same question, from another model: the reply it stands beside. */
  alternateOf?: string;
}
export interface ChatRow { id: string; role: 'user' | 'assistant'; body: string; at: number }
export interface Thread { tree: string; user: string; conv: string; title: string; title_tier: Tier; provider: string | null; model: string | null; created: number; updated: number }

export const parse = (r: Pick<ChatRow, 'body'>): Body => JSON.parse(r.body) as Body;
/** Turns stored before tiers were kept count as editor turns: a demoted reader does not get them back. */
const tierOf = (b: { tier?: string | null }): Tier => (b.tier === 'member' ? 'member' : 'editor');
export const tierForRole = (role: Role): Tier => (can(role, 'edit-person') ? 'editor' : 'member');

/** Whether a reader whose role is `role` may read a stored turn now. */
export const mayRead = (b: { tier?: string | null }, role: Role): boolean => tierOf(b) === 'member' || can(role, 'edit-person');
export const isSteward = (role: Role): boolean => can(role, 'manage-access');

const id = () => crypto.randomUUID();
const NO_CHAT = 'ai.err_no_chat';
/** An empty chat that was opened and never written in is cleared away after this long. */
const EMPTY_KEPT_MS = 7 * 86_400_000;

// ---------- which chat, and whose ----------

/** A fresh chat for this reader. Chats only ever come from here, so an id the server did not hand this reader is refused everywhere. */
export async function newThread(tree: string, user: string): Promise<string> {
  const conv = id();
  const now = Date.now();
  await accounts().batch([
    q('DELETE FROM ai_thread WHERE tree = ? AND user = ? AND updated < ? AND NOT EXISTS (SELECT 1 FROM ai_chat c WHERE c.tree = ai_thread.tree AND c.user = ai_thread.user AND c.conv = ai_thread.conv)', tree, user, now - EMPTY_KEPT_MS),
    q('INSERT INTO ai_thread (tree, user, conv, created, updated) VALUES (?, ?, ?, ?, ?)', tree, user, conv, now, now),
  ]);
  return conv;
}

/** The chat, if it is this reader's in this family. Throws otherwise, the same way whether it is someone else's or never existed. */
export async function requireThread(tree: string, user: string, conv: string): Promise<Thread> {
  const t = await accounts().get<Thread>('SELECT tree, user, conv, title, title_tier, provider, model, created, updated FROM ai_thread WHERE tree = ? AND user = ? AND conv = ?', tree, user, conv);
  if (!t) throw new Error(NO_CHAT);
  return t;
}

/** Goes first in a batch that stores turns: a chat deleted while its reply was on the way stores nothing. */
export const threadExists = (tree: string, user: string, conv: string): Query =>
  guard('EXISTS (SELECT 1 FROM ai_thread WHERE tree = ? AND user = ? AND conv = ?)', tree, user, conv);

/** Moves the chat to the top of the list. Goes in the batch with the turns. */
export const touchThread = (tree: string, user: string, conv: string, at: number): Query =>
  q('UPDATE ai_thread SET updated = ? WHERE tree = ? AND user = ? AND conv = ?', at, tree, user, conv);

// ---------- a chat's turns ----------

/** A second answer sits right after the reply it stands beside, whenever it was asked for. One whose original is gone is not shown. */
export function withAlternates<R extends ChatRow>(rows: R[]): R[] {
  const ids = new Set(rows.map((r) => r.id));
  const beside = new Map<string, R[]>();
  const base: R[] = [];
  for (const r of rows) {
    const of = parse(r).alternateOf;
    if (!of) base.push(r);
    else if (ids.has(of)) beside.set(of, [...(beside.get(of) ?? []), r]);
  }
  return base.flatMap((r) => [r, ...(beside.get(r.id) ?? [])]);
}

/** One answer per question, as the model reads it back: the newest of a reply and its second answers, in the reply's place. */
export function latestAnswers<R extends ChatRow>(rows: R[]): R[] {
  const out: R[] = [];
  for (const r of withAlternates(rows)) {
    if (parse(r).alternateOf) out[out.length - 1] = r;
    else out.push(r);
  }
  return out;
}

export const toItem = (r: ChatRow, role: Role): ChatItem => {
  const b = parse(r);
  return {
    id: r.id, role: r.role, text: b.text, at: r.at,
    ...(b.session && { session: true }), ...(b.images && { images: b.images }), ...(b.proposals?.length && { proposals: b.proposals }), ...(b.sources?.length && { sources: b.sources }), ...(b.blocks?.length && { blocks: b.blocks }),
    ...(b.continuation && { continuation: true }), ...(b.alternateOf && { alternateOf: b.alternateOf }),
    // Which model wrote it is the steward's business, and it stays on the server for anyone else.
    ...(b.model && isSteward(role) && { model: b.model }),
  };
};

export const toTurn = (r: ChatRow): Turn => {
  const b = parse(r);
  return { id: r.id, role: r.role, proposals: b.proposals, continuation: !!b.continuation, continuing: b.continuing };
};

async function storedRows(tree: string, user: string, conv: string): Promise<ChatRow[]> {
  return accounts().all<ChatRow>('SELECT id, role, body, at FROM ai_chat WHERE tree = ? AND user = ? AND conv = ? ORDER BY at, rowid', tree, user, conv);
}

/** The turns this reader may read in this chat, oldest first, as the continuation rules see them. */
export async function readableTurns(tree: string, user: string, conv: string, role: Role): Promise<Turn[]> {
  return withAlternates((await storedRows(tree, user, conv)).filter((r) => mayRead(parse(r), role))).map(toTurn);
}

/** This reader's rows in the chat that they may read now, oldest first. */
export async function readableRows(tree: string, user: string, conv: string, role: Role): Promise<ChatRow[]> {
  return withAlternates((await storedRows(tree, user, conv)).filter((r) => mayRead(parse(r), role)));
}

/** One chat, oldest first, without the turns the reader's role may no longer read. `continueDue` is a continuation still owed. */
export async function loadChat(tree: string, user: string, role: Role, conv: string): Promise<{ items: ChatItem[]; continueDue: boolean; override: { provider: string; model: string } | null }> {
  const thread = await requireThread(tree, user, conv);
  const readable = await readableRows(tree, user, conv, role);
  return {
    items: readable.map((r) => toItem(r, role)),
    continueDue: decisionState(readable.map(toTurn), Date.now()).due,
    override: isSteward(role) && thread.provider && thread.model ? { provider: thread.provider, model: thread.model } : null,
  };
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

// ---------- the list ----------

interface ListRow { conv: string; role: string; at: number; tier: string | null; text: string | null; session: number | null; pictures: number | null }

const listRows = (tree: string, user: string, chars: number) =>
  accounts().all<ListRow>(
    `SELECT conv, role, at, json_extract(body, '$.tier') AS tier, substr(json_extract(body, '$.text'), 1, ${chars}) AS text,
       json_extract(body, '$.session') AS session, json_extract(body, '$.images.count') AS pictures
     FROM ai_chat WHERE tree = ? AND user = ? ORDER BY at, rowid`,
    tree, user,
  );

const threadsOf = (tree: string, user: string) => accounts().all<Thread>('SELECT tree, user, conv, title, title_tier, provider, model, created, updated FROM ai_thread WHERE tree = ? AND user = ? ORDER BY updated DESC, rowid DESC', tree, user);

function summarize(t: Thread, rows: ListRow[], role: Role): ThreadSummary {
  const own = t.title && mayRead({ tier: t.title_tier }, role) ? t.title : '';
  const first = rows.find((r) => r.role === 'user');
  const derived = first?.text ? threadTitle(first.text) : '';
  const session = !!first?.session;
  return {
    conv: t.conv, updated: t.updated, created: t.created, title: own || (session ? '' : derived), renamed: !!own,
    ...(!own && (session || !derived) && { untitled: session ? ('session' as const) : first?.pictures ? ('pictures' as const) : ('chat' as const) }),
  };
}

/** Every chat this reader has something to read in, newest first, with a name from the first message they may read. */
export async function listThreads(tree: string, user: string, role: Role): Promise<ThreadSummary[]> {
  const [threads, rows] = await Promise.all([threadsOf(tree, user), listRows(tree, user, 400)]);
  const byConv = new Map<string, ListRow[]>();
  for (const r of rows) if (mayRead(r, role)) byConv.set(r.conv, [...(byConv.get(r.conv) ?? []), r]);
  return threads.flatMap((t) => {
    const readable = byConv.get(t.conv);
    return readable?.length ? [summarize(t, readable, role)] : [];
  });
}

const SNIPPET_SCAN = 20_000;

/** Chats whose title or text holds the words, ignoring case and accents. Only what this reader may read is searched or quoted. */
export async function searchThreads(tree: string, user: string, role: Role, query: string): Promise<(ThreadSummary & { snippet?: string })[]> {
  const needle = foldText(query.trim());
  if (!needle) return [];
  const [threads, rows] = await Promise.all([threadsOf(tree, user), listRows(tree, user, SNIPPET_SCAN)]);
  const byConv = new Map<string, ListRow[]>();
  for (const r of rows) if (mayRead(r, role)) byConv.set(r.conv, [...(byConv.get(r.conv) ?? []), r]);
  return threads.flatMap((t) => {
    const readable = byConv.get(t.conv);
    if (!readable?.length) return [];
    const summary = summarize(t, readable, role);
    if (foldText(summary.title).includes(needle)) return [summary];
    for (const r of readable) {
      if (!r.text) continue;
      const at = foldText(r.text).indexOf(needle);
      if (at >= 0) return [{ ...summary, snippet: snippetAround(r.text, at, needle.length) }];
    }
    return [];
  });
}

// ---------- changing a chat ----------

export const TITLE_MAX = 80;

/** A name the reader chose, or an empty one to go back to the first message. It needs the tier of whoever gave it. */
export async function renameThread(tree: string, user: string, role: Role, conv: string, title: string): Promise<void> {
  await requireThread(tree, user, conv);
  const name = title.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
  await accounts().run('UPDATE ai_thread SET title = ?, title_tier = ? WHERE tree = ? AND user = ? AND conv = ?', name, tierForRole(role), tree, user, conv);
}

/** Deletes the chat, every message in it, and the pictures kept with them. Other chats are not touched. */
export async function deleteThread(tree: string, user: string, conv: string): Promise<void> {
  await requireThread(tree, user, conv);
  await accounts().batch([
    q('DELETE FROM ai_chat_image WHERE tree = ? AND user = ? AND item IN (SELECT id FROM ai_chat WHERE tree = ? AND user = ? AND conv = ?)', tree, user, tree, user, conv),
    q('DELETE FROM ai_chat WHERE tree = ? AND user = ? AND conv = ?', tree, user, conv),
    q('DELETE FROM ai_thread WHERE tree = ? AND user = ? AND conv = ?', tree, user, conv),
  ]);
}

// ---------- a steward's choice of model ----------

export interface ModelOverride { provider: Provider; model: string }

/** A choice of model, checked: stewards only, a provider this family has connected, and a model that can be used. */
export async function checkOverride(tree: string, role: Role, want: { provider: string; model: string }): Promise<ModelOverride> {
  if (!isSteward(role)) throw new Error('ai.err_model_steward');
  const provider = want.provider as Provider;
  if (!(PROVIDERS as readonly string[]).includes(provider) || !(await connectedProviders(tree)).has(provider)) throw new Error('ai.err_provider_not_connected');
  const model = chatModelId(provider, want.model.trim());
  if (!model || !validModel(model)) throw new Error('ai.err_model_chars');
  if (searchesOnItsOwn(provider, model)) throw new Error('ai.err_model_search');
  return { provider, model };
}

/**
 * The model this turn uses, or null for the family's own. A choice made for this one message is checked and refused
 * outright for anyone but a steward. The chat's stored choice applies only while its reader is a steward and its provider
 * is still connected; otherwise the turn quietly goes the family's way.
 */
export async function modelForTurn(tree: string, role: Role, thread: Thread, requested?: { provider: string; model: string } | null): Promise<ModelOverride | null> {
  if (requested) return checkOverride(tree, role, requested);
  if (!isSteward(role) || !thread.provider || !thread.model) return null;
  return checkOverride(tree, role, { provider: thread.provider, model: thread.model }).catch(() => null);
}

/** Stores a steward's choice on the chat, or clears it with null. */
export async function setThreadModel(tree: string, user: string, role: Role, conv: string, want: { provider: string; model: string } | null): Promise<void> {
  if (!isSteward(role)) throw new Error('ai.err_model_steward');
  await requireThread(tree, user, conv);
  const pick = want ? await checkOverride(tree, role, want) : null;
  await accounts().run('UPDATE ai_thread SET provider = ?, model = ? WHERE tree = ? AND user = ? AND conv = ?', pick?.provider ?? null, pick?.model ?? null, tree, user, conv);
}

/** What the picker offers: the connected providers' models with a plain cost hint. A list that cannot be read still offers Kindred's picks. */
export async function modelChoices(tree: string, role: Role): Promise<ModelChoices> {
  if (!isSteward(role)) throw new Error('ai.err_model_steward');
  const [connected, assistant] = await Promise.all([connectedProviders(tree), resolveRoute(tree, 'assistant')]);
  const unavailable: Provider[] = [];
  const models: ModelChoice[] = [];
  for (const provider of PROVIDERS) {
    if (!connected.has(provider)) continue;
    const picks = new Set(RECOMMENDED.filter((r) => r.provider === provider).map((r) => r.model));
    try {
      const listed = await listModels(provider, await keyFor(tree, provider));
      for (const m of listed.models) {
        if (m.tools === false || searchesOnItsOwn(provider, m.id)) continue;
        const blended = blendedPrice(m.inPerM, m.outPerM);
        models.push({ provider, id: m.id, name: m.name, cost: costHint(blended), recommended: picks.has(m.id), blended });
      }
    } catch {
      unavailable.push(provider);
      for (const model of picks) models.push({ provider, id: model, name: model, cost: '', recommended: true, blended: null });
    }
  }
  return { familyDefault: assistant.effective, models, unavailable };
}
