// Which chats are open as tabs in the assistant's window, what was being written in each, and where each was scrolled to.
// Kept per family in this browser, so all of it comes back after a reload. The state and its changes are pure, so the rules
// can be tested alone; the store around them only remembers and tells React. Closing a tab never touches the chat itself.

export const MAX_TABS = 8;
/** Drafts are kept for chats that are not open too, up to this many, the oldest dropped first. */
export const MAX_DRAFTS = 40;

export interface ScrollSpot { y: number; atEnd: boolean }
export interface TabsState {
  tabs: string[];
  active: string | null;
  /** The list of chats beside the thread is showing. */
  listOpen: boolean;
  drafts: Record<string, { text: string; at: number }>;
  scroll: Record<string, ScrollSpot>;
}

export const EMPTY_TABS: TabsState = { tabs: [], active: null, listOpen: false, drafts: {}, scroll: {} };

const isId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);

/** What was remembered, or nothing when it is not what this code wrote: it may be old, cut off, or edited by hand. */
export function parseTabs(raw: string | null): TabsState {
  if (!raw) return EMPTY_TABS;
  try {
    const v = JSON.parse(raw) as Partial<TabsState>;
    const tabs = [...new Set((Array.isArray(v.tabs) ? v.tabs : []).filter(isId))].slice(0, MAX_TABS);
    const drafts: TabsState['drafts'] = {};
    for (const [conv, d] of Object.entries(v.drafts ?? {})) if (isId(conv) && typeof d?.text === 'string' && d.text && typeof d.at === 'number') drafts[conv] = { text: d.text, at: d.at };
    const scroll: TabsState['scroll'] = {};
    for (const [conv, s] of Object.entries(v.scroll ?? {})) if (isId(conv) && typeof s?.y === 'number' && Number.isFinite(s.y)) scroll[conv] = { y: s.y, atEnd: s.atEnd === true };
    return { tabs, active: isId(v.active) && tabs.includes(v.active) ? v.active : (tabs[0] ?? null), listOpen: v.listOpen === true, drafts, scroll };
  } catch {
    return EMPTY_TABS;
  }
}

/** Opens a chat in a tab and brings it to the front. With every tab taken, the one opened first makes way, unless a reply is running in it; null when all are running. */
export function openTab(s: TabsState, conv: string, running: (c: string) => boolean = () => false): TabsState | null {
  if (s.tabs.includes(conv)) return { ...s, active: conv };
  if (s.tabs.length < MAX_TABS) return { ...s, tabs: [...s.tabs, conv], active: conv };
  const out = s.tabs.find((c) => c !== s.active && !running(c)) ?? (running(s.active ?? '') ? undefined : s.active ?? undefined);
  if (!out) return null;
  return { ...s, tabs: s.tabs.map((c) => (c === out ? conv : c)), active: conv };
}

/** Closes a tab, and the one next to it comes forward. */
export function closeTab(s: TabsState, conv: string): TabsState {
  const at = s.tabs.indexOf(conv);
  if (at < 0) return s;
  const tabs = s.tabs.filter((c) => c !== conv);
  const active = s.active === conv ? (tabs[at] ?? tabs[at - 1] ?? null) : s.active;
  return { ...s, tabs, active };
}

/** A chat that no longer exists: its tab, draft and place go too. */
export function forgetChat(s: TabsState, conv: string): TabsState {
  const { [conv]: _d, ...drafts } = s.drafts;
  const { [conv]: _s, ...scroll } = s.scroll;
  return { ...closeTab(s, conv), drafts, scroll };
}

export function withDraft(s: TabsState, conv: string, text: string, now: number): TabsState {
  const drafts = { ...s.drafts };
  if (text) drafts[conv] = { text, at: now };
  else delete drafts[conv];
  const keys = Object.keys(drafts);
  if (keys.length > MAX_DRAFTS) {
    for (const k of keys.sort((a, b) => drafts[a].at - drafts[b].at).slice(0, keys.length - MAX_DRAFTS)) if (k !== conv) delete drafts[k];
  }
  return { ...s, drafts };
}

// ---------- the store: one per family, in this browser ----------

const key = (tree: string) => `kindred:assistant-tabs:${tree}`;
interface Entry { state: TabsState; subs: Set<() => void>; timer: ReturnType<typeof setTimeout> | null }
const entries = new Map<string, Entry>();

function entry(tree: string): Entry {
  let e = entries.get(tree);
  if (!e) {
    let raw: string | null = null;
    try { raw = typeof window === 'undefined' ? null : window.localStorage.getItem(key(tree)); } catch { /* starts empty */ }
    e = { state: parseTabs(raw), subs: new Set(), timer: null };
    entries.set(tree, e);
  }
  return e;
}

function flush(tree: string, e: Entry) {
  if (e.timer) clearTimeout(e.timer);
  e.timer = null;
  try { window.localStorage.setItem(key(tree), JSON.stringify(e.state)); } catch { /* not remembered, but it still works */ }
}

function persist(tree: string, e: Entry) {
  if (!e.timer) e.timer = setTimeout(() => flush(tree, e), 150);
}

if (typeof window !== 'undefined') {
  // A reload in the middle of a sentence keeps the sentence.
  window.addEventListener('pagehide', () => { for (const [tree, e] of entries) flush(tree, e); });
}

export const getTabs = (tree: string): TabsState => entry(tree).state;

/** Changes the state. Quiet writes (a scroll position) are remembered without drawing anything again. */
export function updateTabs(tree: string, change: (s: TabsState) => TabsState, quiet = false) {
  const e = entry(tree);
  const next = change(e.state);
  if (next === e.state) return;
  e.state = next;
  persist(tree, e);
  if (!quiet) e.subs.forEach((l) => l());
}

export function subscribeTabs(tree: string, l: () => void) {
  const e = entry(tree);
  e.subs.add(l);
  return () => { e.subs.delete(l); };
}
