// The guided tour's script and the rules that shape it for one reader. No React and no DOM here, so the tests load it
// directly. Tour.tsx walks these steps on the real pages.
import type { Key } from '../../lib/i18n/dictionary.ts';
import { can, type Action, type Role } from '../../lib/roles.ts';

/** Where a step happens. `$house` is filled with the family's first house. */
export const TOUR_ROUTES = {
  tree: '/$tree',
  almanac: '/$tree/almanac',
  atlas: '/$tree/atlas',
  contacts: '/$tree/contacts',
  register: '/$tree/people',
  houses: '/$tree/houses',
  house: '/$tree/house/$house',
  needed: '/$tree/needed',
  chronicle: '/$tree/chronicle',
  gallery: '/$tree/gallery',
  research: '/$tree/research',
  import: '/$tree/settings/import',
  access: '/$tree/access',
  ai: '/$tree/settings/ai',
} as const;

export type TourPage = keyof typeof TOUR_ROUTES;

export interface TourStep {
  id: string;
  /** The page to go to first. Absent: the step works wherever the reader is (the top bar, a welcome card). */
  page?: TourPage;
  /** What to spotlight: the first of these that is on screen. Absent: a card in the middle, with nothing to find. */
  targets?: readonly string[];
  title: Key;
  body: Key;
  /** Only for readers who may do this. */
  needs?: Action;
  /** Only when this is switched on for the family. */
  feature?: 'assistant';
  /** Only when the family has any of these. */
  requires?: 'people' | 'house';
  /** The person's panel must be open first. */
  prepare?: 'panel';
}

/** What the tour knows about this reader and family when it starts. */
export interface TourContext {
  role: Role;
  assistant: boolean;
  people: number;
  houses: number;
}

const PAGE_HEADER = '.ui-page-header';

export const TOUR_STEPS: readonly TourStep[] = [
  { id: 'welcome', title: 'tour.welcome.title', body: 'tour.welcome.body' },

  // The tree.
  { id: 'tree', page: 'tree', targets: ['.card.selected', '.canvas'], title: 'shell.tree', body: 'tour.tree.body', requires: 'people' },
  { id: 'views', page: 'tree', targets: ['.tree-toolbar'], title: 'tour.views.title', body: 'tour.views.body', requires: 'people' },
  { id: 'minimap', page: 'tree', targets: ['.minimap', '.map-toggle'], title: 'tour.minimap.title', body: 'tour.minimap.body', requires: 'people' },
  { id: 'add', page: 'tree', targets: ['.card.selected', '.canvas'], title: 'tour.add.title', body: 'tour.add.body', requires: 'people', needs: 'add-person' },
  { id: 'panel', page: 'tree', targets: ['.person-panel'], title: 'tour.panel.title', body: 'tour.panel.body', requires: 'people', prepare: 'panel' },
  { id: 'edit', page: 'tree', targets: ['.pp-tabs [role="tab"]:last-child'], title: 'panel.tab.edit', body: 'tour.edit.body', requires: 'people', needs: 'edit-person', prepare: 'panel' },

  // The top bar. On phones, language and theme are behind More.
  { id: 'find', targets: ['.search-trigger'], title: 'tour.find.title', body: 'tour.find.body' },
  { id: 'assistant', targets: ['.ai-launch:not(.ai-setup)', '.tabbar button'], title: 'tour.assistant.title', body: 'tour.assistant.body', feature: 'assistant' },
  { id: 'language', targets: ['.topbar-tools', '.tabbar button'], title: 'tour.language.title', body: 'tour.language.body' },

  // The other pages.
  { id: 'almanac', page: 'almanac', targets: ['.alm-strip-wrap', PAGE_HEADER], title: 'shell.almanac', body: 'tour.almanac.body' },
  { id: 'atlas', page: 'atlas', targets: ['.atlas-time', '.atlas-map'], title: 'shell.atlas', body: 'tour.atlas.body' },
  { id: 'contacts', page: 'contacts', targets: ['.con-tools', PAGE_HEADER], title: 'shell.contacts', body: 'tour.contacts.body' },
  { id: 'register', page: 'register', targets: ['.reg-tools', PAGE_HEADER], title: 'shell.register', body: 'tour.register.body' },
  { id: 'houses', page: 'houses', targets: ['.hs-grid', PAGE_HEADER], title: 'shell.houses', body: 'tour.houses.body' },
  { id: 'arms', page: 'house', targets: ['.hp-shield'], title: 'tour.arms.title', body: 'tour.arms.body', requires: 'house' },
  { id: 'needed', page: 'needed', targets: ['.needed-list', PAGE_HEADER], title: 'shell.needed', body: 'tour.needed.body' },
  { id: 'chronicle', page: 'chronicle', targets: ['.chr-bar', PAGE_HEADER], title: 'shell.chronicle', body: 'tour.chronicle.body' },
  { id: 'gallery', page: 'gallery', targets: [PAGE_HEADER], title: 'shell.gallery', body: 'tour.gallery.body' },
  { id: 'research', page: 'research', targets: [PAGE_HEADER], title: 'research.title', body: 'tour.research.body' },

  // Keeping the family's records, and running the family.
  { id: 'import', page: 'import', targets: [PAGE_HEADER], title: 'shell.importExport', body: 'tour.import.body', needs: 'edit-person' },
  { id: 'access', page: 'access', targets: ['.acc-list', PAGE_HEADER], title: 'shell.access', body: 'tour.access.body', needs: 'manage-access' },
  { id: 'ai', page: 'ai', targets: [PAGE_HEADER], title: 'shell.ai_settings', body: 'tour.ai.body', needs: 'manage-access' },

  { id: 'again', targets: ['.acct-trigger'], title: 'tour.again.title', body: 'tour.again.body' },
];

/** The steps this reader gets: what their role allows, and what this family has switched on and filled in. */
export function stepsFor(ctx: TourContext, steps: readonly TourStep[] = TOUR_STEPS): TourStep[] {
  return steps.filter((s) => {
    if (s.needs && !can(ctx.role, s.needs)) return false;
    if (s.feature === 'assistant' && !ctx.assistant) return false;
    if (s.requires === 'people' && ctx.people === 0) return false;
    if (s.requires === 'house' && ctx.houses === 0) return false;
    return true;
  });
}

/**
 * From `from`, the first step in direction `dir` that can be shown; -1 if none can. `tryStep` goes to a step and says
 * whether its element is there, so a step whose element is missing is passed over and the tour cannot get stuck on it.
 * Stops and returns -1 as soon as `cancelled` says the tour has been left.
 */
export async function findStep<S>(steps: readonly S[], from: number, dir: 1 | -1, tryStep: (step: S) => Promise<boolean>, cancelled: () => boolean = () => false): Promise<number> {
  for (let i = from; i >= 0 && i < steps.length; i += dir) {
    if (cancelled()) return -1;
    if (await tryStep(steps[i])) return cancelled() ? -1 : i;
  }
  return -1;
}

export interface Box { x: number; y: number; w: number; h: number }
export interface Point { left: number; top: number }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));

/** Up to this width the card spans the screen, docked to the end away from what it points at. */
export const PHONE_WIDTH = 600;

/**
 * Where the card goes: beside the spotlight on the first side with room (below, above, right, left), kept on screen.
 * With nothing to point at it sits in the middle. When no side has room (a target that fills the screen) it sits
 * low in the middle, over the target, so it can always be read.
 */
export function placeCard(target: Box | null, card: { w: number; h: number }, view: { w: number; h: number }, gap = 14, margin = 12): Point {
  const middleX = (view.w - card.w) / 2;
  if (!target) return { left: Math.round(middleX), top: Math.round((view.h - card.h) / 2) };
  if (view.w <= PHONE_WIDTH) {
    const above = target.y + target.h / 2 > view.h / 2;
    return { left: margin, top: Math.round(above ? margin : view.h - card.h - margin) };
  }
  const fitsX = (x: number) => x >= margin && x + card.w <= view.w - margin;
  const fitsY = (y: number) => y >= margin && y + card.h <= view.h - margin;
  const alongX = clamp(target.x + (target.w - card.w) / 2, margin, view.w - card.w - margin);
  const alongY = clamp(target.y + (target.h - card.h) / 2, margin, view.h - card.h - margin);
  const sides: Point[] = [
    { left: alongX, top: target.y + target.h + gap },
    { left: alongX, top: target.y - card.h - gap },
    { left: target.x + target.w + gap, top: alongY },
    { left: target.x - card.w - gap, top: alongY },
  ];
  const side = sides.find((p) => fitsX(p.left) && fitsY(p.top));
  const at = side ?? { left: middleX, top: view.h - card.h - margin * 3 };
  return { left: Math.round(at.left), top: Math.round(at.top) };
}
