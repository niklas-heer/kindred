// The Atlas: where the family was born, died and married, on a world map drawn locally (d3-geo +
// world-atlas, no tile server). A time slider replays the family spreading out; arcs show moves
// from a mother's birthplace to her child's.
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { geoGraticule10, geoNaturalEarth1, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import { Layers, Pause, Play, Route as RouteIcon, ScrollText, Shield, X } from 'lucide-react';
import { usePageHotkey } from '~/components/ui/overlay';
import { setPref, usePref } from '~/lib/prefs';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { feature, mesh } from 'topojson-client';
import { z } from 'zod';
import { GameIcon } from '~/components/GameIcon';
import { Arms } from '~/components/Heraldry';
import type { House } from '~/lib/types';
import { Portrait } from '~/components/Portrait';
import { useFamily, useTreeId } from '~/lib/family';
import { displayName, lifespan, parents, yearOf } from '~/lib/graph';
import { play } from '~/lib/sfx';
import type { GPerson, Place } from '~/lib/types';
import '~/styles/atlas.css';
import { sectionHead } from '~/lib/title';

type Kind = 'births' | 'deaths' | 'weddings';
type Mode = Kind | 'all';

export const Route = createFileRoute('/$tree/atlas')({
  head: sectionHead('Atlas'),
  validateSearch: z.object({ mode: z.enum(['all', 'births', 'deaths', 'weddings']).optional(), place: z.string().optional() }),
  component: Atlas,
});

interface Event { kind: Kind; place: string; year: number; people: string[] }
interface FeedRow { year: number; event?: Event; summary?: Event[] }
interface Pin { place: Place; people: string[]; first: number; entries: { kind: Kind; id: string }[]; kinds: Record<Kind, number>; house?: string; /** Events here: a wedding counts once. */ n: number }

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
  // Playback speed, remembered: ½×, 1×, 2× or 4× the base pace.
  const speedPref = usePref('atlas-speed');
  const speed = [0.5, 1, 2, 4].includes(Number(speedPref)) ? Number(speedPref) : 1;
  const [feedOpen, setFeedOpen] = useState(false);
  // After a replay reaches the end, the chronicle bows out a few seconds later, unless the reader
  // scrubs or opens it themselves meanwhile. (Its own effect: the replay's cleanup must not cancel it.)
  const finished = useRef(false);
  useEffect(() => {
    if (playing || !finished.current || year !== y1 || feedOpen) return;
    const t = window.setTimeout(() => { finished.current = false; setYear((y) => (y === y1 ? null : y)); }, 4000);
    return () => clearTimeout(t);
  }, [playing, year, y1, feedOpen]);
  // The time bar's real height, so the chronicle always sits clear above it.
  const timeBar = useRef<HTMLDivElement>(null);
  const atlasEl = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = timeBar.current;
    if (!el) return;
    const ro = new ResizeObserver(() => atlasEl.current?.style.setProperty('--time-h', `${Math.round(el.getBoundingClientRect().height)}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, [events.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const [feedLimit, setFeedLimit] = useState(300);
  const [moves, setMoves] = useState(true);
  const [heraldry, setHeraldry] = useState(false);
  useEffect(() => { setYear(null); setPlaying(false); }, [mode, tree]);

  // Replay, paced by events rather than years: busy centuries get the time they need (15–60 s).
  const duration = Math.min(60000, Math.max(15000, events.length * 25));
  useEffect(() => {
    if (!playing || !events.length) return;
    const n = events.length;
    // Resume from the cursor: the share of events already past it.
    let past = 0;
    while (past < n && events[past].year <= cursor && cursor < y1) past++;
    const span = duration / speed;
    const start = performance.now() - (past / n) * span;
    let raf = 0;
    finished.current = false;
    const step = (t: number) => {
      const idx = Math.min(n - 1, Math.floor(((t - start) / span) * n));
      setYear(events[idx].year);
      if (idx >= n - 1) {
        setPlaying(false);
        finished.current = true;
      } else raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pins: people per place up to the cursor year.
  const pins = useMemo(() => {
    const m = new Map<string, Pin>();
    for (const e of events) {
      if (e.year > cursor) break;
      const pin = m.get(e.place) ?? m.set(e.place, { place: placeBy.get(e.place)!, people: [], first: e.year, entries: [], kinds: { births: 0, deaths: 0, weddings: 0 }, n: 0 }).get(e.place)!;
      pin.people.push(...e.people);
      pin.kinds[e.kind] += 1;
      pin.n += 1;
      for (const id of e.people) pin.entries.push({ kind: e.kind, id });
    }
    // The house most of a place's people belong to, for the heraldry view.
    for (const pin of m.values()) {
      const n = new Map<string, number>();
      for (const id of pin.people) { const h = f.byId.get(id)?.house; if (h) n.set(h, (n.get(h) ?? 0) + 1); }
      pin.house = [...n].sort((a, b) => b[1] - a[1])[0]?.[0];
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [events, cursor, placeBy, f]);

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
      // The mother's birthplace when known, else the father's; no move when the child was born there too.
      const ps = parents(f, p.id).map((id) => f.byId.get(id)!).filter((q) => q?.bornPlace);
      const from = (ps.find((q) => q.sex === 'f') ?? ps[0])?.bornPlace;
      if (!from || from === p.bornPlace || !placeBy.has(from) || !placeBy.has(p.bornPlace)) continue;
      const k = `${from}→${p.bornPlace}`;
      const a = m.get(k) ?? m.set(k, { from: placeBy.get(from)!, to: placeBy.get(p.bornPlace)!, n: 0 }).get(k)!;
      a.n++;
    }
    // With many moves, only the well-trodden routes: a web of one-off arcs says nothing.
    const all = [...m.values()];
    return all.length > 40 ? all.filter((a) => a.n >= 3) : all;
  }, [f, mode, moves, cursor, placeBy]);

  // The chronicle: the latest events up to the cursor, newest first. A year with more than three
  // events becomes one summary line, so a busy century stays readable.
  const upto = useMemo(() => {
    let hi = events.length;
    for (let lo = 0; lo < hi; ) { const mid = (lo + hi) >> 1; if (events[mid].year <= cursor) lo = mid + 1; else hi = mid; }
    return hi;
  }, [events, cursor]);
  const feed = useMemo(() => {
    const rows: FeedRow[] = [];
    let k = upto - 1;
    while (k >= 0 && rows.length < feedLimit) {
      const yr = events[k].year;
      let a = k;
      while (a > 0 && events[a - 1].year === yr) a--;
      const year = events.slice(a, k + 1);
      if (year.length > 3) rows.push({ year: yr, summary: year });
      else for (const e of [...year].reverse()) if (rows.length < feedLimit) rows.push({ year: yr, event: e });
      k = a - 1;
    }
    return { rows, more: k >= 0 };
  }, [events, upto, feedLimit]);
  const showFeed = feedOpen || playing || year !== null;

  // Keys: space plays and pauses, arrows step to the previous or next year with an event.
  const stepTo = (dir: -1 | 1) => {
    setPlaying(false);
    finished.current = false;
    if (!events.length) return;
    const target = dir > 0 ? events.find((e) => e.year > cursor)?.year : [...events].reverse().find((e) => e.year < cursor)?.year;
    if (target !== undefined) setYear(target >= y1 ? y1 : target);
  };
  usePageHotkey('Space', () => { if (cursor >= y1 && !playing) setYear(y0); setPlaying((p) => !p); });
  usePageHotkey('ArrowRight', () => stepTo(1));
  usePageHotkey('ArrowLeft', () => stepTo(-1));
  // Places touched in the last few years of the replay pulse on the map (every event in that window).
  const recent = useMemo(() => {
    if (!playing) return new Set<string>();
    const window = Math.max(1, Math.round((y1 - y0) / 60));
    const out = new Set<string>();
    for (let k = upto - 1; k >= 0 && events[k].year > cursor - window; k--) out.add(events[k].place);
    return out;
  }, [playing, events, upto, cursor, y0, y1]);

  const selected = search.place && pins.find((p) => p.place.name === search.place);
  const total = mode === 'weddings' ? new Set(pins.flatMap((p) => p.people)).size : pins.reduce((n, p) => n + p.n, 0);
  const select = (name?: string) => {
    if (name) play('tick');
    navigate({ search: (s) => ({ ...s, place: name }), replace: true });
  };

  return (
    <div className="atlas" ref={atlasEl}>
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
                    <span>{p.place.name}</span>
                    {mode === 'all' && (
                      <small className="atlas-kinds">
                        {KINDS.filter((k) => p.kinds[k]).map((k) => <span key={k} className={`k-${k}`}><GameIcon name={ICON[k]} size={11} />{p.kinds[k]}</span>)}
                      </small>
                    )}
                  </span>
                  <span className="atlas-bar"><i style={{ width: `${(p.n / (pins[0]?.n || 1)) * 100}%` }} /></span>
                  <b>{p.n}</b>
                </button>
              </li>
            ))}
            {pins.length === 0 && <li className="empty">No places recorded {cursor < y1 ? 'yet in this year' : 'for this tree'}.</li>}
          </ol>
        )}
      </aside>

      <div className="atlas-map">
        <WorldMap places={f.graph.places} pins={pins} arcs={arcs} selected={search.place} onSelect={select} rings={mode === 'all' && !heraldry} heraldry={heraldry ? f.house : null} recent={recent} />
        {showFeed && feed.rows.length > 0 && (
          <Chronicle
            rows={feed.rows}
            more={feed.more}
            onMore={() => setFeedLimit((l) => l + 300)}
            cursor={cursor}
            playing={playing}
            f={f}
            tree={tree}
            heraldry={heraldry}
            onSelect={select}
            onClose={() => { setPlaying(false); setYear(null); setFeedOpen(false); }}
          />
        )}
        {events.length > 0 && (
          <div className="atlas-time panel" ref={timeBar}>
            <button className="btn icon primary" onClick={() => { if (cursor >= y1) setYear(y0); setPlaying((p) => !p); }} title={playing ? 'Pause' : 'Replay through time'}>
              {playing ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <span className="atlas-year display">{cursor}</span>
            <input
              type="range"
              min={y0}
              max={y1}
              value={cursor}
              onChange={(e) => { setPlaying(false); finished.current = false; setYear(+e.target.value === y1 ? null : +e.target.value); }}
              aria-label="Year"
            />
            <span className="faint">{y0}–{y1}</span>
            <button
              className="btn atlas-speed"
              onClick={() => setPref('atlas-speed', String(speed === 4 ? 0.5 : speed * 2))}
              title="Playback speed (click to change)"
            >
              {speed === 0.5 ? '½×' : `${speed}×`}
            </button>
            <button className="btn" aria-pressed={showFeed} onClick={() => (showFeed ? (setFeedOpen(false), setYear(null), setPlaying(false)) : setFeedOpen(true))} title="Open the chronicle of everything up to this year">
              <ScrollText size={15} /> <span className="tb-label">Chronicle</span>
            </button>
            <button className="btn" aria-pressed={heraldry} onClick={() => { if (!heraldry) play('seal'); setHeraldry((h) => !h); }} title="Show each place by the arms of the house most of its people belong to">
              <Shield size={15} /> <span className="tb-label">Arms</span>
            </button>
            {(mode === 'births' || mode === 'all') && (
              <button className="btn" aria-pressed={moves} onClick={() => setMoves((m) => !m)} title="Show moves from a mother's birthplace to her child's">
                <RouteIcon size={15} /> <span className="tb-label">Moves</span>
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

const PLAIN: House['arms'] = { field: 'argent', division: 'plain', charge: 'none', chargeTincture: 'sable' };

type World = { land: GeoPermissibleObjects; borders: GeoPermissibleObjects };
let worldCache: Promise<World> | null = null;
const loadWorld = () =>
  (worldCache ??= import('world-atlas/countries-110m.json').then((m) => {
    const topo = (m as { default?: unknown }).default ?? m;
    const t = topo as Parameters<typeof feature>[0] & { objects: { countries: Parameters<typeof feature>[1]; land?: unknown } };
    return { land: feature(t, t.objects.countries) as GeoPermissibleObjects, borders: mesh(t, t.objects.countries as never, (a, b) => a !== b) as GeoPermissibleObjects };
  }));

function WorldMap({ places, pins, arcs, selected, onSelect, rings, heraldry, recent }: {
  recent: ReadonlySet<string>;
  places: Place[];
  pins: Pin[];
  rings: boolean;
  /** When set, pins are drawn as the arms of each place's main house. */
  heraldry: Map<string, House> | null;
  arcs: { from: Place; to: Place; n: number }[];
  selected?: string;
  onSelect: (name?: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 700, measured: false });
  const [world, setWorld] = useState<World | null>(null);
  const [cam, setCam] = useState({ x: 0, y: 0, k: 1 });
  useEffect(() => { loadWorld().then(setWorld); }, []);
  useEffect(() => {
    const el = host.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight, measured: true }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Room taken by the side panel (docked left, or a bottom sheet on narrow windows) and the time bar.
  const narrow = size.w <= 900;
  const padL = narrow ? 24 : 340 + 40;
  const padB = narrow ? Math.round(size.h * 0.42) + 90 : 130;
  // Fit the projection to the family's places, with room around them.
  const projection = useMemo(() => {
    const p = geoNaturalEarth1();
    const pts = places.map((pl) => [pl.lng, pl.lat]);
    if (!pts.length) return p.fitExtent([[20, 20], [size.w - 20, size.h - 20]], { type: 'Sphere' });
    // Every place, each with a little neighbourhood (clamped to the globe) so a tight cluster is not over-zoomed.
    const clampLng = (x: number) => Math.max(-179.9, Math.min(179.9, x));
    const clampLat = (y: number) => Math.max(-85, Math.min(85, y));
    const around = pts.flatMap(([x, y]) => [[clampLng(x - 2.5), clampLat(y - 2)], [clampLng(x + 2.5), clampLat(y + 2)]]);
    // Leave the side panel (left) and the time bar (bottom) clear, plus room for pins and labels.
    return p.fitExtent([[padL + 20, 70], [size.w - 50, size.h - padB]], { type: 'MultiPoint', coordinates: around });
  }, [places, size, padL, padB]);
  const path = useMemo(() => geoPath(projection), [projection]);
  const paths = useMemo(
    () => (world ? { land: path(world.land) ?? '', borders: path(world.borders) ?? '', grid: path(geoGraticule10()) ?? '', sphere: path({ type: 'Sphere' }) ?? '' } : null),
    [world, path],
  );
  const prev = useRef<{ projection: typeof projection; places: Place[]; size: typeof size } | null>(null);
  useEffect(() => {
    const was = prev.current;
    prev.current = { projection, places, size };
    // A fresh fit for a new tree, and for the first real measurement (the placeholder size means nothing).
    if (!was || was.places !== places || !was.size.measured) return setCam({ x: 0, y: 0, k: 1 });
    // A resize: keep the same place at the centre of the screen, at the same zoom.
    setCam((c) => {
      const centre = was.projection.invert?.([(was.size.w / 2 - c.x) / c.k, (was.size.h / 2 - c.y) / c.k]);
      const xy = centre && projection(centre);
      return xy ? { k: c.k, x: size.w / 2 - xy[0] * c.k, y: size.h / 2 - xy[1] * c.k } : { x: 0, y: 0, k: 1 };
    });
  }, [projection]); // eslint-disable-line react-hooks/exhaustive-deps
  // Choosing a place brings it to the middle of the free map area, close enough to read its neighbours.
  // Only on a new choice: a resize keeps whatever panning happened since.
  const centred = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (centred.current === selected) return;
    centred.current = selected;
    const pin = selected && places.find((p) => p.name === selected);
    const xy = pin && projection([pin.lng, pin.lat]);
    if (!xy) return;
    setCam((c) => {
      const k = Math.max(c.k, 3);
      return { k, x: padL + (size.w - padL) / 2 - xy[0] * k, y: (size.h - padB + 70) / 2 - xy[1] * k };
    });
  }, [selected, projection]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pan and zoom.
  const drag = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(0);
  const onWheel = (e: React.WheelEvent) => {
    const r = host.current!.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const step = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
    setCam((c) => {
      const k = Math.min(12, Math.max(0.6, c.k * step));
      const f = k / c.k;
      return { k, x: sx - (sx - c.x) * f, y: sy - (sy - c.y) * f };
    });
  };
  useEffect(() => {
    const el = host.current!;
    const stop = (e: WheelEvent) => e.preventDefault();
    el.addEventListener('wheel', stop, { passive: false });
    return () => el.removeEventListener('wheel', stop);
  }, []);

  const max = Math.max(1, ...pins.map((p) => p.n));
  // Labels, busiest place first, skipping any that would overlap one already placed (screen space).
  const labelled = useMemo(() => {
    // Screen-space boxes: first every pin's body (dot, or shield and count), then labels, busiest
    // place first (the selected one before all), skipping any label that would overlap.
    type Box = [number, number, number, number];
    const hit = (a: Box, b: Box) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
    const placed = pins.flatMap((p) => {
      const xy = projection([p.place.lng, p.place.lat]);
      if (!xy) return [];
      const r = 5 + Math.sqrt(p.n / max) * 18;
      const x = xy[0] * cam.k + cam.x, y = xy[1] * cam.k + cam.y;
      const body: Box = heraldry ? [x - r * 1.1, y - r * 1.32, x + r * 1.1, y + r * 1.32 + 14] : [x - r, y - r, x + r, y + r];
      const top = heraldry ? r * 1.35 : r;
      const w = p.place.name.length * 7.6 + 6;
      const label: Box = [x - w / 2, y - top - 22, x + w / 2, y - top - 4];
      return [{ name: p.place.name, body, label }];
    });
    const bodies: Box[] = placed.map((q) => q.body);
    const labels: Box[] = [];
    const out = new Map<string, 'above' | 'below'>();
    const order = [...placed].sort((a, b) => (a.name === selected ? -1 : b.name === selected ? 1 : 0));
    order.forEach((q, rank) => {
      // The selected and the three busiest places always get a name (they may cover a small pin);
      // others take the first free spot above or below their pin.
      const vip = q.name === selected || rank < 3;
      const free = (b: Box) => !labels.some((o) => hit(b, o)) && (vip || !bodies.some((o) => o !== q.body && hit(b, o)));
      const below: Box = [q.label[0], q.body[3] + 2, q.label[2], q.body[3] + 20];
      const spot = free(q.label) ? 'above' : free(below) ? 'below' : null;
      if (!spot) return;
      labels.push(spot === 'above' ? q.label : below);
      out.set(q.name, spot);
    });
    return out;
  }, [pins, projection, cam, max, selected, heraldry]);
  // Screen-constant pin sizes: zooming in spreads places apart instead of inflating them.
  const radius = (n: number) => (5 + Math.sqrt(n / max) * 18) / cam.k;
  return (
    <div
      ref={host}
      className="atlas-canvas"
      onWheel={onWheel}
      onPointerDown={(e) => { if ((e.target as Element).closest('.pin')) return; drag.current = { x: e.clientX, y: e.clientY }; moved.current = 0; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
      onPointerMove={(e) => { const d = drag.current; if (!d) return; moved.current += Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y); setCam((c) => ({ ...c, x: c.x + e.clientX - d.x, y: c.y + e.clientY - d.y })); drag.current = { x: e.clientX, y: e.clientY }; }}
      onPointerUp={() => { if (drag.current && moved.current < 4 && selected) onSelect(undefined); drag.current = null; }}
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
                style={{ strokeWidth: (1 + Math.log2(a.n + 1)) / cam.k, strokeDasharray: `${6 / cam.k} ${5 / cam.k}`, opacity: Math.min(0.75, 0.25 + a.n * 0.08) }}
              />
            );
          })}
          {/* Stable order (first appearance): reordering would move DOM nodes and restart their animation. */}
          {[...pins].sort((a, b) => a.first - b.first || a.place.name.localeCompare(b.place.name)).map((p) => {
            const xy = projection([p.place.lng, p.place.lat]);
            if (!xy) return null;
            const r = radius(p.n);
            const on = selected === p.place.name;
            return (
              <g key={p.place.name} className={`pin${on ? ' on' : ''}${recent.has(p.place.name) ? ' recent' : ''}`} transform={`translate(${xy[0]},${xy[1]})`} onClick={() => onSelect(on ? undefined : p.place.name)}>
                {recent.has(p.place.name) && <circle r={r} className="pulse" style={{ strokeWidth: 2 / cam.k }} />}
                <g className="pin-grow">
                {heraldry ? (
                  // A shield instead of a dot (plain silver where no house dominates); its count sits underneath.
                  <g className="pin-arms" transform={`translate(${-r * 1.1},${-r * 1.32})`}>
                    <Arms arms={(p.house && heraldry.get(p.house)?.arms) || PLAIN} size={r * 2.2} title={(p.house && heraldry.get(p.house)?.name) || p.place.name} />
                  </g>
                ) : (
                  <circle r={r} className="pin-dot" style={{ strokeWidth: 2 / cam.k }} />
                )}
                {rings && <KindRing kinds={p.kinds} r={r + 2.5 / cam.k} w={3.5 / cam.k} />}
                {p.n > 1 && r * cam.k > 11 && (
                  heraldry
                    ? <text className="pin-n under" style={{ fontSize: 11 / cam.k, strokeWidth: 3 / cam.k }} y={r * 1.32 + 11 / cam.k}>{p.n}</text>
                    : <text className="pin-n" style={{ fontSize: 11 / cam.k }} dy="0.35em">{p.n}</text>
                )}
                {labelled.has(p.place.name) && (
                  <text
                    className="pin-label"
                    style={{ fontSize: 13 / cam.k, strokeWidth: 3 / cam.k }}
                    y={labelled.get(p.place.name) === 'below' ? (heraldry ? r * 1.32 + 14 / cam.k : r) + 15 / cam.k : -(heraldry ? r * 1.35 : r) - 5 / cam.k}
                  >
                    {p.place.name}
                  </text>
                )}
                <title>{`${p.place.name}: ${p.n}`}</title>
                </g>
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

// ---------- the chronicle feed ----------

/** "Ulric Valcourt is born in Castel Sainte-Ode", in the voice of a chronicle. */
function sentence(e: Event, f: ReturnType<typeof useFamily>) {
  const [a, b] = e.people.map((id) => f.byId.get(id));
  const name = (p?: GPerson) => <b>{p ? displayName(p, f) : 'Someone'}</b>;
  if (e.kind === 'births') return <>{name(a)} is born <i>in {e.place}</i></>;
  if (e.kind === 'deaths') {
    const age = a && !isNaN(yearOf(a.born)) ? e.year - yearOf(a.born) : undefined;
    return <>{name(a)} dies <i>in {e.place}{age !== undefined ? `, aged ${age}` : ''}</i></>;
  }
  return <>{name(a)} marries {name(b)} <i>in {e.place}</i></>;
}

/** The portrait of who it is about, or their house's arms when the map shows arms. */
function FeedFace({ e, f, tree, heraldry }: { e: Event; f: ReturnType<typeof useFamily>; tree: string; heraldry: boolean }) {
  const p = f.byId.get(e.people[0]);
  const house = p?.house ? f.house.get(p.house) : undefined;
  return (
    <span className="feed-face">
      {heraldry ? <Arms arms={house?.arms ?? PLAIN} size={26} title={house?.name ?? 'No house'} /> : p ? <Portrait person={p} tree={tree} size={32} frame={false} /> : null}
      <span className={`feed-kind k-${e.kind}`}><GameIcon name={ICON[e.kind]} size={11} /></span>
    </span>
  );
}

/** "37 births, 9 deaths and 2 weddings across the realm", for a busy year. */
function summary(events: Event[], f: ReturnType<typeof useFamily>) {
  const n = (k: Kind) => events.filter((e) => e.kind === k).length;
  const parts = ([['births', 'birth'], ['deaths', 'death'], ['weddings', 'wedding']] as const)
    .filter(([k]) => n(k))
    .map(([k, one]) => `${n(k)} ${n(k) === 1 ? one : k}`);
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
  const where = f.graph.tree.theme === 'codex' ? 'across the realm' : 'in the family';
  return <><b>{text}</b> <i>{where}, most in {busiest(events)}</i></>;
}

function busiest(events: Event[]): string {
  const c = new Map<string, number>();
  for (const e of events) c.set(e.place, (c.get(e.place) ?? 0) + 1);
  return [...c].sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * The chronicle: every event up to the current year, newest first, scrollable. While someone reads
 * further down, new entries arriving at the top do not move what they are reading; "Latest" returns.
 */
function Chronicle({ rows, more, onMore, cursor, playing, f, tree, heraldry, onSelect, onClose }: {
  rows: FeedRow[]; more: boolean; onMore: () => void; cursor: number; playing: boolean;
  f: ReturnType<typeof useFamily>; tree: string; heraldry: boolean; onSelect: (place: string) => void; onClose: () => void;
}) {
  const box = useRef<HTMLOListElement>(null);
  const anchor = useRef<{ key: string; offset: number } | null>(null);
  const [away, setAway] = useState(false);
  const keyOf = (r: FeedRow) => (r.event ? `${r.event.kind}:${r.year}:${r.event.people.join('+')}` : `sum:${r.year}`);

  const remember = () => {
    const el = box.current;
    if (!el) return;
    const isAway = el.scrollTop > 8;
    setAway(isAway);
    if (!isAway) return (anchor.current = null);
    const first = [...el.querySelectorAll<HTMLElement>('li[data-key]')].find((li) => li.offsetTop + li.offsetHeight > el.scrollTop);
    anchor.current = first ? { key: first.dataset.key!, offset: first.offsetTop - el.scrollTop } : null;
  };
  // Keep the reader's place: after new rows arrive, scroll so the remembered row sits where it was.
  useLayoutEffect(() => {
    const el = box.current, a = anchor.current;
    if (!el || !a) return;
    const li = el.querySelector<HTMLElement>(`li[data-key="${CSS.escape(a.key)}"]`);
    if (li) el.scrollTop = li.offsetTop - a.offset;
  }, [rows]);

  return (
    <section className={`atlas-feed panel${playing ? ' playing' : ''}`} aria-live={playing ? 'off' : 'polite'}>
      <header>
        <b>Chronicle</b>
        {away ? (
          <button className="btn feed-latest" onClick={() => { box.current?.scrollTo({ top: 0, behavior: 'smooth' }); anchor.current = null; setAway(false); }}>
            ↑ Latest
          </button>
        ) : (
          <span className="faint">{cursor}</span>
        )}
        <button className="btn icon ghost" onClick={onClose} title="Close the chronicle"><X size={14} /></button>
      </header>
      <ol ref={box} onScroll={remember}>
        {rows.map((row) => (
          <li key={keyOf(row)} data-key={keyOf(row)}>
            {row.event ? (
              <button onClick={() => onSelect(row.event!.place)}>
                <span className="feed-year">{row.year}</span>
                <FeedFace e={row.event} f={f} tree={tree} heraldry={heraldry} />
                <span className="feed-text">{sentence(row.event, f)}</span>
              </button>
            ) : (
              <button onClick={() => onSelect(busiest(row.summary!))}>
                <span className="feed-year">{row.year}</span>
                <span className="feed-face feed-sum"><GameIcon name="quill-ink" size={18} /></span>
                <span className="feed-text">{summary(row.summary!, f)}</span>
              </button>
            )}
          </li>
        ))}
        {more && <li className="feed-more-row"><button className="btn feed-more" onClick={onMore}>Show earlier</button></li>}
      </ol>
    </section>
  );
}
