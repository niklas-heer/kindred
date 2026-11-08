// Whether the guided tour is running, shared by the ways to start it (the first-run offer, the account menu, the ⌘K
// palette) and the one place that draws it.
import { useSyncExternalStore } from 'react';
import { setPref } from '~/lib/prefs';

/** The preference that says this browser has been offered the tour, whatever the answer was. */
export const TOUR_SEEN_PREF = 'tour';

let running = false;
/** Where the walk has got to and where it began, kept here so a re-mount of the page around it resumes, never restarts. */
export const progress: { step: number; returnTo: string | null } = { step: 0, returnTo: null };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Remembers that the tour needs no more offering. Storage can be unavailable in private browsing. */
export function markTourSeen() {
  try { setPref(TOUR_SEEN_PREF, 'seen'); } catch {}
}

export function startTour() {
  markTourSeen();
  if (running) return;
  running = true;
  progress.step = 0;
  progress.returnTo = null;
  emit();
}

export function endTour() {
  if (!running) return;
  running = false;
  emit();
}

export function useTourRunning(): boolean {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => running, () => false);
}
