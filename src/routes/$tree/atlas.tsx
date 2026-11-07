// The Atlas: where the family was born, died and married, on a world map drawn locally (d3-geo +
// world-atlas, no tile server). A time slider replays the family spreading out; arcs show moves
// from a mother's birthplace to her child's.
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { geoGraticule10, geoNaturalEarth1, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import { Layers, Pause, Play, Route as RouteIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { feature, mesh } from 'topojson-client';
import { z } from 'zod';
import { GameIcon } from '~/components/GameIcon';
import { Portrait } from '~/components/Portrait';
import { useFamily, useTreeId } from '~/lib/family';
import { displayName, lifespan, parents, yearOf } from '~/lib/graph';
import { play } from '~/lib/sfx';
import type { GPerson, Place } from '~/lib/types';
import '~/styles/atlas.css';

type Kind = 'births' | 'deaths' | 'weddings';
type Mode = Kind | 'all';

export const Route = createFileRoute('/$tree/atlas')({
  validateSearch: z.object({ mode: z.enum(['all', 'births', 'deaths', 'weddings']).optional(), place: z.string().optional() }),
  component: Atlas,
});

interface Event { kind: Kind; place: string; year: number; people: string[] }
interface Pin { place: Place; people: string[]; first: number; entries: { kind: Kind; id: string }[]; kinds: Record<Kind, number> }

const KINDS: Kind[] = ['births', 'deaths', 'weddings'];
const ICON: Record<Kind, 'cake-slice' | 'candle-light' | 'linked-rings'> = { births: 'cake-slice', deaths: 'candle-light', weddings: 'linked-rings' };
const MODES: { id: Mode; label: string; icon?: 'cake-slice' | 'candle-light' | 'linked-rings' }[] = [
  { id: 'all', label: 'All' },
  { id: 'births', label: 'Births', icon: 'cake-slice' },
  { id: 'deaths', label: 'Deaths', icon: 'candle-light' },
  { id: 'weddings', label: 'Weddings', icon: 'linked-rings' },
];

function Atlas() {
  const f = useFamily();
  const tree = useTreeId();
  const navigate = useNavigate({ from: '/$tree/atlas' });
  const search = Route.useSearch();
  const mode: Mode = search.mode ?? 'births';
  const placeBy = useMemo(() => new Map(f.graph.places.map((p) => [p.name, p])), [f]);

  // Every event of this kind, with a year and a place we can draw.
  const { events, unplaced } = useMemo(() => {
    const out: Event[] = [];
    let unplaced = 0;
    const add = (kind: Kind, place: string | undefined, year: number, people: string[]) => {
      if (!place || !placeBy.has(place) || isNaN(year)) unplaced += people.length;
      else out.push({ kind, place, year, people });
    };
    const want = (k: Kind) => mode === 'all' || mode === k;
    if (want('births')) for (const p of f.graph.people) add('births', p.bornPlace, yearOf(p.born), [p.id]);
    if (want('deaths')) for (const p of f.graph.people) { if (!p.living && (p.died || p.diedPlace)) add('deaths', p.diedPlace, yearOf(p.died), [p.id]); }
    if (want('weddings')) for (const u of f.graph.unions) if (u.kind === 'marriage') add('weddings', u.place, yearOf(u.start), [u.a, u.b]);
    return { events: out.sort((a, b) => a.year - b.year), unplaced };
  }, [f, mode, placeBy]);

  const [y0, y1] = events.length ? [events[0].year, events[events.length - 1].year] : [0, 0];
  const [year, setYear] = useState<number | null>(null);
  const cursor = year ?? y1;
  const [playing, setPlaying] = useState(false);
  const [moves, setMoves] = useState(true);
  useEffect(() => { setYear(null); setPlaying(false); }, [mode, tree]);

  // Replay: about twelve seconds from the first event to the last.
  useEffect(() => {
    if (!playing) return;
    const span = Math.max(1, y1 - y0);
    const start = performance.now() - ((cursor >= y1 ? y0 : cursor) - y0) / span * 12000;
    let raf = 0;
    const step = (t: number) => {
      const y = Math.min(y1, Math.round(y0 + ((t - start) / 12000) * span));
      setYear(y);
      if (y >= y1) setPlaying(false);
      else raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pins: people per place up to the cursor year.
  const pins = useMemo(() => {
    const m = new Map<string, Pin>();
    for (const e of events) {
      if (e.year > cursor) break;
      const pin = m.get(e.place) ?? m.set(e.place, { place: placeBy.get(e.place)!, people: [], first: e.year, entries: [], kinds: { births: 0, deaths: 0, weddings: 0 } }).get(e.place)!;
      pin.people.push(...e.people);
      pin.kinds[e.kind] += e.people.length;
      for (const id of e.people) pin.entries.push({ kind: e.kind, id });
    }
    return [...m.values()].sort((a, b) => b.people.length - a.people.length);
  }, [events, cursor, placeBy]);

  // A new place appearing during the replay gets a small tick.
  const seen = useRef(0);
  useEffect(() => {
    if (playing && pins.length > seen.current) play('tick', { pitch: 1 + Math.min(pins.length, 30) / 60 });
    seen.current = pins.length;
  }, [pins.length, playing]);

  // Moves: from the mother's (else father's) birthplace to the child's.
  const arcs = useMemo(() => {
    if ((mode !== 'births' && mode !== 'all') || !moves) return [];
    const m = new Map<string, { from: Place; to: Place; n: number }>();
    for (const p of f.graph.people) {
      if (!p.bornPlace || yearOf(p.born) > cursor) continue;
      const ps = parents(f, p.id).map((id) => f.byId.get(id)!).filter((q) => q?.bornPlace && q.bornPlace !== p.bornPlace);
      const from = (ps.find((q) => q.sex === 'f') ?? ps[0])?.bornPlace;
      if (!from || !placeBy.has(from) || !placeBy.has(p.bornPlace)) continue;
      const k = `${from}→${p.bornPlace}`;
      const a = m.get(k) ?? m.set(k, { from: placeBy.get(from)!, to: placeBy.get(p.bornPlace)!, n: 0 }).get(k)!;
      a.n++;
    }
    // With many moves, only the well-trodden routes: a web of one-off arcs says nothing.
    const all = [...m.values()];
    return all.length > 40 ? all.filter((a) => a.n >= 3) : all;
  }, [f, mode, moves, cursor, placeBy]);

  const selected = search.place && pins.find((p) => p.place.name === search.place);
  const total = pins.reduce((n, p) => n + p.people.length, 0);
  const select = (name?: string) => {
    if (name) play('tick');
    navigate({ search: (s) => ({ ...s, place: name }), replace: true });
  };

  return (
    <div className="atlas">
      <aside className="atlas-side panel">
        <header>
          <h1 className="display">Atlas</h1>
          <div className="seg">
            {MODES.map((m) => (
              <button key={m.id} className="btn" aria-pressed={mode === m.id} onClick={() => navigate({ search: { mode: m.id }, replace: true })}>
                {m.icon ? <GameIcon name={m.icon} size={15} /> : <Layers size={15} />} {m.label}
              </button>
            ))}
          </div>
          <p className="muted atlas-count">
            {total.toLocaleString('en-GB')} {mode === 'all' ? 'births, deaths and weddings' : mode === 'weddings' ? 'people married' : mode === 'births' ? 'born' : 'died'} in {pins.length} {pins.length === 1 ? 'place' : 'places'}
            {cursor < y1 ? ` by ${cursor}` : ''}
            {unplaced > 0 && <span className="faint"> · {unplaced.toLocaleString('en-GB')} without a known place</span>}
          </p>
        </header>
        {selected ? (
          <PlaceDetail pin={selected} f={f} tree={tree} mode={mode} onBack={() => select(undefined)} />
        ) : (
          <ol className="atlas-places">
            {pins.map((p) => (
              <li key={p.place.name}>
                <button onClick={() => select(p.place.name)}>
                  <span className="atlas-place-name">
                    {p.place.name}
                    {mode === 'all' && (
                      <small className="atlas-kinds">
                        {KINDS.filter((k) => p.kinds[k]).map((k) => <span key={k} className={`k-${k}`}><GameIcon name={ICON[k]} size={11} />{p.kinds[k]}</span>)}
                      </small>
                    )}
                  </span>
                  <span className="atlas-bar"><i style={{ width: `${(p.people.length / (pins[0]?.people.length || 1)) * 100}%` }} /></span>
                  <b>{p.people.length}</b>
                </button>
              </li>
            ))}
            {pins.length === 0 && <li className="empty">No places recorded {cursor < y1 ? 'yet in this year' : 'for this tree'}.</li>}
          </ol>
        )}
      </aside>

      <div className="atlas-map">
        <WorldMap places={f.graph.places} pins={pins} arcs={arcs} selected={search.place} onSelect={select} rings={mode === 'all'} />
        {events.length > 0 && (
          <div className="atlas-time panel">
            <button className="btn icon primary" onClick={() => { if (cursor >= y1) setYear(y0); setPlaying((p) => !p); }} title={playing ? 'Pause' : 'Replay through time'}>
              {playing ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <span className="atlas-year display">{cursor}</span>
            <input
              type="range"
              min={y0}
              max={y1}
              value={cursor}
              onChange={(e) => { setPlaying(false); setYear(+e.target.value === y1 ? null : +e.target.value); }}
              aria-label="Year"
            />
            <span className="faint">{y0}–{y1}</span>
            {(mode === 'births' || mode === 'all') && (
              <button className="btn" aria-pressed={moves} onClick={() => setMoves((m) => !m)} title="Show moves from a mother's birthplace to her child's">
                <RouteIcon size={15} /> Moves
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PlaceDetail({ pin, f, tree, mode, onBack }: { pin: Pin; f: ReturnType<typeof useFamily>; tree: string; mode: Mode; onBack: () => void }) {
  const WHAT: Record<Kind, string> = { births: 'Born here', deaths: 'Died here', weddings: 'Married here' };
  const groups = KINDS.filter((k) => mode === 'all' || mode === k)
    .map((k) => [k, [...new Set(pin.entries.filter((e) => e.kind === k).map((e) => e.id))].map((id) => f.byId.get(id)).filter((p): p is GPerson => !!p)] as const)
    .filter(([, ps]) => ps.length);
  return (
    <div className="atlas-detail">
      <button className="btn ghost" onClick={onBack}>← All places</button>
      <h2 className="display">{pin.place.name}</h2>
      <p className="muted">First recorded in {pin.first}</p>
      {groups.map(([k, people]) => (
        <section key={k}>
          <div className={`rule k-${k}`}><GameIcon name={ICON[k]} size={14} /> {WHAT[k]} <span className="faint">{people.length}</span></div>
          <ul>
            {people.map((p) => (
              <li key={p.id}>
                <Link to="/$tree" params={{ tree }} search={{ focus: p.id }}>
                  <Portrait person={p} tree={tree} size={40} />
                  <span>
                    <b>{displayName(p, f)}</b>
                    <small className="muted">{lifespan(p)}</small>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ---------- the map ----------

type World = { land: GeoPermissibleObjects; borders: GeoPermissibleObjects };
let worldCache: Promise<World> | null = null;
const loadWorld = () =>
  (worldCache ??= import('world-atlas/countries-50m.json').then((m) => {
    const topo = (m as { default?: unknown }).default ?? m;
    const t = topo as Parameters<typeof feature>[0] & { objects: { countries: Parameters<typeof feature>[1]; land?: unknown } };
    return { land: feature(t, t.objects.countries) as GeoPermissibleObjects, borders: mesh(t, t.objects.countries as never, (a, b) => a !== b) as GeoPermissibleObjects };
  }));

function WorldMap({ places, pins, arcs, selected, onSelect, rings }: {
  places: Place[];
  pins: Pin[];
  rings: boolean;
  arcs: { from: Place; to: Place; n: number }[];
  selected?: string;
  onSelect: (name?: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 700 });
  const [world, setWorld] = useState<World | null>(null);
  const [cam, setCam] = useState({ x: 0, y: 0, k: 1 });
  useEffect(() => { loadWorld().then(setWorld); }, []);
  useEffect(() => {
    const el = host.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit the projection to the family's places, with room around them.
  const projection = useMemo(() => {
    const p = geoNaturalEarth1();
    const pts = places.map((pl) => [pl.lng, pl.lat]);
    if (!pts.length) return p.fitExtent([[20, 20], [size.w - 20, size.h - 20]], { type: 'Sphere' });
    const lngs = pts.map((q) => q[0]), lats = pts.map((q) => q[1]);
    const pad = Math.max(3, (Math.max(...lngs) - Math.min(...lngs)) * 0.15, (Math.max(...lats) - Math.min(...lats)) * 0.15);
    const box = {
      type: 'MultiPoint' as const,
      coordinates: [[Math.min(...lngs) - pad, Math.min(...lats) - pad], [Math.max(...lngs) + pad, Math.max(...lats) + pad]],
    };
    // Leave the side panel (left) and the time bar (bottom) clear.
    return p.fitExtent([[390, 40], [size.w - 50, size.h - 110]], box);
  }, [places, size]);
  const path = useMemo(() => geoPath(projection), [projection]);
  const paths = useMemo(
    () => (world ? { land: path(world.land) ?? '', borders: path(world.borders) ?? '', grid: path(geoGraticule10()) ?? '', sphere: path({ type: 'Sphere' }) ?? '' } : null),
    [world, path],
  );
  useEffect(() => setCam({ x: 0, y: 0, k: 1 }), [projection]);
  // Choosing a place brings it to the middle of the free map area, close enough to read its neighbours.
  useEffect(() => {
    const pin = selected && places.find((p) => p.name === selected);
    const xy = pin && projection([pin.lng, pin.lat]);
    if (!xy) return;
    setCam((c) => {
      const k = Math.max(c.k, 3);
      return { k, x: 390 + (size.w - 390) / 2 - xy[0] * k, y: size.h / 2 - 40 - xy[1] * k };
    });
  }, [selected, projection]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pan and zoom.
  const drag = useRef<{ x: number; y: number } | null>(null);
  const onWheel = (e: React.WheelEvent) => {
    const r = host.current!.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const k = Math.min(40, Math.max(0.6, cam.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018))));
    const f = k / cam.k;
    setCam({ k, x: sx - (sx - cam.x) * f, y: sy - (sy - cam.y) * f });
  };
  useEffect(() => {
    const el = host.current!;
    const stop = (e: WheelEvent) => e.preventDefault();
    el.addEventListener('wheel', stop, { passive: false });
    return () => el.removeEventListener('wheel', stop);
  }, []);

  const max = Math.max(1, ...pins.map((p) => p.people.length));
  // Labels, busiest place first, skipping any that would overlap one already placed (screen space).
  const labelled = useMemo(() => {
    const out = new Set<string>();
    const boxes: [number, number, number, number][] = [];
    for (const p of pins) {
      const xy = projection([p.place.lng, p.place.lat]);
      if (!xy) continue;
      const r = (5 + Math.sqrt(p.people.length / max) * 18);
      const x = xy[0] * cam.k + cam.x, y = xy[1] * cam.k + cam.y - r - 10;
      const w = p.place.name.length * 7.6 + 6, h = 16;
      const b: [number, number, number, number] = [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
      if (p.place.name !== selected && boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])) continue;
      boxes.push(b);
      out.add(p.place.name);
    }
    return out;
  }, [pins, projection, cam, max, selected]);
  // Screen-constant pin sizes: zooming in spreads places apart instead of inflating them.
  const radius = (n: number) => (5 + Math.sqrt(n / max) * 18) / cam.k;
  return (
    <div
      ref={host}
      className="atlas-canvas"
      onWheel={onWheel}
      onPointerDown={(e) => { if ((e.target as Element).closest('.pin')) return; drag.current = { x: e.clientX, y: e.clientY }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
      onPointerMove={(e) => { const d = drag.current; if (!d) return; setCam((c) => ({ ...c, x: c.x + e.clientX - d.x, y: c.y + e.clientY - d.y })); drag.current = { x: e.clientX, y: e.clientY }; }}
      onPointerUp={() => (drag.current = null)}
    >
      <svg width={size.w} height={size.h}>
        <defs>
          <radialGradient id="sea-glow" cx="50%" cy="45%" r="75%">
            <stop offset="0%" className="sea-hi" />
            <stop offset="100%" className="sea-lo" />
          </radialGradient>
        </defs>
        <rect width={size.w} height={size.h} fill="url(#sea-glow)" />
        <g transform={`translate(${cam.x},${cam.y}) scale(${cam.k})`}>
          {paths ? (
            <>
              <path d={paths.grid} className="graticule" />
              <path d={paths.land} className="land" />
              <path d={paths.borders} className="borders" />
            </>
          ) : null}
          {arcs.map((a) => {
            const p0 = projection([a.from.lng, a.from.lat]), p1 = projection([a.to.lng, a.to.lat]);
            if (!p0 || !p1) return null;
            const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
            const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
            const bend = 0.22;
            return (
              <path
                key={`${a.from.name}→${a.to.name}`}
                className="arc"
                d={`M${p0[0]},${p0[1]}Q${mx - dy * bend},${my + dx * bend} ${p1[0]},${p1[1]}`}
                style={{ strokeWidth: (1 + Math.log2(a.n + 1)) / cam.k, opacity: Math.min(0.75, 0.25 + a.n * 0.08) }}
              />
            );
          })}
          {[...pins].reverse().map((p) => {
            const xy = projection([p.place.lng, p.place.lat]);
            if (!xy) return null;
            const r = radius(p.people.length);
            const on = selected === p.place.name;
            return (
              <g key={p.place.name} className={`pin${on ? ' on' : ''}`} transform={`translate(${xy[0]},${xy[1]})`} onClick={() => onSelect(on ? undefined : p.place.name)}>
                <circle r={r} className="pin-dot" style={{ strokeWidth: 2 / cam.k }} />
                {rings && <KindRing kinds={p.kinds} r={r + 2.5 / cam.k} w={3.5 / cam.k} />}
                {p.people.length > 1 && r * cam.k > 11 && <text className="pin-n" style={{ fontSize: 11 / cam.k }} dy="0.35em">{p.people.length}</text>}
                {(on || labelled.has(p.place.name)) && (
                  <text className="pin-label" style={{ fontSize: 13 / cam.k, strokeWidth: 3 / cam.k }} y={-r - 5 / cam.k}>{p.place.name}</text>
                )}
                <title>{`${p.place.name}: ${p.people.length}`}</title>
              </g>
            );
          })}
        </g>
      </svg>
      {!paths && <div className="atlas-loading">Unrolling the map…</div>}
    </div>
  );
}

/** Around an "All" pin: how its people split into births, deaths and weddings. */
function KindRing({ kinds, r, w }: { kinds: Record<Kind, number>; r: number; w: number }) {
  const total = KINDS.reduce((n, k) => n + kinds[k], 0);
  let a0 = -Math.PI / 2;
  return (
    <g className="kind-ring" style={{ strokeWidth: w }}>
      {KINDS.filter((k) => kinds[k]).map((k) => {
        const a1 = a0 + (kinds[k] / total) * Math.PI * 2;
        const full = kinds[k] === total;
        // Rounded: server and browser maths differ in the last digit, which would break hydration.
        const q = (n: number) => Math.round(n * 100) / 100;
        const d = full
          ? undefined
          : `M${q(r * Math.cos(a0))},${q(r * Math.sin(a0))}A${q(r)},${q(r)} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${q(r * Math.cos(a1))},${q(r * Math.sin(a1))}`;
        a0 = a1;
        return full ? <circle key={k} r={r} className={`k-${k}`} /> : <path key={k} d={d} className={`k-${k}`} />;
      })}
    </g>
  );
}
