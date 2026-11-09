// The whole family at a glance: the canvas's far-zoom shields and its real family lines, small enough
// to fit in a corner, with the viewport as a box you can click or drag.
//
// The shields on the canvas are DOM nodes with stacked shadows, far too heavy to mount again for
// every person, so this draws the same shape, colours and edge paths on one <canvas>. It repaints only
// when the family, focus, filter or theme changes; panning just moves the viewport box.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Family } from '~/lib/graph';
import { useT } from '~/lib/i18n';
import { CARD_H, CARD_W, type LNode, type Layout } from '~/lib/layout';
import { letterPx, mapToWorld, minimapDensity, minimapFrame, shieldPaint, worldToMap, type MinimapDensity, type MinimapFrame, type ShieldPaint } from '~/lib/minimap';
import { shieldColours } from './Heraldry';

/** The far card's box inside its slot, as card.css lays it out. */
const SHIELD_TOP = 8, SHIELD_W = 148, SHIELD_H = 180;
const ASPECT = SHIELD_H / SHIELD_W;
/** The focused person is never drawn smaller than this, so they can be found on a big family's map. */
const FOCUS_MIN_PX = 9;

interface View { x0: number; y0: number; x1: number; y1: number; k: number }

export function Minimap({ family, layout, view, focus, here, dimmed, small, onJump }: {
  family: Family;
  layout: Layout;
  view: View;
  focus: string;
  /** Where the focused person stands, when they are in this layout. */
  here?: LNode;
  dimmed?: ReadonlySet<string> | null;
  /** Drawn a quarter smaller, where the canvas is short of room. */
  small?: boolean;
  onJump: (wx: number, wy: number) => void;
}) {
  const t = useT();
  const cv = useRef<HTMLCanvasElement>(null);
  const frame = useMemo(() => minimapFrame(layout.bounds, CARD_W, small), [layout.bounds, small]);
  const theme = useThemeName();
  const fonts = useFontsReady();

  useEffect(() => {
    if (cv.current) paintMinimap(cv.current, { family, layout, frame, here, dimmed, light: theme === 'modern' });
  }, [family, layout, frame, here, focus, dimmed, theme, fonts]);

  const vx = view.x0 + 260 / view.k, vy = view.y0 + 260 / view.k;
  const vw = view.x1 - view.x0 - 520 / view.k, vh = view.y1 - view.y0 - 520 / view.k;
  const box = worldToMap(frame, vx, vy);
  const jump = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const w = mapToWorld(frame, e.clientX - r.left, e.clientY - r.top);
    onJump(w.x, w.y);
  };
  // Only real people count: an empty family's layout still holds a placeholder card. Memoised: this renders every frame of a pan.
  const count = useMemo(
    () => new Set(layout.nodes.filter((n) => n.role !== 'ghost' && family.byId.has(n.id)).map((n) => n.id)).size,
    [layout, family],
  );
  const peopleText = t('common.people', { count });
  // Keyboard: arrows move the view a quarter screen at a time.
  const onKey = (e: React.KeyboardEvent) => {
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    onJump(vx + vw / 2 + (step[0] * vw) / 4, vy + vh / 2 + (step[1] * vh) / 4);
  };
  return (
    <div className={`minimap no-pan panel${small ? ' small' : ''}`}>
      <div
        className="minimap-map"
        role="application"
        tabIndex={0}
        aria-label={t('canvas.minimap_label', { people: peopleText })}
        onKeyDown={onKey}
        style={{ width: frame.width, height: frame.height }}
        onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); jump(e); }}
        onPointerMove={(e) => e.buttons && jump(e)}
      >
        <canvas ref={cv} style={{ width: frame.width, height: frame.height }} />
        <div className="minimap-view" style={{ left: box.x, top: box.y, width: Math.max(6, vw * frame.s), height: Math.max(6, vh * frame.s) }} />
      </div>
      <div className="minimap-foot">
        <span>{peopleText}</span>
        <span>{t('common.generations', { count: count ? layout.rows.length : 0 })}</span>
      </div>
    </div>
  );
}

interface Scene {
  family: Family;
  layout: Layout;
  frame: MinimapFrame;
  here?: LNode;
  dimmed?: ReadonlySet<string> | null;
  light: boolean;
}

/** The far card's outline, one unit wide, centred on x = 0 with its top on y = 0 (the radii of card.css). */
let unitShield: Path2D | undefined;
function shieldPath(): Path2D {
  if (unitShield) return unitShield;
  const top = { x: 12 / SHIELD_W, y: 12 / SHIELD_W };
  const bottom = { x: 0.5, y: 0.36 * ASPECT };
  unitShield = new Path2D();
  unitShield.roundRect(-0.5, 0, 1, ASPECT, [top, top, bottom, bottom]);
  return unitShield;
}

function paintMinimap(c: HTMLCanvasElement, { family, layout, frame, here, dimmed, light }: Scene) {
  const dpr = window.devicePixelRatio || 1;
  const px = Math.round(frame.width * dpr), py = Math.round(frame.height * dpr);
  if (c.width !== px || c.height !== py) { c.width = px; c.height = py; }
  const g = c.getContext('2d');
  if (!g) return;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, px, py);

  const css = getComputedStyle(c);
  const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const ground = token('--canvas', '#6b6142');
  const ok = token('--ok', '#7fb36d');
  const lineColour = css.getPropertyValue('--mm-line').trim() || token('--line', '#999');
  const accent = token('--accent', '#e2bd6b');
  const inkOfCanvas = token('--canvas-ink', '#1f1d1a');
  const fontFamily = token('--font-display', 'serif');
  const density = minimapDensity(CARD_W * frame.s);

  paintLines(g, layout, frame, density, dimmed, dpr, lineColour, accent);

  const shield = shieldPath();
  const shieldPaints = new Map<string, ShieldPaint>();
  const gradients = new Map<string, CanvasGradient>();
  const paintOf = (house: string | undefined, living: boolean) => {
    const key = `${house ?? ''}:${living ? 1 : 0}`;
    let out = shieldPaints.get(key);
    if (!out) {
      const h = house ? family.house.get(house) : undefined;
      const { house: colour, ink } = shieldColours(h?.arms);
      out = shieldPaint(light, colour, ink, living, ground);
      shieldPaints.set(key, out);
    }
    return out;
  };
  const fillOf = (house: string | undefined, living: boolean, p: ShieldPaint) => {
    if (p.top === p.bottom) return p.top;
    const key = `${house ?? ''}:${living ? 1 : 0}`;
    let out = gradients.get(key);
    if (!out) {
      out = g.createLinearGradient(0, 0, 0, ASPECT);
      out.addColorStop(0, p.top);
      out.addColorStop(1, p.bottom);
      gradients.set(key, out);
    }
    return out;
  };

  /** Draws one shield with its top centre at (cx, top), `w` map pixels wide. */
  const drawShield = (house: string | undefined, living: boolean, cx: number, top: number, w: number, rim: number) => {
    const p = paintOf(house, living);
    g.setTransform(w * dpr, 0, 0, w * dpr, cx * dpr, top * dpr);
    if (rim > 0) {
      // Green for the living, as on the canvas; a dark casting line for the dead.
      g.strokeStyle = living ? ok : '#1b1408aa';
      g.lineWidth = (rim * 2) / w;
      g.stroke(shield);
    }
    g.fillStyle = fillOf(house, living, p);
    g.fill(shield);
    if (p.edge && rim > 0) {
      g.strokeStyle = p.edge;
      g.lineWidth = Math.min(rim, w * 0.09) / w;
      g.stroke(shield);
    }
    return p;
  };

  const shieldTop = (n: LNode, w: number) => {
    const y = n.y * frame.s + frame.oy;
    // A dot held at its minimum size stays centred on its card.
    return w > CARD_W * frame.s ? y + (CARD_H * frame.s - w * ASPECT) / 2 : y + SHIELD_TOP * frame.s;
  };

  const letters = density.step === 'initials';
  if (letters) {
    g.font = `600 ${letterPx(density.width)}px ${fontFamily}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
  }
  for (const n of layout.nodes) {
    if (here && n.key === here.key) continue;
    const p = family.byId.get(n.id);
    const cx = n.x * frame.s + frame.ox;
    const w = density.width;
    const top = shieldTop(n, w);
    const faded = dimmed && !dimmed.has(n.id);
    if (n.role === 'ghost' || !p) {
      // An empty slot: a dashed outline where there is room for one, a faint mark where there is not.
      g.globalAlpha = faded ? 0.12 : 0.4;
      if (density.rim > 0) {
        g.setTransform(w * dpr, 0, 0, w * dpr, cx * dpr, top * dpr);
        g.strokeStyle = inkOfCanvas;
        g.lineWidth = 0.8 / w;
        g.setLineDash([2.5 / w, 2 / w]);
        g.stroke(shield);
        g.setLineDash([]);
      } else {
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.fillStyle = inkOfCanvas;
        g.fillRect(cx - w / 2, top, w, w * ASPECT);
      }
      continue;
    }
    g.globalAlpha = faded ? 0.2 : n.role === 'dup' ? 0.55 : 1;
    if (density.rim > 0) {
      const paint = drawShield(p.house || undefined, p.living, cx, top, w, density.rim);
      if (letters) {
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.globalAlpha = (faded ? 0.2 : n.role === 'dup' ? 0.55 : 1) * paint.letterAlpha;
        g.fillStyle = paint.letter;
        g.fillText(initialOf(p.given), cx, top + w * ASPECT * 0.45);
      }
    } else if (density.step === 'small') {
      g.setTransform(w * dpr, 0, 0, w * dpr, cx * dpr, top * dpr);
      g.fillStyle = paintOf(p.house || undefined, p.living).dot;
      g.fill(shield);
    } else {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = paintOf(p.house || undefined, p.living).dot;
      g.fillRect(cx - w / 2, top, w, w * ASPECT);
    }
  }

  const who = here && family.byId.get(here.id);
  if (here && who) {
    g.globalAlpha = 1;
    const w = Math.max(density.width, FOCUS_MIN_PX);
    const cx = here.x * frame.s + frame.ox;
    const top = shieldTop(here, w);
    drawShield(who.house || undefined, who.living, cx, top, w, 0);
    // The canvas's selected ring: light with a dark halo on the dark themes, the accent with a white halo on Paper.
    g.setTransform(w * dpr, 0, 0, w * dpr, cx * dpr, top * dpr);
    g.strokeStyle = light ? '#ffffff' : '#000000aa';
    // Each stroke is centred on the outline and the fill covers its inner half, so a stroke shows half its width.
    const ring = Math.min(2.5, w * 0.2);
    g.lineWidth = ((ring + 1.5) * 2) / w;
    g.stroke(shield);
    g.strokeStyle = light ? accent : '#f6ead0';
    g.lineWidth = (ring * 2) / w;
    g.stroke(shield);
    g.fillStyle = fillOf(who.house || undefined, who.living, paintOf(who.house || undefined, who.living));
    g.fill(shield);
    if (letters) {
      const paint = paintOf(who.house || undefined, who.living);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.globalAlpha = paint.letterAlpha;
      g.fillStyle = paint.letter;
      g.fillText(initialOf(who.given), cx, top + w * ASPECT * 0.45);
    }
  }
  g.globalAlpha = 1;
}

/** The layout's own edge paths, one stroke per style, so a big family's lines cost a handful of strokes. */
function paintLines(g: CanvasRenderingContext2D, layout: Layout, f: MinimapFrame, d: MinimapDensity, dimmed: Scene['dimmed'], dpr: number, line: string, marriage: string) {
  const groups = new Map<string, { kind: Layout['edges'][number]['kind']; dashed: boolean; faint: boolean; paths: string[] }>();
  for (const e of layout.edges) {
    const faint = !!dimmed && e.ids.filter((i) => dimmed.has(i)).length < 2;
    const key = `${e.kind}:${e.dashed ? 1 : 0}:${faint ? 1 : 0}`;
    let b = groups.get(key);
    if (!b) groups.set(key, (b = { kind: e.kind, dashed: !!e.dashed, faint, paths: [] }));
    b.paths.push(e.d);
  }
  g.setTransform(f.s * dpr, 0, 0, f.s * dpr, f.ox * dpr, f.oy * dpr);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // Faint ones first, so the people still in view draw over them.
  for (const b of [...groups.values()].sort((a, z) => Number(z.faint) - Number(a.faint))) {
    g.strokeStyle = b.kind === 'marriage' ? marriage : line;
    g.globalAlpha = b.faint ? d.lineAlpha * 0.2 : d.lineAlpha;
    g.lineWidth = (b.kind === 'marriage' ? d.lineWidth * 1.2 : d.lineWidth) / f.s;
    // Dashes only where a dash is longer than the line is wide.
    g.setLineDash(b.dashed && d.rim > 0 ? [3 / f.s, 2.5 / f.s] : []);
    g.stroke(new Path2D(b.paths.join('')));
  }
  g.setLineDash([]);
  g.globalAlpha = 1;
}

const initialOf = (given: string) => Array.from(given)[0] ?? '';

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

/** Turns true once the web fonts are in, so the initials are repainted in the display face. */
function useFontsReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    document.fonts?.ready.then(() => { if (live) setReady(true); });
    return () => { live = false; };
  }, []);
  return ready;
}
