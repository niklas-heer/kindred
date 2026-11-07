// The tree canvas: pan and zoom over a laid-out tree, drawing only what is on screen.
//
// Feel: drag or two-finger scroll pans; pinch, ⌘/ctrl+wheel or a mouse wheel zooms around the
// pointer. Cards change detail with zoom (portrait → name plate → house-coloured tile). A minimap
// shows where you are in the whole tree; a ruler on the left names each generation and its era.
import { Expand, Map as MapIcon, Minus, Plus } from 'lucide-react';
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CARD_H, CARD_W, ROW_H, type LNode, type Layout } from '~/lib/layout';
import type { Family } from '~/lib/graph';
import { houseColour } from './Heraldry';
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

interface Cam { x: number; y: number; k: number } // screen = world * k + (x, y)

export interface CanvasHandle {
  /** Returns whether the camera had to move noticeably. */
  centerOn(id: string, opts?: { k?: number; animate?: boolean }): boolean;
  fit(): void;
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
  /** Screen space covered by floating panels: side panel left, toolbar and banner on top, minimap right, sheet below. */
  inset?: { left: number; top: number; right?: number; bottom?: number };
  /** Person to greet with a brief ring, after the camera arrives at them. */
  flash?: { id: string; at: number } | null;
  /** Extra buttons for the map control stack (below zoom and fit), e.g. keyboard help. */
  controls?: ReactNode;
  /** Called once when the reader starts moving the camera themselves (drag, wheel, pinch, minimap). */
  onUserMove?: () => void;
}

export const Canvas = forwardRef<CanvasHandle, Props>(function Canvas(
  { family, layout, focus, dimmed, renderCard, onBackground, rowLabel, overlay, inset = { left: 0, top: 0 }, flash, controls, onUserMove },
  ref,
) {
  const moved = useRef(onUserMove);
  moved.current = onUserMove;
  const userMove = () => moved.current?.();
  const host = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const cam = useRef<Cam>({ x: 0, y: 0, k: 0.8 });
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

  const centerOn = useCallback((id: string, opts?: { k?: number; animate?: boolean }) => {
    const n = firstOf.get(id);
    const el = host.current;
    if (!n || !el) return false;
    const { width: w, height: h } = el.getBoundingClientRect();
    const k = opts?.k ?? Math.max(cam.current.k, 0.55);
    // Centre in the part of the canvas no panel covers (unless the panel leaves almost nothing).
    const left = w - inset.left < 320 ? 56 : inset.left;
    const bottom = h - inset.top - (inset.bottom ?? 0) < 200 ? 0 : inset.bottom ?? 0;
    const cx = left + (w - left) / 2, cy = inset.top + (h - inset.top - bottom) * 0.46;
    const target = { k, x: cx - n.x * k, y: cy - (n.y + CARD_H / 2) * k };
    const c = cam.current;
    const moved = Math.hypot(target.x - c.x, target.y - c.y) > 24 || Math.abs(target.k - c.k) > 0.02;
    if (opts?.animate === false) { cam.current = target; apply(); } else animateTo(target);
    return moved;
  }, [firstOf, apply, animateTo, inset.left, inset.top, inset.right, inset.bottom]);

  const fit = useCallback(() => {
    const el = host.current;
    if (!el) return;
    const { width: w, height: h } = el.getBoundingClientRect();
    const b = layout.bounds;
    const right = w - inset.left - (inset.right ?? 0) < (w < 600 ? 220 : 400) ? 0 : inset.right ?? 0;
    const left = w - inset.left < 320 ? 56 : inset.left;
    const bottom = h - inset.top - (inset.bottom ?? 0) < 200 ? 0 : inset.bottom ?? 0;
    // Narrow screens get a slimmer margin, or the tree shrinks to nothing.
    const mx = w < 600 ? 16 : 60, my = w < 600 ? 12 : 30;
    const aw = w - left - right - 2 * mx, ah = h - inset.top - bottom - 2 * my;
    const k = Math.min(1, Math.max(0.04, Math.min(aw / b.w, ah / b.h)));
    animateTo({ k, x: left + mx + aw / 2 - (b.x + b.w / 2) * k, y: inset.top + my + ah / 2 - (b.y + b.h / 2) * k });
  }, [layout, animateTo, inset.left, inset.top, inset.right, inset.bottom]);

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
  // The minimap is always there on wide screens; phones show it on request (see canvas.css).
  const [mapOpen, setMapOpen] = useState(false);

  useImperativeHandle(ref, () => ({
    centerOn,
    fit,
    zoomBy,
    nodeOf: (id) => firstOf.get(id),
  }), [centerOn, fit, zoomBy, firstOf]);

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

  // First paint: centre on the focus.
  const mounted = useRef(false);
  useLayoutEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    centerOn(focus, { animate: false, k: 0.85 });
  }, [centerOn, focus]);

  const lastDetail = useRef<Detail>('near');
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
      <div className={`map-dock no-pan${mapOpen ? ' map-open' : ''}`}>
        <div className="map-controls panel" role="toolbar" aria-label="Map" aria-orientation="vertical">
          <button className="btn icon ghost" onClick={() => zoomBy(1.25)} title="Zoom in (=)" aria-label="Zoom in"><Plus size={17} /></button>
          <button className="btn icon ghost" onClick={() => zoomBy(0.8)} title="Zoom out (−)" aria-label="Zoom out"><Minus size={17} /></button>
          <button className="btn icon ghost" onClick={fit} title="Fit everything (F)" aria-label="Fit everything"><Expand size={16} /></button>
          {controls}
          <button className="btn icon ghost map-toggle" onClick={() => setMapOpen((o) => !o)} aria-pressed={mapOpen} title={mapOpen ? 'Hide the minimap' : 'Show the minimap'} aria-label="Minimap"><MapIcon size={16} /></button>
        </div>
        <Minimap family={family} layout={layout} view={view} focus={focus} dimmed={dimmed} onJump={(wx, wy) => {
          const r = host.current!.getBoundingClientRect();
          cancelAnimationFrame(anim.current);
          userMove();
          // Into the middle of the part of the canvas no panel covers.
          const left = r.width - inset.left < 320 ? 56 : inset.left;
          const bottom = r.height - inset.top - (inset.bottom ?? 0) < 200 ? 0 : inset.bottom ?? 0;
          const cx = left + (r.width - left) / 2, cy = inset.top + (r.height - inset.top - bottom) / 2;
          cam.current = { ...cam.current, x: cx - wx * cam.current.k, y: cy - wy * cam.current.k };
          apply();
        }} />
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
          <path
            key={e.key}
            d={e.d}
            className={`edge ${e.kind}${e.dashed ? ' dashed' : ''}${dimmed ? (lit ? ' lit' : ' dim') : ''}`}
          />
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

function Minimap({ family, layout, view, focus, dimmed, onJump }: {
  family: Family; layout: Layout; view: { x0: number; y0: number; x1: number; y1: number; k: number }; focus: string;
  dimmed?: ReadonlySet<string> | null; onJump: (wx: number, wy: number) => void;
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
    // You are here: a bright dot with a dark ring, visible on any house colour.
    const f = layout.nodes.find((n) => n.id === focus);
    if (f) {
      const cx = f.x * s + ox, cy = (f.y + CARD_H / 2) * s + oy;
      g.globalAlpha = 1;
      g.beginPath();
      g.arc(cx, cy, 4.5, 0, Math.PI * 2);
      g.fillStyle = css.getPropertyValue('--accent').trim() || '#fc0';
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = theme === 'modern' ? '#ffffff' : '#0b0e14';
      g.stroke();
    }
  }, [layout, family, s, ox, oy, tints, focus, dimmed, MM_W, MM_H, theme]);

  const vx = view.x0 + 260 / view.k, vy = view.y0 + 260 / view.k;
  const vw = view.x1 - view.x0 - 520 / view.k, vh = view.y1 - view.y0 - 520 / view.k;
  const jump = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    onJump((e.clientX - r.left - ox) / s, (e.clientY - r.top - oy) / s);
  };
  const people = new Set(layout.nodes.filter((n) => n.role !== 'ghost').map((n) => n.id)).size;
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
      <div
        className="minimap-map"
        role="application"
        tabIndex={0}
        aria-label={`Minimap of ${people} people. Click to jump there, or use the arrow keys to move the view.`}
        onKeyDown={onKey}
        style={{ width: MM_W, height: MM_H }}
        onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); jump(e); }}
        onPointerMove={(e) => e.buttons && jump(e)}
      >
        <canvas ref={cv} style={{ width: MM_W, height: MM_H }} />
        <div className="minimap-view" style={{ left: vx * s + ox, top: vy * s + oy, width: Math.max(6, vw * s), height: Math.max(6, vh * s) }} />
      </div>
      <div className="minimap-foot">
        <span>{people.toLocaleString('en-GB')} people</span>
        <span>{layout.rows.length} generations</span>
      </div>
    </div>
  );
}

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
