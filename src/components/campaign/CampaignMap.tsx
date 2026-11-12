// The campaign's map: an invented continent drawn as a sheet of parchment. The sea is engraved with waves, the coast is
// shaded, every province is a piece of land washed in its terrain's colour and bordered in its holder's, with little
// trees, hills, reeds, houses and castles drawn on it, rivers and mountain ridges along its borders, and dotted lanes
// across the water. Each province flies its holder's shield and carries its garrison in a token. Plain SVG.
//
// Each province is a button (Tab reaches it, Enter or Space chooses it) with a spoken label that says who holds it, with
// how many, and on what land; the list beside the map is the same thing as rows. Colour is never the only sign: the shield
// names the holder, and the pictures name the terrain.
//
// While a province is chosen the board says what it can reach (`reach`): the rest of the map dims, a march is ringed with
// footprints, an attack with crossed swords and its chance, and a seat that cannot be attacked with a lock. An order being
// made is an arrow from its province to its target. Troops on the move are tokens that travel (`flights`), a battle is a
// burst where they meet (`clash`), and a province that changes hands fills with its new colour. With "reduce motion"
// nothing travels and nothing bursts: the map simply shows what is.
import { Crown, Footprints, Lock, Plus, Sailboat, Swords, Waves } from 'lucide-react';
import { memo, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Arms, TINCTURE_HEX } from '~/components/Heraldry';
import { HEX_V2 } from '~/lib/heraldry/tinctures';
import { MAP_H, MAP_W, terrainOf, type Crossing, type GameMap, type Pt, type State, type Terrain } from '~/lib/campaign/engine';
import type { StoredSide } from '~/lib/campaign/types';
import { useT, type Key, type Translator } from '~/lib/i18n';
import { badgeAt, cameraFor, coastOf, cornersOf, courseOf, nameBox, namesAt, peaksAlong, ridgeBoxes, settlementAt, smoothClosed, smoothOpen, spotsIn, type Box, type GlyphKind, type NameSpot } from './drawing';

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

/** One of the map's little pictures, drawn around its own middle in a box of about 24. The legend draws the same ones. */
export function GlyphShape({ kind }: { kind: GlyphKind }) {
  switch (kind) {
    case 'tree': return <><path className="cm-g-ink" d="M0 9.5V3" /><path className="cm-g-leaf" d="M-6.5 3.5A4.6 4.6 0 0 1-6-4.2A5.6 5.6 0 0 1 4.6-5.2A4.6 4.6 0 0 1 6 3.5Z" /></>;
    case 'pine': return <><path className="cm-g-ink" d="M0 6V10" /><path className="cm-g-leaf" d="M0-10L5-1H2.5L6.5 6H-6.5L-2.5-1H-5Z" /></>;
    case 'hill': return <><path className="cm-g-land" d="M-12 6Q-5-10 2 6Z" /><path className="cm-g-land" d="M-2 6Q5-7 12 6Z" /><path className="cm-g-hatch" d="M-4.5-1.5L-3 5M-1.5 1L-.5 5M6.5 0L7.5 5" /></>;
    case 'peak': return <><path className="cm-g-land" d="M-12 8L-3-10L1-4L4.5-8.5L12 8Z" /><path className="cm-g-hatch" d="M-3-10L-1 8M-1.5-4L1.5 8M4.5-8.5L6.5 8M7.2-1.5L8.5 8" /></>;
    case 'reed': return <><path className="cm-g-water" d="M-10 6.5h5M-1.5 6.5h4M6 6.5h4M-6 9.5h4M2 9.5h5" /><path className="cm-g-ink" d="M-4 6V-2M0 6V-6M4 6V-1" /><path className="cm-g-dot" d="M-4-5.5a1.2 2.3 0 1 0 .01 0ZM0-9.5a1.2 2.3 0 1 0 .01 0ZM4-4.5a1.2 2.3 0 1 0 .01 0Z" /></>;
    case 'grass': return <path className="cm-g-hatch" d="M-5 4q1.5-6 3 0M1 4q1.5-7 3 0" />;
    case 'town': return <><path className="cm-g-wall" d="M-10.5 8V1L-6.5-3L-2.5 1V8Z" /><path className="cm-g-wall" d="M-2.5 8V-1L3-6.5L8.5-1V8Z" /><path className="cm-g-ink" d="M3-6.5V-12M1-10h4M-7.5 8V4.5h2V8M2 8V4h2.5V8" /></>;
    case 'castle': return <><path className="cm-g-wall" d="M-11.5 9V-2.5h3V-.5h2.5V-2.5h2.5V-8.5h2.5V-6.5h2V-8.5h2.5V-2.5H6V-.5h2.5V-2.5h3V9Z" /><path className="cm-g-ink" d="M-2 9V5.5a2 2 0 0 1 4 0V9M0-8.5V-13.5" /><path className="cm-g-flag" d="M0-13.5l4.5 1.5l-4.5 1.5Z" /></>;
    case 'ship': return <><path className="cm-g-wall" d="M-8.5 3H8.5Q5 8.5 0 8.5T-8.5 3Z" /><path className="cm-g-ink" d="M0 3V-9.5" /><path className="cm-g-wall" d="M.8-8.5Q8-4.5 .8 1Z" /><path className="cm-g-wall" d="M-.8-6.5Q-6-3-.8 1Z" /></>;
  }
}

/** What stands for each terrain in the legend, the list and the panels: the map's own picture of it. */
export const TERRAIN_GLYPH: Record<Terrain, GlyphKind> = { plains: 'grass', forest: 'tree', highland: 'hill', marsh: 'reed', town: 'town' };

/** The terrain's picture as a small drawing on paper, the same in the list, the legend and the panels. */
export function TerrainIcon({ terrain, size = 16, className = '' }: { terrain: Terrain; size?: number; className?: string }) {
  return <GlyphIcon kind={TERRAIN_GLYPH[terrain]} size={size} className={className} />;
}

export function GlyphIcon({ kind, size = 16, className = '' }: { kind: GlyphKind; size?: number; className?: string }) {
  return <svg className={`cm-glyph ${className}`} width={size} height={size} viewBox="-13 -14 26 26" aria-hidden><GlyphShape kind={kind} /></svg>;
}

export const TERRAIN_NAME: Record<Terrain, Key> = {
  plains: 'campaign.terrain.plains', forest: 'campaign.terrain.forest', highland: 'campaign.terrain.highland', marsh: 'campaign.terrain.marsh', town: 'campaign.terrain.town',
};
export const TERRAIN_RULE: Record<Terrain, Key> = {
  plains: 'campaign.terrain.plains_rule', forest: 'campaign.terrain.forest_rule', highland: 'campaign.terrain.highland_rule', marsh: 'campaign.terrain.marsh_rule', town: 'campaign.terrain.town_rule',
};

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
export type Reach = { kind: 'march'; crossing?: Crossing | null } | { kind: 'attack'; chance: number; crossing?: Crossing | null } | { kind: 'locked' };

/** Troops on the move: a token that travels from one province towards another. An attack stops where the armies meet. */
export interface Flight { id: string; from: number; to: number; count: number; side: string; kind: 'march' | 'attack' }

export interface CampaignMapProps {
  map: GameMap;
  /** Who holds what, with how many. The board may show a moment earlier than the reign's own position, while troops travel. */
  state: Pick<State, 'holder' | 'troops' | 'seats'>;
  sides: Pick<StoredSide, 'id' | 'name' | 'arms'>[];
  player: string | null;
  /** The province chosen (a thick gold outline), and what it can reach. With a choice the rest of the map dims. */
  selected?: number | null;
  reach?: ReadonlyMap<number, Reach>;
  /** Provinces where a troop of the levy can be placed now: each carries a small plus. */
  placeable?: ReadonlySet<number>;
  /** An order being made, or a regent's move being shown: an arrow. */
  arrow?: { from: number; to: number; kind: 'march' | 'attack' } | null;
  /** A province to look at (inspected, or one a regent's move is about). */
  marked?: number | null;
  flights?: Flight[];
  /** Where two armies meet just now: the province attacked, and where the attack came from. */
  clash?: { from: number; to: number } | null;
  onSelect?: (id: number) => void;
  /** A press on the sea, outside every province: the board cancels the choice. */
  onClear?: () => void;
  /** A picture only: nothing can be pressed, and it is announced as one image with this label. */
  picture?: string;
  /** Laid over the map: the turn's banner. */
  children?: ReactNode;
}

const pct = (chance: number) => `${Math.round(chance * 100)}%`;
const NONE: ReadonlyMap<number, Reach> = new Map();

/** What never changes while a reign is played: the sea, the coast, the land's pictures, the rivers, ridges and lanes. */
const Sheet = memo(function Sheet({ map, uid, room }: { map: GameMap; uid: string; room: number }) {
  const coast = useMemo(() => coastOf(map).map(smoothClosed).join(''), [map]);
  const corners = useMemo(() => cornersOf(map), [map]);
  const title = map.name ?? '';
  const far = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]) > 190;
  const seas = (map.seas ?? []).filter((s) => far([s.x, s.y], corners.title) && far([s.x, s.y], corners.compass));
  return (
    <>
      <rect className="cm-sea" width={MAP_W} height={MAP_H} />
      <rect className="cm-waves" width={MAP_W} height={MAP_H} fill={`url(#${uid}-waves)`} />
      {/* The coast's shading: the land's outline drawn wide and faint, then narrower and stronger, under the land. */}
      <path className="cm-shore is-3" d={coast} />
      <path className="cm-shore is-2" d={coast} />
      <path className="cm-shore is-1" d={coast} />
      <g className="cm-lanes">
        {(map.lanes ?? []).map((lane, i) => {
          const [a, bend, b] = lane.line;
          const half: Pt = [0.25 * a[0] + 0.5 * bend[0] + 0.25 * b[0], 0.25 * a[1] + 0.5 * bend[1] + 0.25 * b[1]];
          return (
            <g key={i}>
              <path className="cm-lane" d={`M${a[0]} ${a[1]}Q${bend[0]} ${bend[1]} ${b[0]} ${b[1]}`} />
              <g className="cm-ship" transform={`translate(${half[0]} ${half[1]}) scale(${1.5 * room})`}><GlyphShape kind="ship" /></g>
            </g>
          );
        })}
      </g>
      {seas.map((s) => <text key={s.name} className="cm-sea-name" x={s.x} y={s.y} textAnchor="middle">{s.name}</text>)}
      <g className="cm-compass" transform={`translate(${corners.compass[0]} ${corners.compass[1]})`}>
        <circle r="34" /><circle r="27" className="is-thin" />
        <path className="is-dark" d="M0-44L6-6L0 0ZM0 44L-6 6L0 0ZM44 0L6 6L0 0ZM-44 0L-6-6L0 0Z" />
        <path className="is-light" d="M0-44L-6-6L0 0ZM0 44L6 6L0 0ZM44 0L6-6L0 0ZM-44 0L-6 6L0 0Z" />
        <path className="is-dark" d="M22-22L8-2L0 0ZM-22 22L-8 2L0 0ZM22 22L2 8L0 0ZM-22-22L-2-8L0 0Z" />
        <text y="-49" textAnchor="middle">N</text>
      </g>
      <g className="cm-title" transform={`translate(${corners.title[0]} ${corners.title[1]})`}>
        <path className="cm-scroll" d="M-128-24H128Q118-12 128 0Q118 12 128 24H-128Q-118 12-128 0Q-118-12-128-24Z" />
        <path className="cm-scroll-rule" d="M-104-15H104M-104 15H104" />
        <text y="1" textAnchor="middle" dominantBaseline="central" textLength={Math.min(196, title.length * 21)} lengthAdjust="spacing">{title.toUpperCase()}</text>
      </g>
      <path className="cm-ground" d={coast} />
    </>
  );
});

/**
 * The land's own pictures, drawn over the provinces' washes. They keep clear of the names as they are written (`avoid`),
 * and step aside in the provinces an order is being chosen among (`quiet`), where the badges and names must be read.
 */
const Pictures = memo(function Pictures({ map, uid, seats, room, avoid, quiet }: { map: GameMap; uid: string; seats: string; room: number; avoid: readonly Box[]; quiet: string }) {
  const coast = useMemo(() => coastOf(map).map(smoothClosed).join(''), [map]);
  const seatSet = useMemo(() => new Set(seats.split(',').filter(Boolean).map(Number)), [seats]);
  const hushed = useMemo(() => new Set(quiet.split(',').filter(Boolean).map(Number)), [quiet]);
  const spots = useMemo(() => map.provinces.map((p) => spotsIn(map, p, room, avoid)), [map, room, avoid]);
  const towns = useMemo(() => map.provinces.filter((p) => terrainOf(map, p.id) === 'town').map((p) => ({ id: p.id, at: settlementAt(p, Math.sqrt(room), avoid) })), [map, room, avoid]);
  const ridges = useMemo(() => {
    const banners = map.provinces.map((p): Pt => [p.x, p.y]);
    return (map.ridges ?? []).map((r, i) => ({ d: smoothOpen(r.line), peaks: peaksAlong(r.line, `${map.name}:${i}`, banners, room, avoid) }));
  }, [map, room, avoid]);
  return (
    <g className="cm-pictures" aria-hidden>
      {/* The coast, inked over the provinces' own dashed borders. */}
      <path className="cm-coastline" d={coast} />
      {spots.map((list, id) => !hushed.has(id) && list.map((s, i) => <use key={`${id}-${i}`} href={`#${uid}-${s.kind}`} transform={`translate(${s.x} ${s.y}) scale(${s.size})`} />))}
      {towns.map(({ id, at }) => at && !hushed.has(id) && <use key={`s${id}`} href={`#${uid}-${seatSet.has(id) ? 'castle' : 'town'}`} transform={`translate(${at[0]} ${at[1]}) scale(${1.75 * room ** 0.35})`} />)}
      {(map.rivers ?? []).map((r, i) => {
        const d = smoothOpen(r.line);
        return <g key={`r${i}`}><path className="cm-river is-bank" d={d} /><path className="cm-river" d={d} /></g>;
      })}
      {ridges.map((r, i) => (
        <g key={`m${i}`}>
          <path className="cm-ridge" d={r.d} />
          {r.peaks.map((s, k) => <use key={k} href={`#${uid}-peak`} transform={`translate(${s.x} ${s.y - 4}) scale(${s.size})`} />)}
        </g>
      ))}
    </g>
  );
});

const NO_BOXES: readonly Box[] = [];

export function CampaignMap({ map, state, sides, player, selected = null, reach = NONE, placeable, arrow, marked, flights, clash, onSelect, onClear, picture, children }: CampaignMapProps) {
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
  const choosing = selected !== null && reach.size > 0;
  // On a narrow screen the view moves in on an order being chosen, so its provinces, names and chances are large.
  const camera = useMemo(() => (narrow && choosing ? cameraFor(map, [selected!, ...reach.keys()]) : null), [narrow, choosing, selected, reach, map]);
  const zoom = camera?.k ?? 1;
  const base = narrow ? 1.7 : 1;
  const k = base / zoom;
  const paths = useMemo(() => map.provinces.map((p) => smoothClosed(p.cell)), [map]);
  const sideAt = useMemo(() => new Map(sides.map((s) => [s.id, s])), [sides]);
  const seats = useMemo(() => new Set(Object.values(state.seats)), [state.seats]);
  const colours = useMemo(() => landColours(sides), [sides]);
  const onKey = (id: number) => (e: KeyboardEvent<SVGGElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    onSelect?.(id);
  };
  const shield = 46 * k;
  const nameSize = narrow ? 21 * Math.max(0.62, k * 0.9) : 21;
  // What the view shows of the sheet: all of it, or the part the camera has moved in on.
  const within = useMemo<Box>(() => (camera ? [-camera.x / camera.k, -camera.y / camera.k, (MAP_W - camera.x) / camera.k, (MAP_H - camera.y) / camera.k] : [0, 0, MAP_W, MAP_H]), [camera]);
  // The provinces an order is being chosen among: the chosen one and what it can reach.
  const chosen = useMemo(() => (choosing ? new Set([selected!, ...reach.keys()]) : null), [choosing, selected, reach]);
  // On a wide screen every name is written once and stays where it is. On a narrow one the names show only while the view
  // has moved in on an order, and then only those the order is about, kept inside what the view shows.
  const ridges = useMemo(() => ridgeBoxes(map), [map]);
  const names = useMemo(
    () => (narrow ? (camera && chosen ? namesAt(map, seats, k, nameSize, { only: chosen, within }) : new Map<number, NameSpot>()) : namesAt(map, seats, 1, 21, { avoid: ridges })),
    [narrow, camera, chosen, map, seats, k, nameSize, within, ridges],
  );
  const nameBoxes = useMemo(() => (narrow ? NO_BOXES : [...names.values()].map((n) => nameBox(n, 21))), [narrow, names]);
  // The badges have the say: each finds a place clear of the banners and names of the provinces in play, and of the others.
  const badges = useMemo(() => {
    const out = new Map<number, Pt>();
    if (!chosen) return out;
    const taken: Box[] = [];
    for (const id of chosen) {
      const p = map.provinces[id];
      taken.push([p.x - shield / 2, p.y - shield * 0.78, p.x + shield * 0.46 + 15 * k, p.y + shield * 0.3 + 15 * k]);
      const n = names.get(id);
      if (n) taken.push(nameBox(n, nameSize));
    }
    for (const [id, r] of reach) {
      const w = (r.kind === 'attack' ? (r.crossing ? 96 : 74) : r.kind === 'march' && r.crossing === 'sea' ? 48 : 28) * k;
      out.set(id, badgeAt(map.provinces[id], w, 26 * k, k, taken, within));
    }
    return out;
  }, [chosen, reach, map, names, shield, k, nameSize, within]);
  const [focused, setFocused] = useState<number | null>(null);
  const centre = (id: number): Pt => [map.provinces[id].x, map.provinces[id].y];

  // A province that changes hands fills with its new holder's colour, from where the attack came in.
  const before = useRef<(string | null)[]>(state.holder);
  const [floods, setFloods] = useState<{ id: number; key: number; from: Pt }[]>([]);
  const cameFrom = useRef<{ from: number; to: number } | null>(null);
  if (clash) cameFrom.current = clash;
  useEffect(() => {
    const changed = state.holder.flatMap((h, id) => (before.current[id] !== h && before.current.length === state.holder.length && h !== null ? [id] : []));
    before.current = state.holder;
    if (!changed.length || changed.length > 4) return;
    const stamp = Date.now();
    setFloods(changed.map((id, i) => ({ id, key: stamp + i, from: cameFrom.current?.to === id ? centre(cameFrom.current.from) : centre(id) })));
    const done = window.setTimeout(() => setFloods([]), 1100);
    return () => window.clearTimeout(done);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- only a change of holders floods; `centre` reads the map, which does not change during a reign
  }, [state.holder]);

  const course = arrow ? courseOf(map, arrow.from, arrow.to, 34 * k) : null;

  const badge = (id: number, r: Reach): ReactNode => {
    const s = k;
    const [bx, by] = badges.get(id) ?? [centre(id)[0], centre(id)[1] - shield * 0.78 - 26 * s];
    if (r.kind === 'attack') {
      const w = (r.crossing ? 96 : 74) * s;
      return (
        <g key={`b${id}`} className="cm-badge is-attack" transform={`translate(${bx} ${by})`}>
          <rect width={w} height={26 * s} rx={13 * s} />
          <Swords x={6 * s} y={5 * s} width={16 * s} height={16 * s} />
          {r.crossing && (r.crossing === 'sea' ? <Sailboat x={26 * s} y={5 * s} width={16 * s} height={16 * s} /> : <Waves x={26 * s} y={5 * s} width={16 * s} height={16 * s} />)}
          <text x={w - 9 * s} y={13 * s} textAnchor="end" dominantBaseline="central" fontSize={15 * s}>{pct(r.chance)}</text>
        </g>
      );
    }
    const sea = r.kind === 'march' && r.crossing === 'sea';
    const w = (sea ? 48 : 28) * s;
    return (
      <g key={`b${id}`} className={`cm-badge is-${r.kind}`} transform={`translate(${bx} ${by})`}>
        <rect width={w} height={26 * s} rx={13 * s} />
        {r.kind === 'march' ? <Footprints x={6 * s} y={5 * s} width={16 * s} height={16 * s} /> : <Lock x={6 * s} y={5 * s} width={16 * s} height={16 * s} />}
        {sea && <Sailboat x={26 * s} y={5 * s} width={16 * s} height={16 * s} />}
      </g>
    );
  };

  const view: CSSProperties | undefined = camera ? { transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.k})` } : undefined;
  const seatList = [...seats].sort((a, b) => a - b).join(',');

  return (
    <div className="cm-wrap" ref={wrap} data-narrow={narrow || undefined} data-zoom={camera ? '' : undefined} data-picture={picture ? '' : undefined}>
      <svg className="cm-map" viewBox={`0 0 ${MAP_W} ${MAP_H}`} role={picture ? 'img' : 'group'} aria-label={picture ?? t('campaign.map.label')}>
        <defs>
          <pattern id={`${uid}-waves`} width="92" height="46" patternUnits="userSpaceOnUse" patternTransform="rotate(-4)">
            <path className="cm-wave" d="M6 12q5-5 10 0t10 0M52 34q5-5 10 0t10 0" />
          </pattern>
          {(['tree', 'pine', 'hill', 'peak', 'reed', 'grass', 'town', 'castle'] as const).map((kind) => <g key={kind} id={`${uid}-${kind}`}><GlyphShape kind={kind} /></g>)}
          {map.provinces.map((p) => <clipPath key={p.id} id={`${uid}-c${p.id}`}><path d={paths[p.id]} /></clipPath>)}
          {(['march', 'attack'] as const).map((kind) => (
            <marker key={kind} id={`${uid}-head-${kind}`} viewBox="0 0 10 10" refX="4" refY="5" markerWidth="2.6" markerHeight="2.6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10L2.5 5Z" className={`cm-arrow-head is-${kind}`} /></marker>
          ))}
        </defs>
        <g className="cm-camera" style={view}>
          <g onClick={picture ? undefined : onClear}><Sheet map={map} uid={uid} room={base} /></g>
          {/* The lands: these are the buttons. */}
          {map.provinces.map((p) => {
            const held = state.holder[p.id];
            const owner = held ? sideAt.get(held) : undefined;
            const terrain = terrainOf(map, p.id);
            const flags = { mine: !!player && held === player, seat: seats.has(p.id) };
            const dim = choosing && selected !== p.id && !reach.has(p.id);
            const colour = owner ? colours.get(owner.id) : undefined;
            const flood = floods.find((f) => f.id === p.id);
            const press = picture ? {} : {
              role: 'button', tabIndex: 0, 'aria-pressed': selected === p.id,
              'aria-label': provinceLabel(t, p.name, owner?.name, state.troops[p.id], terrain, flags),
              onClick: () => onSelect?.(p.id), onKeyDown: onKey(p.id), onFocus: (e: FocusEvent<SVGGElement>) => { if (e.currentTarget.matches(':focus-visible')) setFocused(p.id); }, onBlur: () => setFocused((f) => (f === p.id ? null : f)),
            } as const;
            return (
              <g
                key={p.id}
                className={`cm-prov${dim ? ' is-dim' : ''}${flags.mine ? ' is-mine' : ''}`}
                data-province={p.name}
                data-mine={flags.mine || undefined}
                data-terrain={terrain}
                data-reach={reach.get(p.id)?.kind}
                {...press}
              >
                <path className="cm-land" d={paths[p.id]} />
                {/* The holder's colour: a light wash over the land, and a band along the inside of its border. */}
                {colour && <path className="cm-tint" d={paths[p.id]} style={{ fill: colour }} />}
                {flood && colour && <circle key={flood.key} className="cm-flood" cx={flood.from[0]} cy={flood.from[1]} r="320" clipPath={`url(#${uid}-c${p.id})`} style={{ fill: colour }} />}
                {colour && <path className="cm-band" d={paths[p.id]} clipPath={`url(#${uid}-c${p.id})`} style={{ stroke: colour }} />}
                <path className="cm-edge" d={paths[p.id]} />
              </g>
            );
          })}
          <Pictures map={map} uid={uid} seats={seatList} room={base} avoid={nameBoxes} quiet={chosen ? [...chosen].sort((a, b) => a - b).join(',') : ''} />
          {/* What is chosen, reachable or focused, drawn over every land so no neighbour covers it. */}
          <g className="cm-rings" aria-hidden>
            {[...reach].map(([id, r]) => <path key={`t${id}`} className={`cm-ring is-${r.kind}`} d={paths[id]} />)}
            {placeable && [...placeable].map((id) => <path key={`p${id}`} className="cm-ring is-place" d={paths[id]} />)}
            {marked != null && marked !== selected && <path className="cm-ring is-marked" d={paths[marked]} />}
            {selected !== null && <path className="cm-ring is-selected" d={paths[selected]} />}
            {focused !== null && <path className="cm-ring is-focused" d={paths[focused]} />}
          </g>
          {/* Shields, garrisons and names, over the lands; a press goes through them to the land. */}
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
                  <g transform={`translate(${p.x + shield * 0.46} ${p.y + shield * 0.3})`}>
                    <g key={state.troops[p.id]} className="cm-token">
                      <circle r={15 * k} />
                      <text textAnchor="middle" dominantBaseline="central" fontSize={19 * k}>{state.troops[p.id]}</text>
                    </g>
                    {placeable?.has(p.id) && (
                      <g className="cm-plus" transform={`translate(${13 * k} ${-13 * k})`}>
                        <circle r={8.5 * k} />
                        <Plus x={-6 * k} y={-6 * k} width={12 * k} height={12 * k} />
                      </g>
                    )}
                  </g>
                  {names.has(p.id) && <text className="cm-name" x={names.get(p.id)!.x} y={names.get(p.id)!.y} textAnchor="middle" style={narrow ? { fontSize: `${nameSize}px` } : undefined}>{p.name}</text>}
                </g>
              );
            })}
          </g>
          <g className="cm-over" aria-hidden>
            {course && <path key={`a${arrow!.from}-${arrow!.to}`} className={`cm-arrow is-${arrow!.kind}`} d={course.d} markerEnd={`url(#${uid}-head-${arrow!.kind})`} style={{ strokeWidth: 9 * Math.max(k, 0.7) }} />}
            {[...reach].map(([id, r]) => badge(id, r))}
            {(flights ?? []).map((f) => {
              const [x0, y0] = centre(f.from), [x1, y1] = centre(f.to);
              // An attack stops where the armies meet, most of the way there.
              const far = f.kind === 'attack' ? 0.62 : 1;
              const style = { '--x0': `${x0}px`, '--y0': `${y0}px`, '--x1': `${x0 + (x1 - x0) * far}px`, '--y1': `${y0 + (y1 - y0) * far}px`, fill: colours.get(f.side) ?? '#1f1b14' } as CSSProperties;
              return (
                <g key={f.id} className={`cm-flight is-${f.kind}`} style={style}>
                  <g className="cm-hop">
                    <circle r={15 * k} />
                    <text textAnchor="middle" dominantBaseline="central" fontSize={18 * k}>{f.count}</text>
                  </g>
                </g>
              );
            })}
            {clash && (() => {
              const [x0, y0] = centre(clash.from), [x1, y1] = centre(clash.to);
              return (
                // The place is set on the outer group and the burst is animated on the inner one: an animated transform would
                // otherwise replace the place.
                <g key={`c${clash.from}-${clash.to}`} transform={`translate(${x0 + (x1 - x0) * 0.66} ${y0 + (y1 - y0) * 0.66}) scale(${Math.max(k, 0.75)})`}>
                  <g className="cm-clash">
                    <path className="cm-burst" d="M0-30L7-11L26-18L14-2L31 8L11 10L14 30L0 15L-14 30L-11 10L-31 8L-14-2L-26-18L-7-11Z" />
                    <Swords x={-13} y={-13} width={26} height={26} />
                  </g>
                </g>
              );
            })()}
          </g>
        </g>
        {/* The sheet's frame stays where it is while the view moves. */}
        <rect className="cm-frame" x="5" y="5" width={MAP_W - 10} height={MAP_H - 10} />
        <rect className="cm-frame is-inner" x="11" y="11" width={MAP_W - 22} height={MAP_H - 22} />
      </svg>
      {children}
    </div>
  );
}
