// CK3-style event notices: a title, a line, a portrait, and one optional action. They leave on their own.
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

let toasts: Toast[] = [];
let next = 1;
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());

export function toast(t: Omit<Toast, 'id'>) {
  const id = next++;
  toasts = [...toasts.slice(-2), { ...t, id }];
  emit();
  setTimeout(() => dismiss(id), t.ms ?? 5000);
}
export function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}
export function useToasts(): Toast[] {
  return useSyncExternalStore((l) => (subs.add(l), () => subs.delete(l)), () => toasts, () => toasts);
}
