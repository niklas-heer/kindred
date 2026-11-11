// What this browser tab has in focus, for presence: the person selected on the tree (set by the tree page, which knows its
// default as well as the address does) and the person whose Edit tab is open ("Anna is editing Carl", set by the person
// panel). Read by the presence host; nothing else. Only ids: what is being typed never leaves the form.
import { useSyncExternalStore } from 'react';

const state = { selected: null as string | null, editing: null as string | null };
const listeners = new Set<() => void>();
const set = (k: keyof typeof state, id: string | null) => {
  if (state[k] === id) return;
  state[k] = id;
  listeners.forEach((l) => l());
};
const use = (k: keyof typeof state) => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state[k], () => null);

export const setEditingPerson = (id: string | null) => set('editing', id);
export const useEditingPerson = () => use('editing');
export const setSelectedPerson = (id: string | null) => set('selected', id);
export const useSelectedPerson = () => use('selected');
