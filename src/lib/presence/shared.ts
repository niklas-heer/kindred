// What live presence ("2 here now") may contain, for the browser and the server alike. A page is one of the names below,
// never an address, a search or anything typed; a focus is a person's id and nothing else. Pages that are a reader's own
// business (Contacts, Access, the settings, Statistics, the assistant) all read as `elsewhere`, and carry no focus.
import { routeName } from '../stats/shared.ts';

export const PRESENCE_ROUTES = [
  'today', 'tree', 'person', 'almanac', 'atlas', 'register', 'houses', 'house', 'needed', 'chronicle', 'gallery',
  'research', 'research-project', 'campaign', 'history', 'elsewhere',
] as const;
export type PresenceRoute = (typeof PRESENCE_ROUTES)[number];

/** The pages a focus (a selected person) may be shared from. */
export const FOCUS_ROUTES: readonly PresenceRoute[] = ['tree', 'person'];

/** A visible tab beats this often. */
export const BEAT_MS = 15_000;
/** And asks who else is here this often. */
export const POLL_MS = 5_000;
/** A row not renewed for this long is gone: every read ignores it. */
export const EXPIRY_MS = 45_000;
/** A change of page or focus is sent after this pause, so clicking through the tree sends one beat, not ten. */
export const DEBOUNCE_MS = 1_000;

export const TAB = /^[A-Za-z0-9-]{8,40}$/;

/** The page a path shows, as presence names it. Anything after the section's name stays in the browser. */
export function presenceRoute(pathname: string, tree: string): PresenceRoute | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== tree) return null;
  switch (parts[1]) {
    case 'today': return 'today';
    case 'person': return parts[2] ? 'person' : 'elsewhere';
    case 'campaign': return 'campaign';
    case 'history': return 'history';
    case 'contacts': case 'access': case 'settings': return 'elsewhere';
  }
  const name = routeName(pathname, tree);
  return name && (PRESENCE_ROUTES as readonly string[]).includes(name) ? (name as PresenceRoute) : 'elsewhere';
}

/** The person a page has in focus: a profile's person, or the tree's selected (else centred) card. */
export function presenceFocus(pathname: string, search: { sel?: unknown; focus?: unknown }, tree: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== tree) return null;
  if (parts[1] === 'person' && parts[2]) return decodeURIComponent(parts[2]);
  if (parts.length === 1) {
    const id = typeof search.sel === 'string' && search.sel ? search.sel : typeof search.focus === 'string' && search.focus ? search.focus : null;
    return id;
  }
  return null;
}

/** A calm, steady colour for one account: the same on every screen, so Anna's halo is always Anna's. */
export function hueOf(account: string): number {
  let h = 0;
  for (let i = 0; i < account.length; i++) h = (h * 31 + account.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** Someone else in the family right now. `focus` and `editing` are empty unless both they and the reader share them. */
export interface Present {
  account: string;
  name: string;
  /** Their own person in the tree, for their face; null when they have not said who they are. */
  person: string | null;
  route: PresenceRoute;
  focus: string | null;
  editing: boolean;
  seen: number;
  hue: number;
}

/** The last member here before now, from their visits ("Last here: Anna, 2 h ago"). */
export interface LastHere { name: string; person: string | null; at: number }

export interface Roster {
  /** False in a demo, in a "View as" preview and for anyone who is not a member: nothing was written and nothing is shown. */
  on: boolean;
  here: Present[];
  /** Whether the reader shares their focus, and so sees others'. */
  sharing: boolean;
  last: LastHere | null;
}

export const OFF: Roster = { on: false, here: [], sharing: false, last: null };
