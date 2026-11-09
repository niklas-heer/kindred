// Whether the assistant drawer and the "Set up AI" panel are open, shared by the buttons, the ⌘K palette and
// the hosts. Also the AI status hook: what the UI may show (a feature is listed only when it is on and configured).
import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { aiStatusQuery } from '~/lib/ai.functions';

/** Sent when the assistant is asked for while it is already open. */
export const ASSISTANT_FOCUS = 'kindred:assistant-focus';

const STATE_KEY = 'kindred:assistant-state';

/** Whether the window was open or minimized when the page went away. A phone's sheet is not reopened over the page. */
function remembered(): { open: boolean; minimized: boolean } {
  try {
    if (typeof window === 'undefined' || window.matchMedia('(max-width: 640px)').matches) return { open: false, minimized: false };
    const v = JSON.parse(window.localStorage.getItem(STATE_KEY) ?? '{}') as { open?: unknown; minimized?: unknown };
    return { open: v.open === true, minimized: v.open === true && v.minimized === true };
  } catch {
    return { open: false, minimized: false };
  }
}

const initial = remembered();
let open = initial.open;
let minimized = initial.minimized;
let setupOpen = false;
/** The reader has just asked for the window, so the box should take the focus. A window restored by a reload leaves it alone. */
let wantsFocus = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
function remember() {
  try { window.localStorage.setItem(STATE_KEY, JSON.stringify({ open, minimized })); } catch { /* not remembered, but it still works */ }
}

/** Opens the assistant drawer. The ⌘K palette's "Ask the assistant" calls this. */
export function openAssistant() {
  if (!open || minimized) {
    open = true;
    minimized = false;
    wantsFocus = true;
    remember();
    emit();
  } else if (typeof window !== 'undefined') {
    // It is a window now, and may be sitting behind what the reader is doing: asking again goes back to it.
    window.dispatchEvent(new Event(ASSISTANT_FOCUS));
  }
}

export function closeAssistant() {
  if (open) {
    open = false;
    minimized = false;
    remember();
    emit();
  }
}

/** Shrinks the window to a bar. Replies keep running, and the window comes back at the same size and place. */
export function minimizeAssistant() {
  if (open && !minimized) {
    minimized = true;
    remember();
    emit();
  }
}

/** Whether the window should take the focus as it opens. Forgotten once the opening is over (React's Strict Mode runs the window's effect twice). */
export function takeFocusRequest(): boolean {
  if (wantsFocus) setTimeout(() => { wantsFocus = false; }, 0);
  return wantsFocus;
}

export function useAssistantOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open && !minimized, () => false);
}

export function useAssistantMinimized(): boolean {
  return useSyncExternalStore(subscribe, () => open && minimized, () => false);
}

/** Opens the "Set up AI" panel (stewards, while the family has no AI key). */
export function openAiSetup() {
  if (!setupOpen) {
    setupOpen = true;
    emit();
  }
}

export function closeAiSetup() {
  if (setupOpen) {
    setupOpen = false;
    emit();
  }
}

export function useAiSetupOpen(): boolean {
  return useSyncExternalStore(subscribe, () => setupOpen, () => false);
}

/** The family's AI status, or undefined while it loads (the UI shows nothing AI-related until then). */
export function useAiStatus(tree: string) {
  return useQuery(aiStatusQuery(tree)).data;
}
