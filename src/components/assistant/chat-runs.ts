// What is happening in each chat, by chat: a reply on its way, what was sent, what failed. It lives outside the window on
// purpose. A reply keeps going while another tab is in front, while the window is minimized and after it is closed, and when
// it ends it lands in the chat it was asked in. Also which chats have a reply the reader has not seen, remembered in this browser.
import { useSyncExternalStore } from 'react';
import type { Attached } from './attachments';

/** A message that did not go: its text, why it failed, and the id Retry and Edit work from. */
export interface Unsent { id: string; text: string; error: string; images?: Attached[]; keep?: boolean }

export interface ChatRun {
  busy: boolean;
  /** The message on its way, shown until it is stored. */
  pending: string | null;
  pendingImages: Attached[];
  unsent: Unsent[];
  error: string | null;
  continueError: string | null;
  /** A decision came in while a reply was running: the assistant carries on when it ends. */
  wantContinue: boolean;
  /** Decisions that could not be recorded; Retry records them first. */
  unrecorded: (() => Promise<{ due: boolean }>)[];
  /** The reply as it streams in. The stream's own shape. */
  stream: unknown;
}

const IDLE: ChatRun = { busy: false, pending: null, pendingImages: [], unsent: [], error: null, continueError: null, wantContinue: false, unrecorded: [], stream: null };

const runs = new Map<string, ChatRun>();
const UNREAD_KEY = 'kindred:assistant-unread';
let unread = new Set<string>(loadUnread());
/** The chat the reader is looking at, or null while the window is closed or minimized. */
let front: string | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((l) => l());
const subscribe = (l: () => void) => { subs.add(l); return () => { subs.delete(l); }; };

function loadUnread(): string[] {
  try {
    const raw = typeof window === 'undefined' ? null : window.localStorage.getItem(UNREAD_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function saveUnread() {
  try { window.localStorage.setItem(UNREAD_KEY, JSON.stringify([...unread])); } catch { /* not remembered */ }
}

export const getRun = (conv: string): ChatRun => runs.get(conv) ?? IDLE;

export function patchRun(conv: string, patch: Partial<ChatRun> | ((r: ChatRun) => Partial<ChatRun>)) {
  const now = getRun(conv);
  runs.set(conv, { ...now, ...(typeof patch === 'function' ? patch(now) : patch) });
  summary = null;
  emit();
}

/** A run ended: the mark for a chat the reader is not looking at. */
export function finishRun(conv: string) {
  if (front === conv || unread.has(conv)) return;
  unread = new Set(unread).add(conv);
  saveUnread();
  summary = null;
  emit();
}

/** The reader is now looking at this chat (null: at none). A reply they have now seen is no longer unread. */
export function setFrontChat(conv: string | null) {
  front = conv;
  if (conv && unread.has(conv)) {
    unread = new Set(unread);
    unread.delete(conv);
    saveUnread();
    summary = null;
    emit();
  }
}

export function forgetRun(conv: string) {
  runs.delete(conv);
  if (unread.delete(conv)) saveUnread();
  summary = null;
  emit();
}

export interface RunSummary { busy: ReadonlySet<string>; unread: ReadonlySet<string> }
let summary: RunSummary | null = null;
const EMPTY: RunSummary = { busy: new Set(), unread: new Set() };
function getSummary(): RunSummary {
  if (!summary) summary = { busy: new Set([...runs].flatMap(([c, r]) => (r.busy ? [c] : []))), unread };
  return summary;
}

/** One chat's run. Draws again when anything changes in it. */
export const useRun = (conv: string | null): ChatRun => useSyncExternalStore(subscribe, () => (conv ? getRun(conv) : IDLE), () => IDLE);
/** Which chats are working and which have an unread reply, for tabs, the list and the minimized bar. */
export const useRunSummary = (): RunSummary => useSyncExternalStore(subscribe, getSummary, () => EMPTY);
