// The tree canvas: pan and zoom over a laid-out tree, drawing only what is on screen.
//
// Feel: drag or two-finger scroll pans; pinch, ⌘/ctrl+wheel or a mouse wheel zooms around the
// pointer. Cards change detail with zoom (portrait → name plate → house-coloured tile). A minimap
// shows where you are in the whole tree; a ruler on the left names each generation and its era.
import { Expand, Map as MapIcon, Minus, Plus } from 'lucide-react';
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CARD_H, CARD_W, type LNode, type Layout } from '~/lib/layout';
import type { Family } from '~/lib/graph';
import { Minimap } from './Minimap';
import { useT } from '~/lib/i18n';
import './canvas.css';

export type Detail = 'far' | 'mid' | 'near';
/** Card name sizes in world pixels at each level (card.css reads them as --name-near / --name-mid). */
export const NAME_PX = { near: 15, mid: 24 } as const;
/** Smallest name on screen we accept before dropping to a simpler level. */
const MIN_TEXT_PX = 14;
// Detail follows the size names actually reach on screen (zoom × font size), not fixed zoom steps.
// With a little hysteresis, so cards don't flicker between levels while zooming near a threshold.
const detailFor = (k: number, prev: Detail): Detail => {
  const keep = 0.5; // px of slack before leaving the current level
  if (k * NAME_PX.near >= MIN_TEXT_PX - (prev === 'near' ? keep : 0)) return 'near';
  if (k * NAME_PX.mid >= MIN_TEXT_PX - (prev !== 'far' ? keep : 0)) return 'mid';
  return 'far';
};
/** The smallest zoom that still shows name plates (coming from a closer level). */
const MID_K = (MIN_TEXT_PX - 0.5) / NAME_PX.mid;
/** When the whole tree won't fit at name plates, open at this zoom around the focus instead of shrinking it to tiles. */
const READABLE_K = MIN_TEXT_PX / NAME_PX.mid + 0.01;
/** The smallest zoom that shows portraits and full cards. A tree that nearly fits at it opens there, not a level simpler. */
const NEAR_K = MIN_TEXT_PX / NAME_PX.near + 0.005;

/** Screen space covered by floating panels, in px from each edge of the canvas. */
export interface Inset { left: number; top: number; right?: number; bottom?: number }

interface Cam { x: number; y: number; k: number } // screen = world * k + (x, y)

export interface CanvasHandle {
  /** Returns whether the camera had to move noticeably. */
  centerOn(id: string, opts?: { k?: number; animate?: boolean }): boolean;
  fit(): void;
  /**
   * Opening view: the whole tree at the most detailed zoom that fits the free area; when even name
   * plates won't fit, readable name plates around `id`: a generation starts right under the toolbar and
   * the rest runs off the edge, which also shows that the canvas scrolls.
   */
  frame(id: string, opts?: { animate?: boolean }): void;
  /** Pans just enough to bring a card fully into the free area (after a sheet or panel opens). */
  reveal(id: string): boolean;
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
}

export const Canvas = forwardRef<CanvasHandle, Props>(function Canvas(
  { family, layout, focus, dimmed, renderCard, onBackground, rowLabel, overlay, inset, flash, controls, onUserMove },
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

  const animateTo = useCallback((to: Cam, ms = 420) => {
    cancelAnimationFrame(anim.current);
    // Reduced motion: no flying, just arrive.
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      cam.current = to;
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
    let right = Math.max(i.right ?? 0, d ? w - d.offsetLeft + 8 : 0);
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
    const fitK = Math.min((hi.x - lo.x) / b.w, (hi.y - lo.y) / b.h);
    // Full cards when the tree fits at them, or so nearly that a row or column just runs off the edge; else
    // name plates as large as fit; else readable name plates around the focus.
    const k = fitK >= NEAR_K * 0.86 ? Math.min(Math.max(fitK, NEAR_K), 1) : fitK >= MID_K ? fitK : READABLE_K;
    lastDetail.current = k * NAME_PX.near < MIN_TEXT_PX ? 'mid' : 'near'; // so the hysteresis keeps the level at its threshold
    const n = firstOf.get(id);
    // Across: centre the tree when it fits, else centre the focus and pull the tree's edges to the area's
    // edges, so the view never shows empty space where there is more tree.
    const across = (from: number, to: number, start: number, len: number, at: number) => {
      if (len * k <= to - from) return from + (to - from - len * k) / 2 - start * k;
      const off = (from + to) / 2 - at * k;
      return Math.max(to - (start + len) * k, Math.min(from - start * k, off));
    };
    // Down: centre the tree when it fits. Else a generation starts right under the toolbar, never half a
    // card behind it: the earliest one that still shows the focus whole. Later ones run off the bottom.
    const down = (from: number, to: number) => {
      if (b.h * k <= to - from) return from + (to - from - b.h * k) / 2 - b.y * k;
      const fy = n ? n.y : b.y;
      const tops = layout.rows.map((r) => r.y).sort((p, q) => p - q);
      const top = tops.find((y) => y <= fy && (fy + CARD_H - y) * k <= to - from) ?? fy;
      return from - top * k;
    };
    const target = { k, x: across(lo.x, hi.x, b.x, b.w, n ? n.x : b.x + b.w / 2), y: down(lo.y, hi.y) };
    if (opts?.animate === false) { cancelAnimationFrame(anim.current); cam.current = target; apply(); } else animateTo(target);
  }, [layout, firstOf, apply, animateTo, area]);

  const reveal = useCallback((id: string) => {
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
    const x0 = (n.x - CARD_W / 2) * c.k + c.x, y0 = n.y * c.k + c.y;
    const dx = shift(x0, x0 + CARD_W * c.k, a.l + pad, a.r - pad);
    const dy = shift(y0, y0 + CARD_H * c.k, a.t + pad, a.b - pad);
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return false;
    animateTo({ k: c.k, x: c.x + dx, y: c.y + dy }, 320);
    return true;
  }, [firstOf, animateTo, area]);

  const zoomAt = useCallback((factor: number, sx: number, sy: number) => {
    cancelAnimationFrame(anim.current);
    const c = cam.current;
    const k = Math.min(2.2, Math.max(0.04, c.k * factor));
    const f = k / c.k;
    cam.current = { k, x: sx - (sx - c.x) * f, y: sy - (sy - c.y) * f };
    apply();
  }, [apply]);

  const zoomBy = useCallback((f: number) => {
    const r = host.current!.getBoundingClientRect();
    const c = cam.current;
    const k = Math.min(2.2, Math.max(0.04, c.k * f));
    animateTo({ k, x: r.width / 2 - ((r.width / 2 - c.x) / c.k) * k, y: r.height / 2 - ((r.height / 2 - c.y) / c.k) * k }, 220);
  }, [animateTo]);

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

  const detail = (lastDetail.current = detailFor(view.k, lastDetail.current));
  const visible = useMemo(
    () => layout.nodes.filter((n) => n.x + CARD_W / 2 > view.x0 && n.x - CARD_W / 2 < view.x1 && n.y + CARD_H > view.y0 && n.y < view.y1),
    [layout, view.x0, view.x1, view.y0, view.y1],
  );

  return (
    <div
      ref={host}
      className={`canvas detail-${detail}`}
      style={{ '--name-near': `${NAME_PX.near}px`, '--name-mid': `${NAME_PX.mid}px` } as CSSProperties}
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
          <button className="btn icon ghost" onClick={() => { userMove(); zoomBy(1.25); }} title={t('canvas.zoomInTitle')} aria-label={t('canvas.zoomIn')}><Plus size={17} /></button>
          <button className="btn icon ghost" onClick={() => { userMove(); zoomBy(0.8); }} title={t('canvas.zoomOutTitle')} aria-label={t('canvas.zoomOut')}><Minus size={17} /></button>
          <button className="btn icon ghost" onClick={() => { userMove(); fit(); }} title={t('canvas.fitTitle')} aria-label={t('canvas.fit')}><Expand size={16} /></button>
          {controls}
          <button className="btn icon ghost map-toggle" onClick={() => setMapOpen((o) => !o)} aria-pressed={mapOpen} title={mapOpen ? t('canvas.hideMinimap') : t('canvas.showMinimap')} aria-label={t('canvas.minimap')}><MapIcon size={16} /></button>
        </div>
        <Minimap family={family} layout={layout} view={view} focus={focus} here={firstOf.get(focus)} dimmed={dimmed} onJump={minimapJump} />
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
