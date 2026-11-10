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
// A share-link guest's browser also reports its active time and the people it opened, for a request to join
// (src/lib/auth/join.server.ts). A member's never does: their reports name no person.
let guestMode = false;
let activeSeconds = 0;
let people: string[] = [];
let lastInput = 0;
const ACTIVE_TICK = 15;
/** Time counts as active while the page is visible and the reader did something in the last two minutes. */
const IDLE_MS = 120_000;

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
  if (!visitPending && !Object.keys(views).length && !Object.keys(events).length && !activeSeconds && !people.length) return;
  const batch: StatsBatch & { active?: number; people?: string[] } = { tree, visit: visitPending, views, events };
  if (guestMode) {
    if (activeSeconds) batch.active = activeSeconds;
    if (people.length) batch.people = people;
  }
  views = {};
  events = {};
  visitPending = false;
  activeSeconds = 0;
  people = [];
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

/** The person a page shows: a profile (/<family>/person/<id>) or the tree's selected card (?sel=<id>). */
function personOn(pathname: string, sel: unknown, family: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== family) return null;
  if (parts[1] === 'person' && parts[2]) return decodeURIComponent(parts[2]);
  return parts.length === 1 && typeof sel === 'string' && sel ? sel : null;
}

/**
 * Reports this family's page views for as long as the reader is in it. Used once, by the family's layout. `guest` is a share-link
 * guest: their browser also counts its active time and the people it opened (the server keeps those only where a request to
 * join is possible).
 */
export function useStatsBeacon(family: string, guest = false) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const sel = useRouterState({ select: (s) => (s.location.search as { sel?: unknown }).sel });

  useEffect(() => {
    if (!guest || refused()) return;
    guestMode = true;
    lastInput = Date.now();
    const input = () => { lastInput = Date.now(); };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    for (const e of events) window.addEventListener(e, input, { passive: true });
    const tick = setInterval(() => {
      if (document.visibilityState !== 'visible' || Date.now() - lastInput > IDLE_MS) return;
      activeSeconds += ACTIVE_TICK;
      schedule();
    }, ACTIVE_TICK * 1000);
    return () => {
      clearInterval(tick);
      for (const e of events) window.removeEventListener(e, input);
      guestMode = false;
    };
  }, [guest, family]);

  useEffect(() => {
    try {
      if (!guest || refused()) return;
      const id = personOn(pathname, sel, family);
      if (!id || people.includes(id) || people.length >= 10) return;
      people.push(id);
      schedule();
    } catch {}
  }, [guest, pathname, sel, family]);

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
