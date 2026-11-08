// Whether the assistant drawer is open, shared by the button, the ⌘K palette and the host. Also the
// AI status hook: what the UI may show (a feature is listed only when it is on and configured).
import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { aiStatusQuery } from '~/lib/ai.functions';

let open = false;
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

/** The family's AI status, or undefined while it loads (the UI shows nothing AI-related until then). */
export function useAiStatus(tree: string) {
  return useQuery(aiStatusQuery(tree)).data;
}
