// The tree canvas: pan and zoom over a laid-out tree, drawing only what is on screen.
//
// Feel: drag or two-finger scroll pans; pinch, ⌘/ctrl+wheel or a mouse wheel zooms around the
// pointer. Cards change detail with zoom (portrait → name plate → shield with a name → shield). A minimap
// shows where you are in the whole tree; a ruler on the left names each generation and its era.
import { Expand, Map as MapIcon, Minus, Plus } from 'lucide-react';
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CARD_H, CARD_W, type LNode, type Layout } from '~/lib/layout';
import { MAX_K, NAME_PX, READABLE_K, detailFor, minZoom, openingZoom, type Detail } from '~/lib/camera';
import type { Family } from '~/lib/graph';
import { Minimap } from './Minimap';
import { useT } from '~/lib/i18n';
import './canvas.css';

export { NAME_PX, type Detail };

/**
 * World pixels the focus card needs above its slot on full cards: it is drawn 12% larger from a point 60% down
 * (card.css), which lifts its top by 14px and puts the "+" for a parent, with its ring, 57px above the slot.
 */
const FOCUS_HEADROOM = 58;

/** Screen space covered by floating panels, in px from each edge of the canvas. */
export interface Inset { left: number; top: number; right?: number; bottom?: number }

interface Cam { x: number; y: number; k: number } // screen = world * k + (x, y)

export interface CanvasHandle {
  /** Returns whether the camera had to move noticeably. */
  centerOn(id: string, opts?: { k?: number; animate?: boolean }): boolean;
  fit(): void;
  /**
   * Opening view: the whole tree at the most detailed zoom that fits the free area; when even name
   * plates won't fit, readable name plates around `id`: a generation starts right under the toolbar, `id`
   * sits near the middle with the generations before and after it, and the rest runs off the edge.
   */
  frame(id: string, opts?: { animate?: boolean }): void;
  /**
   * Pans just enough to bring a card fully into the free area (after a sheet or panel opens). With `beside`, that
   * person's card too when both fit at the current zoom: someone just added is shown next to whom they were added to.
   */
  reveal(id: string, beside?: string): boolean;
  zoomBy(f: number): void;
  /** World position of a node by person id (first placement). */
  nodeOf(id: string): LNode | undefined;
}

interface Props {
  family: Family;
  layout: Layout;
  focus: string;
  dimmed?: ReadonlySet<string> | null; // when set, people NOT in it are dimmed
  pathEdges?: ReadonlySet<string> | null;
  renderCard: (n: LNode, detail: Detail) => ReactNode;
  onBackground?: () => void;
  /** Ruler label per generation row: a short mark ("IX") and an era ("c. 1146"). */
  rowLabel?: (row: number, year: number | undefined, index: number) => [string, string?];
  overlay?: ReactNode;
  /**
   * Screen space covered by floating panels: side panel left, toolbar and banner on top, sheet below.
   * A function is read each time the camera frames something, so it can measure the live layout.
   * The map controls on the right are measured here.
   */
  inset?: Inset | (() => Inset);
  /** Person to greet with a brief ring, after the camera arrives at them. */
  flash?: { id: string; at: number } | null;
  /** Extra buttons for the map control stack (below zoom and fit), e.g. keyboard help. */
  controls?: ReactNode;
  /** Called once when the reader starts moving the camera themselves (drag, wheel, pinch, minimap). */
  onUserMove?: () => void;
  /** A smaller minimap, for when panels leave the tree little room. */
  smallMap?: boolean;
}

export const Canvas = forwardRef<CanvasHandle, Props>(function Canvas(
  { family, layout, focus, dimmed, renderCard, onBackground, rowLabel, overlay, inset, flash, controls, onUserMove, smallMap },
  ref,
) {
  const t = useT();
  const insetOf = useRef(inset);
  insetOf.current = inset;
  const dock = useRef<HTMLDivElement>(null);
  const moved = useRef(onUserMove);
  moved.current = onUserMove;
  const userMove = () => moved.current?.();
  const host = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const cam = useRef<Cam>({ x: 0, y: 0, k: 0.8 });
  const lastDetail = useRef<Detail>('near');
  const anim = useRef<number>(0);
  const [view, setView] = useState({ x0: -2000, y0: -2000, x1: 2000, y1: 2000, k: 0.8, w: 1000, h: 800, cx: 0, cy: 0 });
  const raf = useRef(0);

  // Push the camera to the DOM immediately; recompute what is visible once per frame.
  const apply = useCallback(() => {
    const c = cam.current;
    if (world.current) world.current.style.transform = `translate(${c.x}px, ${c.y}px) scale(${c.k})`;
    host.current?.style.setProperty('--k', String(c.k));
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const el = host.current;
      if (!el) return;
      const { width: w, height: h } = el.getBoundingClientRect();
      const c = cam.current;
      const pad = 260 / c.k;
      setView({ x0: -c.x / c.k - pad, y0: -c.y / c.k - pad, x1: (w - c.x) / c.k + pad, y1: (h - c.y) / c.k + pad, k: c.k, w, h, cx: c.x, cy: c.y });
    });
  }, []);

  // `settle`: the level to show on arrival. A flight from farther out would otherwise end one level simpler than
  // the same zoom reached from closer in (the hysteresis), and an opening view must not depend on where it came from.
  const animateTo = useCallback((to: Cam, ms = 420, settle?: Detail) => {
    cancelAnimationFrame(anim.current);
    // Reduced motion: no flying, just arrive.
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      cam.current = to;
      if (settle) lastDetail.current = settle;
      apply();
      return;
    }
    const from = { ...cam.current };
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      // Zoom interpolates geometrically so it feels even.
      const k = from.k * Math.pow(to.k / from.k, e);
      cam.current = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, k };
      if (p >= 1 && settle) lastDetail.current = settle;
      apply();
      if (p < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  }, [apply]);

  const firstOf = useMemo(() => {
    const m = new Map<string, LNode>();
    for (const n of layout.nodes) if (!m.has(n.id) || n.role === 'main') m.set(n.id, n);
    return m;
  }, [layout]);

  /** The part of the canvas no panel covers, in canvas pixels. */
  const area = useCallback(() => {
    const { width: w, height: h } = host.current!.getBoundingClientRect();
    const i = typeof insetOf.current === 'function' ? insetOf.current() : insetOf.current ?? { left: 0, top: 0 };
    const gutter = w <= 900 ? 44 : 56; // the ruler
    // The zoom stack and minimap sit on the right; measure them rather than guess.
    const d = dock.current;
    // A phone keeps them in the ruler's gutter on the left (canvas.css), where they cover no part of the tree.
    let right = Math.max(i.right ?? 0, d && d.offsetLeft > w / 2 ? w - d.offsetLeft + 8 : 0);
    let left = Math.max(gutter, i.left);
    let bottom = i.bottom ?? 0;
    // A panel that leaves almost nothing is ignored, so the tree is not squeezed into a sliver.
    if (w - left < 320) left = gutter;
    if (w - left - right < (w < 600 ? 220 : 400)) right = 0;
    if (h - i.top - bottom < 160) bottom = 0;
    return { l: left, t: Math.min(i.top, h / 2), r: w - right, b: h - bottom, w, h };
  }, []);

  const centerOn = useCallback((id: string, opts?: { k?: number; animate?: boolean }) => {
    const n = firstOf.get(id);
    if (!n || !host.current) return false;
    const a = area();
    const k = opts?.k ?? Math.max(cam.current.k, READABLE_K);
    // Centre in the part of the canvas no panel covers (the map controls only hide a corner).
    const cx = (a.l + a.w) / 2, cy = a.t + (a.b - a.t) * 0.46;
    const target = { k, x: cx - n.x * k, y: cy - (n.y + CARD_H / 2) * k };
    const c = cam.current;
    const moved = Math.hypot(target.x - c.x, target.y - c.y) > 24 || Math.abs(target.k - c.k) > 0.02;
    if (opts?.animate === false) { cam.current = target; apply(); } else animateTo(target);
    return moved;
  }, [firstOf, apply, animateTo, area]);

  const margins = (w: number) => (w < 600 ? { x: 12, y: 10 } : { x: 28, y: 12 });

  /** The farthest out a gesture or the zoom buttons go: a little past the whole tree in view. */
  const floor = useCallback(() => {
    const a = area();
    const m = margins(a.w);
    return minZoom(Math.min((a.r - a.l - 2 * m.x) / layout.bounds.w, (a.b - a.t - 2 * m.y) / layout.bounds.h));
  }, [layout, area]);

  const fit = useCallback(() => {
    if (!host.current) return;
    const a = area();
    const b = layout.bounds;
    const m = margins(a.w);
    const aw = a.r - a.l - 2 * m.x, ah = a.b - a.t - 2 * m.y;
    const k = Math.min(1, Math.max(0.04, Math.min(aw / b.w, ah / b.h)));
    animateTo({ k, x: a.l + m.x + aw / 2 - (b.x + b.w / 2) * k, y: a.t + m.y + ah / 2 - (b.y + b.h / 2) * k });
  }, [layout, animateTo, area]);

  const frame = useCallback((id: string, opts?: { animate?: boolean }) => {
    if (!host.current) return;
    const a = area();
    const b = layout.bounds;
    const m = margins(a.w);
    const lo = { x: a.l + m.x, y: a.t + m.y }, hi = { x: a.r - m.x, y: a.b - m.y };
    // Full cards for a small tree, readable name plates around the focus for a large one (see openingZoom).
    const k = openingZoom((hi.x - lo.x) / b.w, (hi.y - lo.y) / b.h, a.w, hi.y - lo.y);
    const opens = detailFor(k, 'near'); // coming from closer in, so the hysteresis keeps the level at its threshold
    const n = firstOf.get(id);
    // Across: centre the tree when it fits, else centre the focus and pull the tree's edges to the area's
    // edges, so the view never shows empty space where there is more tree.
    const across = (from: number, to: number, start: number, len: number, at: number) => {
      if (len * k <= to - from) return from + (to - from - len * k) / 2 - start * k;
      const off = (from + to) / 2 - at * k;
      return Math.max(to - (start + len) * k, Math.min(from - start * k, off));
    };
    // Down: centre the tree when it fits. Else a generation starts right under the toolbar, never half a
    // card behind it. Of the generations that can start there with the focus whole, the one that puts the
    // focus nearest the middle (45% down), so its parents show above it and its children below. A start
    // that would leave room for another whole card under the last generation is passed over; when every
    // start does (Ancestors, a focus with no descendants), the earliest one, which leaves the least.
    // When the focus itself is the generation under the toolbar, on full cards, it starts a little lower: the
    // focus card is drawn an eighth larger and carries the "+" for a parent above it, and both would sit behind the toolbar.
    const head = opens === 'near' ? FOCUS_HEADROOM * k : 0;
    const down = (from: number, to: number) => {
      if (b.h * k <= to - from) return from + (to - from - b.h * k) / 2 - b.y * k;
      const fy = n ? n.y : b.y;
      const tops = layout.rows.map((r) => r.y).sort((p, q) => p - q);
      const whole = tops.filter((y) => y <= fy && (fy + CARD_H - y) * k <= to - from);
      if (!whole.length) return from + head - fy * k;
      const last = tops[tops.length - 1] + CARD_H;
      const full = whole.filter((y) => to - from - (last - y) * k <= CARD_H * k);
      const off = (y: number) => Math.abs((fy + CARD_H / 2 - y) * k - (to - from) * 0.45);
      const top = full.length ? full.reduce((best, y) => (off(y) < off(best) ? y : best)) : whole[0];
      return from + (top === fy ? head : 0) - top * k;
    };
    const target = { k, x: across(lo.x, hi.x, b.x, b.w, n ? n.x : b.x + b.w / 2), y: down(lo.y, hi.y) };
    if (opts?.animate === false) { cancelAnimationFrame(anim.current); cam.current = target; lastDetail.current = opens; apply(); } else animateTo(target, 420, opens);
  }, [layout, firstOf, apply, animateTo, area]);

  const reveal = useCallback((id: string, beside?: string) => {
    const n = firstOf.get(id);
    if (!n || !host.current) return false;
    const a = area();
    if (a.b - a.t < 120) return false;
    const c = cam.current;
    const pad = 12;
    const shift = (s0: number, s1: number, from: number, to: number) => {
      if (s1 - s0 > to - from) return (from + to) / 2 - (s0 + s1) / 2;
      if (s0 < from) return from - s0;
      if (s1 > to) return to - s1;
      return 0;
    };
    // The box to bring into view: the card, widened to the second card when the two fit the free area together.
    // On full cards the card revealed is the selected one, drawn larger with a "+" above it: that is part of what must show.
    let wx0 = n.x - CARD_W / 2, wx1 = n.x + CARD_W / 2, wy0 = n.y - (lastDetail.current === 'near' ? FOCUS_HEADROOM : 0), wy1 = n.y + CARD_H;
    const m = beside ? firstOf.get(beside) : undefined;
    if (m) {
      const bx0 = Math.min(wx0, m.x - CARD_W / 2), bx1 = Math.max(wx1, m.x + CARD_W / 2), by0 = Math.min(wy0, m.y), by1 = Math.max(wy1, m.y + CARD_H);
      if ((bx1 - bx0) * c.k <= a.r - a.l - 2 * pad && (by1 - by0) * c.k <= a.b - a.t - 2 * pad) { wx0 = bx0; wx1 = bx1; wy0 = by0; wy1 = by1; }
    }
    const dx = shift(wx0 * c.k + c.x, wx1 * c.k + c.x, a.l + pad, a.r - pad);
    const dy = shift(wy0 * c.k + c.y, wy1 * c.k + c.y, a.t + pad, a.b - pad);
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return false;
    animateTo({ k: c.k, x: c.x + dx, y: c.y + dy }, 320);
    return true;
  }, [firstOf, animateTo, area]);

  const zoomAt = useCallback((factor: number, sx: number, sy: number) => {
    cancelAnimationFrame(anim.current);
    const c = cam.current;
    // Zooming out stops at the floor; a camera already past it (the tree grew smaller under it) is not pulled in.
    const k = Math.min(MAX_K, Math.max(Math.min(c.k, floor()), c.k * factor));
    const f = k / c.k;
    cam.current = { k, x: sx - (sx - c.x) * f, y: sy - (sy - c.y) * f };
    apply();
  }, [apply, floor]);

  const zoomBy = useCallback((f: number) => {
    const r = host.current!.getBoundingClientRect();
    const c = cam.current;
    const k = Math.min(MAX_K, Math.max(Math.min(c.k, floor()), c.k * f));
    animateTo({ k, x: r.width / 2 - ((r.width / 2 - c.x) / c.k) * k, y: r.height / 2 - ((r.height / 2 - c.y) / c.k) * k }, 220);
  }, [animateTo, floor]);

  // Minimap clicks and drags move the view at once, keeping the zoom.
  const minimapJump = useCallback((wx: number, wy: number) => {
    const r = host.current!.getBoundingClientRect();
    cancelAnimationFrame(anim.current);
    moved.current?.();
    // Into the middle of the part of the canvas no panel covers.
    const a = area();
    const cx = (a.l + r.width) / 2, cy = (a.t + a.b) / 2;
    cam.current = { ...cam.current, x: cx - wx * cam.current.k, y: cy - wy * cam.current.k };
    apply();
  }, [apply, area]);

  // The minimap is always there on wide screens; phones show it on request (see canvas.css).
  const [mapOpen, setMapOpen] = useState(false);
  // While the minimap shows, things docked in the window's bottom right corner (the minimized chat) stand clear of it.
  useEffect(() => {
    const d = dock.current;
    if (!d) return;
    const root = document.documentElement;
    const measure = () => {
      const map = d.querySelector<HTMLElement>('.minimap');
      if (map && map.offsetWidth > 0) root.style.setProperty('--dock-inset-right', `${map.offsetWidth + 16}px`);
      else root.style.removeProperty('--dock-inset-right');
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(d);
    return () => { ro.disconnect(); root.style.removeProperty('--dock-inset-right'); };
  }, [mapOpen]);

  useImperativeHandle(ref, () => ({
    centerOn,
    fit,
    frame,
    reveal,
    zoomBy,
    nodeOf: (id) => firstOf.get(id),
  }), [centerOn, fit, frame, reveal, zoomBy, firstOf]);

  // ---- input ----
  useEffect(() => {
    const el = host.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      // Trackpad pinch arrives as ctrl+wheel; a notched mouse wheel scrolls in lines or big steps.
      const mouseWheel = e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 40 && Number.isInteger(e.deltaY));
      userMove();
      if (e.ctrlKey || e.metaKey || mouseWheel) {
        zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0018)), sx, sy);
      } else {
        cancelAnimationFrame(anim.current);
        cam.current = { ...cam.current, x: cam.current.x - e.deltaX, y: cam.current.y - e.deltaY };
        apply();
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    const ro = new ResizeObserver(() => apply());
    ro.observe(el);
    return () => { el.removeEventListener('wheel', onWheel); ro.disconnect(); };
  }, [apply, zoomAt]);

  const drag = useRef<{ x: number; y: number; moved: boolean; id: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, a, input, textarea, .no-pan')) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y) };
    }
    drag.current = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    cancelAnimationFrame(anim.current);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const r = host.current!.getBoundingClientRect();
      userMove();
      zoomAt(d / pinch.current.d, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      pinch.current.d = d;
      return;
    }
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) userMove();
    d.moved = true;
    host.current!.classList.add('panning');
    d.x = e.clientX;
    d.y = e.clientY;
    cam.current = { ...cam.current, x: cam.current.x + dx, y: cam.current.y + dy };
    apply();
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const d = drag.current;
    host.current!.classList.remove('panning');
    if (d && !d.moved && d.id === e.pointerId && !(e.target as HTMLElement).closest('.card')) onBackground?.();
    // A drag that ends on a card must not count as a click on it.
    if (d?.moved) {
      const stop = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
      window.addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
    }
    drag.current = null;
  };

  // First paint: frame the tree around the focus.
  const mounted = useRef(false);
  useLayoutEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    frame(focus, { animate: false });
  }, [frame, focus]);

  // From the camera itself, not from `view`, which is a frame behind it: a render in between must not undo the level frame() chose.
  const detail = (lastDetail.current = detailFor(cam.current.k, lastDetail.current));
  const visible = useMemo(
    () => layout.nodes.filter((n) => n.x + CARD_W / 2 > view.x0 && n.x - CARD_W / 2 < view.x1 && n.y + CARD_H > view.y0 && n.y < view.y1),
    [layout, view.x0, view.x1, view.y0, view.y1],
  );

  return (
    <div
      ref={host}
      className={`canvas detail-${detail}`}
      data-tour="tree-canvas"
      style={{ '--name-near': `${NAME_PX.near}px`, '--name-mid': `${NAME_PX.mid}px`, '--name-seal': `${NAME_PX.seal}px` } as CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div ref={world} className="world">
        <Edges layout={layout} dimmed={dimmed} />
        <UnionLabels layout={layout} dimmed={dimmed} />
        {visible.map((n) => (
          <div
            key={n.key}
            className={`slot${n.id === focus ? ' is-focus' : ''}${dimmed && !dimmed.has(n.id) ? ' is-dim' : ''}`}
            style={{ transform: `translate(${n.x - CARD_W / 2}px, ${n.y}px)` }}
          >
            {renderCard(n, detail)}
            {flash && flash.id === n.id && n.role !== 'dup' ? <span key={flash.at} className="arrive" aria-hidden /> : null}
          </div>
        ))}
      </div>
      <Ruler layout={layout} view={view} label={rowLabel} active={layout.nodes.find((n) => n.id === focus)?.row} />
      <div ref={dock} className={`map-dock no-pan${mapOpen ? ' map-open' : ''}`}>
        <div className="map-controls panel" role="toolbar" aria-label={t('canvas.map')} aria-orientation="vertical">
          <button className="btn icon ghost map-zoom" onClick={() => { userMove(); zoomBy(1.25); }} title={t('canvas.zoomInTitle')} aria-label={t('canvas.zoomIn')}><Plus size={17} /></button>
          <button className="btn icon ghost map-zoom" onClick={() => { userMove(); zoomBy(0.8); }} title={t('canvas.zoomOutTitle')} aria-label={t('canvas.zoomOut')}><Minus size={17} /></button>
          <button className="btn icon ghost" onClick={() => { userMove(); fit(); }} title={t('canvas.fitTitle')} aria-label={t('canvas.fit')}><Expand size={16} /></button>
          {controls}
          <button className="btn icon ghost map-toggle" onClick={() => setMapOpen((o) => !o)} aria-pressed={mapOpen} title={mapOpen ? t('canvas.hideMinimap') : t('canvas.showMinimap')} aria-label={t('canvas.minimap')}><MapIcon size={16} /></button>
        </div>
        <Minimap family={family} layout={layout} view={view} focus={focus} here={firstOf.get(focus)} dimmed={dimmed} small={smallMap} onJump={minimapJump} />
      </div>
      {overlay}
    </div>
  );
});

const Edges = memo(function Edges({ layout, dimmed }: { layout: Layout; dimmed?: ReadonlySet<string> | null }) {
  const b = layout.bounds;
  return (
    <svg className="edges" style={{ left: b.x - 40, top: b.y - 40, width: b.w + 80, height: b.h + 80 }} viewBox={`${b.x - 40} ${b.y - 40} ${b.w + 80} ${b.h + 80}`}>
      {layout.edges.map((e) => {
        const lit = dimmed ? e.ids.filter((i) => dimmed.has(i)).length >= 2 : false;
        return (
          <g key={e.key}>
          <path
            d={e.d}
            className={`edge ${e.kind}${e.dashed ? ' dashed' : ''}${dimmed ? (lit ? ' lit' : ' dim') : ''}`}
          />
          </g>
        );
      })}
    </svg>
  );
});

/**
 * When two people married, on a small plate centred on their line. Name plates (mid) show the ring and the
 * year it began; full cards add the year it ended and, on a second line, how. The type is sized so that it
 * never lands under 11px on screen at the levels that show it (canvas.css); tiles hide it.
 */
const UnionLabels = memo(function UnionLabels({ layout, dimmed }: { layout: Layout; dimmed?: ReadonlySet<string> | null }) {
  const t = useT();
  return (
    <>
      {layout.edges.map((e) => {
        if (!e.label) return null;
        const lit = dimmed ? e.ids.filter((i) => dimmed.has(i)).length >= 2 : false;
        // "⚭ 1957–1997": the part up to the dash is what name plates show.
        const cut = e.label.text.indexOf('–');
        const began = cut < 0 ? e.label.text : e.label.text.slice(0, cut);
        const ended = cut < 0 ? '' : e.label.text.slice(cut);
        return (
          <div key={e.key} className={`union-label${dimmed && !lit ? ' dim' : ''}`} style={{ left: e.label.x, top: e.label.y + 9 }}>
            <span className="union-years">{began}{ended && <span className="union-ended">{ended}</span>}</span>
            {e.label.status && <span className="union-status">{t(`union.${e.label.status as 'widowed' | 'divorced' | 'ended'}`)}</span>}
          </div>
        );
      })}
    </>
  );
});

function Ruler({ layout, view, label, active }: { layout: Layout; view: { k: number; cy: number; h: number }; label?: Props['rowLabel']; active?: number }) {
  // A gutter like an editor's line numbers: the generation, and its era when there is room.
  return (
    <div className="ruler" aria-hidden>
      {layout.rows.map((r, i) => {
        const y = r.y * view.k + view.cy;
        const h = CARD_H * view.k;
        if (y + h < 0 || y > view.h || h < 24) return null;
        const [mark, era] = label ? label(r.row, r.year, i) : [String(i + 1)];
        return (
          <div key={r.row} className={`ruler-row${r.row === active ? ' active' : ''}`} style={{ top: y, height: h }}>
            <b>{mark}</b>
            {era && h >= 60 && <span>{era}</span>}
          </div>
        );
      })}
    </div>
  );
}
