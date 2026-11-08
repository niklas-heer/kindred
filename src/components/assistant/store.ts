// Whether the assistant drawer and the "Set up AI" panel are open, shared by the buttons, the ⌘K palette and
// the hosts. Also the AI status hook: what the UI may show (a feature is listed only when it is on and configured).
import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { aiStatusQuery } from '~/lib/ai.functions';

/** Sent when the assistant is asked for while it is already open. */
export const ASSISTANT_FOCUS = 'kindred:assistant-focus';

let open = false;
let setupOpen = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Opens the assistant drawer. The ⌘K palette's "Ask the assistant" calls this. */
export function openAssistant() {
  if (!open) {
    open = true;
    emit();
  } else if (typeof window !== 'undefined') {
    // It is a window now, and may be sitting behind what the reader is doing: asking again goes back to it.
    window.dispatchEvent(new Event(ASSISTANT_FOCUS));
  }
}

export function closeAssistant() {
  if (open) {
    open = false;
    emit();
  }
}

export function useAssistantOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open, () => false);
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
