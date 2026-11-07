// PlaceInput: a place field that helps. It suggests the family's own places first (with how often they
// are used), then real towns from the offline gazetteer (data/gazetteer.db), and picking one brings
// its coordinates, so the Atlas can draw it. Free text is fine too: a farm, an old parish or an
// invented town can be put on the map by dropping a pin.
//
// Usage:
//   const [born, setBorn] = useState<PlaceValue>(placeValue(person.bornPlace));
//   <div className="field"><span id="bp">Birthplace</span><PlaceInput tree={tree} value={born} onChange={setBorn} aria-labelledby="bp" /></div>
//   // On save, before writing the person:
//   await savePlaces(tree, born);
//
// Keys (WAI-ARIA combobox with a listbox popup): ↓/↑ move through suggestions, ↵ picks the highlighted one
// (with none highlighted, ↵ is left to the form, so it still saves), Escape closes the list, Tab leaves.
import { useDebouncedValue } from '@tanstack/react-pacer';
import { useQuery } from '@tanstack/react-query';
import { geoMercator, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import { Crosshair, MapPin, Minus, Plus, Users } from 'lucide-react';
import {
  useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type KeyboardEvent, type PointerEvent as ReactPointerEvent, type Ref,
} from 'react';
import { feature, mesh } from 'topojson-client';
import { getPlacesIn, graphQuery, placeSearchQuery, searchPlaces, upsertPlaces } from '~/lib/api';
import type { Place } from '~/lib/types';
import { Dialog } from './ui/Dialog';
import { isTopOverlay, useOverlayLayer } from './ui/overlay';
import './placeinput.css';

/** What a place field holds. Coordinates come from a picked town or a dropped pin; a bare name is fine too. */
export interface PlaceValue {
  name: string;
  lat?: number;
  lng?: number;
  /** ISO 3166 alpha-2, lower case. */
  country?: string;
  /** State or province, shown beside the name. */
  region?: string;
  /** The user chose to move the family's existing pin of this name here. */
  move?: boolean;
}
type Hit = Awaited<ReturnType<typeof searchPlaces>>[number];

export const placeValue = (name?: string | null): PlaceValue => ({ name: name ?? '' });

/**
 * Puts the given places on the tree's map: only those with coordinates. An existing pin of the same
 * name stays put unless the user chose to move it. Safe to call again on a retry.
 */
export async function savePlaces(tree: string, ...values: (PlaceValue | undefined)[]) {
  const places = values
    .filter((v): v is PlaceValue & { lat: number; lng: number } => !!v?.name.trim() && v.lat !== undefined && v.lng !== undefined)
    .map((v) => ({ name: v.name.trim(), lat: v.lat, lng: v.lng, country: v.country, move: v.move || undefined }));
  if (places.length) await upsertPlaces({ data: { tree, places } });
}

// ---------- small helpers ----------

/** Same folding as the server: lower case, no accents, punctuation as spaces. */
const fold = (s: string) =>
  s.toLowerCase().replace(/ß/g, 'ss').replace(/ø/g, 'o').replace(/æ/g, 'ae').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export const flagOf = (cc?: string) =>
  cc && /^[a-z]{2}$/i.test(cc) ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '';
let regionNames: Intl.DisplayNames | null | undefined;
export function countryName(cc?: string) {
  if (!cc) return '';
  try {
    regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return regionNames.of(cc.toUpperCase()) ?? cc.toUpperCase();
  } catch {
    return cc.toUpperCase();
  }
}
/** "Baden-Württemberg, Germany"; the region is left out when it only repeats the name (Berlin, Berlin). */
const whereOf = (p: { name: string; region?: string; country?: string }) =>
  [p.region && fold(p.region) !== fold(p.name) ? p.region : '', countryName(p.country)].filter(Boolean).join(', ');
const far = (a: { lat: number; lng: number }, b: { lat?: number; lng?: number }) =>
  b.lat === undefined || b.lng === undefined || Math.abs(a.lat - b.lat) > 0.05 || Math.abs(a.lng - b.lng) > 0.05;

/** Bold the typed part of a name, where it starts a word. */
function Highlight({ text, q }: { text: string; q: string }) {
  const fq = fold(q);
  if (!fq) return <>{text}</>;
  // Fold character by character, so positions in the folded text map back onto the original.
  let at = -1;
  for (let i = 0; i < text.length && at < 0; i++) {
    if (i > 0 && /[\p{L}\p{N}]/u.test(text[i - 1])) continue;
    if (fold(text.slice(i)).startsWith(fq)) at = i;
  }
  if (at < 0) return <>{text}</>;
  let end = at;
  while (end < text.length && fold(text.slice(at, end)).length < fq.length) end++;
  return <>{text.slice(0, at)}<span className="pi-hl">{text.slice(at, end)}</span>{text.slice(end)}</>;
}

// ---------- the field ----------

export interface PlaceInputProps {
  tree: string;
  value: PlaceValue;
  onChange: (value: PlaceValue) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

export function PlaceInput({ tree, value, onChange, id, placeholder = 'Town, village or farm', disabled, inputRef, ...aria }: PlaceInputProps) {
  const base = useId();
  const optId = (i: number) => `${base}-o${i}`;
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [mapOpen, setMapOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);

  const [dq] = useDebouncedValue(value.name, { wait: 150 });
  const { data: graph } = useQuery(graphQuery(tree));
  const known = useMemo(() => new Map((graph?.places ?? []).map((p) => [p.name, p])), [graph]);
  const search = useQuery({ ...placeSearchQuery(tree, dq), enabled: focused || !!value.name.trim() });
  const hits = search.data ?? [];
  const shown = open && focused && hits.length > 0;
  const layer = useOverlayLayer(shown);

  const name = value.name.trim();
  const family = known.get(name);
  const placed = value.lat !== undefined || !!family;
  // A picked town that shares its name with a family pin somewhere else: never move that pin silently.
  const clash = value.lat !== undefined && family && !value.move && far(family, value) ? family : undefined;
  const where = value.lat !== undefined ? whereOf(value) : family ? countryName(family.country) : '';
  const flag = flagOf(value.lat !== undefined ? value.country : family?.country);
  // "Uppsala" typed in full but not picked: offer the town, one click away.
  const suggestion = !placed && name && dq.trim() === name ? hits.find((h) => h.uses === undefined && fold(h.name) === fold(name)) : undefined;

  useEffect(() => setActive(-1), [search.data]);

  const place = useCallback(() => {
    const b = box.current?.getBoundingClientRect();
    if (!b) return;
    const below = innerHeight - b.bottom - 8, above = b.top - 8;
    const want = Math.min(380, innerHeight * 0.55);
    const up = below < Math.min(want, 220) && above > below;
    const maxHeight = Math.max(140, Math.min(want, up ? above - 4 : below - 4));
    const width = Math.min(Math.max(b.width, 300), innerWidth - 16);
    const left = Math.max(8, Math.min(b.left, innerWidth - width - 8));
    const h = Math.min(maxHeight, pop.current?.scrollHeight ?? maxHeight);
    setPos({ top: up ? b.top - 4 - h : b.bottom + 4, left, width, maxHeight });
  }, []);
  // In the top layer, like the Select popover, so a dialog never clips it.
  useLayoutEffect(() => {
    const el = pop.current;
    if (!shown || !el) return;
    try { if (!el.matches(':popover-open')) el.showPopover(); } catch {}
    place();
    return () => { try { el.hidePopover(); } catch {} };
  }, [shown, place]);
  useLayoutEffect(() => { if (shown) place(); }, [shown, hits.length, place]);
  useEffect(() => {
    if (!shown) return;
    const onScroll = (e: Event) => { if (!pop.current?.contains(e.target as Node)) place(); };
    addEventListener('scroll', onScroll, true);
    addEventListener('resize', place);
    return () => { removeEventListener('scroll', onScroll, true); removeEventListener('resize', place); };
  }, [shown, place]);
  useEffect(() => {
    if (shown && active >= 0) pop.current?.querySelector(`#${CSS.escape(optId(active))}`)?.scrollIntoView({ block: 'nearest' });
  }, [shown, active]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (h: Hit) => {
    onChange({ name: h.name, lat: h.lat, lng: h.lng, country: h.country, region: h.region });
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const n = hits.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!shown) { setOpen(true); setActive(n ? 0 : -1); } else setActive((a) => Math.min(n - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      if (!shown) return;
      e.preventDefault();
      setActive((a) => Math.max(-1, a - 1));
    } else if (e.key === 'Enter') {
      // A highlighted suggestion takes the ↵; otherwise it belongs to the form (save, save & next).
      if (shown && active >= 0 && hits[active]) {
        e.preventDefault();
        e.stopPropagation();
        choose(hits[active]);
      } else setOpen(false);
    } else if (e.key === 'Escape') {
      if (shown && isTopOverlay(layer)) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        setActive(-1);
      }
    } else if (e.key === 'Tab') setOpen(false);
  };

  const famHits = hits.filter((h) => h.uses !== undefined).length;
  const setRef = (el: HTMLInputElement | null) => {
    input.current = el;
    if (typeof inputRef === 'function') inputRef(el);
    else if (inputRef) (inputRef as { current: HTMLInputElement | null }).current = el;
  };

  return (
    <div className="pi">
      <div className="pi-box" ref={box}>
        <button
          type="button"
          className="pi-pin"
          data-placed={placed}
          disabled={disabled}
          onClick={() => setMapOpen(true)}
          title={placed ? (name ? `${name} is on the map. Move its pin…` : 'On the map') : 'Place it on the map…'}
          aria-label={placed ? `On the map${where ? `: ${where}` : ''}. Move the pin` : 'Place it on the map'}
        >
          <MapPin size={16} aria-hidden />
        </button>
        <input
          ref={setRef}
          id={id}
          className="pi-input"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={shown}
          aria-controls={shown ? `${base}-list` : undefined}
          aria-activedescendant={shown && active >= 0 ? optId(active) : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          disabled={disabled}
          value={value.name}
          onChange={(e) => { onChange({ name: e.target.value }); setOpen(true); setActive(-1); }}
          // Not on focus alone: a field focused for you (the next person in Blaze) shouldn't throw a list over the form.
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); setOpen(false); setActive(-1); }}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          {...aria}
        />
        {placed && (where || flag) && (
          <span className="pi-where" title={where}>
            {flag && <span className="pi-flag" aria-hidden>{flag}</span>}
            <span>{where}</span>
          </span>
        )}
      </div>

      {!shown && clash && (
        <div className="pi-note" role="status">
          {value.move ? (
            <>
              <span>The family’s “{name}” pin will move here.</span>
              <button type="button" className="pi-link" onClick={() => onChange({ ...value, move: undefined })}>Keep it where it was</button>
            </>
          ) : (
            <>
              <span>The family already has a “{name}” elsewhere on the map.</span>
              {value.region && fold(value.region) !== fold(name) && !known.has(`${name}, ${value.region}`) && (
                <button type="button" className="pi-link" onClick={() => onChange({ ...value, name: `${name}, ${value.region}` })}>Call this one “{name}, {value.region}”</button>
              )}
              <button type="button" className="pi-link" onClick={() => onChange({ ...value, move: true })}>Move that pin here</button>
            </>
          )}
        </div>
      )}
      {!shown && !placed && name && (
        <div className="pi-note" role="status">
          <span>Not on the map yet.</span>
          {suggestion && (
            <button type="button" className="pi-link" onClick={() => choose(suggestion)}>
              <span>{flagOf(suggestion.country) && <span className="pi-flag" aria-hidden>{flagOf(suggestion.country)} </span>}{suggestion.name}, {whereOf(suggestion)}?</span>
            </button>
          )}
          <button type="button" className="pi-link" onClick={() => setMapOpen(true)}><Crosshair size={13} aria-hidden /> Place it on the map</button>
        </div>
      )}

      {shown && (
        <div
          ref={pop}
          popover="manual"
          id={`${base}-list`}
          role="listbox"
          aria-label="Suggested places"
          className="ui-select-pop pi-pop"
          style={pos ? { top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight } : { visibility: 'hidden' }}
          // Keep focus in the field; a press on an option must not blur it first.
          onMouseDown={(e) => e.preventDefault()}
        >
          {hits.map((h, i) => {
            const fam = h.uses !== undefined;
            const heading = i === 0 && fam ? 'In this family' : !fam && (i === 0 || hits[i - 1].uses !== undefined) ? 'Towns and cities' : undefined;
            const selected = h.name === value.name && (h.lat === undefined || !far({ lat: h.lat, lng: h.lng! }, value) || (fam && value.lat === undefined));
            const sub = fam ? (h.lat === undefined ? 'not on the map yet' : whereOf(h) || 'on the map') : [h.also, whereOf(h)].filter(Boolean).join(' · ');
            return (
              <div key={`${fam ? 'f' : 'g'}${h.name}${h.lat}`}>
                {heading && <div className="ui-select-group" role="presentation">{heading}</div>}
                <div
                  id={optId(i)}
                  role="option"
                  aria-selected={selected}
                  data-active={i === active}
                  className="ui-option"
                  onPointerMove={() => setActive(i)}
                  onClick={() => choose(h)}
                >
                  <span className={`ui-option-icon ${fam ? (h.lat !== undefined ? 'pi-icon-placed' : 'pi-icon-loose') : ''}`} aria-hidden>
                    {fam ? <MapPin size={15} /> : <span className="pi-flag">{flagOf(h.country) || '·'}</span>}
                  </span>
                  <span className="ui-option-label">
                    <span><Highlight text={h.name} q={dq} /></span>
                    {sub && <small>{sub}</small>}
                  </span>
                  {fam && h.uses ? (
                    <span className="ui-option-hint" title={`Used ${h.uses} ${h.uses === 1 ? 'time' : 'times'} in this family`}>
                      <Users size={12} aria-hidden /> {h.uses}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
          {famHits === hits.length && dq.trim().length >= 2 && (
            <div className="pi-foot" role="presentation">No towns to suggest. Type it as you know it, and drop a pin.</div>
          )}
        </div>
      )}

      {mapOpen && (
        <PinMap
          tree={tree}
          name={name || 'this place'}
          start={value.lat !== undefined ? { lat: value.lat, lng: value.lng! } : family ?? (suggestion ? { lat: suggestion.lat!, lng: suggestion.lng! } : undefined)}
          family={graph?.places ?? []}
          onClose={() => setMapOpen(false)}
          onSave={(p) => {
            // Moving the family's existing pin is exactly what the reader asked for here.
            onChange({ name: value.name, lat: p.lat, lng: p.lng, country: p.country, region: p.region, move: family && far(family, p) ? true : undefined });
            setMapOpen(false);
            // The "Place it on the map" link that opened the map is gone now; carry on in the field.
            requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
          }}
        />
      )}
    </div>
  );
}

// ---------- the pin map ----------

type World = { land: string; borders: string };
const FRAME = 1000;
// Mercator in a fixed 1000-unit frame; the camera maps the frame onto the screen.
const projection = geoMercator().scale(FRAME / (2 * Math.PI)).translate([FRAME / 2, FRAME / 2]).precision(0.2);
let worldCache: Promise<World> | null = null;
const loadWorld = () =>
  (worldCache ??= import('world-atlas/countries-50m.json').then((m) => {
    const t = ((m as { default?: unknown }).default ?? m) as Parameters<typeof feature>[0] & { objects: { countries: Parameters<typeof feature>[1] } };
    const path = geoPath(projection);
    return {
      land: path(feature(t, t.objects.countries) as GeoPermissibleObjects) ?? '',
      borders: path(mesh(t, t.objects.countries as never, (a, b) => a !== b) as GeoPermissibleObjects) ?? '',
    };
  }));

type Cam = { x: number; y: number; k: number };
type LatLng = { lat: number; lng: number };
type Town = Awaited<ReturnType<typeof getPlacesIn>>[number];
const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmt = (n: number) => n.toFixed(5).replace(/0+$/, '').replace(/\.$/, '');

function PinMap({ tree, name, start, family, onClose, onSave }: {
  tree: string; name: string; start?: LatLng; family: Place[]; onClose: () => void;
  onSave: (p: LatLng & { country?: string; region?: string }) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 700, h: 420 });
  const [world, setWorld] = useState<World | null>(null);
  const [pin, setPin] = useState<LatLng | null>(start ?? null);
  const [coords, setCoords] = useState(start ? `${fmt(start.lat)}, ${fmt(start.lng)}` : '');
  const [go, setGo] = useState('');
  const [dgo] = useDebouncedValue(go, { wait: 150 });
  const goHits = useQuery({ ...placeSearchQuery(tree, dgo), enabled: dgo.trim().length >= 2 }).data ?? [];
  const [dragging, setDragging] = useState(false);
  useEffect(() => { loadWorld().then(setWorld); }, []);

  const xy = (p: LatLng) => projection([p.lng, p.lat]) ?? [0, 0];
  /** A camera centred on a point with `span` degrees of longitude across the map. */
  const view = useCallback((c: LatLng, span: number, sz = size): Cam => {
    const k = sz.w / ((span * FRAME) / 360);
    const [px, py] = projection([c.lng, c.lat]) ?? [FRAME / 2, FRAME / 2];
    return { k, x: sz.w / 2 - px * k, y: sz.h / 2 - py * k };
  }, [size]);
  const initial = useCallback((sz: { w: number; h: number }): Cam => {
    if (start) return view(start, 2.5, sz);
    if (family.length) {
      const lngs = family.map((p) => p.lng), lats = family.map((p) => p.lat);
      const c = { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lng: (Math.min(...lngs) + Math.max(...lngs)) / 2 };
      return view(c, Math.min(360, Math.max(6, (Math.max(...lngs) - Math.min(...lngs)) * 1.4, (Math.max(...lats) - Math.min(...lats)) * 2.2)), sz);
    }
    return view({ lat: 30, lng: 10 }, 360, sz);
  }, [start, family, view]);
  const [cam, setCamState] = useState<Cam>(() => initial(size));
  const camRef = useRef(cam);
  const setCam = (c: Cam) => {
    const kMin = size.w / FRAME, kMax = size.w / ((0.01 * FRAME) / 360);
    const k = Math.max(kMin, Math.min(kMax, c.k));
    // Keep some of the world on screen.
    const x = Math.max(size.w - FRAME * k - size.w * 0.4, Math.min(size.w * 0.4, c.x));
    const y = Math.max(size.h - FRAME * k - size.h * 0.4, Math.min(size.h * 0.4, c.y));
    camRef.current = { x, y, k };
    setCamState(camRef.current);
  };
  const anim = useRef(0);
  const glide = (to: Cam) => {
    cancelAnimationFrame(anim.current);
    if (reducedMotion()) return setCam(to);
    const from = camRef.current, t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 420);
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      setCam({ k: from.k * Math.pow(to.k / from.k, e), x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e });
      if (p < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  };
  useEffect(() => () => cancelAnimationFrame(anim.current), []);

  useLayoutEffect(() => {
    const el = host.current!;
    let first = true;
    const read = () => {
      const sz = { w: el.clientWidth, h: el.clientHeight };
      setSize(sz);
      if (first) { first = false; const c = initial(sz); camRef.current = c; setCamState(c); }
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const invert = (sx: number, sy: number): LatLng | null => {
    const c = camRef.current;
    const r = projection.invert?.([(sx - c.x) / c.k, (sy - c.y) / c.k]);
    return r && Math.abs(r[1]) <= 85 ? { lat: r[1], lng: ((r[0] + 540) % 360) - 180 } : null;
  };
  const zoomAt = (sx: number, sy: number, f: number) => {
    const c = camRef.current;
    const k = c.k * f;
    setCam({ k, x: sx - ((sx - c.x) / c.k) * k, y: sy - ((sy - c.y) / c.k) * k });
  };
  const drop = (at: LatLng | null) => {
    if (!at) return;
    // Five decimals is about a metre: more would only be noise from the click.
    const p = { lat: Math.round(at.lat * 1e5) / 1e5, lng: Math.round(at.lng * 1e5) / 1e5 };
    setPin(p);
    setCoords(`${fmt(p.lat)}, ${fmt(p.lng)}`);
  };

  // Wheel zoom needs a non-passive listener to keep the page from scrolling.
  useEffect(() => {
    const el = host.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelAnimationFrame(anim.current);
      const r = el.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }); // re-bound each render so it sees the current size

  // Drag pans, two fingers pinch, a press that barely moves drops the pin.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: number; pinch?: number; at: number } | null>(null);
  const local = (e: ReactPointerEvent) => { const r = host.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const onPointerDown = (e: ReactPointerEvent) => {
    if ((e.target as Element).closest('button')) return;
    try { host.current!.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer */ }
    pointers.current.set(e.pointerId, local(e));
    cancelAnimationFrame(anim.current);
    gesture.current = { moved: pointers.current.size > 1 ? 99 : 0, at: Date.now() };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev || !gesture.current) return;
    const now = local(e);
    pointers.current.set(e.pointerId, now);
    const g = gesture.current;
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (g.pinch) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, dist / g.pinch);
      g.pinch = dist;
      g.moved = 99;
      return;
    }
    const dx = now.x - prev.x, dy = now.y - prev.y;
    g.moved += Math.abs(dx) + Math.abs(dy);
    if (g.moved > 4) {
      setDragging(true);
      const c = camRef.current;
      setCam({ ...c, x: c.x + dx, y: c.y + dy });
    }
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const g = gesture.current;
    const at = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      if (g && at && g.moved <= 4 && e.type === 'pointerup') drop(invert(at.x, at.y));
      gesture.current = null;
      setDragging(false);
    } else if (g) g.pinch = undefined;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const c = camRef.current;
    const pan: Record<string, [number, number]> = { ArrowLeft: [80, 0], ArrowRight: [-80, 0], ArrowUp: [0, 80], ArrowDown: [0, -80] };
    if (pan[e.key]) { e.preventDefault(); setCam({ ...c, x: c.x + pan[e.key][0], y: c.y + pan[e.key][1] }); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomAt(size.w / 2, size.h / 2, 1.6); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomAt(size.w / 2, size.h / 2, 1 / 1.6); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); drop(invert(size.w / 2, size.h / 2)); }
  };

  // What is on screen, in degrees; towns are fetched once the view is small enough to name them.
  const sw = invert(0, size.h), ne = invert(size.w, 0);
  const span = (size.w / cam.k) * (360 / FRAME);
  const boxKey = sw && ne && span < 30 ? [sw.lng, sw.lat, ne.lng, ne.lat].map((n) => Math.round(n * 20) / 20).join(',') : '';
  const [dbox] = useDebouncedValue(boxKey, { wait: 220 });
  const townsQ = useQuery({
    queryKey: ['places-in', dbox],
    enabled: !!dbox,
    staleTime: Infinity,
    placeholderData: (prev) => prev,
    queryFn: () => {
      const [west, south, east, north] = dbox.split(',').map(Number);
      return getPlacesIn({ data: { west: Math.max(-180, west), south: Math.max(-85, south), east: Math.min(180, east), north: Math.min(85, north), limit: 90 } });
    },
  });
  // A town the family already has a pin for is drawn once, as theirs.
  const towns = useMemo(
    () => (boxKey ? townsQ.data ?? [] : []).filter((t) => !family.some((f) => Math.abs(f.lat - t.lat) < 0.03 && Math.abs(f.lng - t.lng) < 0.03)),
    [boxKey, townsQ.data, family],
  );

  const screen = (p: LatLng) => { const [x, y] = xy(p); return { x: x * cam.k + cam.x, y: y * cam.k + cam.y }; };
  // Labels that would overlap one already placed are left out; the family's places and the pin go first.
  const labels = useMemo(() => {
    const boxes: [number, number, number, number][] = [];
    const fits = (x: number, y: number, text: string) => {
      const w = text.length * 6.6 + 6, b: [number, number, number, number] = [x + 7, y - 8, x + 7 + w, y + 8];
      if (b[2] > size.w - 52 || b[0] < 0 || b[1] < 0 || b[3] > size.h) return false;
      if (boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])) return false;
      boxes.push(b);
      return true;
    };
    const out = new Set<string>();
    if (pin) { const s = screen(pin); boxes.push([s.x - 9, s.y - 26, s.x + 9 + name.length * 7.4, s.y + 2]); }
    for (const f of family) { const s = screen(f); if (fits(s.x, s.y, f.name)) out.add(`f:${f.name}`); }
    for (const t of towns.slice(0, 40)) { const s = screen(t); if (fits(s.x, s.y, t.name)) out.add(`t:${t.name}:${t.lat}`); }
    return out;
  }, [cam, size, family, towns, pin, name]); // eslint-disable-line react-hooks/exhaustive-deps

  // The nearest named town gives the country and a "near …" line.
  const near = useMemo(() => {
    if (!pin) return undefined;
    let best: Town | undefined, d = Infinity;
    const theirs = family.map((f): Town => ({ name: f.name, cc: f.country ?? null, admin1: null, lat: f.lat, lng: f.lng, pop: 0 }));
    for (const t of [...theirs, ...towns]) {
      const dd = (t.lat - pin.lat) ** 2 + ((t.lng - pin.lng) * Math.cos((pin.lat * Math.PI) / 180)) ** 2;
      if (dd < d) { d = dd; best = t; }
    }
    return best && d < 0.6 ** 2 ? { ...best, km: Math.round(Math.sqrt(d) * 111) } : undefined;
  }, [pin, towns, family]);

  const parse = (s: string): LatLng | null => {
    const m = s.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])?\s*$/i);
    if (!m) return null;
    const lat = Number(m[1]) * (m[2]?.toUpperCase() === 'S' ? -1 : 1), lng = Number(m[3]) * (m[4]?.toUpperCase() === 'W' ? -1 : 1);
    return Math.abs(lat) <= 85 && Math.abs(lng) <= 180 ? { lat, lng } : null;
  };
  const typed = coords.trim() ? parse(coords) : null;
  const dirty = !!pin && (!start || far(start, pin));
  const at = pin ? `${pin.lat.toFixed(4)}°, ${pin.lng.toFixed(4)}°` : '';

  return (
    <Dialog
      open
      onClose={onClose}
      variant="event"
      width={760}
      dirty={dirty}
      title={<>Place “{name}” on the map</>}
      description="Click where it is. Drag to move the map, scroll or pinch to zoom."
      initialFocus={host}
      footer={
        <div className="pm-foot">
          <span className="pm-at" aria-live="polite">
            {pin ? <>{at}{near && <> · {near.km < 2 ? 'in' : `${near.km} km from`} {near.name}{near.cc ? `, ${countryName(near.cc)}` : ''}</>}</> : 'No pin yet'}
          </span>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn primary"
            disabled={!pin}
            onClick={() => pin && onSave({ ...pin, country: near?.cc ?? undefined, region: near?.admin1 ?? undefined })}
          >
            <MapPin size={14} aria-hidden /> Save pin
          </button>
        </div>
      }
    >
      <div className="pm">
        <div className="pm-tools">
          <div className="field pm-go">
            <span id="pm-go-label">Go to a town nearby</span>
            <input
              className="input"
              aria-labelledby="pm-go-label"
              value={go}
              placeholder="Uppsala, Uppsala…"
              onChange={(e) => setGo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const h = goHits.find((x) => x.lat !== undefined);
                  if (h) { glide(view({ lat: h.lat!, lng: h.lng! }, 0.6)); setGo(''); }
                }
              }}
            />
            {go.trim().length >= 2 && dgo === go && (
              <div className="pm-results">
                {goHits.filter((h) => h.lat !== undefined).slice(0, 4).map((h) => (
                  <button type="button" key={`${h.name}${h.lat}`} className="btn" onClick={() => { glide(view({ lat: h.lat!, lng: h.lng! }, 0.6)); setGo(''); }}>
                    {flagOf(h.country) && <span className="pi-flag" aria-hidden>{flagOf(h.country)}</span>}
                    {h.name} <small>{whereOf(h)}</small>
                  </button>
                ))}
                {!goHits.some((h) => h.lat !== undefined) && <span className="subtle">No town by that name.</span>}
              </div>
            )}
          </div>
          <label className="field">
            <span>Or coordinates</span>
            <input
              className="input"
              value={coords}
              placeholder="48.9987, 9.7708"
              inputMode="decimal"
              aria-invalid={!!coords.trim() && !typed}
              onChange={(e) => {
                setCoords(e.target.value);
                const p = parse(e.target.value);
                if (p) { setPin(p); glide(view(p, Math.min(span, 1.2))); }
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
            />
          </label>
        </div>

        <div
          ref={host}
          className={`pm-map${dragging ? ' dragging' : ''}`}
          tabIndex={0}
          role="application"
          aria-label={`Map. Arrow keys move, plus and minus zoom, Enter drops the pin in the middle.${pin ? ` Pin at ${at}.` : ''}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
        >
          <svg width={size.w} height={size.h} aria-hidden>
            {world && (
              <g transform={`translate(${cam.x} ${cam.y}) scale(${cam.k})`}>
                <path className="pm-land" d={world.land} />
                <path className="pm-borders" d={world.borders} />
              </g>
            )}
            <g className="pm-town">
              {towns.map((t) => { const s = screen(t); return <circle key={`${t.name}${t.lat}`} cx={s.x} cy={s.y} r={t.pop > 100_000 ? 3.2 : 2.3} />; })}
              {towns.map((t) => {
                const key = `t:${t.name}:${t.lat}`;
                if (!labels.has(key)) return null;
                const s = screen(t);
                return <text key={key} className={`pm-label${t.pop > 100_000 ? ' big' : ''}`} x={s.x + 6} y={s.y + 4}>{t.name}</text>;
              })}
            </g>
            <g className="pm-family">
              {family.map((f) => { const s = screen(f); return <circle key={f.name} cx={s.x} cy={s.y} r={4.5} />; })}
              {family.map((f) => {
                if (!labels.has(`f:${f.name}`)) return null;
                const s = screen(f);
                return <text key={f.name} className="pm-label" x={s.x + 8} y={s.y + 4}>{f.name}</text>;
              })}
            </g>
            {pin && (() => {
              const s = screen(pin);
              return (
                <g className="pm-pin" transform={`translate(${s.x} ${s.y})`}>
                  <path d="M0 0 C -2 -6 -9 -10 -9 -17 A 9 9 0 1 1 9 -17 C 9 -10 2 -6 0 0 Z" />
                  <circle cx={0} cy={-17} r={3.2} />
                  <text className="pm-label" x={12} y={-14}>{name}</text>
                </g>
              );
            })()}
          </svg>
          <div className="pm-zoom">
            <button type="button" className="btn" aria-label="Zoom in" onClick={() => glide({ ...zoomed(camRef.current, size, 2) })}><Plus size={16} /></button>
            <button type="button" className="btn" aria-label="Zoom out" onClick={() => glide({ ...zoomed(camRef.current, size, 0.5) })}><Minus size={16} /></button>
          </div>
          {!pin && <div className="pm-hint">Click the map to drop the pin</div>}
          <div className="pm-attr">Towns: GeoNames</div>
        </div>
      </div>
    </Dialog>
  );
}

const zoomed = (c: Cam, sz: { w: number; h: number }, f: number): Cam => {
  const k = c.k * f;
  return { k, x: sz.w / 2 - ((sz.w / 2 - c.x) / c.k) * k, y: sz.h / 2 - ((sz.h / 2 - c.y) / c.k) * k };
};
