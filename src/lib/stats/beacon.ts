// The browser's half of usage statistics: counts what happens, and sends it in one small report every so often and when the page
// is left. Nothing is sent under Do Not Track or Global Privacy Control, and nothing here can break or slow a page: every step is
// allowed to fail silently.
import { useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import { browserRefusesTracking, routeName, type EventName, type RouteName, type StatsBatch } from './shared';

const FLUSH_MS = 30_000;

let tree: string | null = null;
let views: Partial<Record<RouteName, number>> = {};
let events: Partial<Record<EventName, number>> = {};
let timer: ReturnType<typeof setTimeout> | null = null;
let visitPending = false;

function refused(): boolean {
  try {
    return browserRefusesTracking(navigator as Navigator & { globalPrivacyControl?: boolean }, window as unknown as { doNotTrack?: string | null });
  } catch { return true; }
}

function firstOfSession(family: string): boolean {
  try {
    const key = `kindred:stats-visit:${family}`;
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, '1');
    return true;
  } catch { return false; }
}

function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!tree) return;
  if (!visitPending && !Object.keys(views).length && !Object.keys(events).length) return;
  const batch: StatsBatch = { tree, visit: visitPending, views, events };
  views = {};
  events = {};
  visitPending = false;
  try {
    const body = JSON.stringify(batch);
    if (!navigator.sendBeacon?.('/api/stats', new Blob([body], { type: 'application/json' }))) {
      void fetch('/api/stats', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } }).catch(() => {});
    }
  } catch {}
}

function schedule() {
  if (!timer) timer = setTimeout(flush, FLUSH_MS);
}

/** Counts something a reader did in this family, such as finishing the tour. */
export function track(name: EventName) {
  try {
    if (!tree || refused()) return;
    events[name] = (events[name] ?? 0) + 1;
    schedule();
  } catch {}
}

/** Reports this family's page views for as long as the reader is in it. Used once, by the family's layout. */
export function useStatsBeacon(family: string) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (refused()) return;
    tree = family;
    if (firstOfSession(family)) { visitPending = true; schedule(); }
    const leave = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', leave);
    window.addEventListener('pagehide', flush);
    return () => {
      flush();
      tree = null;
      document.removeEventListener('visibilitychange', leave);
      window.removeEventListener('pagehide', flush);
    };
  }, [family]);

  useEffect(() => {
    try {
      if (refused()) return;
      const name = routeName(pathname, family);
      if (!name) return;
      views[name] = (views[name] ?? 0) + 1;
      schedule();
    } catch {}
  }, [pathname, family]);
}
