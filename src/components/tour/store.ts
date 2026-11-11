// Which tour is running and whether the Tours dialog is open, shared by the ways to start one (the first-run offer,
// the account menu, More, the ⌘K palette) and the one place that draws them. What a reader has walked of the grand
// tour is kept in this browser, per family: a tour stores nothing with the family or the account.
import { useSyncExternalStore } from 'react';
import { setPref } from '~/lib/prefs';
import { NO_PROGRESS, readProgress, type GrandProgress, type TourId } from './steps';

/** The preference that says this browser has been offered a tour, whatever the answer was. */
export const TOUR_SEEN_PREF = 'tour';
/** The preference that holds a family's grand-tour progress. */
export const grandPref = (tree: string) => `tour.grand:${tree}`;

export interface Run {
  /** Tells one start from the next, so starting a tour from inside another begins afresh. */
  id: number;
  tour: TourId;
  /** The grand tour's chapter to open at; absent: from the start. */
  chapter?: string;
}

let run: Run | null = null;
let starts = 0;
let hub = false;
/** Where the walk has got to and where it began, kept here so a re-mount of the page around it resumes, never restarts. */
export const progress: { step: number; returnTo: string | null } = { step: -1, returnTo: null };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

/** Remembers that the tour needs no more offering. Storage can be unavailable in private browsing. */
export function markTourSeen() {
  try { setPref(TOUR_SEEN_PREF, 'seen'); } catch {}
}

export function startTour(tour: TourId = 'welcome', chapter?: string) {
  markTourSeen();
  hub = false;
  run = { id: ++starts, tour, chapter };
  progress.step = -1;
  progress.returnTo = null;
  emit();
}

export function endTour() {
  if (!run) return;
  run = null;
  emit();
}

/** Opens the Tours dialog: both tours, and how far the grand one has got. */
export function openTours() {
  markTourSeen();
  if (hub || run) return;
  hub = true;
  emit();
}

export function closeTours() {
  if (!hub) return;
  hub = false;
  emit();
}

/** For a page that opens something of its own on a first visit: it waits while a tour is showing that page. */
export const isTourRunning = () => !!run;

export function useTourRun(): Run | null {
  return useSyncExternalStore(subscribe, () => run, () => null);
}

export function useToursOpen(): boolean {
  return useSyncExternalStore(subscribe, () => hub, () => false);
}

export function loadGrand(tree: string): GrandProgress {
  try { return readProgress(localStorage.getItem(`kindred:${grandPref(tree)}`)); } catch { return NO_PROGRESS; }
}

export function saveGrand(tree: string, value: GrandProgress | null) {
  try { setPref(grandPref(tree), value ? JSON.stringify(value) : null); } catch {}
}
