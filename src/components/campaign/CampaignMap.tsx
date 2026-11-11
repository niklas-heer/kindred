// The campaign's map: every province as a piece of land in its holder's colour, hatched by its terrain, flying the
// holder's shield, with its garrison in a token. Plain SVG. Each province is a button (Tab reaches it, Enter or Space
// chooses it) with a spoken label that says who holds it, with how many, and on what land; the list beside the map is
// the same thing as rows. Colour is never the only sign: the shield names the holder, and the hatching and the small icon
// name the terrain.
//
// While a province is chosen the board says what it can reach (`reach`): the rest of the map dims, a march is ringed with
// footprints, an attack with crossed swords and its chance, and a seat that cannot be attacked with a lock. An order
// being made is an arrow from its province to its target.
import { Castle, Crown, Footprints, Lock, Mountain, Swords, Trees, Wheat } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Arms, TINCTURE_HEX } from '~/components/Heraldry';
import { HEX_V2 } from '~/lib/heraldry/tinctures';
import { MAP_H, MAP_W, terrainOf, type GameMap, type Pt, type State, type Terrain } from '~/lib/campaign/engine';
import { hashSeed, rng } from '~/lib/campaign/rng';
import type { StoredSide } from '~/lib/campaign/types';
import { useT, type Key, type Translator } from '~/lib/i18n';

const SPARE = ['#8f97a6', '#b08a4a', '#5f8f8a', '#9a6fa3', '#7d8c4f', '#a8705c'];
const pale = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.72;
};

/**
 * Each side's colour on the map: the first tincture of its arms that is not pale (silver would read as a free march)
 * and that no side before it has taken, else a spare. Two houses with the same field still get lands that differ.
 */
export function landColours(sides: Pick<StoredSide, 'id' | 'arms'>[]): Map<string, string> {
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

/** The terrain's icon, the same on the map, in the list and in the legend. */
export function TerrainIcon({ terrain, size = 14, ...rest }: { terrain: Terrain; size?: number; x?: number; y?: number; className?: string }) {
  const props = { size, 'aria-hidden': true, ...rest } as const;
  return terrain === 'forest' ? <Trees {...props} /> : terrain === 'highland' ? <Mountain {...props} /> : terrain === 'town' ? <Castle {...props} /> : <Wheat {...props} />;
}

export const TERRAIN_NAME: Record<Terrain, Key> = {
  plains: 'campaign.terrain.plains', forest: 'campaign.terrain.forest', highland: 'campaign.terrain.highland', town: 'campaign.terrain.town',
};
export const TERRAIN_RULE: Record<Terrain, Key> = {
  plains: 'campaign.terrain.plains_rule', forest: 'campaign.terrain.forest_rule', highland: 'campaign.terrain.highland_rule', town: 'campaign.terrain.town_rule',
};

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
export function provinceLabel(t: Translator, name: string, holder: string | undefined, troops: number, terrain: Terrain, flags: { mine: boolean; seat: boolean }): string {
  return [
    holder ? t('campaign.map.held', { province: name, house: holder, count: troops }) : t('campaign.map.free', { province: name, count: troops }),
    t(TERRAIN_NAME[terrain]) + '.',
    flags.mine ? t('campaign.map.yours') : '',
    flags.seat ? t('campaign.map.seat') : '',
  ].filter(Boolean).join(' ');
}

/** What a chosen province can do to a neighbour: march there, attack it (with this chance), or nothing, as it is a seat. */
export type Reach = { kind: 'march' } | { kind: 'attack'; chance: number } | { kind: 'locked' };

export interface CampaignMapProps {
  map: GameMap;
  state: State;
  sides: Pick<StoredSide, 'id' | 'name' | 'arms'>[];
  player: string | null;
  /** The province chosen (a thick gold outline), and what it can reach. With a choice the rest of the map dims. */
  selected: number | null;
  reach: ReadonlyMap<number, Reach>;
  /** An order being made, or a regent's move being shown: an arrow. */
  arrow?: { from: number; to: number; kind: 'march' | 'attack' } | null;
  /** A province to look at (inspected, or one a regent's move is about). */
  marked?: number | null;
  onSelect: (id: number) => void;
  /** A press on the sea, outside every province: the board cancels the choice. */
  onClear?: () => void;
}

const pct = (chance: number) => `${Math.round(chance * 100)}%`;

export function CampaignMap({ map, state, sides, player, selected, reach, arrow, marked, onSelect, onClear }: CampaignMapProps) {
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
  const sideAt = useMemo(() => new Map(sides.map((s) => [s.id, s])), [sides]);
  const seats = useMemo(() => new Set(Object.values(state.seats)), [state.seats]);
  const colours = useMemo(() => landColours(sides), [sides]);
  const onKey = (id: number) => (e: KeyboardEvent<SVGGElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    onSelect(id);
  };
  const shield = 46 * k;
  const [focused, setFocused] = useState<number | null>(null);
  const choosing = selected !== null && reach.size > 0;
  const centre = (id: number): Pt => [map.provinces[id].x, map.provinces[id].y];

  // The arrow, drawn short of both banners.
  let arrowPath: string | null = null;
  if (arrow && map.provinces[arrow.from] && map.provinces[arrow.to]) {
    const [x0, y0] = centre(arrow.from), [x1, y1] = centre(arrow.to);
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const cut = Math.min(34 * k, len / 3);
    const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
    const bend = Math.min(40, len * 0.18);
    const mx = (x0 + x1) / 2 - uy * bend, my = (y0 + y1) / 2 + ux * bend;
    arrowPath = `M${(x0 + ux * cut).toFixed(1)} ${(y0 + uy * cut).toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${(x1 - ux * cut).toFixed(1)} ${(y1 - uy * cut).toFixed(1)}`;
  }

  const badge = (id: number, r: Reach): ReactNode => {
    const [x, y] = centre(id);
    const s = k;
    const by = y - shield * 0.78 - 26 * s;
    if (r.kind === 'attack') {
      const w = 74 * s;
      return (
        <g key={`b${id}`} className="cm-badge is-attack" transform={`translate(${x - w / 2} ${by})`}>
          <rect width={w} height={26 * s} rx={13 * s} />
          <Swords x={6 * s} y={5 * s} width={16 * s} height={16 * s} />
          <text x={w - 9 * s} y={13 * s} textAnchor="end" dominantBaseline="central" fontSize={15 * s}>{pct(r.chance)}</text>
        </g>
      );
    }
    return (
      <g key={`b${id}`} className={`cm-badge is-${r.kind}`} transform={`translate(${x - 14 * s} ${by})`}>
        <rect width={28 * s} height={26 * s} rx={13 * s} />
        {r.kind === 'march' ? <Footprints x={6 * s} y={5 * s} width={16 * s} height={16 * s} /> : <Lock x={6 * s} y={5 * s} width={16 * s} height={16 * s} />}
      </g>
    );
  };

  return (
    <div className="cm-wrap" ref={wrap} data-narrow={narrow || undefined}>
      <svg className="cm-map" viewBox={`0 0 ${MAP_W} ${MAP_H}`} role="group" aria-label={t('campaign.map.label')}>
        <defs>
          {/* One hatching for each terrain but plains, after the engravers' way of showing a ground without colour. */}
          <pattern id={`${uid}-forest`} width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="5" cy="6" r="2.6" className="cm-dot" /><circle cx="14" cy="14" r="2.6" className="cm-dot" /></pattern>
          <pattern id={`${uid}-highland`} width="22" height="16" patternUnits="userSpaceOnUse"><path d="M2 12L8 5L14 12" className="cm-hatch" /></pattern>
          <pattern id={`${uid}-town`} width="14" height="14" patternUnits="userSpaceOnUse"><path d="M0 7H14M7 0V14" className="cm-hatch" /></pattern>
          <marker id={`${uid}-head`} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" className="cm-arrow-head" /></marker>
        </defs>
        <rect className="cm-sea" width={MAP_W} height={MAP_H} onClick={onClear} />
        {/* The lands: these are the buttons. */}
        {map.provinces.map((p) => {
          const held = state.holder[p.id];
          const owner = held ? sideAt.get(held) : undefined;
          const terrain = terrainOf(map, p.id);
          const flags = { mine: !!player && held === player, seat: seats.has(p.id) };
          const dim = choosing && selected !== p.id && !reach.has(p.id);
          return (
            <g
              key={p.id}
              className={`cm-prov${dim ? ' is-dim' : ''}`}
              role="button"
              tabIndex={0}
              aria-pressed={selected === p.id}
              aria-label={provinceLabel(t, p.name, owner?.name, state.troops[p.id], terrain, flags)}
              data-province={p.name}
              data-mine={flags.mine || undefined}
              data-terrain={terrain}
              data-reach={reach.get(p.id)?.kind}
              onClick={() => onSelect(p.id)}
              onKeyDown={onKey(p.id)}
              onFocus={() => setFocused(p.id)}
              onBlur={() => setFocused((f) => (f === p.id ? null : f))}
            >
              <path className="cm-land" d={paths[p.id]} style={owner ? { fill: `color-mix(in srgb, ${colours.get(owner.id)} 56%, var(--cm-paper))` } : undefined} />
              {terrain !== 'plains' && <path className="cm-shade" d={paths[p.id]} fill={`url(#${uid}-${terrain})`} />}
              <path className="cm-edge" d={paths[p.id]} />
            </g>
          );
        })}
        {/* What is chosen, reachable or focused, drawn over every land so no neighbour covers it. */}
        <g className="cm-rings" aria-hidden>
          {[...reach].map(([id, r]) => <path key={`t${id}`} className={`cm-ring is-${r.kind}`} d={paths[id]} />)}
          {marked != null && marked !== selected && <path className="cm-ring is-marked" d={paths[marked]} />}
          {selected !== null && <path className="cm-ring is-selected" d={paths[selected]} />}
          {focused !== null && <path className="cm-ring is-focused" d={paths[focused]} />}
        </g>
        {/* Shields, garrisons, terrain and names, over the lands; a press goes through them to the land. */}
        <g className="cm-marks" aria-hidden>
          {map.provinces.map((p) => {
            const held = state.holder[p.id];
            const owner = held ? sideAt.get(held) : undefined;
            const mine = !!player && held === player;
            const dim = choosing && selected !== p.id && !reach.has(p.id);
            return (
              <g key={p.id} className={`cm-mark${mine ? ' is-mine' : ''}${dim ? ' is-dim' : ''}`}>
                {owner ? (
                  <g transform={`translate(${p.x - shield / 2} ${p.y - shield * 0.78})`} className="cm-shield">
                    <Arms arms={owner.arms} size={shield} />
                  </g>
                ) : (
                  <path className="cm-flag" transform={`translate(${p.x} ${p.y - shield * 0.2}) scale(${k})`} d="M-2 -30V22M-2 -30L22 -22L-2 -13" />
                )}
                {seats.has(p.id) && <Crown className="cm-crown" x={p.x - 11 * k} y={p.y - shield * 0.78 - 21 * k} width={22 * k} height={22 * k} />}
                <g transform={`translate(${p.x - shield * 0.62} ${p.y + shield * 0.3})`} className="cm-terrain">
                  <circle r={12 * k} />
                  <TerrainIcon terrain={terrainOf(map, p.id)} x={-8 * k} y={-8 * k} size={16 * k} />
                </g>
                <g transform={`translate(${p.x + shield * 0.46} ${p.y + shield * 0.3})`} className="cm-token">
                  <circle r={15 * k} />
                  <text textAnchor="middle" dominantBaseline="central" fontSize={19 * k}>{state.troops[p.id]}</text>
                </g>
                <text className="cm-name" {...nameAt(p.x, p.name)} y={p.y + shield * 0.62 + 22}>{p.name}</text>
              </g>
            );
          })}
        </g>
        <g className="cm-over" aria-hidden>
          {arrowPath && <path className={`cm-arrow is-${arrow!.kind}`} d={arrowPath} markerEnd={`url(#${uid}-head)`} />}
          {[...reach].map(([id, r]) => badge(id, r))}
        </g>
      </svg>
    </div>
  );
}
