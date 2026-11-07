// The Atlas: where the family was born, died and married, on a world map drawn locally (d3-geo +
// world-atlas, no tile server). A time slider replays the family spreading out; arcs show moves
// from a mother's birthplace to her child's.
//
// Layout: the map always fills the page. The place list (left, or a bottom sheet on narrow screens),
// the time bar and the chronicle (right column, or a bottom sheet) sit over it, and the map is told
// which rectangle they leave free: fitting, centring and labels all live inside that rectangle, and
// the camera glides when it changes.
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { geoGraticule10, geoNaturalEarth1, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import {
  ArrowLeft, ChevronDown, ChevronUp, Gauge, Layers, List, Map as MapIcon, Pause, Play, Route as RouteIcon, ScrollText, Shield, X,
} from 'lucide-react';
import { PageHeader, Range, usePageHotkey } from '~/components/ui';
import { setPref, usePref } from '~/lib/prefs';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
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
/** The part of the map no panel covers, as insets from each edge of the atlas, in pixels. */
interface Free { l: number; t: number; r: number; b: number }
interface Arc { from: Place; to: Place; n: number }

const KINDS: Kind[] = ['births', 'deaths', 'weddings'];
const ICON: Record<Kind, 'cake-slice' | 'candle-light' | 'linked-rings'> = { births: 'cake-slice', deaths: 'candle-light', weddings: 'linked-rings' };
const KIND_ONE: Record<Kind, [string, string]> = { births: ['birth', 'births'], deaths: ['death', 'deaths'], weddings: ['wedding', 'weddings'] };
const MODES: { id: Mode; label: string; icon?: 'cake-slice' | 'candle-light' | 'linked-rings' }[] = [
  { id: 'all', label: 'All' },
  { id: 'births', label: 'Births', icon: 'cake-slice' },
  { id: 'deaths', label: 'Deaths', icon: 'candle-light' },
  { id: 'weddings', label: 'Weddings', icon: 'linked-rings' },
];
const SPEEDS = [0.5, 1, 2, 4];
const speedLabel = (s: number) => (s === 0.5 ? '½×' : `${s}×`);

// ---------- small browser hooks ----------

const NARROW = '(max-width: 900px)';
function useMedia(query: string) {
  return useSyncExternalStore(
    (l) => { const m = window.matchMedia(query); m.addEventListener('change', l); return () => m.removeEventListener('change', l); },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The theme on <html>, kept live: label widths depend on its display font. */
function useThemeAttr() {
  return useSyncExternalStore(
    (l) => { const o = new MutationObserver(l); o.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); return () => o.disconnect(); },
    () => document.documentElement.dataset.theme ?? 'codex',
    () => 'codex',
  );
}

/** Round, labelled years for the slider: centuries for a long chronicle, decades for a short one. */
function eraTicks(y0: number, y1: number) {
  const span = y1 - y0;
  if (span <= 0) return [];
  const step = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((s) => span / s <= 4) ?? 1000;
  const out: { value: number; label: string }[] = [];
  for (let v = Math.ceil(y0 / step) * step; v <= y1; v += step) {
    // Ticks hard against either end would print their label half outside the bar.
    if ((v - y0) / span > 0.05 && (y1 - v) / span > 0.05) out.push({ value: v, label: String(v) });
  }
  return out;
}

function Atlas() {
  const f = useFamily();
  const tree = useTreeId();
  const navigate = useNavigate({ from: '/$tree/atlas' });
  const search = Route.useSearch();
  const mode: Mode = search.mode ?? 'births';
  const placeBy = useMemo(() => new Map(f.graph.places.map((p) => [p.name, p])), [f]);
  const narrow = useMedia(NARROW);

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
  const speed = SPEEDS.includes(Number(speedPref)) ? Number(speedPref) : 1;
  const [feedOpen, setFeedOpen] = useState(false);
  // On a narrow screen the chronicle and the place list are bottom sheets that fold to their header.
  const [feedFolded, setFeedFolded] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  // After a replay reaches the end, the chronicle bows out a few seconds later, unless the reader
  // scrubs or opens it themselves meanwhile. (Its own effect: the replay's cleanup must not cancel it.)
  const finished = useRef(false);
  useEffect(() => {
    if (playing || !finished.current || year !== y1 || feedOpen) return;
    const t = window.setTimeout(() => { finished.current = false; setYear((y) => (y === y1 ? null : y)); }, 4000);
    return () => clearTimeout(t);
  }, [playing, year, y1, feedOpen]);
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

  // Moves: from the mother's (else father's) birthplace to the child's, one arc per pair of places.
  const arcs = useMemo(() => {
    if ((mode !== 'births' && mode !== 'all') || !moves) return [];
    const m = new Map<string, Arc>();
    for (const p of f.graph.people) {
      if (!p.bornPlace || yearOf(p.born) > cursor) continue;
      // The mother's birthplace when known, else the father's; no move when the child was born there too.
      const ps = parents(f, p.id).map((id) => f.byId.get(id)!).filter((q) => q?.bornPlace);
      const from = (ps.find((q) => q.sex === 'f') ?? ps[0])?.bornPlace;
      if (!from || from === p.bornPlace || !placeBy.has(from) || !placeBy.has(p.bornPlace)) continue;
      // Either direction is the same road: one arc, drawn the same way whichever came first.
      const [a, b] = from < p.bornPlace ? [from, p.bornPlace] : [p.bornPlace, from];
      const k = `${a}↔${b}`;
      const arc = m.get(k) ?? m.set(k, { from: placeBy.get(a)!, to: placeBy.get(b)!, n: 0 }).get(k)!;
      arc.n++;
    }
    // With many roads, only the busiest: a web of one-off arcs says nothing.
    return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 40);
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
  const showFeed = (feedOpen || playing || year !== null) && feed.rows.length > 0;
  // A chronicle opened by a new replay starts unfolded.
  useEffect(() => { if (showFeed) setFeedFolded(false); }, [showFeed]);

  const togglePlay = () => {
    if (!events.length) return;
    if (cursor >= y1 && !playing) setYear(y0);
    setPlaying((p) => !p);
  };
  const scrub = (v: number) => { setPlaying(false); finished.current = false; setYear(v >= y1 ? null : v); };
  const closeFeed = () => { setPlaying(false); setYear(null); setFeedOpen(false); };

  // Keys: space plays and pauses, arrows step to the previous or next year with an event.
  const stepTo = (dir: -1 | 1) => {
    setPlaying(false);
    finished.current = false;
    if (!events.length) return;
    const target = dir > 0 ? events.find((e) => e.year > cursor)?.year : [...events].reverse().find((e) => e.year < cursor)?.year;
    if (target !== undefined) setYear(target >= y1 ? y1 : target);
  };
  usePageHotkey('Space', togglePlay);
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

  const selected = search.place ? pins.find((p) => p.place.name === search.place) : undefined;
  const total = mode === 'weddings' ? new Set(pins.flatMap((p) => p.people)).size : pins.reduce((n, p) => n + p.n, 0);
  const select = (name?: string) => {
    if (name) play('tick');
    navigate({ search: (s) => ({ ...s, place: name }), replace: true });
  };

  // What the panels leave free of the map, measured from their real boxes. Offsets, not client
  // rects: the panels' entrance animations use transforms, which must not move the map.
  const atlasEl = useRef<HTMLDivElement>(null);
  const sideEl = useRef<HTMLElement>(null);
  const timeBar = useRef<HTMLDivElement>(null);
  const feedEl = useRef<HTMLElement>(null);
  const [free, setFree] = useState<Free>({ l: 340, t: 0, r: 0, b: 100 });
  const measure = useCallback(() => {
    const a = atlasEl.current;
    if (!a) return;
    const W = a.clientWidth, H = a.clientHeight;
    const shown = (e: HTMLElement | null): e is HTMLElement => !!e && e.offsetParent !== null;
    const side = sideEl.current, bar = timeBar.current, feed = feedEl.current;
    let next: Free;
    if (window.matchMedia(NARROW).matches) {
      // Bottom sheets: the time bar rides on whichever sheet is showing; the map is what is above it.
      const sheet = shown(feed) ? feed : shown(side) ? side : null;
      a.style.setProperty('--sheet-h', `${sheet ? sheet.offsetHeight : 0}px`);
      const top = shown(bar) ? bar.offsetTop : sheet ? sheet.offsetTop : H;
      next = { l: 0, t: 0, r: 0, b: Math.max(0, H - top) };
    } else {
      a.style.removeProperty('--sheet-h');
      next = {
        l: shown(side) ? side.offsetLeft + side.offsetWidth : 0,
        t: 0,
        r: shown(feed) ? Math.max(0, W - feed.offsetLeft) : 0,
        b: shown(bar) ? Math.max(0, H - bar.offsetTop) : 0,
      };
    }
    setFree((p) => (p.l === next.l && p.t === next.t && p.r === next.r && p.b === next.b ? p : next));
  }, []);
  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    for (const el of [atlasEl.current, sideEl.current, timeBar.current, feedEl.current]) if (el) ro.observe(el);
    return () => ro.disconnect();
  }, [measure, showFeed, feedFolded, listOpen, narrow, events.length > 0, !!selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const ticks = useMemo(() => eraTicks(y0, y1), [y0, y1]);
  const countText = `${total.toLocaleString('en-GB')} ${mode === 'all' ? 'births, deaths and weddings' : mode === 'weddings' ? 'people married' : mode === 'births' ? 'born' : 'died'} in ${pins.length} ${pins.length === 1 ? 'place' : 'places'}${cursor < y1 ? ` by ${cursor}` : ''}`;

  return (
    <div className={`atlas${showFeed ? ' feed-on' : ''}${listOpen ? ' list-open' : ''}${feedFolded ? ' feed-folded' : ''}`} ref={atlasEl}>
      <aside className="atlas-side panel" ref={sideEl} aria-label="Places">
        {/* On a narrow screen: the sheet's handle, folding the list away to show the map. */}
        <button className="atlas-handle" aria-expanded={listOpen} onClick={() => setListOpen((o) => !o)}>
          <span className="atlas-grip" aria-hidden />
          <span className="atlas-handle-text">
            <b className="display">Atlas</b>
            <span className="subtle">{pins.length} {pins.length === 1 ? 'place' : 'places'}{cursor < y1 ? ` by ${cursor}` : ''}</span>
          </span>
          <span className="atlas-handle-act">
            {listOpen ? <><MapIcon size={16} aria-hidden /> Show map</> : <><List size={16} aria-hidden /> Show list</>}
          </span>
        </button>
        <div className="atlas-head">
          <PageHeader title="Atlas" subtitle={<>{countText}{unplaced > 0 && <span className="subtle"> · {unplaced.toLocaleString('en-GB')} without a known place</span>}</>} />
        </div>
        <div className="atlas-seg" role="group" aria-label="Events shown">
          {MODES.map((m) => (
            <button key={m.id} className="atlas-seg-btn" aria-pressed={mode === m.id} onClick={() => navigate({ search: { mode: m.id }, replace: true })}>
              {m.icon ? <GameIcon name={m.icon} size={15} /> : <Layers size={15} aria-hidden />} <span>{m.label}</span>
            </button>
          ))}
        </div>
        <div className="atlas-side-body">
          {selected ? (
            <PlaceDetail pin={selected} f={f} tree={tree} mode={mode} onBack={() => select(undefined)} />
          ) : pins.length === 0 ? (
            <p className="atlas-empty muted">{events.length === 0 ? 'No places recorded for this tree yet.' : `Nothing recorded by ${cursor}.`}</p>
          ) : (
            <ol className="atlas-places">
              {pins.map((p, i) => (
                <li key={p.place.name}>
                  <button onClick={() => select(p.place.name)}>
                    <span className="atlas-rank subtle">{i + 1}</span>
                    <span className="atlas-place-name">
                      <span className="atlas-place-text">{p.place.name}</span>
                      {mode === 'all' && (
                        <small className="atlas-kinds">
                          {KINDS.filter((k) => p.kinds[k]).map((k) => (
                            <span key={k} className={`k-${k}`} title={`${p.kinds[k]} ${KIND_ONE[k][p.kinds[k] === 1 ? 0 : 1]}`}>
                              <GameIcon name={ICON[k]} size={11} />{p.kinds[k]}
                            </span>
                          ))}
                        </small>
                      )}
                    </span>
                    <span className="atlas-bar" aria-hidden><i style={{ width: `${(p.n / (pins[0]?.n || 1)) * 100}%` }} /></span>
                    <b>{p.n}</b>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      </aside>

      <div className="atlas-map">
        <WorldMap
          places={f.graph.places}
          pins={pins}
          arcs={arcs}
          selected={search.place}
          onSelect={select}
          rings={mode === 'all' && !heraldry}
          heraldry={heraldry ? f.house : null}
          recent={recent}
          playing={playing}
          free={free}
          mode={mode}
        />
      </div>

      {events.length > 0 && (
        <div className="atlas-time panel" ref={timeBar} role="group" aria-label="Time">
          <button className="btn primary atlas-play" onClick={togglePlay} aria-label={playing ? 'Pause the replay' : 'Replay through time'} title={playing ? 'Pause (Space)' : 'Replay through time (Space)'}>
            {playing ? <Pause size={18} fill="currentColor" strokeWidth={1.5} aria-hidden /> : <Play size={18} fill="currentColor" strokeWidth={1.5} aria-hidden />}
          </button>
          <span className="atlas-year display" aria-hidden>{cursor}</span>
          <Range className="atlas-range" value={cursor} onChange={scrub} min={y0} max={y1} ticks={ticks} aria-label="Year" format={(v) => String(v)} />
          <div className="atlas-tools">
            <button
              className="btn atlas-tool"
              onClick={() => setPref('atlas-speed', String(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]))}
              aria-label={`Replay speed ${speedLabel(speed)}. Change speed`}
              title="Replay speed (click to change)"
            >
              <Gauge size={16} aria-hidden /> <span className="atlas-speed">{speedLabel(speed)}</span>
            </button>
            <button className="btn atlas-tool" aria-pressed={showFeed} onClick={() => (showFeed ? closeFeed() : setFeedOpen(true))} aria-label="Chronicle" title="The chronicle of everything up to this year">
              <ScrollText size={16} aria-hidden /> <span className="tb-label">Chronicle</span>
            </button>
            <button className="btn atlas-tool" aria-pressed={heraldry} onClick={() => { if (!heraldry) play('seal'); setHeraldry((h) => !h); }} aria-label="Arms" title="Show each place by the arms of the house most of its people belong to">
              <Shield size={16} aria-hidden /> <span className="tb-label">Arms</span>
            </button>
            {(mode === 'births' || mode === 'all') && (
              <button className="btn atlas-tool" aria-pressed={moves} onClick={() => setMoves((m) => !m)} aria-label="Moves" title="Show moves from a mother's birthplace to her child's">
                <RouteIcon size={16} aria-hidden /> <span className="tb-label">Moves</span>
              </button>
            )}
          </div>
        </div>
      )}

      {showFeed && (
        <Chronicle
          ref={feedEl}
          rows={feed.rows}
          more={feed.more}
          onMore={() => setFeedLimit((l) => l + 300)}
          cursor={cursor}
          playing={playing}
          f={f}
          tree={tree}
          heraldry={heraldry}
          onSelect={select}
          onClose={closeFeed}
          folded={feedFolded}
          onFold={() => setFeedFolded((x) => !x)}
        />
      )}
    </div>
  );
}

function PlaceDetail({ pin, f, tree, mode, onBack }: { pin: Pin; f: ReturnType<typeof useFamily>; tree: string; mode: Mode; onBack: () => void }) {
  const WHAT: Record<Kind, string> = { births: 'Born here', deaths: 'Died here', weddings: 'Married here' };
  const groups = KINDS.filter((k) => mode === 'all' || mode === k)
    .map((k) => [k, [...new Set(pin.entries.filter((e) => e.kind === k).map((e) => e.id))].map((id) => f.byId.get(id)).filter((p): p is GPerson => !!p)] as const)
    .filter(([, ps]) => ps.length);
  const house = pin.house ? f.house.get(pin.house) : undefined;
  return (
    <div className="atlas-detail">
      <button className="btn ghost atlas-back" onClick={onBack}><ArrowLeft size={16} aria-hidden /> All places</button>
      <div className="ui-card atlas-place-card">
        {house ? (
          <Link className="atlas-place-mark" to="/$tree/house/$house" params={{ tree, house: house.id }} title={`Open the page of ${house.name}`} aria-label={`Open the page of ${house.name}`}>
            <Arms arms={house.arms} size={34} />
          </Link>
        ) : (
          <span className="atlas-place-mark" aria-hidden><PlaceToken size={38} /></span>
        )}
        <div>
          <h2 className="display">{pin.place.name}</h2>
          <p className="muted">First recorded in {pin.first}{house ? <> · mostly <Link className="atlas-house" to="/$tree/house/$house" params={{ tree, house: house.id }}>{house.name}</Link></> : null}</p>
          <p className="atlas-place-kinds">
            {KINDS.filter((k) => pin.kinds[k]).map((k) => (
              <span key={k} className={`k-${k}`}><GameIcon name={ICON[k]} size={13} /> {pin.kinds[k]} {KIND_ONE[k][pin.kinds[k] === 1 ? 0 : 1]}</span>
            ))}
          </p>
        </div>
      </div>
      {groups.map(([k, people]) => (
        <section key={k}>
          <h3 className={`rule k-${k}`}><GameIcon name={ICON[k]} size={14} /> {WHAT[k]} <span className="subtle">{people.length}</span></h3>
          <ul>
            {people.map((p) => (
              <li key={p.id}>
                <Link to="/$tree" params={{ tree }} search={{ focus: p.id }}>
                  <Portrait person={p} tree={tree} size={40} />
                  <span>
                    <b className="atlas-name">{displayName(p, f)}</b>
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

/** A place with no ruling house: a tower on a roundel, in the map's own colours. */
function PlaceToken({ size }: { size: number }) {
  return (
    <svg className="place-token" width={size} height={size} viewBox="-20 -20 40 40" aria-hidden>
      <TokenBody r={18} />
    </svg>
  );
}
function TokenBody({ r, stroke = 1.5 }: { r: number; stroke?: number }) {
  return (
    <g className="token">
      <circle r={r} className="token-disc" style={{ strokeWidth: stroke }} />
      <circle r={r * 0.82} className="token-inner" style={{ strokeWidth: stroke * 0.5 }} />
      <g transform={`translate(${-r * 0.6},${-r * 0.62})`} className="token-ink">
        <GameIcon name="tower-flag" size={r * 1.2} />
      </g>
    </g>
  );
}

// ---------- the map ----------

type World = { land: GeoPermissibleObjects; borders: GeoPermissibleObjects };
let worldCache: Promise<World> | null = null;
const loadWorld = () =>
  (worldCache ??= import('world-atlas/countries-110m.json').then((m) => {
    const topo = (m as { default?: unknown }).default ?? m;
    const t = topo as Parameters<typeof feature>[0] & { objects: { countries: Parameters<typeof feature>[1]; land?: unknown } };
    return { land: feature(t, t.objects.countries) as GeoPermissibleObjects, borders: mesh(t, t.objects.countries as never, (a, b) => a !== b) as GeoPermissibleObjects };
  }));

type Cam = { x: number; y: number; k: number };
type Box = [number, number, number, number];
type Label = { dx: number; dy: number; anchor: 'middle' | 'start' | 'end' };
const LABEL_PX = 13;

// Label widths from the real display font, cached per font and name.
let measureCtx: CanvasRenderingContext2D | null | undefined;
const widthCache = new Map<string, number>();
function textWidth(text: string, font: string) {
  if (typeof document === 'undefined') return text.length * 7.6;
  const key = `${font}|${text}`;
  let w = widthCache.get(key);
  if (w === undefined) {
    measureCtx ??= document.createElement('canvas').getContext('2d');
    if (!measureCtx) return text.length * 7.6;
    measureCtx.font = font;
    w = measureCtx.measureText(text).width;
    widthCache.set(key, w);
  }
  return w;
}

/** The projection works in a fixed 1000-unit frame; the camera maps it onto the screen. */
const FRAME = 1000;

function WorldMap({ places, pins, arcs, selected, onSelect, rings, heraldry, recent, playing, free, mode }: {
  recent: ReadonlySet<string>;
  places: Place[];
  pins: Pin[];
  rings: boolean;
  /** When set, pins are drawn as the arms of each place's main house. */
  heraldry: Map<string, House> | null;
  arcs: Arc[];
  selected?: string;
  onSelect: (name?: string) => void;
  playing: boolean;
  free: Free;
  mode: Mode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1100, h: 800, measured: false });
  const [world, setWorld] = useState<World | null>(null);
  const theme = useThemeAttr();
  const [fontsReady, setFontsReady] = useState(0);
  useEffect(() => { loadWorld().then(setWorld); }, []);
  useEffect(() => { document.fonts?.ready.then(() => { widthCache.clear(); setFontsReady((n) => n + 1); }); }, [theme]);
  useLayoutEffect(() => {
    const el = host.current!;
    const read = () => setSize((s) => (s.measured && s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight, measured: true }));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The projection, fitted to the family's places in a fixed frame (screen fitting is the camera's job).
  const { projection, bounds } = useMemo(() => {
    const p = geoNaturalEarth1();
    const pts = places.map((pl) => [pl.lng, pl.lat]);
    if (!pts.length) {
      p.fitSize([FRAME, FRAME / 2], { type: 'Sphere' });
      return { projection: p, bounds: geoPath(p).bounds({ type: 'Sphere' }) };
    }
    // Every place, each with a little neighbourhood (clamped to the globe) so a tight cluster is not over-zoomed.
    const clampLng = (x: number) => Math.max(-179.9, Math.min(179.9, x));
    const clampLat = (y: number) => Math.max(-85, Math.min(85, y));
    const around = pts.flatMap(([x, y]) => [[clampLng(x - 2.5), clampLat(y - 2)], [clampLng(x + 2.5), clampLat(y + 2)]]);
    const shape = { type: 'MultiPoint' as const, coordinates: around };
    p.fitExtent([[0, 0], [FRAME, FRAME]], shape);
    return { projection: p, bounds: geoPath(p).bounds(shape) };
  }, [places]);
  const path = useMemo(() => geoPath(projection), [projection]);
  const paths = useMemo(
    () => (world ? { land: path(world.land) ?? '', borders: path(world.borders) ?? '', grid: path(geoGraticule10()) ?? '', sphere: path({ type: 'Sphere' }) ?? '' } : null),
    [world, path],
  );

  // The camera that fits every place into the free rectangle, with room for pins and their labels.
  const fit = useCallback((sz: { w: number; h: number }, fr: Free): Cam => {
    const fw = Math.max(80, sz.w - fr.l - fr.r), fh = Math.max(80, sz.h - fr.t - fr.b);
    const [[x0, y0], [x1, y1]] = bounds;
    const padX = Math.min(70, fw * 0.12), padTop = Math.min(56, fh * 0.14), padBottom = Math.min(30, fh * 0.08);
    const k = Math.max(0.05, Math.min((fw - padX * 2) / Math.max(1, x1 - x0), (fh - padTop - padBottom) / Math.max(1, y1 - y0)));
    return { k, x: fr.l + fw / 2 - ((x0 + x1) / 2) * k, y: fr.t + padTop + (fh - padTop - padBottom) / 2 - ((y0 + y1) / 2) * k };
  }, [bounds]);

  const [cam, setCamState] = useState<Cam>(() => fit({ w: 1100, h: 800 }, free));
  const camRef = useRef(cam);
  const goal = useRef<Cam | null>(null);
  const anim = useRef(0);
  const touched = useRef(false);
  const kFit = useRef(cam.k);
  const setCam = (c: Cam) => { camRef.current = c; setCamState(c); };
  const stop = () => { cancelAnimationFrame(anim.current); goal.current = null; };
  /** Move the camera smoothly (or at once, for reduced motion). */
  const glide = (to: Cam, ms = 520) => {
    cancelAnimationFrame(anim.current);
    goal.current = to;
    if (reducedMotion()) { setCam(to); goal.current = null; return; }
    const from = camRef.current, t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      setCam({ k: from.k * Math.pow(to.k / from.k, e), x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e });
      if (p < 1) anim.current = requestAnimationFrame(step);
      else goal.current = null;
    };
    anim.current = requestAnimationFrame(step);
  };
  useEffect(() => () => cancelAnimationFrame(anim.current), []);

  // When the window or the free rectangle changes: an untouched map refits; a map the reader has
  // panned or zoomed keeps showing the same things, moved (and scaled) into the new free area.
  const prev = useRef<{ size: typeof size; free: Free; projection: typeof projection } | null>(null);
  useLayoutEffect(() => {
    const was = prev.current;
    prev.current = { size, free, projection };
    if (!size.measured) return;
    const target = fit(size, free);
    kFit.current = target.k;
    if (!was || !was.size.measured || was.projection !== projection) {
      touched.current = false;
      stop();
      setCam(target);
      return;
    }
    const resized = was.size.w !== size.w || was.size.h !== size.h;
    if (!touched.current) return resized ? (stop(), setCam(target)) : glide(target);
    const c = goal.current ?? camRef.current;
    const ow = was.size.w - was.free.l - was.free.r, oh = was.size.h - was.free.t - was.free.b;
    const nw = size.w - free.l - free.r, nh = size.h - free.t - free.b;
    const rw = nw / Math.max(1, ow), rh = nh / Math.max(1, oh);
    // Growing on both sides zooms in by the larger gain; any shrink zooms out by the larger loss.
    const s = resized ? 1 : rw >= 1 && rh >= 1 ? Math.max(rw, rh) : Math.min(rw, rh);
    const wx = (was.free.l + ow / 2 - c.x) / c.k, wy = (was.free.t + oh / 2 - c.y) / c.k;
    const k = c.k * s;
    const to = { k, x: free.l + nw / 2 - wx * k, y: free.t + nh / 2 - wy * k };
    if (resized) { stop(); setCam(to); } else glide(to);
  }, [size, free, projection]); // eslint-disable-line react-hooks/exhaustive-deps

  // Choosing a place brings it to the middle of the free map area, close enough to read its neighbours.
  // Only on a new choice: a resize keeps whatever panning happened since.
  const centred = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (centred.current === selected) return;
    centred.current = selected;
    const pin = selected && places.find((p) => p.name === selected);
    const xy = pin && projection([pin.lng, pin.lat]);
    if (!xy) return;
    touched.current = true;
    const c = goal.current ?? camRef.current;
    const k = Math.max(c.k, kFit.current * 2.5);
    const fw = size.w - free.l - free.r, fh = size.h - free.t - free.b;
    glide({ k, x: free.l + fw / 2 - xy[0] * k, y: free.t + fh / 2 - xy[1] * k });
  }, [selected, projection]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pan and zoom.
  const drag = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(0);
  const zoomBy = (factor: number, sx: number, sy: number) => {
    stop();
    touched.current = true;
    const c = camRef.current;
    const k = Math.min(kFit.current * 14, Math.max(kFit.current * 0.5, c.k * factor));
    const f = k / c.k;
    setCam({ k, x: sx - (sx - c.x) * f, y: sy - (sy - c.y) * f });
  };
  useEffect(() => {
    const el = host.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Two fingers pinch.
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);

  const max = Math.max(1, ...pins.map((p) => p.n));
  const screenR = (n: number) => 5 + Math.sqrt(n / max) * 18;

  // Labels: a collision pass in screen space. Every pin's body (dot and ring, or shield and its
  // count) is an obstacle. Busiest place first (the selected one before all), each label tries
  // above, below, right, then left of its pin, and must stay inside the free part of the map.
  const labelled = useMemo(() => {
    // Measured text: only after mounting, so the server and the hydrating client draw the same (no labels).
    if (!size.measured) return new Map<string, Label>();
    const hit = (a: Box, b: Box) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
    const inside: Box = [free.l + 6, free.t + 6, size.w - free.r - 6, size.h - free.b - 6];
    const within = (b: Box) => b[0] >= inside[0] && b[1] >= inside[1] && b[2] <= inside[2] && b[3] <= inside[3];
    const fontFamily = typeof document === 'undefined' ? 'serif' : getComputedStyle(document.documentElement).getPropertyValue('--font-display') || 'serif';
    const font = `600 ${LABEL_PX}px ${fontFamily}`;
    type Item = { name: string; body: Box | null; x: number; y: number; r: number };
    const items = pins.flatMap((p): Item[] => {
      const xy = projection([p.place.lng, p.place.lat]);
      if (!xy) return [];
      const x = xy[0] * cam.k + cam.x, y = xy[1] * cam.k + cam.y;
      const r = screenR(p.n);
      if (x < inside[0] || x > inside[2] || y < inside[1] || y > inside[3]) return [{ name: p.place.name, body: null, x, y, r }];
      const ring = rings ? 5 : 1.5;
      const token = heraldry && !(p.house && heraldry.get(p.house));
      let body: Box;
      if (!heraldry || token) body = [x - r - ring, y - r - ring, x + r + ring, y + r + ring];
      else {
        // The shield, and its count underneath when one is drawn.
        const foot = y + r * 1.32 + (p.n > 1 && r > 11 ? 14 : 0);
        body = [x - r * 1.1, y - r * 1.32, x + r * 1.1, foot];
      }
      if (token && p.n > 1 && r > 11) body[3] += 14;
      return [{ name: p.place.name, body, x, y, r }];
    });
    const bodies = items.flatMap((q) => (q.body ? [{ box: q.body, small: q.r < 10 }] : []));
    const labels: Box[] = [];
    const out = new Map<string, Label>();
    const order = [...items].sort((a, b) => (a.name === selected ? -1 : b.name === selected ? 1 : 0));
    order.forEach((q, rank) => {
      if (!q.body) return;
      const body = q.body;
      const w = textWidth(q.name, font) + 4, h = LABEL_PX + 4;
      // Baseline offsets: a 13px label's box runs from 12px above its baseline to 4px below.
      const cands: { box: Box; label: Label }[] = [
        { box: [q.x - w / 2, body[1] - 3 - h, q.x + w / 2, body[1] - 3], label: { dx: 0, dy: body[1] - 3 - 4 - q.y, anchor: 'middle' } },
        { box: [q.x - w / 2, body[3] + 2, q.x + w / 2, body[3] + 2 + h], label: { dx: 0, dy: body[3] + 2 + 12 - q.y, anchor: 'middle' } },
        { box: [body[2] + 4, q.y - h / 2, body[2] + 4 + w, q.y + h / 2], label: { dx: body[2] + 6 - q.x, dy: 4.5, anchor: 'start' } },
        { box: [body[0] - 4 - w, q.y - h / 2, body[0] - 4, q.y + h / 2], label: { dx: body[0] - 6 - q.x, dy: 4.5, anchor: 'end' } },
      ];
      const freeOf = (b: Box, strict: boolean) =>
        within(b) && !labels.some((o) => hit(b, o)) && !bodies.some((o) => hit(b, o.box) && (strict || o.box === body || !o.small));
      // The selected and the three busiest places may cover a small pin when nothing else is free.
      const vip = q.name === selected || rank < 3;
      const spot = cands.find((c) => freeOf(c.box, true)) ?? (vip ? cands.find((c) => freeOf(c.box, false)) : undefined);
      if (!spot) return;
      labels.push(spot.box);
      out.set(q.name, spot.label);
    });
    return out;
  }, [pins, projection, cam, max, selected, heraldry, rings, free, size, theme, fontsReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const kindWord = mode === 'all' ? 'events' : mode === 'births' ? 'born' : mode === 'deaths' ? 'died' : 'married';
  const arcMax = Math.max(1, ...arcs.map((a) => a.n));
  // Screen-constant pin sizes: zooming in spreads places apart instead of inflating them.
  const radius = (n: number) => screenR(n) / cam.k;
  return (
    <div
      ref={host}
      className="atlas-canvas"
      onPointerDown={(e) => {
        if ((e.target as Element).closest('.pin')) return;
        touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.current.size === 2) {
          const [a, b] = [...touches.current.values()];
          pinch.current = Math.hypot(a.x - b.x, a.y - b.y);
          drag.current = null;
        } else {
          stop();
          drag.current = { x: e.clientX, y: e.clientY };
          moved.current = 0;
        }
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.current.size === 2 && pinch.current) {
          const [a, b] = [...touches.current.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          const r = host.current!.getBoundingClientRect();
          zoomBy(d / pinch.current, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
          pinch.current = d;
          moved.current = 99;
          return;
        }
        const d = drag.current;
        if (!d) return;
        moved.current += Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y);
        touched.current = true;
        const c = camRef.current;
        setCam({ ...c, x: c.x + e.clientX - d.x, y: c.y + e.clientY - d.y });
        drag.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        touches.current.delete(e.pointerId);
        if (touches.current.size < 2) pinch.current = null;
        if (drag.current && moved.current < 4 && selected) onSelect(undefined);
        drag.current = null;
      }}
      onPointerCancel={(e) => { touches.current.delete(e.pointerId); pinch.current = null; drag.current = null; }}
    >
      <svg width={size.w} height={size.h} role="group" aria-label="Map of places">
        <defs>
          <radialGradient id="sea-glow" cx="50%" cy="45%" r="75%">
            <stop offset="0%" className="sea-hi" />
            <stop offset="100%" className="sea-lo" />
          </radialGradient>
          {/* Night's land: a faint stipple, so the coast reads against the dark sea. */}
          <pattern id="land-stipple" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform={`scale(${1 / cam.k})`}>
            <circle cx="1.5" cy="1.5" r="0.7" className="stipple-dot" />
            <circle cx="4.5" cy="4.5" r="0.55" className="stipple-dot" />
          </pattern>
        </defs>
        <rect width={size.w} height={size.h} fill="url(#sea-glow)" />
        <g transform={`translate(${cam.x},${cam.y}) scale(${cam.k})`}>
          {paths ? (
            <>
              <path d={paths.grid} className="graticule" />
              <path d={paths.land} className="land" />
              <path d={paths.land} className="land-stipple" fill="url(#land-stipple)" />
              <path d={paths.borders} className="borders" />
            </>
          ) : null}
          <g className={`arcs${playing ? ' flowing' : ''}`}>
            {arcs.map((a) => {
              const p0 = projection([a.from.lng, a.from.lat]), p1 = projection([a.to.lng, a.to.lat]);
              if (!p0 || !p1) return null;
              const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
              const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
              const bend = 0.2;
              const w = 1 + 4 * Math.sqrt(a.n / arcMax);
              return (
                <path
                  key={`${a.from.name}↔${a.to.name}`}
                  className="arc"
                  d={`M${p0[0]},${p0[1]}Q${mx - dy * bend},${my + dx * bend} ${p1[0]},${p1[1]}`}
                  style={{ strokeWidth: w / cam.k, strokeDasharray: `${6 / cam.k} ${5 / cam.k}` }}
                >
                  <title>{`${a.from.name} – ${a.to.name}: ${a.n} ${a.n === 1 ? 'move' : 'moves'}`}</title>
                </path>
              );
            })}
          </g>
          {/* Stable order (first appearance): reordering would move DOM nodes and restart their animation. */}
          {[...pins].sort((a, b) => a.first - b.first || a.place.name.localeCompare(b.place.name)).map((p) => {
            const xy = projection([p.place.lng, p.place.lat]);
            if (!xy) return null;
            const r = radius(p.n);
            const on = selected === p.place.name;
            const arms = heraldry && p.house ? heraldry.get(p.house) : undefined;
            const showN = p.n > 1 && r * cam.k > 11;
            return (
              <g
                key={p.place.name}
                className={`pin${on ? ' on' : ''}${recent.has(p.place.name) ? ' recent' : ''}`}
                transform={`translate(${xy[0]},${xy[1]})`}
                role="button"
                tabIndex={0}
                aria-pressed={on}
                aria-label={`${p.place.name}, ${p.n} ${kindWord}${arms ? `, house ${arms.name}` : ''}`}
                onClick={() => onSelect(on ? undefined : p.place.name)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(on ? undefined : p.place.name); } }}
              >
                {recent.has(p.place.name) && <circle r={r} className="pulse" style={{ strokeWidth: 2 / cam.k }} />}
                <g className="pin-grow">
                  {/* A focus ring for keyboard readers. */}
                  <circle r={r + (rings ? 7 : 4) / cam.k} className="pin-focus" style={{ strokeWidth: 2 / cam.k }} />
                  {heraldry ? (
                    arms ? (
                      <g className="pin-arms" transform={`translate(${-r * 1.1},${-r * 1.32})`}>
                        <Arms arms={arms.arms} size={r * 2.2} />
                      </g>
                    ) : (
                      // No ruling house: a neutral place token rather than a blank shield.
                      <g className="pin-token"><TokenBody r={r} stroke={1.5 / cam.k} /></g>
                    )
                  ) : (
                    <circle r={r} className="pin-dot" style={{ strokeWidth: 2 / cam.k }} />
                  )}
                  {rings && <KindRing kinds={p.kinds} r={r + 2.5 / cam.k} w={3.5 / cam.k} />}
                  {showN && (
                    heraldry
                      ? <text className="pin-n under" style={{ fontSize: 11 / cam.k, strokeWidth: 3 / cam.k }} y={(arms ? r * 1.32 : r) + 11 / cam.k}>{p.n}</text>
                      : <text className="pin-n" style={{ fontSize: 11 / cam.k }} dy="0.35em">{p.n}</text>
                  )}
                  <title>{`${p.place.name}: ${p.n}`}</title>
                </g>
              </g>
            );
          })}
          {/* Names above every pin, so no later pin paints over a label. */}
          <g className="pin-labels" aria-hidden>
            {pins.map((p) => {
              const lab = labelled.get(p.place.name);
              const xy = lab && projection([p.place.lng, p.place.lat]);
              if (!lab || !xy) return null;
              return (
                <text
                  key={p.place.name}
                  className={`pin-label${selected === p.place.name ? ' on' : ''}`}
                  textAnchor={lab.anchor}
                  x={xy[0] + lab.dx / cam.k}
                  y={xy[1] + lab.dy / cam.k}
                  style={{ fontSize: LABEL_PX / cam.k, strokeWidth: 3 / cam.k }}
                >
                  {p.place.name}
                </text>
              );
            })}
          </g>
        </g>
      </svg>
      {!paths && <div className="atlas-loading" style={{ left: free.l, right: free.r, bottom: free.b }}>Unrolling the map…</div>}
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
      {heraldry ? (house ? <Arms arms={house.arms} size={26} title={house.name} /> : <PlaceToken size={28} />) : p ? <Portrait person={p} tree={tree} size={32} frame={false} /> : null}
      <span className={`feed-kind k-${e.kind}`}><GameIcon name={ICON[e.kind]} size={11} /></span>
    </span>
  );
}

/** "37 births, 9 deaths and 2 weddings across the realm", for a busy year. */
function summary(events: Event[], f: ReturnType<typeof useFamily>) {
  const n = (k: Kind) => events.filter((e) => e.kind === k).length;
  const parts = KINDS.filter((k) => n(k)).map((k) => `${n(k)} ${KIND_ONE[k][n(k) === 1 ? 0 : 1]}`);
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
 * A right-hand column on wide screens; a bottom sheet that folds to its header on narrow ones.
 */
function Chronicle({ ref, rows, more, onMore, cursor, playing, f, tree, heraldry, onSelect, onClose, folded, onFold }: {
  ref: React.Ref<HTMLElement>;
  rows: FeedRow[]; more: boolean; onMore: () => void; cursor: number; playing: boolean;
  f: ReturnType<typeof useFamily>; tree: string; heraldry: boolean; onSelect: (place: string) => void; onClose: () => void;
  folded: boolean; onFold: () => void;
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
    <section ref={ref} className={`atlas-feed panel${playing ? ' playing' : ''}`} aria-label="Chronicle">
      <header>
        <h2 className="display">Chronicle</h2>
        {away ? (
          <button className="btn feed-latest" onClick={() => { box.current?.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' }); anchor.current = null; setAway(false); }}>
            <ChevronUp size={14} aria-hidden /> Latest
          </button>
        ) : (
          <span className="feed-cursor">{cursor}</span>
        )}
        <button className="btn icon ghost feed-fold" onClick={onFold} aria-expanded={!folded} aria-label={folded ? 'Unfold the chronicle' : 'Fold the chronicle'} title={folded ? 'Unfold' : 'Fold'}>
          {folded ? <ChevronUp size={18} aria-hidden /> : <ChevronDown size={18} aria-hidden />}
        </button>
        <button className="btn icon ghost feed-close" onClick={onClose} aria-label="Close the chronicle" title="Close the chronicle"><X size={18} aria-hidden /></button>
      </header>
      <ol ref={box} onScroll={remember} aria-live={playing ? 'off' : 'polite'}>
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
