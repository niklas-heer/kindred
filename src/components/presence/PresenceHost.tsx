// Live presence in the browser: this tab's heartbeat and the roster of who else is in the family (src/lib/presence/).
// A visible tab beats every BEAT_MS and at once (after DEBOUNCE_MS) when its page or focus changes, asks who else is here
// every POLL_MS, and says it has gone when it is hidden or closed. Members only: a guest, a demo and a "View as" preview
// send nothing and see nothing. Only a page name and, with "Show me to others" on, a person's id are ever sent.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePref } from '~/lib/prefs';
import { presenceBeat, presenceQuery } from '~/lib/presence/presence.functions';
import { BEAT_MS, DEBOUNCE_MS, POLL_MS, presenceFocus, presenceRoute, type PresenceRoute, type Roster } from '~/lib/presence/shared';
import { useMember, useSession } from '~/lib/session';
import { useEditingPerson, useSelectedPerson } from './editing';

/** The setting behind "Show me to others" (on unless switched off), kept in this browser. */
export const SHADOWS_PREF = 'presence-shadows';
export const useSharesShadows = () => usePref(SHADOWS_PREF) !== 'off';

interface Presence { roster: Roster | undefined; route: PresenceRoute | null }
const Ctx = createContext<Presence>({ roster: undefined, route: null });
export const usePresence = () => useContext(Ctx);

function tabId(): string {
  try {
    const saved = sessionStorage.getItem('kindred:presence-tab');
    if (saved) return saved;
    const id = crypto.randomUUID();
    sessionStorage.setItem('kindred:presence-tab', id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

const visible = () => typeof document !== 'undefined' && document.visibilityState === 'visible';

export function PresenceHost({ tree, children }: { tree: string; children: ReactNode }) {
  const session = useSession();
  const member = useMember(tree);
  const on = !!member && !session?.demo && !session?.viewAs;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.search as { sel?: unknown; focus?: unknown } });
  const route = presenceRoute(pathname, tree);
  const shadows = useSharesShadows();
  const editingId = useEditingPerson();
  const selected = useSelectedPerson();
  // On the tree, the card it shows selected (its default included); on a profile, its person.
  const focus = !shadows ? null : route === 'tree' ? (selected ?? presenceFocus(pathname, search, tree)) : route === 'person' ? presenceFocus(pathname, search, tree) : null;
  const editing = !!focus && editingId === focus;
  const qc = useQueryClient();
  const [shown, setShown] = useState(true);

  const roster = useQuery({
    ...presenceQuery(tree),
    enabled: on,
    refetchInterval: shown ? POLL_MS : false,
    refetchIntervalInBackground: false,
    retry: false,
  });

  // What the next beat says, read by the timer without restarting it.
  const state = useRef({ route, focus, editing, shadows });
  state.current = { route, focus, editing, shadows };
  const tab = useRef<string | null>(null);

  useEffect(() => {
    if (!on) return;
    tab.current ??= tabId();
    let stopped = false;
    const send = () => {
      const s = state.current;
      if (stopped || !visible() || !s.route) return;
      presenceBeat({ data: { tree, tab: tab.current!, route: s.route, focus: s.focus, editing: s.editing, shadows: s.shadows } })
        .then((r) => { if (!stopped) qc.setQueryData(presenceQuery(tree).queryKey, r); })
        .catch(() => {});
    };
    const gone = () => {
      try {
        const body = JSON.stringify({ tree, tab: tab.current });
        if (!navigator.sendBeacon?.('/api/presence', new Blob([body], { type: 'application/json' }))) {
          void fetch('/api/presence', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } }).catch(() => {});
        }
      } catch {}
    };
    const seen = () => {
      setShown(visible());
      if (visible()) send(); else gone();
    };
    send();
    const timer = setInterval(send, BEAT_MS);
    document.addEventListener('visibilitychange', seen);
    window.addEventListener('pagehide', gone);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', seen);
      window.removeEventListener('pagehide', gone);
      gone();
    };
  }, [on, tree, qc]);

  // A new page or focus is said soon, but once: clicking through ten cards sends one beat.
  const first = useRef(true);
  useEffect(() => {
    if (!on) return;
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => {
      const s = state.current;
      if (!visible() || !s.route || !tab.current) return;
      presenceBeat({ data: { tree, tab: tab.current, route: s.route, focus: s.focus, editing: s.editing, shadows: s.shadows } })
        .then((r) => qc.setQueryData(presenceQuery(tree).queryKey, r))
        .catch(() => {});
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [on, tree, route, focus, editing, shadows, qc]);

  const value = useMemo(() => ({ roster: on && roster.data?.on ? roster.data : undefined, route }), [on, roster.data, route]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
