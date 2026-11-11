// The guided tours: a card that walks the reader through the real pages, with a spotlight on the real element.
// `scriptFor` shapes the script for this reader; here it is played. A step whose element is not there is passed over.
//
// It is a native modal <dialog>, like every other dialog here: the page behind is inert, focus stays in the card, and
// it sits above everything. The dialog is transparent, so the page shows through and the spotlight's shadow dims it.
// A step with a task ("open the search") waits for the reader to do it: for that step the dialog is not modal, so the
// page can be used, and it becomes modal again with the next step.
import { useRouter } from '@tanstack/react-router';
import { Check, MousePointerClick } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { closeAssistant, useAiStatus } from '~/components/assistant/store';
import { useFamily, useMe, useTreeId } from '~/lib/family';
import { useT } from '~/lib/i18n';
import { useRole } from '~/lib/session';
import { track } from '~/lib/stats/beacon';
import { usePalette } from '../Palette';
import { useOverlayLayer } from '../ui/overlay';
import { endTour, loadGrand, progress, saveGrand, startTour, useTourRun, type Run } from './store';
import { advance, chaptersDone, findStep, GRAND_TOUR, nextChapterStart, placeCard, scriptFor, TOUR_ROUTES, type Box, type TourContext, type TourStep } from './steps';
import './tour.css';

/** How long to wait for a step's element after going to its page, and when already there. */
const WAIT_AFTER_MOVE = 2500;
const WAIT_IN_PLACE = 700;
/** How long a tab or a sheet takes to show what a step points at, once its opener was pressed. */
const WAIT_OPENED = 1500;
/** How long "That's it" stays before the tour goes on by itself. */
const DONE_PAUSE = 1100;
const SPOTLIGHT_PAD = 6;
/** On a page, focus came from a menu item that has closed: this is where it goes back to. */
const FALLBACK_FOCUS = '.acct-trigger';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Steps name their elements; the pages carry the names in `data-tour`. */
const named = (name: string) => `[data-tour~="${name}"]`;
const shown = (el: Element) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
const onScreen = (r: DOMRect) => r.width > 0 && r.height > 0 && r.bottom > 4 && r.right > 4 && r.top < innerHeight - 4 && r.left < innerWidth - 4;

/** An element by name that can be seen, preferring one on screen; never one inside `outside`. */
function seen(name: string, outside?: Element | null): HTMLElement | null {
  const all = [...document.querySelectorAll<HTMLElement>(named(name))].filter((el) => shown(el) && !outside?.contains(el));
  return all.find((el) => onScreen(el.getBoundingClientRect())) ?? all[0] ?? null;
}

/** The first of the names that is on screen, else the first that exists at all (scrolled to, where it can be). */
function pickTarget(names: readonly string[]): HTMLElement | null {
  const found = names.map((n) => seen(n)).filter((el): el is HTMLElement => !!el);
  const visible = found.find((el) => onScreen(el.getBoundingClientRect()));
  if (visible) return visible;
  const first = found[0];
  if (first) first.scrollIntoView({ block: 'center', inline: 'nearest' });
  return first ?? null;
}

async function waitFor<T>(find: () => T | null, ms: number, alive: () => boolean): Promise<T | null> {
  const end = performance.now() + ms;
  for (;;) {
    const hit = find();
    if (hit || !alive() || performance.now() >= end) return hit;
    await sleep(60);
  }
}

/** Opens the selected person's panel, and on phones lifts its sheet high enough to show the tabs. */
async function openPanel(alive: () => boolean) {
  if (!document.querySelector('.person-panel')) (document.querySelector<HTMLElement>('.card.selected .card-hit') ?? document.querySelector<HTMLElement>('.card.selected'))?.click();
  await waitFor(() => document.querySelector('.person-panel'), 1200, alive);
  if (document.querySelector('.tree-page[data-sheet="peek"]')) {
    document.querySelector<HTMLElement>('.sheet-grip')?.click();
    await sleep(320); // the sheet's own transition
  }
}

/** What the tours know about this reader and family; the Tours dialog lists the chapters from the same. */
export function useTourContext(): TourContext {
  const tree = useTreeId();
  const f = useFamily();
  const role = useRole();
  const assistant = !!useAiStatus(tree)?.features.assistant;
  return { role, assistant, people: f.graph.people.length, houses: f.graph.houses.length };
}

export function Tour() {
  const run = useTourRun();
  return run ? <TourRun key={run.id} run={run} /> : null;
}

/** Whether the step in hand waits for the reader: not at all, still waiting, or just done. */
type Task = 'none' | 'waiting' | 'done';

function TourRun({ run }: { run: Run }) {
  const t = useT();
  const router = useRouter();
  const tree = useTreeId();
  const f = useFamily();
  const ctx = useTourContext();
  const palette = usePalette();
  const grand = run.tour === 'grand';
  // The script is fixed when the tour starts, so a change behind the scenes can't renumber it mid-way.
  const [steps] = useState(() => scriptFor(run.tour, ctx));
  const house = f.graph.houses[0]?.id;
  const person = useMe();

  const [index, setIndex] = useState(-1);
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set());
  const [box, setBox] = useState<Box | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [working, setWorking] = useState(false);
  const [task, setTask] = useState<Task>('none');
  const [ended, setEnded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const target = useRef<HTMLElement | null>(null);
  /** What a task found when its step began: whether there is anything to wait for, and what was there already. */
  const taskStart = useRef<{ waits: boolean; had: HTMLElement | null }>({ waits: false, had: null });
  const alive = useRef(true);
  const busy = useRef(false);
  const step: TourStep | undefined = ended ? undefined : steps[index];
  // While a task waits, the page is the reader's: the dialog is not modal and page shortcuts work.
  const free = task !== 'none';
  useOverlayLayer(!free);

  const leave = useCallback(() => {
    alive.current = false;
    endTour();
  }, []);
  /** Leaving before the end. The grand tour is only paused: where it stopped is already kept. */
  const quit = () => {
    if (!grand && !ended) track('tour.skipped');
    leave();
  };

  /** Goes to the step's page, gets it ready, and says whether there is something to show. */
  const arrive = useCallback(async (s: TourStep): Promise<boolean> => {
    let wait = WAIT_IN_PLACE;
    if (s.page) {
      const to = TOUR_ROUTES[s.page];
      const params = { tree, house: house ?? '', id: person };
      if (router.buildLocation({ to, params } as never).pathname !== router.state.location.pathname) {
        // Replacing, so the browser's Back still goes to where the reader was before the tour.
        await router.navigate({ to, params, replace: true } as never);
        wait = WAIT_AFTER_MOVE;
      }
    }
    const isAlive = () => alive.current;
    if (s.prepare === 'panel') await openPanel(isAlive);
    taskStart.current = { waits: false, had: null };
    if (!s.targets) { target.current = null; return true; }
    let el: HTMLElement | null;
    if (s.opener) {
      // The targets, or else the tab that holds them: whichever the page has first.
      const first = await waitFor(() => pickTarget(s.targets!) ?? seen(s.opener!), wait, isAlive);
      el = first && s.targets.some((n) => first.matches(named(n))) ? first : null;
      if (!el && first) {
        first.click();
        el = await waitFor(() => pickTarget(s.targets!), WAIT_OPENED, isAlive);
      }
    } else {
      el = await waitFor(() => pickTarget(s.targets!), wait, isAlive);
    }
    target.current = el;
    if (el && s.task) {
      const had = seen(s.task.until);
      // Nothing to wait for when it is done already (the tab is open), or when there is nothing to press.
      taskStart.current = { waits: (s.task.changed || !had) && !!seen(s.task.click, had), had };
    }
    return !!el;
  }, [house, person, router, tree]);

  /** Shows step `at`, or the nearest one in direction `dir` that can be shown; past the last one, the closing card. */
  const move = useCallback(async (cur: number, at: number, dir: 1 | -1, skipped = false) => {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    const passed: string[] = [];
    const found = await findStep(steps, at, dir, async (s) => {
      const ok = await arrive(s);
      if (!ok) passed.push(s.id);
      return ok;
    }, () => !alive.current);
    busy.current = false;
    if (!alive.current) return;
    setWorking(false);
    if (passed.length) setMissing((m) => new Set([...m, ...passed]));
    if (found < 0 && dir === -1) return;
    if (grand) {
      const kept = loadGrand(tree);
      const to = found < 0 ? steps.length : found;
      saveGrand(tree, dir === 1 && cur >= 0 ? advance(kept, steps, cur, to, skipped) : { ...kept, at: steps[to]?.chapter ?? null });
    }
    if (found >= 0) {
      progress.step = found;
      setTask(taskStart.current.waits ? 'waiting' : 'none');
      setEnded(false);
      setIndex(found);
    } else {
      target.current = null;
      setTask('none');
      setEnded(true);
      if (!grand) track('tour.finished');
    }
  }, [arrive, grand, steps, tree]);

  /** The end of the walk: back to the page the tour started on. */
  const finish = () => {
    const href = progress.returnTo;
    leave();
    if (href && href !== router.state.location.href) router.history.replace(href);
  };

  const forward = () => (ended ? finish() : void move(index, index + 1, 1));
  const back = () => {
    if (ended) void move(index, index, -1);
    else if (index > 0) void move(index, index - 1, -1);
  };
  const skipChapter = () => void move(index, nextChapterStart(steps, index), 1, true);

  // Open the dialog and start. On the way out, focus goes back to where it was.
  useLayoutEffect(() => {
    const el = dialog.current;
    if (!el) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    alive.current = true;
    closeAssistant();
    if (!el.open) { try { el.showModal(); } catch { el.setAttribute('open', ''); } }
    progress.returnTo ??= router.state.location.href;
    // A re-mount of the page around the tour goes on where it was; a fresh start opens at the chapter asked for.
    const start = progress.step >= 0 ? progress.step : Math.max(0, run.chapter ? steps.findIndex((s) => s.chapter === run.chapter) : 0);
    void move(-1, start, 1);
    return () => {
      alive.current = false;
      if (el.open) el.close();
      requestAnimationFrame(() => {
        const back = opener?.isConnected && opener !== document.body ? opener : document.querySelector<HTMLElement>(FALLBACK_FOCUS);
        back?.focus({ preventScroll: true });
      });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Modal for a step that is read, not modal for one that is done on the page. Declared after the opening effect, so
  // on the first render the dialog is open already and this finds nothing to change.
  useLayoutEffect(() => {
    const el = dialog.current;
    if (!el?.open || el.matches(':modal') === !free) return;
    try {
      el.close();
      if (free) el.show(); else el.showModal();
    } catch { el.setAttribute('open', ''); }
  }, [free]);

  // A task is done when what it waits for is on the page (and, for a selection, is another card than before).
  const wanted = step?.task;
  useEffect(() => {
    if (task !== 'waiting' || !wanted) return;
    const timer = setInterval(() => {
      const el = seen(wanted.until);
      if (el && (!wanted.changed || el !== taskStart.current.had)) setTask('done');
    }, 120);
    return () => clearInterval(timer);
  }, [task, wanted]);

  // Done: a moment to see it, then whatever it opened is put away and the tour goes on.
  useEffect(() => {
    if (task !== 'done' || !wanted) return;
    const timer = setTimeout(() => {
      if (wanted.tidy === 'palette') palette.close();
      if (wanted.tidy === 'toggle') document.querySelector<HTMLElement>(`${named(wanted.click)}[aria-expanded="true"]`)?.click();
      void move(index, index + 1, 1);
    }, DONE_PAUSE);
    return () => clearTimeout(timer);
  }, [task, wanted]); // eslint-disable-line react-hooks/exhaustive-deps

  /** "Show me": the tour presses it for the reader, and the watcher above sees the result. */
  const showMe = () => {
    if (wanted) seen(wanted.click, taskStart.current.had)?.click();
  };

  // Keys stay here while the card is read: not stopped, they would reach the page's shortcuts and the ⌘K palette.
  // While a task waits they pass, so ⌘K pressed with the focus still on the card opens the search.
  const keys = useRef((_e: KeyboardEvent) => {});
  keys.current = (e) => {
    if (!free) e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); quit(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); forward(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); back(); }
  };
  const cancel = useRef(() => {});
  cancel.current = quit;
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => keys.current(e);
    // The platform's own dismissal (Android's back gesture, a second Escape) ends the tour the same way.
    const onCancel = (e: Event) => { e.preventDefault(); cancel.current(); };
    // Only if it really is closed: switching between modal and not closes it and opens it again straight away.
    const onClose = () => { if (alive.current && !el.open) leave(); };
    el.addEventListener('keydown', onKey);
    el.addEventListener('cancel', onCancel);
    el.addEventListener('close', onClose);
    return () => {
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('cancel', onCancel);
      el.removeEventListener('close', onClose);
    };
  }, [leave]);

  // The spotlight follows its element frame by frame: pages settle, the tree's camera glides, the window resizes.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (target.current && !target.current.isConnected) target.current = step?.targets ? pickTarget(step.targets) : null;
      const r = step ? target.current?.getBoundingClientRect() : undefined;
      const next: Box | null = r && onScreen(r) ? spotlight(r) : null;
      setBox((b) => (same(b, next) ? b : next));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [step]);

  // Place the card once its size for this step and language is known.
  const showing = !!step || ended;
  useLayoutEffect(() => {
    const c = card.current;
    const s = stage.current;
    if (!c || !s || !showing) return;
    setPos(placeCard(box, { w: c.offsetWidth, h: c.offsetHeight }, { w: s.clientWidth, h: s.clientHeight }));
  }, [box, step, showing, task, t.locale]);

  // The primary button holds focus, so Enter and Space go on. The card's text is a live region, so it is read out.
  // Waits for `pos`: the card stays hidden until it is placed, and a hidden button can't take focus.
  const placed = !!pos;
  useEffect(() => { if (showing && placed && task !== 'done') next.current?.focus({ preventScroll: true }); }, [step, showing, placed, task]);

  const remaining = steps.filter((s) => !missing.has(s.id));
  const place = step ? remaining.indexOf(step) + 1 : remaining.length;
  const atStart = index <= 0;
  // The grand tour counts within its chapter, and says which chapter that is.
  const chapters = [...new Set(steps.map((s) => s.chapter).filter((c): c is string => !!c))];
  const inChapter = step?.chapter ? remaining.filter((s) => s.chapter === step.chapter) : remaining;
  const chapter = step?.chapter ? GRAND_TOUR.find((c) => c.id === step.chapter) : undefined;
  const walked = grand && ended ? chaptersDone(loadGrand(tree), chapters) : 0;

  return (
    <dialog ref={dialog} className="tour-dialog" data-free={free || undefined} aria-labelledby="tour-title" aria-describedby="tour-body">
      <div className="tour-stage" ref={stage}>
        {box
          ? <div className="tour-spot" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />
          : <div className="tour-scrim" />}
        {step && (
          <div className="tour-card panel" ref={card} style={pos ?? { visibility: 'hidden' }} aria-busy={working || undefined}>
            <div className="tour-meter" aria-hidden><i style={{ width: `${(place / remaining.length) * 100}%` }} /></div>
            {chapter && (
              <p className="tour-chapter">
                <span>{t('tour.chapter', { n: chapters.indexOf(chapter.id) + 1, count: chapters.length })} · <b>{t(chapter.title)}</b></span>
                <button type="button" className="tour-chapter-skip" onClick={skipChapter}>{t('tour.chapter.skip')}</button>
              </p>
            )}
            <div aria-live="polite" aria-atomic="true">
              <p className="tour-count">{t('tour.progress', { step: inChapter.indexOf(step) + 1, count: inChapter.length })}<span className="tour-keys" aria-hidden><kbd>←</kbd> <kbd>→</kbd> <kbd>esc</kbd></span></p>
              <h2 id="tour-title" className="tour-title display">{t(step.title)}</h2>
              <p id="tour-body" className="tour-body">{t(step.body)}</p>
              {task === 'waiting' && wanted && <p className="tour-ask"><MousePointerClick size={16} aria-hidden /> <span>{t(wanted.ask)}</span></p>}
              {task === 'done' && <p className="tour-ask tour-ask-done"><Check size={16} aria-hidden /> <span>{t('tour.task.done')}</span></p>}
            </div>
            <div className="tour-foot">
              <button type="button" className="btn ghost tour-skip" onClick={quit}>{grand ? t('tour.pause') : t('tour.skip')}</button>
              {!atStart && <button type="button" className="btn" onClick={back}>{t('tour.back')}</button>}
              {task === 'none'
                ? <button type="button" className="btn primary" ref={next} onClick={forward}>{t('tour.next')}</button>
                : <>
                  <button type="button" className="btn" onClick={forward} disabled={task === 'done'}>{t('tour.task.skip')}</button>
                  <button type="button" className="btn primary" ref={next} onClick={showMe} disabled={task === 'done'}>{t('tour.task.show')}</button>
                </>}
            </div>
          </div>
        )}
        {ended && (
          <div className="tour-card tour-end panel" ref={card} style={pos ?? { visibility: 'hidden' }}>
            <svg className="tour-seal" viewBox="0 0 48 48" aria-hidden><circle cx="24" cy="24" r="21" /><path d="M14.5 24.5l6.5 6.5 12.5-13.5" /></svg>
            <div aria-live="polite" aria-atomic="true">
              <h2 id="tour-title" className="tour-title display">{t(grand ? 'tour.end.grand_title' : 'tour.end.title')}</h2>
              <p id="tour-body" className="tour-body">
                {grand
                  ? walked >= chapters.length ? t('tour.end.grand_all', { count: chapters.length }) : t('tour.end.grand_some', { done: walked, count: chapters.length })
                  : t('tour.end.body')}
              </p>
            </div>
            <div className="tour-foot">
              <button type="button" className="btn tour-skip" onClick={back}>{t('tour.back')}</button>
              {!grand && <button type="button" className="btn" onClick={() => startTour('grand')}>{t('tour.end.to_grand')}</button>}
              <button type="button" className="btn primary" ref={next} onClick={finish}>{t('tour.done')}</button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}

/** The element's box with the spotlight's margin, kept inside the window. */
function spotlight(r: DOMRect): Box {
  const x = Math.max(0, Math.round(r.left - SPOTLIGHT_PAD));
  const y = Math.max(0, Math.round(r.top - SPOTLIGHT_PAD));
  return {
    x, y,
    w: Math.min(innerWidth, Math.round(r.right + SPOTLIGHT_PAD)) - x,
    h: Math.min(innerHeight, Math.round(r.bottom + SPOTLIGHT_PAD)) - y,
  };
}

const same = (a: Box | null, b: Box | null) => a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);
