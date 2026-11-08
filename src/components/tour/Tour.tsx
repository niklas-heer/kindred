// The guided tour: a card that walks the reader through the real pages, with a spotlight on the real element.
// `stepsFor` shapes the script for this reader; here it is played. A step whose element is not there is passed over.
//
// It is a native modal <dialog>, like every other dialog here: the page behind is inert, focus stays in the card, and
// it sits above everything. The dialog is transparent, so the page shows through and the spotlight's shadow dims it.
import { useRouter } from '@tanstack/react-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { closeAssistant, useAiStatus } from '~/components/assistant/store';
import { useFamily, useTreeId } from '~/lib/family';
import { useT } from '~/lib/i18n';
import { useRole } from '~/lib/session';
import { useOverlayLayer } from '../ui/overlay';
import { endTour, progress, useTourRunning } from './store';
import { findStep, placeCard, stepsFor, TOUR_ROUTES, type Box, type TourStep } from './steps';
import './tour.css';

/** How long to wait for a step's element after going to its page, and when already there. */
const WAIT_AFTER_MOVE = 2500;
const WAIT_IN_PLACE = 700;
const SPOTLIGHT_PAD = 6;
/** On a page, focus came from a menu item that has closed: this is where it goes back to. */
const FALLBACK_FOCUS = '.acct-trigger';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const shown = (el: Element) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
const onScreen = (r: DOMRect) => r.width > 0 && r.height > 0 && r.bottom > 4 && r.right > 4 && r.top < innerHeight - 4 && r.left < innerWidth - 4;

/** The first of the selectors that is on screen, else the first that exists at all (scrolled to, where it can be). */
function pickTarget(selectors: readonly string[]): HTMLElement | null {
  const found = selectors.flatMap((s) => [...document.querySelectorAll<HTMLElement>(s)].filter(shown).slice(0, 1));
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

export function Tour() {
  return useTourRunning() ? <TourRun /> : null;
}

function TourRun() {
  const t = useT();
  const router = useRouter();
  const tree = useTreeId();
  const f = useFamily();
  const role = useRole();
  const assistant = !!useAiStatus(tree)?.features.assistant;
  const layer = useOverlayLayer(true);
  // The script is fixed when the tour starts, so a change behind the scenes can't renumber it mid-way.
  const [steps] = useState(() => stepsFor({ role, assistant, people: f.graph.people.length, houses: f.graph.houses.length }));
  const house = f.graph.houses[0]?.id;

  const [index, setIndex] = useState(-1);
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set());
  const [box, setBox] = useState<Box | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [working, setWorking] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const target = useRef<HTMLElement | null>(null);
  const alive = useRef(true);
  const busy = useRef(false);
  const step: TourStep | undefined = steps[index];

  const leave = useCallback(() => {
    alive.current = false;
    endTour();
  }, []);

  /** Goes to the step's page, gets it ready, and says whether there is something to show. */
  const arrive = useCallback(async (s: TourStep): Promise<boolean> => {
    let wait = WAIT_IN_PLACE;
    if (s.page) {
      const to = TOUR_ROUTES[s.page];
      const params = { tree, house: house ?? '' };
      if (router.buildLocation({ to, params } as never).pathname !== router.state.location.pathname) {
        // Replacing, so the browser's Back still goes to where the reader was before the tour.
        await router.navigate({ to, params, replace: true } as never);
        wait = WAIT_AFTER_MOVE;
      }
    }
    const isAlive = () => alive.current;
    if (s.prepare === 'panel') await openPanel(isAlive);
    if (!s.targets) { target.current = null; return true; }
    const el = await waitFor(() => pickTarget(s.targets!), wait, isAlive);
    target.current = el;
    return !!el;
  }, [house, router, tree]);

  const move = useCallback(async (from: number, dir: 1 | -1) => {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    const passed: string[] = [];
    const found = await findStep(steps, from, dir, async (s) => {
      const ok = await arrive(s);
      if (!ok) passed.push(s.id);
      return ok;
    }, () => !alive.current);
    busy.current = false;
    if (!alive.current) return;
    setWorking(false);
    if (passed.length) setMissing((m) => new Set([...m, ...passed]));
    if (found >= 0) { progress.step = found; setIndex(found); }
    else if (dir === 1) finish();
  }, [arrive, steps]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The end of the walk: back to the page the tour started on. */
  const finish = () => {
    const href = progress.returnTo;
    leave();
    if (href && href !== router.state.location.href) router.history.replace(href);
  };

  const forward = () => (index >= steps.length - 1 ? finish() : void move(index + 1, 1));
  const back = () => { if (index > 0) void move(index - 1, -1); };

  // Open the dialog and start. On the way out, focus goes back to where it was.
  useLayoutEffect(() => {
    const el = dialog.current;
    if (!el) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    alive.current = true;
    closeAssistant();
    if (!el.open) { try { el.showModal(); } catch { el.setAttribute('open', ''); } }
    progress.returnTo ??= router.state.location.href;
    void move(progress.step, 1);
    return () => {
      alive.current = false;
      if (el.open) el.close();
      requestAnimationFrame(() => {
        const back = opener?.isConnected && opener !== document.body ? opener : document.querySelector<HTMLElement>(FALLBACK_FOCUS);
        back?.focus({ preventScroll: true });
      });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keys stay here: not stopped, they would reach the page's shortcuts and the ⌘K palette.
  const keys = useRef((_e: KeyboardEvent) => {});
  keys.current = (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); leave(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); forward(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
  };
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => keys.current(e);
    // The platform's own dismissal (Android's back gesture, a second Escape) ends the tour the same way.
    const onCancel = (e: Event) => { e.preventDefault(); leave(); };
    // Only if it really is closed: a re-run of the opening effect closes it and opens it again straight away.
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
      if (target.current && !target.current.isConnected && step?.targets) target.current = pickTarget(step.targets);
      const r = target.current?.getBoundingClientRect();
      const next: Box | null = r && onScreen(r) ? spotlight(r) : null;
      setBox((b) => (same(b, next) ? b : next));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [step]);

  // Place the card once its size for this step and language is known.
  useLayoutEffect(() => {
    const c = card.current;
    const s = stage.current;
    if (!c || !s || !step) return;
    setPos(placeCard(box, { w: c.offsetWidth, h: c.offsetHeight }, { w: s.clientWidth, h: s.clientHeight }));
  }, [box, step, t.locale]);

  // The primary button holds focus, so Enter and Space go on. The card's text is a live region, so it is read out.
  // Waits for `pos`: the card stays hidden until it is placed, and a hidden button can't take focus.
  const placed = !!pos;
  useEffect(() => { if (step && placed) next.current?.focus({ preventScroll: true }); }, [step, placed]);

  const remaining = steps.filter((s) => !missing.has(s.id));
  const place = step ? remaining.indexOf(step) + 1 : 0;
  const atStart = index <= 0;
  const atEnd = index >= steps.length - 1;

  return (
    <dialog ref={dialog} className="tour-dialog" aria-labelledby="tour-title" aria-describedby="tour-body">
      <div className="tour-stage" ref={stage}>
        {box
          ? <div className="tour-spot" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />
          : <div className="tour-scrim" />}
        {step && (
          <div className="tour-card panel" ref={card} style={pos ?? { visibility: 'hidden' }} aria-busy={working || undefined}>
            <div className="tour-meter" aria-hidden><i style={{ width: `${(place / remaining.length) * 100}%` }} /></div>
            <div aria-live="polite" aria-atomic="true">
              <p className="tour-count">{t('tour.progress', { step: place, count: remaining.length })}<span className="tour-keys" aria-hidden><kbd>←</kbd> <kbd>→</kbd> <kbd>esc</kbd></span></p>
              <h2 id="tour-title" className="tour-title display">{t(step.title)}</h2>
              <p id="tour-body" className="tour-body">{t(step.body)}</p>
            </div>
            <div className="tour-foot">
              {!atEnd && <button type="button" className="btn ghost tour-skip" onClick={leave}>{t('tour.skip')}</button>}
              {!atStart && <button type="button" className="btn" onClick={back}>{t('tour.back')}</button>}
              <button type="button" className="btn primary" ref={next} onClick={forward}>{atEnd ? t('tour.done') : t('tour.next')}</button>
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
