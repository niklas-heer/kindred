// The guided tour's script and the rules that shape it for one reader. No React and no DOM here, so the tests load it
// directly. Tour.tsx walks these steps on the real pages.
import type { Key } from '../../lib/i18n/dictionary.ts';
import { can, type Action, type Role } from '../../lib/roles.ts';

/** Where a step happens. `$house` is filled with the family's first house, `$id` with the reader or the family's focus. */
export const TOUR_ROUTES = {
  tree: '/$tree',
  today: '/$tree/today',
  profile: '/$tree/person/$id',
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
  statistics: '/$tree/statistics',
  feedback: '/$tree/settings/feedback',
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
  /** Only for readers who may not do this: the reading version of a step whose other version is about writing. */
  lacks?: Action;
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

/**
 * The tour is short on purpose: what a relative who has just been invited needs on the first day. The tree, one person,
 * finding someone, where the family talks, where to add a memory, and where the birthdays are. Editors also see how a relative is added and
 * stewards how one is invited. The other pages have a line of their own under their titles; the last step says so.
 */
export const TOUR_STEPS: readonly TourStep[] = [
  { id: 'welcome', title: 'tour.welcome.title', body: 'tour.welcome.body' },
  { id: 'tree', page: 'tree', targets: ['.card.selected', '.canvas'], title: 'shell.tree', body: 'tour.tree.body', requires: 'people' },
  { id: 'views', page: 'tree', targets: ['.tree-toolbar'], title: 'tour.views.title', body: 'tour.views.body', requires: 'people' },
  { id: 'add', page: 'tree', targets: ['.card.selected', '.canvas'], title: 'tour.add.title', body: 'tour.add.body', requires: 'people', needs: 'add-person' },
  { id: 'panel', page: 'tree', targets: ['.person-panel'], title: 'tour.panel.title', body: 'tour.panel.body', requires: 'people', prepare: 'panel' },
  { id: 'find', targets: ['.search-trigger'], title: 'tour.find.title', body: 'tour.find.body' },
  // Today: where the family talks. The tour is a member's; a share-link guest has neither.
  { id: 'today', page: 'today', targets: ['.fd-compose', '.td-hero'], title: 'today.title', body: 'tour.today.body' },
  // The Chronicle: for anyone who may write, the step is about adding a memory; a viewer is shown where to read them.
  { id: 'memory', page: 'chronicle', targets: ['.ui-page-header-actions .btn', PAGE_HEADER], title: 'tour.memory.title', body: 'tour.memory.body', needs: 'add-story' },
  { id: 'chronicle', page: 'chronicle', targets: ['.chr-bar', PAGE_HEADER], title: 'shell.chronicle', body: 'tour.chronicle.body', lacks: 'add-story' },
  { id: 'almanac', page: 'almanac', targets: ['.alm-strip-wrap', PAGE_HEADER], title: 'shell.almanac', body: 'tour.almanac.body' },
  { id: 'access', page: 'access', targets: ['.ui-page-header-actions .btn', '.acc-list', PAGE_HEADER], title: 'shell.access', body: 'tour.access.body', needs: 'manage-access' },
  { id: 'again', targets: ['.acct-trigger'], title: 'tour.again.title', body: 'tour.again.body' },
];

/** The steps this reader gets: what their role allows, and what this family has switched on and filled in. */
export function stepsFor(ctx: TourContext, steps: readonly TourStep[] = TOUR_STEPS): TourStep[] {
  return steps.filter((s) => {
    if (s.needs && !can(ctx.role, s.needs)) return false;
    if (s.lacks && can(ctx.role, s.lacks)) return false;
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
