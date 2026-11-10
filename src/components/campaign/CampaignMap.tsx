// The campaign's map: every province as a piece of land in its holder's colour, flying the holder's shield, with its
// garrison in a token. Plain SVG. Each province is a button (Tab reaches it, Enter or Space chooses it) with a spoken
// label that says who holds it and with how many; the list beside the map (ProvinceList) is the same thing as rows.
// Colour is never the only sign: the shield names the holder, and each side's land has its own hatching.
import { Crown } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Arms, TINCTURE_HEX } from '~/components/Heraldry';
import { HEX_V2 } from '~/lib/heraldry/tinctures';
import { MAP_H, MAP_W, type GameMap, type Pt, type State } from '~/lib/campaign/engine';
import { hashSeed, rng } from '~/lib/campaign/rng';
import type { SideView } from '~/lib/campaign/types';
import { useT, type Translator } from '~/lib/i18n';

const SPARE = ['#8f97a6', '#b08a4a', '#5f8f8a', '#9a6fa3', '#7d8c4f', '#a8705c'];
const pale = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.72;
};

/**
 * Each side's colour on the map: the first tincture of its arms that is not pale (silver would read as a free march)
 * and that no side before it has taken, else a spare. Two houses with the same field still get lands that differ.
 */
export function landColours(sides: SideView[]): Map<string, string> {
  const taken = new Set<string>();
  const out = new Map<string, string>();
  for (const side of sides) {
    const a = side.arms;
    const own = a.v2 ? a.v2.field.tinctures.map((t) => HEX_V2[t]) : [TINCTURE_HEX[a.field], a.field2 ? TINCTURE_HEX[a.field2] : undefined, a.charge !== 'none' ? TINCTURE_HEX[a.chargeTincture] : undefined];
    const colour = [...own, ...SPARE].find((hex): hex is string => !!hex && !pale(hex) && !taken.has(hex)) ?? SPARE[0];
    taken.add(colour);
    out.set(side.id, colour);
  }
  return out;
}

/** The points of a border between two corners, drawn a little unevenly, the same from either side. */
function inked(a: Pt, b: Pt): Pt[] {
  const onFrame = (a[0] === b[0] && (a[0] <= 0 || a[0] >= MAP_W)) || (a[1] === b[1] && (a[1] <= 0 || a[1] >= MAP_H));
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (onFrame || length < 30) return [b];
  const flip = a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
  const [from, to] = flip ? [b, a] : [a, b];
  const random = rng(`edge:${hashSeed([from, to].map((p) => `${Math.round(p[0] / 2)},${Math.round(p[1] / 2)}`).join(';'))}`);
  const reach = Math.min(13, length * 0.07);
  const nx = -(to[1] - from[1]) / length, ny = (to[0] - from[0]) / length;
  const between: Pt[] = [0.25, 0.5, 0.75].map((k) => {
    const off = (random() - 0.5) * 2 * reach;
    return [from[0] + (to[0] - from[0]) * k + nx * off, from[1] + (to[1] - from[1]) * k + ny * off];
  });
  return [...(flip ? between.reverse() : between), b];
}

function landPath(cell: Pt[]): string {
  if (!cell.length) return '';
  const points: Pt[] = [];
  for (let i = 0; i < cell.length; i++) points.push(...inked(cell[i], cell[(i + 1) % cell.length]));
  const last = points[points.length - 1];
  return `M${last[0].toFixed(1)} ${last[1].toFixed(1)}${points.map((p) => `L${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('')}Z`;
}

/** Where a province's name is anchored: centred under its shield, unless that would run it off the sheet. */
function nameAt(x: number, name: string): { x: number; textAnchor: 'start' | 'middle' | 'end' } {
  const half = name.length * 6.5 + 8;
  if (x - half < 6) return { x: 8, textAnchor: 'start' };
  if (x + half > MAP_W - 6) return { x: MAP_W - 8, textAnchor: 'end' };
  return { x, textAnchor: 'middle' };
}

/** What a screen reader hears for a province, and what the list shows in words. */
export function provinceLabel(t: Translator, name: string, holder: string | undefined, troops: number, flags: { mine: boolean; seat: boolean; changed: boolean }): string {
  return [
    holder ? t('campaign.map.held', { province: name, house: holder, count: troops }) : t('campaign.map.free', { province: name, count: troops }),
    flags.mine ? t('campaign.map.yours') : '',
    flags.seat ? t('campaign.map.seat') : '',
    flags.changed ? t('campaign.map.changed') : '',
  ].filter(Boolean).join(' ');
}

export interface CampaignMapProps {
  map: GameMap;
  state: State;
  sides: SideView[];
  mySide: string | null;
  selected: number | null;
  /** Provinces an order from the selected one could go to. */
  targets: ReadonlySet<number>;
  /** Provinces that changed hands since the reader last looked. */
  changed: ReadonlySet<number>;
  onSelect: (id: number) => void;
}

export function CampaignMap({ map, state, sides, mySide, selected, targets, changed, onSelect }: CampaignMapProps) {
  const t = useT();
  const uid = useId().replace(/\W/g, '');
  const wrap = useRef<HTMLDivElement>(null);
  // On a narrow screen the shields and numbers are drawn larger, so they stay readable when the whole map is 360px wide.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setNarrow(el.clientWidth < 560);
    measure();
    const seen = new ResizeObserver(measure);
    seen.observe(el);
    return () => seen.disconnect();
  }, []);
  const k = narrow ? 1.7 : 1;
  const paths = useMemo(() => map.provinces.map((p) => landPath(p.cell)), [map]);
  const sideAt = useMemo(() => new Map(sides.map((s, i) => [s.id, { side: s, index: i }])), [sides]);
  const seats = useMemo(() => new Set(Object.values(state.seats)), [state.seats]);
  const colours = useMemo(() => landColours(sides), [sides]);
  const onKey = (id: number) => (e: KeyboardEvent<SVGGElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    onSelect(id);
  };
  const shield = 46 * k;

  const [focused, setFocused] = useState<number | null>(null);
  const flagsOf = (id: number) => ({ mine: !!mySide && state.holder[id] === mySide, seat: seats.has(id), changed: changed.has(id) });

  return (
    <div className="cm-wrap" ref={wrap} data-narrow={narrow || undefined}>
      <svg className="cm-map" viewBox={`0 0 ${MAP_W} ${MAP_H}`} role="group" aria-label={t('campaign.map.label')}>
        <defs>
          {/* One hatching for each side, after the engravers' way of showing a tincture without colour. */}
          <pattern id={`${uid}-h0`} width="14" height="14" patternUnits="userSpaceOnUse"><path d="M0 14L14 0" className="cm-hatch" /></pattern>
          <pattern id={`${uid}-h1`} width="14" height="14" patternUnits="userSpaceOnUse"><path d="M7 0V14" className="cm-hatch" /></pattern>
          <pattern id={`${uid}-h2`} width="14" height="14" patternUnits="userSpaceOnUse"><path d="M0 7H14" className="cm-hatch" /></pattern>
          <pattern id={`${uid}-h3`} width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="7" cy="7" r="1.6" className="cm-dot" /></pattern>
          <pattern id={`${uid}-h4`} width="14" height="14" patternUnits="userSpaceOnUse"><path d="M0 0L14 14" className="cm-hatch" /></pattern>
          <pattern id={`${uid}-h5`} width="16" height="16" patternUnits="userSpaceOnUse"><path d="M0 8H16M8 0V16" className="cm-hatch" /></pattern>
        </defs>
        <rect className="cm-sea" width={MAP_W} height={MAP_H} />
        {/* The lands: these are the buttons. */}
        {map.provinces.map((p) => {
          const held = state.holder[p.id];
          const owner = held ? sideAt.get(held) : undefined;
          const flags = flagsOf(p.id);
          const dim = selected !== null && selected !== p.id && !targets.has(p.id);
          return (
            <g
              key={p.id}
              className={`cm-prov${dim ? ' is-dim' : ''}`}
              role="button"
              tabIndex={0}
              aria-pressed={selected === p.id}
              aria-label={provinceLabel(t, p.name, owner?.side.name, state.troops[p.id], flags)}
              data-province={p.name}
              data-mine={flags.mine || undefined}
              onClick={() => onSelect(p.id)}
              onKeyDown={onKey(p.id)}
              onFocus={() => setFocused(p.id)}
              onBlur={() => setFocused((f) => (f === p.id ? null : f))}
            >
              <path className="cm-land" d={paths[p.id]} style={owner ? { fill: `color-mix(in srgb, ${colours.get(owner.side.id)} 56%, var(--cm-paper))` } : undefined} />
              {owner && <path className="cm-shade" d={paths[p.id]} fill={`url(#${uid}-h${owner.index % 6})`} />}
              <path className="cm-edge" d={paths[p.id]} />
            </g>
          );
        })}
        {/* What is chosen, reachable or focused, drawn over every land so no neighbour covers it. */}
        <g className="cm-rings" aria-hidden>
          {[...targets].map((id) => <path key={`t${id}`} className="cm-ring is-target" d={paths[id]} />)}
          {selected !== null && <path className="cm-ring is-selected" d={paths[selected]} />}
          {focused !== null && <path className="cm-ring is-focused" d={paths[focused]} />}
        </g>
        {/* Shields, garrisons and names, over the lands; a press goes through them to the land. */}
        <g className="cm-marks" aria-hidden>
          {map.provinces.map((p) => {
            const held = state.holder[p.id];
            const owner = held ? sideAt.get(held) : undefined;
            const flags = flagsOf(p.id);
            return (
              <g key={p.id} className={`cm-mark${flags.mine ? ' is-mine' : ''}`}>
                {flags.changed && <circle className="cm-pulse" cx={p.x} cy={p.y - 6 * k} r={40 * k} />}
                {owner ? (
                  <g transform={`translate(${p.x - shield / 2} ${p.y - shield * 0.78})`} className="cm-shield">
                    <Arms arms={owner.side.arms} size={shield} />
                  </g>
                ) : (
                  <path className="cm-flag" transform={`translate(${p.x} ${p.y - shield * 0.2}) scale(${k})`} d="M-2 -30V22M-2 -30L22 -22L-2 -13" />
                )}
                {flags.seat && <Crown className="cm-crown" x={p.x - 11 * k} y={p.y - shield * 0.78 - 21 * k} width={22 * k} height={22 * k} />}
                <g transform={`translate(${p.x + shield * 0.46} ${p.y + shield * 0.3})`} className="cm-token">
                  <circle r={15 * k} />
                  <text textAnchor="middle" dominantBaseline="central" fontSize={19 * k}>{state.troops[p.id]}</text>
                </g>
                <text className="cm-name" {...nameAt(p.x, p.name)} y={p.y + shield * 0.62 + 22}>{p.name}</text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
