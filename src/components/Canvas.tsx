// The tree canvas: pan and zoom over a laid-out tree, drawing only what is on screen.
//
// Feel: drag or two-finger scroll pans; pinch, ⌘/ctrl+wheel or a mouse wheel zooms around the
// pointer. Cards change detail with zoom (portrait → name plate → house-coloured tile). A minimap
// shows where you are in the whole tree; a ruler on the left names each generation and its era.
import { Expand, Map as MapIcon, Minus, Plus } from 'lucide-react';
import { forwardRef, memo, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CARD_H, CARD_W, ROW_H, type LNode, type Layout } from '~/lib/layout';
import type { Family } from '~/lib/graph';
import { houseLandmarks, type HouseLandmark, type LandmarkPerson } from '~/lib/minimap-landmarks';
import { Arms, houseColour } from './Heraldry';
import { useT } from '~/lib/i18n';
import './canvas.css';

export type Detail = 'far' | 'mid' | 'near';
/** Card name sizes in world pixels at each level (card.css reads them as --name-near / --name-mid). */
export const NAME_PX = { near: 15, mid: 24 } as const;
/** Smallest name on screen we accept before dropping to a simpler level. */
const MIN_TEXT_PX = 9.5;
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

/** Screen space covered by floating panels, in px from each edge of the canvas. */
export interface Inset { left: number; top: number; right?: number; bottom?: number }

interface Cam { x: number; y: number; k: number } // screen = world * k + (x, y)

export interface CanvasHandle {
  /** Returns whether the camera had to move noticeably. */
  centerOn(id: string, opts?: { k?: number; animate?: boolean }): boolean;
  fit(): void;
  /**
   * Opening view: the whole tree at the most detailed zoom that fits the free area; when even name
   * plates won't fit, name plates around `id`, with the tree's edges pulled in so no space is wasted.
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
    const gutter = w <= 900 ? 40 : 56; // the ruler
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
    const k = opts?.k ?? Math.max(cam.current.k, 0.55);
    // Centre in the part of the canvas no panel covers (the map controls only hide a corner).
    const cx = (a.l + a.w) / 2, cy = a.t + (a.b - a.t) * 0.46;
    const target = { k, x: cx - n.x * k, y: cy - (n.y + CARD_H / 2) * k };
    const c = cam.current;
    const moved = Math.hypot(target.x - c.x, target.y - c.y) > 24 || Math.abs(target.k - c.k) > 0.02;
    if (opts?.animate === false) { cam.current = target; apply(); } else animateTo(target);
    return moved;
  }, [firstOf, apply, animateTo, area]);

  const margins = (w: number) => (w < 600 ? { x: 12, y: 10 } : { x: 28, y: 18 });

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
    const k = fitK >= MID_K ? Math.min(fitK, 0.9) : READABLE_K;
    if (k < 0.6) lastDetail.current = 'mid'; // so the hysteresis keeps name plates at the threshold
    const n = firstOf.get(id);
    // Along one axis: centre the tree when it fits, else centre the focus and pull the tree's edges
    // to the area's edges, so the view never shows empty space where there is more tree.
    const place = (from: number, to: number, start: number, len: number, at: number, topFirst = false) => {
      if (len * k <= to - from) return from + (to - from - len * k) / 2 - start * k;
      // On a phone the top generation starts just under the toolbar, if the focus still shows above the sheet.
      if (topFirst && from + (at + CARD_H / 2 - start) * k <= to) return from - start * k;
      const off = (from + to) / 2 - at * k;
      return Math.max(to - (start + len) * k, Math.min(from - start * k, off));
    };
    const narrow = a.w <= 900;
    const target = {
      k,
      x: place(lo.x, hi.x, b.x, b.w, n ? n.x : b.x + b.w / 2),
      y: place(lo.y, hi.y, b.y, b.h, n ? n.y + CARD_H / 2 : b.y + b.h / 2, narrow),
    };
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

  // Minimap clicks and drags move the view at once, keeping the zoom. Stable, so the minimap's
  // shields are not re-rendered on every pan frame.
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

  // A house shield glides to the house, centred as a search centres a person, and at a zoom where its people read.
  const houseJump = useCallback((wx: number, wy: number) => {
    if (!host.current) return;
    moved.current?.();
    const a = area();
    const k = Math.max(cam.current.k, 0.55);
    animateTo({ k, x: (a.l + a.w) / 2 - wx * k, y: a.t + (a.b - a.t) * 0.46 - wy * k });
  }, [area, animateTo]);

  // The minimap is always there on wide screens; phones show it on request (see canvas.css).
  const [mapOpen, setMapOpen] = useState(false);

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
          <button className="btn icon ghost" onClick={() => zoomBy(1.25)} title={t('canvas.zoomInTitle')} aria-label={t('canvas.zoomIn')}><Plus size={17} /></button>
          <button className="btn icon ghost" onClick={() => zoomBy(0.8)} title={t('canvas.zoomOutTitle')} aria-label={t('canvas.zoomOut')}><Minus size={17} /></button>
          <button className="btn icon ghost" onClick={fit} title={t('canvas.fitTitle')} aria-label={t('canvas.fit')}><Expand size={16} /></button>
          {controls}
          <button className="btn icon ghost map-toggle" onClick={() => setMapOpen((o) => !o)} aria-pressed={mapOpen} title={mapOpen ? t('canvas.hideMinimap') : t('canvas.showMinimap')} aria-label={t('canvas.minimap')}><MapIcon size={16} /></button>
        </div>
        <Minimap family={family} layout={layout} view={view} focus={focus} dimmed={dimmed} onJump={minimapJump} onHouse={houseJump} />
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
          {e.label && <text className={`union-label${dimmed && !lit ? ' dim' : ''}`} x={e.label.x} y={e.label.y} textAnchor="middle">
            <tspan>{e.label.text}</tspan>
            {e.label.status && <tspan className="union-status" x={e.label.x} dy={-16}>{e.label.status}</tspan>}
          </text>}
          </g>
        );
      })}
    </svg>
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

// ---------- minimap ----------

const MM_MAX_W = 240, MM_MAX_H = 180, MM_MIN_W = 150, MM_MIN_H = 110;
/** A house shield on the minimap, px wide (Arms draws it 5 wide to 6 tall). */
const SHIELD_PX = 22;

function Minimap({ family, layout, view, focus, dimmed, onJump, onHouse }: {
  family: Family; layout: Layout; view: { x0: number; y0: number; x1: number; y1: number; k: number }; focus: string;
  dimmed?: ReadonlySet<string> | null; onJump: (wx: number, wy: number) => void; onHouse: (wx: number, wy: number) => void;
}) {
  const cv = useRef<HTMLCanvasElement>(null);
  const b = layout.bounds;
  // The map takes the tree's shape, within limits, so a tall dynasty is not a sliver in a wide box.
  const fitS = Math.min((MM_MAX_W - 16) / b.w, (MM_MAX_H - 16) / b.h);
  const MM_W = Math.round(Math.max(MM_MIN_W, b.w * fitS + 16));
  const MM_H = Math.round(Math.max(MM_MIN_H, b.h * fitS + 16));
  const s = Math.min((MM_W - 16) / b.w, (MM_H - 16) / b.h);
  const ox = (MM_W - b.w * s) / 2 - b.x * s;
  const oy = (MM_H - b.h * s) / 2 - b.y * s;
  const theme = useThemeName();
  // House tints rather than raw tinctures: full heraldic red or silver is loud on paper and lost on
  // dark lacquer. Living people get the stronger tint, the dead a paler one.
  const tints = useMemo(() => {
    const css = typeof document === 'undefined' ? null : getComputedStyle(document.documentElement);
    const ground = css?.getPropertyValue('--canvas').trim() || '#6b6142';
    const light = theme === 'modern';
    const m = new Map<string, { living: string; dead: string }>();
    for (const h of family.graph.houses) {
      // Silver vanishes on paper and gold on the codex's gold canvas: give metals some ink.
      let c = houseColour(h.arms);
      if (light && h.arms.field === 'argent') c = '#8f8b80';
      if (!light && h.arms.field === 'sable') c = '#5a5650';
      // Paper draws people as white tiles, so its map uses pale house tints, like coloured index cards.
      m.set(h.id, light
        ? { living: mixHex(c, '#ffffff', 0.42), dead: mixHex(c, '#ffffff', 0.24) }
        : { living: mixHex(c, '#ffffff', 0.88), dead: mixHex(c, ground, 0.68) });
    }
    const none = css?.getPropertyValue('--line').trim() || '#999';
    m.set('', light ? { living: mixHex(none, '#ffffff', 0.5), dead: mixHex(none, '#ffffff', 0.3) } : { living: mixHex(none, ground, 0.9), dead: mixHex(none, ground, 0.6) });
    return m;
  }, [family, theme]);

  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = MM_W * dpr;
    c.height = MM_H * dpr;
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, MM_W, MM_H);
    const css = getComputedStyle(c);
    g.strokeStyle = css.getPropertyValue('--line').trim() || '#999';
    g.globalAlpha = 0.35;
    g.lineWidth = 0.6;
    g.beginPath();
    const row = new Map<number, number[]>();
    for (const n of layout.nodes) (row.get(n.row) ?? row.set(n.row, []).get(n.row)!).push(n.x);
    for (const [r, xs] of row) {
      const y = (r * ROW_H - (ROW_H - CARD_H) / 2) * s + oy;
      g.moveTo(Math.min(...xs) * s + ox, y);
      g.lineTo(Math.max(...xs) * s + ox, y);
    }
    g.stroke();
    const w = Math.max(1.5, CARD_W * s), h = Math.max(1.5, CARD_H * s);
    for (const n of layout.nodes) {
      const p = family.byId.get(n.id);
      const t = tints.get(p?.house ?? '') ?? tints.get('')!;
      g.globalAlpha = n.role === 'ghost' ? 0.25 : dimmed && !dimmed.has(n.id) ? 0.2 : n.role === 'dup' ? 0.5 : 1;
      g.fillStyle = n.role === 'ghost' ? tints.get('')!.dead : p?.living ? t.living : t.dead;
      g.fillRect((n.x - CARD_W / 2) * s + ox, n.y * s + oy, w, h);
      if (theme === 'modern' && w >= 4) {
        g.lineWidth = 0.75;
        g.strokeStyle = '#2a22142e';
        g.strokeRect((n.x - CARD_W / 2) * s + ox + 0.4, n.y * s + oy + 0.4, w - 0.8, h - 0.8);
      }
    }
    // "You are here" is a DOM dot (below), so the house shields can sit under it.
  }, [layout, family, s, ox, oy, tints, dimmed, MM_W, MM_H, theme]);

  const vx = view.x0 + 260 / view.k, vy = view.y0 + 260 / view.k;
  const vw = view.x1 - view.x0 - 520 / view.k, vh = view.y1 - view.y0 - 520 / view.k;
  const jump = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    onJump((e.clientX - r.left - ox) / s, (e.clientY - r.top - oy) / s);
  };
  const t = useT();
  // Only real people count: an empty family's layout still holds a placeholder card. Memoised: this renders every frame of a pan.
  const count = useMemo(
    () => new Set(layout.nodes.filter((n) => n.role !== 'ghost' && family.byId.has(n.id)).map((n) => n.id)).size,
    [layout, family],
  );
  const peopleText = t('common.people', { count });
  // The house shields: each placed person with a house, at the middle of their card. Only the layout changes them.
  const people = useMemo(() => {
    const out: LandmarkPerson[] = [];
    for (const n of layout.nodes) {
      const p = n.role === 'ghost' ? undefined : family.byId.get(n.id);
      if (p?.house && family.house.has(p.house)) out.push({ id: n.id, house: p.house, x: n.x, y: n.y + CARD_H / 2 });
    }
    return out;
  }, [layout, family]);
  const marks = useMemo(
    () => houseLandmarks(people, { s, ox, oy, width: MM_W, height: MM_H }, { cardW: CARD_W, rowH: ROW_H, size: SHIELD_PX }),
    [people, s, ox, oy, MM_W, MM_H],
  );
  // With a filter on (`dimmed` is the set that stays bright), a house with none of those people fades, as its dots do.
  const faded = useMemo(() => {
    const out = new Set<string>();
    if (!dimmed) return out;
    const lit = new Set(people.filter((p) => dimmed.has(p.id)).map((p) => p.house));
    for (const m of marks) if (!lit.has(m.house)) out.add(m.house);
    return out;
  }, [dimmed, people, marks]);
  const here = useMemo(() => layout.nodes.find((n) => n.id === focus), [layout, focus]);
  // Keyboard: arrows move the view a quarter screen at a time.
  const onKey = (e: React.KeyboardEvent) => {
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    onJump(vx + vw / 2 + (step[0] * vw) / 4, vy + vh / 2 + (step[1] * vh) / 4);
  };
  return (
    <div className="minimap no-pan panel">
      {/* The shields sit beside the map, not inside it, so their tooltips are not clipped and their clicks never start a map drag. */}
      <div className="minimap-stage" style={{ width: MM_W, height: MM_H }}>
        <div
          className="minimap-map"
          role="application"
          tabIndex={0}
          aria-label={t('canvas.minimap_label', { people: peopleText })}
          onKeyDown={onKey}
          style={{ width: MM_W, height: MM_H }}
          onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); jump(e); }}
          onPointerMove={(e) => e.buttons && jump(e)}
        >
          <canvas ref={cv} style={{ width: MM_W, height: MM_H }} />
          <div className="minimap-view" style={{ left: vx * s + ox, top: vy * s + oy, width: Math.max(6, vw * s), height: Math.max(6, vh * s) }} />
        </div>
        <HouseShields marks={marks} family={family} faded={faded} onHouse={onHouse} />
        {here ? <span className="minimap-here" aria-hidden style={{ left: here.x * s + ox, top: (here.y + CARD_H / 2) * s + oy }} /> : null}
      </div>
      <div className="minimap-foot">
        <span>{peopleText}</span>
        <span>{t('common.generations', { count: count ? layout.rows.length : 0 })}</span>
      </div>
    </div>
  );
}

/**
 * One house shield per landmark. Memoised on the landmarks, not the camera: a pan or zoom re-renders the minimap
 * (its viewport box moves) but leaves these buttons alone. Each is a real button, so Tab reaches it and Enter or
 * a click jumps the main view there; its name is "Jump to <house>", and its tooltip (shown on hover or keyboard
 * focus) gives the people count.
 */
const HouseShields = memo(function HouseShields({ marks, family, faded, onHouse }: {
  marks: HouseLandmark[]; family: Family; faded: ReadonlySet<string>; onHouse: (wx: number, wy: number) => void;
}) {
  const t = useT();
  const id = useId();
  if (!marks.length) return null;
  return (
    <div className="house-landmarks" role="group" aria-label={t('canvas.houses')}>
      {marks.map((m, i) => {
        const house = family.house.get(m.house)!;
        const tipId = `${id}-${i}`;
        return (
          <button
            key={m.house}
            type="button"
            className={`house-landmark${faded.has(m.house) ? ' is-faded' : ''}`}
            data-tip={m.tip}
            data-align={m.align}
            style={{ left: m.x, top: m.y, width: SHIELD_PX, height: SHIELD_PX * 1.2 }}
            aria-label={t('canvas.jumpHouse', { house: house.name })}
            aria-describedby={tipId}
            onClick={() => onHouse(m.wx, m.wy)}
          >
            <span className="house-shield" aria-hidden>
              <Arms arms={house.arms} size={SHIELD_PX} />
            </span>
            <span className="house-tip" id={tipId}>
              <b>{house.name}</b>
              <span>{t('common.people', { count: m.people })}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
});

/** The theme on <html>, kept in sync when the reader switches it. */
function useThemeName(): string {
  const [t, setT] = useState('codex');
  useEffect(() => {
    const el = document.documentElement;
    const read = () => setT(el.dataset.theme ?? 'codex');
    read();
    const mo = new MutationObserver(read);
    mo.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  return t;
}

/** Mix two #rrggbb colours: t = 1 is all `a`. */
function mixHex(a: string, b: string, t: number): string {
  const p = (h: string) => {
    const x = h.replace('#', '');
    const f = x.length === 3 ? x.split('').map((c) => c + c).join('') : x.slice(0, 6);
    return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) || 0);
  };
  const [ca, cb] = [p(a), p(b)];
  return '#' + ca.map((v, i) => Math.round(v * t + cb[i] * (1 - t)).toString(16).padStart(2, '0')).join('');
}
