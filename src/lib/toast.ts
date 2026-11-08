// CK3-style event notices: a title, a line, a portrait, and one optional action. A notice without an action
// leaves on its own, but waits while the reader hovers or focuses it. A notice with an action (Undo) stays
// until it is dismissed or its action runs: an Undo must not vanish while someone is deciding.
import { useSyncExternalStore } from 'react';

export interface Toast {
  id: number;
  title: string;
  body?: string;
  person?: string;
  icon?: 'cake-slice' | 'linked-rings' | 'candle-light' | 'quill-ink' | 'crown';
  action?: { label: string; run: () => void };
  ms?: number;
}

/** Most notices on screen at once. Past this, the oldest one without an action goes. */
const MAX = 4;
const DEFAULT_MS = 5000;
/** After a hover or focus ends, a notice stays at least this long, so it can be read. */
const MIN_LEFT_MS = 2500;

let toasts: Toast[] = [];
let next = 1;
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());

interface Clock { handle?: ReturnType<typeof setTimeout>; left: number; since: number; paused: boolean }
const clocks = new Map<number, Clock>();

export function toast(t: Omit<Toast, 'id'>) {
  const id = next++;
  toasts = [...toasts, { ...t, id }];
  while (toasts.length > MAX) {
    const old = toasts.find((x) => !x.action);
    if (!old) break;
    clearClock(old.id);
    toasts = toasts.filter((x) => x.id !== old.id);
  }
  if (!t.action) startClock(id, t.ms ?? DEFAULT_MS);
  emit();
}

function startClock(id: number, left: number) {
  const c: Clock = { left, since: Date.now(), paused: false };
  c.handle = setTimeout(() => dismiss(id), left);
  clocks.set(id, c);
}

function clearClock(id: number) {
  const c = clocks.get(id);
  if (c?.handle) clearTimeout(c.handle);
  clocks.delete(id);
}

/** The reader is on this notice (hover or focus): it stays where it is. */
export function pauseToast(id: number) {
  const c = clocks.get(id);
  if (!c || c.paused) return;
  if (c.handle) clearTimeout(c.handle);
  c.left -= Date.now() - c.since;
  c.paused = true;
}

/** The reader has left it: the time it has left runs again. */
export function resumeToast(id: number) {
  const c = clocks.get(id);
  if (!c || !c.paused) return;
  c.paused = false;
  c.since = Date.now();
  c.handle = setTimeout(() => dismiss(id), Math.max(c.left, MIN_LEFT_MS));
}

export function dismiss(id: number) {
  clearClock(id);
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function useToasts(): Toast[] {
  return useSyncExternalStore((l) => (subs.add(l), () => subs.delete(l)), () => toasts, () => toasts);
}
