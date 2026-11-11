// Cooking mode (docs/recipes.md): the recipe one step at a time, in letters large enough to read from across the
// kitchen, with the screen kept awake where the browser can (the Screen Wake Lock API). It opens on the ingredients, to
// lay everything out, then goes through the method. The arrow keys, a swipe and the two big buttons all turn the page;
// the ingredients are one press away at every step, with the ticks the recipe's page keeps.
//
//   <CookMode tree={tree} recipe={r} factor={2} ticks={ticks} onClose={close} />
import { ChevronLeft, ChevronRight, ListChecks, MonitorSmartphone, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Dialog } from '~/components/ui';
import { useT } from '~/lib/i18n';
import { recipeImageUrl, type RecipeDetail } from '~/lib/recipes/model';
import { IngredientList, type Ticks } from './IngredientList';
import './recipes.css';

type Sentinel = { release: () => Promise<void>; addEventListener: (type: 'release', fn: () => void) => void };

/**
 * Keeps the screen awake while mounted. The browser lets go of the lock whenever the page is hidden, so it is asked
 * for again each time the page comes back. Says whether the screen is being held: 'on', 'off' (the browser refused,
 * as on a low battery) or 'unsupported'.
 */
export function useWakeLock(): 'on' | 'off' | 'unsupported' {
  const [state, setState] = useState<'on' | 'off' | 'unsupported'>('off');
  useEffect(() => {
    const api = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<Sentinel> } }).wakeLock;
    if (!api) { setState('unsupported'); return; }
    let lock: Sentinel | null = null;
    let over = false;
    const ask = async () => {
      if (over || lock || document.visibilityState !== 'visible') return;
      try {
        const got = await api.request('screen');
        if (over) { void got.release().catch(() => {}); return; }
        lock = got;
        setState('on');
        got.addEventListener('release', () => { lock = null; if (!over) setState('off'); });
      } catch {
        setState('off');
      }
    };
    const visible = () => { void ask(); };
    void ask();
    document.addEventListener('visibilitychange', visible);
    return () => {
      over = true;
      document.removeEventListener('visibilitychange', visible);
      void lock?.release().catch(() => {});
    };
  }, []);
  return state;
}

export function CookMode({ tree, recipe, factor, ticks, onClose }: { tree: string; recipe: RecipeDetail; factor: number; ticks: Ticks; onClose: () => void }) {
  const t = useT();
  const awake = useWakeLock();
  const steps = recipe.steps;
  const hasList = recipe.groups.length > 0;
  // Page 0 is the ingredients (when there are any); the steps follow.
  const first = hasList ? 0 : 1;
  const [page, setPage] = useState(first);
  const [list, setList] = useState(false);
  const last = steps.length;
  const go = (by: number) => { setList(false); setPage((p) => Math.min(last, Math.max(first, p + by))); };
  const stage = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  // Each page starts at its top, and a screen reader is told where the cook is.
  useEffect(() => { stage.current?.scrollTo({ top: 0 }); }, [page, list]);

  const step = page > 0 ? steps[page - 1] : undefined;
  const showList = page === 0 || list;
  return (
    <Dialog
      open onClose={onClose} label={t('recipes.cook_mode.label', { title: recipe.title })} bare dismissible={false} width="100vw" className="rcp-cook"
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(1); }
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(-1); }
      }}
    >
      <header className="rcp-cook-head">
        <div>
          <b>{recipe.title}</b>
          <span className="rcp-cook-awake" data-state={awake}>
            <MonitorSmartphone size={14} aria-hidden /> {awake === 'on' ? t('recipes.cook_mode.awake') : awake === 'off' ? t('recipes.cook_mode.awake_off') : t('recipes.cook_mode.awake_unsupported')}
          </span>
        </div>
        {hasList && page > 0 ? (
          <button type="button" className="btn" aria-pressed={list} onClick={() => setList(!list)}><ListChecks size={16} aria-hidden /> {t('recipes.ingredients')}</button>
        ) : null}
        <button type="button" className="btn icon" aria-label={t('recipes.cook_mode.close')} title={t('recipes.cook_mode.close')} onClick={onClose}><X size={18} aria-hidden /></button>
      </header>

      <div
        className="rcp-cook-stage" ref={stage}
        onTouchStart={(e) => { const p = e.touches[0]; touch.current = p ? { x: p.clientX, y: p.clientY } : null; }}
        onTouchEnd={(e) => {
          const from = touch.current;
          const p = e.changedTouches[0];
          touch.current = null;
          if (!from || !p) return;
          const dx = p.clientX - from.x;
          // A sideways swipe turns the page; an up-and-down one is the reader scrolling a long step.
          if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(p.clientY - from.y) * 1.5) go(dx < 0 ? 1 : -1);
        }}
      >
        {showList ? (
          <div className="rcp-cook-list">
            <h2>{page === 0 ? t('recipes.cook_mode.ready') : t('recipes.ingredients')}</h2>
            {page === 0 ? <p className="rcp-hint">{t('recipes.cook_mode.ready_hint')}</p> : null}
            <IngredientList groups={recipe.groups} factor={factor} ticks={ticks} large />
          </div>
        ) : step ? (
          <div className="rcp-cook-step" aria-live="polite">
            <span className="rcp-cook-count">{t('recipes.cook_mode.step_of', { n: page, count: last })}</span>
            {step.image ? <img src={recipeImageUrl(tree, step.image)} alt={t('recipes.step_picture', { n: page })} /> : null}
            <p>{step.text}</p>
            {page === last ? <span className="rcp-cook-done">{t('recipes.cook_mode.done')}</span> : null}
          </div>
        ) : null}
      </div>

      <footer className="rcp-cook-foot">
        <button type="button" className="btn" disabled={page <= first && !list} onClick={() => (list ? setList(false) : go(-1))}><ChevronLeft size={20} aria-hidden /> {t('recipes.cook_mode.back')}</button>
        <span className="rcp-cook-dots" aria-hidden>
          {Array.from({ length: last - first + 1 }, (_, i) => <i key={i} data-on={i + first === page || undefined} data-past={i + first < page || undefined} />)}
        </span>
        {page < last
          ? <button type="button" className="btn primary" data-autofocus onClick={() => go(1)}>{page === 0 ? t('recipes.cook_mode.start') : t('recipes.cook_mode.next')} <ChevronRight size={20} aria-hidden /></button>
          : <button type="button" className="btn primary" onClick={onClose}>{t('recipes.cook_mode.finish')}</button>}
      </footer>
    </Dialog>
  );
}
