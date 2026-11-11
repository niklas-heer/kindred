// The guided tours' scripts and the rules that shape them for one reader. No React and no DOM here, so the tests load
// it directly. Tour.tsx walks these steps on the real pages; docs/tours.md lists them for people.
//
// Two tours: Welcome (a new relative's first minutes) and the grand tour (everything, in chapters that can be skipped
// and picked up again). A step points at elements by the names in their `data-tour` attributes, never by class.
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
  houses: '/$tree/houses',
  house: '/$tree/house/$house',
  chronicle: '/$tree/chronicle',
  cookbook: '/$tree/cookbook',
  gallery: '/$tree/gallery',
  whois: '/$tree/who-is-this',
  campaign: '/$tree/campaign',
  print: '/$tree/print',
  history: '/$tree/history',
  export: '/$tree/settings/import',
  access: '/$tree/access',
  games: '/$tree/settings/games',
} as const;

export type TourPage = keyof typeof TOUR_ROUTES;
export type TourId = 'welcome' | 'grand';

/**
 * Something the reader does themselves: the step waits for it, and "Show me" does it for them. While it waits the
 * page under the card can be used.
 */
export interface TourTask {
  /** Done when an element with this name is on the page. */
  until: string;
  /** Done only when that element is another one than at the start (someone else selected). */
  changed?: boolean;
  /** What "Show me" presses. */
  click: string;
  /** What is put away afterwards, so the next step finds a clean page: the ⌘K palette, or the same button pressed again. */
  tidy?: 'palette' | 'toggle';
  /** The line that asks for it. */
  ask: Key;
}

export interface TourStep {
  id: string;
  /** The page to go to first. Absent: the step works wherever the reader is (the top bar, a welcome card). */
  page?: TourPage;
  /** What to spotlight: the first of these `data-tour` names that is on screen. Absent: a card in the middle. */
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
  /** Pressed first when the targets are not there yet (the tab that holds them). */
  opener?: string;
  task?: TourTask;
  /** The grand tour's chapter this step belongs to; set by `scriptFor`. */
  chapter?: string;
}

export interface TourChapter {
  id: string;
  title: Key;
  steps: readonly TourStep[];
}

/** What the tour knows about this reader and family when it starts. */
export interface TourContext {
  role: Role;
  assistant: boolean;
  people: number;
  houses: number;
}

const HEADER = 'page-header';

const SELECT: TourTask = { until: 'tree-selected', changed: true, click: 'tree-card', ask: 'tour.tree.ask' };

/**
 * Welcome is short on purpose: what a relative who has just been invited needs on the first day. What this is, where
 * the family talks, finding someone, the tree, one person, where to add a memory, the birthdays, and where help is.
 * Stewards also see how a relative is invited. Everything else is the grand tour's.
 */
export const WELCOME_TOUR: readonly TourStep[] = [
  { id: 'welcome', title: 'tour.welcome.title', body: 'tour.welcome.body' },
  // Today: where the family talks. The tours are a member's; a share-link guest has neither.
  { id: 'today', page: 'today', targets: ['feed-compose', 'today-hero'], title: 'today.title', body: 'tour.today.body' },
  { id: 'find', targets: ['search'], title: 'tour.find.title', body: 'tour.find.body', task: { until: 'palette', click: 'search', tidy: 'palette', ask: 'tour.find.ask' } },
  { id: 'tree', page: 'tree', targets: ['tree-selected', 'tree-canvas'], title: 'shell.tree', body: 'tour.tree.body', requires: 'people', task: SELECT },
  { id: 'panel', page: 'tree', targets: ['person-panel'], title: 'tour.panel.title', body: 'tour.panel.body', requires: 'people', prepare: 'panel' },
  // The Chronicle: for anyone who may write, the step is about adding a memory; a viewer is shown where to read them.
  { id: 'memory', page: 'chronicle', targets: ['chronicle-add', HEADER], title: 'tour.memory.title', body: 'tour.memory.body', needs: 'add-story' },
  { id: 'chronicle', page: 'chronicle', targets: ['chronicle-bar', HEADER], title: 'shell.chronicle', body: 'tour.chronicle.body', lacks: 'add-story' },
  { id: 'almanac', page: 'almanac', targets: ['almanac-strip', HEADER], title: 'shell.almanac', body: 'tour.almanac.body' },
  { id: 'access', page: 'access', targets: ['access-invite', HEADER], title: 'shell.access', body: 'tour.access.body', needs: 'manage-access' },
  { id: 'help', targets: ['account-menu', 'more'], title: 'tour.help.title', body: 'tour.help.body' },
];

/**
 * The grand tour: every part of Kindred, a chapter each. A chapter whose steps all fall away for a reader (the
 * stewards' chapter, for everyone else) is left out by `chaptersFor`.
 */
export const GRAND_TOUR: readonly TourChapter[] = [
  { id: 'today', title: 'today.title', steps: [
    { id: 'g-intro', title: 'tour.g.intro.title', body: 'tour.g.intro.body' },
    { id: 'g-feed', page: 'today', targets: ['feed-compose', 'feed'], title: 'tour.g.feed.title', body: 'tour.g.feed.body' },
    { id: 'g-react', page: 'today', targets: ['feed-react'], title: 'tour.g.react.title', body: 'tour.g.react.body', task: { until: 'emoji-palette', click: 'feed-react', tidy: 'toggle', ask: 'tour.g.react.ask' } },
    { id: 'g-cards', page: 'today', targets: ['today-cards'], title: 'tour.g.cards.title', body: 'tour.g.cards.body' },
  ] },
  { id: 'tree', title: 'shell.tree', steps: [
    { id: 'g-select', page: 'tree', targets: ['tree-selected', 'tree-canvas'], title: 'tour.g.select.title', body: 'tour.tree.body', requires: 'people', task: SELECT },
    { id: 'g-views', page: 'tree', targets: ['tree-toolbar'], title: 'tour.views.title', body: 'tour.views.body', requires: 'people' },
    { id: 'g-minimap', page: 'tree', targets: ['tree-minimap'], title: 'tour.g.minimap.title', body: 'tour.g.minimap.body', requires: 'people' },
    { id: 'g-add', page: 'tree', targets: ['tree-selected', 'tree-canvas'], title: 'tour.add.title', body: 'tour.add.body', requires: 'people', needs: 'add-person' },
    { id: 'g-here', page: 'tree', targets: ['here-now', 'topbar'], title: 'tour.g.here.title', body: 'tour.g.here.body' },
  ] },
  { id: 'person', title: 'tour.g.person.chapter', steps: [
    { id: 'g-profile', page: 'profile', targets: ['person-head'], title: 'tour.panel.title', body: 'tour.g.profile.body', requires: 'people' },
    { id: 'g-everyday', page: 'profile', targets: ['person-tab-everyday'], title: 'tour.g.everyday.title', body: 'tour.g.everyday.body', requires: 'people', task: { until: 'person-everyday', click: 'person-tab-everyday', ask: 'tour.g.everyday.ask' } },
    { id: 'g-edit', page: 'profile', targets: ['person-tab-edit'], title: 'tour.g.edit.title', body: 'tour.g.edit.body', requires: 'people', needs: 'edit-person', task: { until: 'person-edit', click: 'person-tab-edit', ask: 'tour.g.edit.ask' } },
    { id: 'g-fields', page: 'profile', targets: ['person-edit'], opener: 'person-tab-edit', title: 'tour.g.fields.title', body: 'tour.g.fields.body', requires: 'people', needs: 'edit-person' },
    // Non-interactive: the address box when one is open, else the Edit tab it lives in, so no address is needed.
    { id: 'g-address', page: 'profile', targets: ['address-finder', 'person-edit'], opener: 'person-tab-edit', title: 'tour.g.address.title', body: 'tour.g.address.body', requires: 'people', needs: 'edit-person' },
    { id: 'g-life', page: 'profile', targets: ['life-editor'], opener: 'person-tab-edit', title: 'tour.g.life.title', body: 'tour.g.life.body', requires: 'people', needs: 'edit-person' },
    { id: 'g-look', page: 'profile', targets: ['person-appearance'], opener: 'person-tab-edit', title: 'tour.g.look.title', body: 'tour.g.look.body', requires: 'people', needs: 'edit-person' },
  ] },
  { id: 'chronicle', title: 'tour.g.chronicle.chapter', steps: [
    { id: 'g-chronicle', page: 'chronicle', targets: ['chronicle-bar', HEADER], title: 'shell.chronicle', body: 'tour.chronicle.body' },
    { id: 'g-memory', page: 'chronicle', targets: ['chronicle-add'], title: 'tour.memory.title', body: 'tour.memory.body', needs: 'add-story' },
    { id: 'g-cookbook', page: 'cookbook', targets: ['recipe-card', HEADER], title: 'recipes.book.title', body: 'tour.g.cookbook.body', task: { until: 'recipe', click: 'recipe-card', ask: 'tour.g.cookbook.ask' } },
    // No page of its own: it speaks about the recipe the step before opened, and is passed over when none was.
    { id: 'g-cook', targets: ['recipe-cook', 'recipe'], title: 'tour.g.cook.title', body: 'tour.g.cook.body' },
  ] },
  { id: 'pictures', title: 'tour.g.pictures.chapter', steps: [
    { id: 'g-gallery', page: 'gallery', targets: [HEADER], title: 'shell.gallery', body: 'tour.g.gallery.body' },
    { id: 'g-whois', page: 'whois', targets: [HEADER], title: 'whois.title', body: 'tour.g.whois.body' },
    { id: 'g-contacts', page: 'contacts', targets: [HEADER], title: 'shell.contacts', body: 'tour.g.contacts.body' },
  ] },
  { id: 'places', title: 'tour.g.places.chapter', steps: [
    // On a phone the Atlas has no header: the handle of its list of places stands in.
    { id: 'g-atlas', page: 'atlas', targets: [HEADER, 'atlas-handle'], title: 'shell.atlas', body: 'tour.g.atlas.body' },
    { id: 'g-almanac', page: 'almanac', targets: ['almanac-strip', HEADER], title: 'shell.almanac', body: 'tour.almanac.body' },
  ] },
  { id: 'houses', title: 'tour.g.houses.chapter', steps: [
    { id: 'g-houses', page: 'houses', targets: [HEADER], title: 'shell.houses', body: 'tour.g.houses.body' },
    { id: 'g-arms', page: 'house', targets: ['house-arms'], title: 'tour.g.arms.title', body: 'tour.g.arms.body', requires: 'house' },
  ] },
  { id: 'campaign', title: 'campaign.title', steps: [
    { id: 'g-campaign', page: 'campaign', targets: [HEADER], title: 'campaign.title', body: 'tour.g.campaign.body' },
    { id: 'g-practice', page: 'campaign', targets: ['campaign-practice'], title: 'tour.g.practice.title', body: 'tour.g.practice.body' },
  ] },
  { id: 'keep', title: 'tour.g.keep.chapter', steps: [
    { id: 'g-print', page: 'print', targets: [HEADER], title: 'tour.g.print.title', body: 'tour.g.print.body' },
    { id: 'g-export', page: 'export', targets: ['export', HEADER], title: 'tour.g.export.title', body: 'tour.g.export.body', needs: 'edit-person' },
    { id: 'g-history', page: 'history', targets: [HEADER], title: 'history.title', body: 'tour.g.history.body' },
  ] },
  { id: 'stewards', title: 'tour.g.stewards.chapter', steps: [
    { id: 'g-access', page: 'access', targets: ['access-invite', HEADER], title: 'shell.access', body: 'tour.access.body', needs: 'manage-access' },
    { id: 'g-share', page: 'access', targets: ['share-links'], title: 'tour.g.share.title', body: 'tour.g.share.body', needs: 'manage-access' },
    { id: 'g-viewas', page: 'access', targets: ['view-as'], title: 'tour.g.viewas.title', body: 'tour.g.viewas.body', needs: 'manage-access' },
    { id: 'g-games', page: 'games', targets: [HEADER], title: 'campaign.games.title', body: 'tour.g.games.body', needs: 'manage-access' },
  ] },
];

/** The steps this reader gets: what their role allows, and what this family has switched on and filled in. */
export function stepsFor(ctx: TourContext, steps: readonly TourStep[] = WELCOME_TOUR): TourStep[] {
  return steps.filter((s) => {
    if (s.needs && !can(ctx.role, s.needs)) return false;
    if (s.lacks && can(ctx.role, s.lacks)) return false;
    if (s.feature === 'assistant' && !ctx.assistant) return false;
    if (s.requires === 'people' && ctx.people === 0) return false;
    if (s.requires === 'house' && ctx.houses === 0) return false;
    return true;
  });
}

/** The grand tour's chapters for this reader, each with the steps they get; a chapter left with none is dropped. */
export function chaptersFor(ctx: TourContext, chapters: readonly TourChapter[] = GRAND_TOUR): TourChapter[] {
  return chapters.map((c) => ({ ...c, steps: stepsFor(ctx, c.steps) })).filter((c) => c.steps.length > 0);
}

/** One tour as the flat list the player walks; the grand tour's steps carry their chapter. */
export function scriptFor(tour: TourId, ctx: TourContext): TourStep[] {
  if (tour === 'welcome') return stepsFor(ctx);
  return chaptersFor(ctx).flatMap((c) => c.steps.map((s) => ({ ...s, chapter: c.id })));
}

/** How far a reader is through the grand tour: the chapters walked to their end, and the one to open next. */
export interface GrandProgress {
  done: string[];
  at: string | null;
}

export const NO_PROGRESS: GrandProgress = { done: [], at: null };

/** Reads what a browser kept. Anything it cannot make sense of is no progress, never an error. */
export function readProgress(raw: string | null | undefined): GrandProgress {
  if (!raw) return NO_PROGRESS;
  try {
    const v = JSON.parse(raw) as { done?: unknown; at?: unknown };
    const done = Array.isArray(v.done) ? [...new Set(v.done.filter((x): x is string => typeof x === 'string'))] : [];
    return { done, at: typeof v.at === 'string' ? v.at : null };
  } catch {
    return NO_PROGRESS;
  }
}

/**
 * The chapter "Continue" opens: where the reader stopped, if that chapter is still theirs and not finished; else the
 * first one not walked yet. Null when nothing is left, and for a reader who has not begun.
 */
export function resumeChapter(progress: GrandProgress, chapters: readonly string[]): string | null {
  if (!progress.at && progress.done.length === 0) return null;
  if (progress.at && chapters.includes(progress.at) && !progress.done.includes(progress.at)) return progress.at;
  return chapters.find((c) => !progress.done.includes(c)) ?? null;
}

/** The chapters walked to their end, among those this reader has. */
export function chaptersDone(progress: GrandProgress, chapters: readonly string[]): number {
  return chapters.filter((c) => progress.done.includes(c)).length;
}

/**
 * Progress after going on from step `from` to step `to` (`to` past the end: the tour is over). Every chapter left
 * behind on the way is walked; a chapter that was skipped is not, and stays open for another day.
 */
export function advance(progress: GrandProgress, steps: readonly TourStep[], from: number, to: number, skipped = false): GrandProgress {
  const next = steps[to]?.chapter ?? null;
  const left = skipped ? [] : steps.slice(Math.max(0, from), to).map((s) => s.chapter).filter((c): c is string => !!c && c !== next);
  return { done: [...new Set([...progress.done, ...left])], at: next };
}

/** The first step of the chapter after the one step `from` is in; the script's length when it is the last. */
export function nextChapterStart(steps: readonly TourStep[], from: number): number {
  const here = steps[from]?.chapter;
  const i = steps.findIndex((s, n) => n > from && s.chapter !== here);
  return i < 0 ? steps.length : i;
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
