// Small persisted preferences (localStorage), readable from any component.
import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
const read = (k: string) => (typeof localStorage === 'undefined' ? null : localStorage.getItem(`kindred:${k}`));
export function setPref(k: string, v: string | null) {
  if (v === null) localStorage.removeItem(`kindred:${k}`);
  else localStorage.setItem(`kindred:${k}`, v);
  listeners.forEach((l) => l());
}
export function usePref(k: string): string | null {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => read(k),
    () => null,
  );
}

export type Theme = 'codex' | 'modern' | 'night';
export const THEMES: { id: Theme; label: string }[] = [
  { id: 'codex', label: 'Codex' },
  { id: 'modern', label: 'Paper' },
  { id: 'night', label: 'Night' },
];
