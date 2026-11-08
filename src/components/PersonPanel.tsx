// The character window: who this is, how they're yours, their life at a glance (the Overview), their
// family, what the family remembers about them, and the everyday things (birthday, how to reach them).
import { useForm, useStore } from '@tanstack/react-form';
import { Link, useBlocker } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { geoMercator, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import {
  Baby, BriefcaseBusiness, Cake, Camera, Check, CookingPot, Crosshair, Crown, Gift, GitFork, Heart, HeartCrack, Hourglass, Mail, MapPin, MessageCircle, MessagesSquare, Pencil,
  Phone, Plus, Quote, Route as RouteIcon, Sparkles, StickyNote, Trash2, UserRound, X,
} from 'lucide-react';
import { feature, mesh } from 'topojson-client';
import { renderMarkdown } from '~/lib/markdown';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { addContact, addStory, deleteContact, opKeys, removePerson, deleteStory, personQuery, updatePerson, uploadPhoto } from '~/lib/api';
import {
  ageAt, age, children, displayName, fmtDate, kinship, lifespan, parents, partnersOf, siblings, yearOf, type Family,
} from '~/lib/graph';
import { setPref } from '~/lib/prefs';
import { chooseMe } from '~/lib/family';
import { can, type Role } from '~/lib/roles';
import { useCan, useRole, useSession } from '~/lib/session';
import type { GPerson, PersonDetail, Place, Story } from '~/lib/types';
import { TRAITS } from '~/lib/traits';
import { validDate } from '~/lib/dates';
import { GAP_ACTION, GAP_LABEL, GAP_WHERE, gapsOf, useRequired, type GapKey } from '~/lib/gaps';
import { GameIcon } from './GameIcon';
import { Arms } from './Heraldry';
import { Portrait } from './Portrait';
import { Dialog, ErrorState, Skeleton, Tabs, TabList, Tab as UiTab, TabPanel, Select, Switch, isOverlayOpen } from './ui';
import { QuickAdd } from './QuickAdd';
import { PlaceInput, placeValue, savePlacesKeyed, type PlaceValue } from './PlaceInput';
import type { AddRelation } from './Card';
import './panel.css';

type Tab = 'overview' | 'family' | 'stories' | 'everyday' | 'edit';

type Draft = { dirty: boolean; busy: boolean; save: () => Promise<boolean> };
const DraftContext = createContext<{ register: (draft: Draft | null) => void; leave: (next: () => void) => void }>({ register: () => {}, leave: (next) => next() });
function DraftTracker({ form }: { form: any }) {
  const { register } = useContext(DraftContext);
  const dirty = useStore(form.store, (s: any) => s.isDirty) as boolean;
  const busy = useStore(form.store, (s: any) => s.isSubmitting) as boolean;
  useEffect(() => { register({ dirty, busy, save: async () => { await form.handleSubmit(); return !form.state.isDirty; } }); }, [dirty, busy, form, register]);
  useEffect(() => () => register(null), [register]);
  return dirty ? <span className="pp-unsaved" role="status">Unsaved changes</span> : null;
}

interface Props {
  family: Family;
  tree: string;
  id: string;
  /** Who the reader said they are; null until they choose (then no kinship is shown). */
  me: string | null;
  onSelect: (id: string) => void;
  onCenter: () => void;
  onPath: () => void;
  onDynasty: () => void;
  onAncestors: () => void;
  onClose: () => void;
}

/** The person's details (stories, contacts, places): loading, failed with a retry, or there. */
type DetailState = { detail?: PersonDetail; failed: boolean; retry: () => void };

export function PersonPanel({ family: f, tree, id, me, onSelect, onCenter, onPath, onDynasty, onAncestors, onClose }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [add, setAdd] = useState<AddRelation | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const leave = (next: () => void) => draft?.dirty || draft?.busy ? setPending(() => next) : next();
  const blocker = useBlocker({ shouldBlockFn: () => !!(draft?.dirty || draft?.busy), enableBeforeUnload: !!(draft?.dirty || draft?.busy), withResolver: true });
  const guarded = pending || (blocker.status === 'blocked' ? blocker.proceed : null);
  const keep = () => { setPending(null); blocker.reset?.(); };
  const proceed = () => { setPending(null); guarded?.(); };
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (draft?.dirty || draft?.busy) && !isOverlayOpen()) {
        e.preventDefault(); e.stopImmediatePropagation(); setPending(() => onClose);
      }
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [draft, onClose]);
  const p = f.byId.get(id);
  const [tab, setTab] = useState<Tab>('overview');
  // What this reader may do here (the server checks the same; see src/lib/roles.ts).
  const role = useRole();
  const canEdit = can(role, 'edit-person');
  const canAdd = can(role, 'add-person');
  const canPhoto = can(role, 'upload-photo');
  const [required] = useRequired(tree);
  const detailQ = useQuery(personQuery(tree, id));
  const details: DetailState = { detail: detailQ.data, failed: detailQ.isError && !detailQ.data, retry: () => void detailQ.refetch() };
  const detail = detailQ.data;
  const qc = useQueryClient();
  const [photoKeys] = useState(opKeys);
  const photo = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.set('tree', tree);
      fd.set('id', id);
      fd.set('file', file);
      fd.set('opKey', photoKeys.for('photo', [id, file.name, file.size, file.lastModified]));
      return uploadPhoto({ data: fd });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['graph', tree] }),
  });

  if (!p) return null;
  const house = p.house ? f.house.get(p.house) : undefined;
  const a = age(p);
  const fillGap = (g: GapKey) => (g === 'photo' ? photoInput.current?.click() : GAP_WHERE[g] === 'tree' ? onAncestors() : leave(() => setTab(GAP_WHERE[g] as Tab)));

  return (
    <DraftContext.Provider value={{ register: setDraft, leave }}><aside className="person-panel panel" key={id}>
      <button className="btn icon ghost panel-close" onClick={() => leave(onClose)} aria-label="Close person panel" title="Close (Esc)"><X size={16} /></button>
      <header className="pp-head">
        {canPhoto ? (
          <>
            <button type="button" disabled={photo.isPending} className="pp-portrait" aria-label="Change portrait" onClick={() => photoInput.current?.click()}>
              <Portrait person={p} tree={tree} size={124} />
              <span className="pp-photo"><Camera size={14} /></span>
            </button>
            <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" aria-label="Portrait image" hidden onChange={(e) => e.target.files?.[0] && photo.mutate(e.target.files[0])} />
          </>
        ) : (
          <span className="pp-portrait readonly"><Portrait person={p} tree={tree} size={124} /></span>
        )}
        <div className="pp-id">
          <h2 className="display">{displayName(p, f)}</h2>
          {p.title && <div className="pp-title">{p.title}</div>}
          <div className="pp-life">
            {p.living && <span className="pp-living" title="Living">●</span>}
            {lifespan(p)}
            {a !== undefined && <span className="muted"> · {p.living ? `${a} years old` : `died aged ${a}`}</span>}
          </div>
          {house && (
            <Link className="pp-house" to="/$tree/house/$house" params={{ tree, house: house.id }} title={`Open the page of ${house.name}`}>
              <Arms arms={house.arms} size={22} /> <span>{house.name}</span>
            </Link>
          )}
        </div>
      </header>

      {photo.isError && <p className="err pp-photo-err" role="alert">Could not change portrait. Try an image smaller than 5 MB.</p>}

      {p.traits?.length ? (
        <div className="pp-traits">
          {p.traits.map((t) => {
            const tr = TRAITS[t];
            return (
              <span key={t} className={`trait ${tr?.kind ?? 'other'}`} title={t}>
                <span className="trait-medal">{tr ? <GameIcon name={tr.icon} size={16} /> : '◆'}</span> {t}
              </span>
            );
          })}
        </div>
      ) : null}

      <div className="pp-actions">
        <button className="btn" onClick={onCenter}><Crosshair size={14} /> Centre</button>
        <button className="btn" onClick={onAncestors}><GitFork size={14} style={{ transform: 'rotate(180deg)' }} /> Ancestors</button>
        <button className="btn" onClick={onDynasty}><Crown size={14} /> Dynasty</button>
      </div>

      <Tabs value={tab} onChange={(v) => leave(() => setTab(v as Tab))} label="Person details">
      <TabList className="pp-tabs">
        {(
          [
            ['overview', 'Overview', undefined],
            ['family', 'Family', relativesCount(f, id)],
            ['stories', 'Stories', detail?.stories.length ?? p.stories],
            ['everyday', p.living ? 'Everyday' : 'Life', undefined],
            ['edit', 'Edit', undefined],
          ] as const
        ).filter(([t]) => t !== 'edit' || canEdit).map(([t, label, n]) => (
          <UiTab key={t} value={t} title={n ? `${label}: ${n}` : undefined}>
            {label}{n ? <span className="pp-count">{n}</span> : null}
          </UiTab>
        ))}
      </TabList>

      <div className="pp-body">
        <TabPanel value="overview">
          <OverviewTab
            f={f} tree={tree} p={p} me={me} details={details} role={role} gaps={gapsOf(f, p, required)}
            onSelect={(v) => leave(() => onSelect(v))} onPath={onPath} onGap={fillGap} onTab={(t) => leave(() => setTab(t))}
          />
        </TabPanel>
        <TabPanel value="family"><FamilyTab f={f} tree={tree} id={id} canAdd={canAdd} onSelect={(v) => leave(() => onSelect(v))} /></TabPanel>
        <TabPanel value="stories"><StoriesTab tree={tree} p={p} details={details} /></TabPanel>
        <TabPanel value="everyday"><EverydayTab f={f} tree={tree} p={p} details={details} /></TabPanel>
        <TabPanel value="edit">
          {canEdit && (detail ? <EditTab tree={tree} p={p} detail={detail} done={() => setTab('overview')} onRemoved={onClose} /> : <DetailFallback details={details} />)}
        </TabPanel>
      </div></Tabs>
      {canAdd ? (
        <div className="pp-add-relative"><Select aria-label="Add relative" placeholder="Add relative" value="" onChange={(v) => { if (v) leave(() => setAdd(v as AddRelation)); }} options={['parent', 'partner', 'child', 'sibling'].map((v) => ({ value: v, label: `Add ${v}` }))} /></div>
      ) : (
        <p className="pp-add-relative pp-ask subtle">Ask an editor to add people or change details.</p>
      )}
      {add && canAdd && <QuickAdd family={f} tree={tree} anchor={id} relation={add} onCancel={() => setAdd(null)} onDone={() => setAdd(null)} />}
      <Dialog open={!!guarded} onClose={keep} title="Unsaved changes" dismissible={!savingDraft && !draft?.busy} footer={<>
        <button className="btn ghost" disabled={savingDraft || draft?.busy} onClick={keep}>Keep editing</button>
        <button className="btn" disabled={savingDraft || draft?.busy} onClick={proceed}>Discard</button>
        <button className="btn primary" disabled={savingDraft || draft?.busy} onClick={async () => { setSavingDraft(true); try { if (await draft?.save()) proceed(); } finally { setSavingDraft(false); } }}>Save</button>
      </>}><p>Save your draft before leaving?</p></Dialog>
    </aside></DraftContext.Provider>
  );
}

/** While the person's details load, a skeleton; when they failed, the error with Retry. Never a blank tab. */
function DetailFallback({ details, lines = 4 }: { details: DetailState; lines?: number }) {
  if (details.failed) return <ErrorState className="pp-error" title="Couldn’t load their details" message="Stories, places and contacts didn’t arrive. Check the connection and try again." onRetry={details.retry} />;
  return <div className="pp-loading" aria-busy="true"><span className="sr-only">Loading…</span><Skeleton lines={lines} height={16} /></div>;
}

function relativesCount(f: Family, id: string) {
  return parents(f, id).length + partnersOf(f, id).length + children(f, id).length + siblings(f, id).length;
}

// ---------- overview ----------

/** The profile at a glance: how they're yours, the key facts, their life, places, words and what's missing. */
function OverviewTab({ f, tree, p, me, details, role, gaps, onSelect, onPath, onGap, onTab }: {
  f: Family; tree: string; p: GPerson; me: string | null; details: DetailState; role: Role; gaps: GapKey[];
  onSelect: (id: string) => void; onPath: () => void; onGap: (g: GapKey) => void; onTab: (t: Tab) => void;
}) {
  const detail = details.detail;
  const k = useMemo(() => (me && me !== p.id ? kinship(f, me, p.id) : undefined), [f, me, p.id]);
  const house = p.house ? f.house.get(p.house) : undefined;
  const a = age(p);
  const unions = f.unionsOf.get(p.id) ?? [];
  const bornPlace = detail?.bornPlace ?? p.bornPlace;
  const diedPlace = detail?.diedPlace ?? p.diedPlace;
  const words = (detail?.stories ?? []).filter((s) => s.kind !== 'recipe' && s.kind !== 'note').slice(0, 2);

  return (
    <div className="pp-overview">
      <section className="pp-kin" aria-label="How you are related">
        {!me ? (
          <span className="muted">Say who you are to see how you’re related</span>
        ) : me === p.id ? (
          <span className="pp-you"><UserRound size={14} /> This is you</span>
        ) : k ? (
          <span>Your <b>{k.label}</b></span>
        ) : (
          <span className="muted">Not related by blood or marriage to you</span>
        )}
        <span className="spacer" />
        {me !== p.id && k && <button className="btn ghost" onClick={onPath} title="Highlight the line between you"><RouteIcon size={14} /> How?</button>}
        {!me ? (
          <button className="btn ghost" onClick={() => void chooseMe(tree, p.id)} title="Kinship labels will be relative to this person">This is me</button>
        ) : me !== p.id && <button className="btn ghost" onClick={() => setPref(`me:${tree}`, p.id)} title="See everyone's relationship from this person's point of view">Be them</button>}
      </section>

      <div className="pp-facts pp-keyfacts">
        <Fact icon={<Cake size={15} />} label="Born">
          {fmtDate(p.born) ?? 'Date unknown'}{bornPlace && <> in <PlaceLink tree={tree} name={bornPlace} /></>}
        </Fact>
        {!p.living && (
          <Fact icon={<span aria-hidden>✝</span>} label="Died">
            {fmtDate(p.died) ?? 'Date unknown'}{diedPlace && <> in <PlaceLink tree={tree} name={diedPlace} /></>}
          </Fact>
        )}
        {a !== undefined && <Fact icon={<Hourglass size={15} />} label="Age">{p.living ? `${a} years old` : `Died aged ${a}`}</Fact>}
        {p.occupation && <Fact icon={<BriefcaseBusiness size={15} />} label="Occupation">{p.occupation}</Fact>}
        {p.title && <Fact icon={<Crown size={15} />} label="Title">{p.title}</Fact>}
        {p.nickname && <Fact icon={<UserRound size={15} />} label="Called">{p.nickname}</Fact>}
      </div>

      {p.living && <Upcoming f={f} p={p} />}
      {p.living && (detail ? <ContactActions p={p} detail={detail} onMore={() => onTab('everyday')} /> : details.failed ? null : null)}

      <LifeTimeline f={f} tree={tree} p={p} onSelect={onSelect} />

      <PlacesMap f={f} tree={tree} p={p} bornPlace={bornPlace} diedPlace={diedPlace} unions={unions} />

      <section className="pp-ov-section">
        <div className="rule">In their words and ours</div>
        {!detail ? (
          <DetailFallback details={details} lines={2} />
        ) : words.length ? (
          <div className="pp-stories">
            {words.map((s) => <StoryCard key={s.id} s={s} compact />)}
            {detail.stories.length > words.length && <button className="btn ghost pp-more" onClick={() => onTab('stories')}>All {detail.stories.length} stories</button>}
          </div>
        ) : (
          <p className="pp-quiet subtle">Nothing written down about {p.given} yet. <button className="pp-inline-link" onClick={() => onTab('stories')}>Add a memory</button></p>
        )}
      </section>

      {house && (
        <section className="pp-ov-section">
          <div className="rule">House</div>
          <Link className="pp-house-card ui-card interactive" to="/$tree/house/$house" params={{ tree, house: house.id }}>
            <Arms arms={house.arms} size={40} />
            <span>
              <b>{house.name}</b>
              {house.motto && <i>“{house.motto}”</i>}
            </span>
          </Link>
        </section>
      )}

      {gaps.length > 0 && (
        <section className="pp-gaps" aria-label="Information needed">
          <span className="pp-gaps-title"><GameIcon name="quill-ink" size={14} /> Information needed</span>
          <div>
            {gaps.map((g) =>
              // Only the gaps this reader may fill in are buttons; the rest are just listed.
              !can(role, GAP_ACTION[g]) ? (
                <span key={g} className="chip">{GAP_LABEL[g]}</span>
              ) : (
                <button key={g} className="chip" onClick={() => onGap(g)} title={g === 'photo' ? 'Choose a photo' : GAP_WHERE[g] === 'tree' ? 'Open the ancestors view to fill the empty slots' : 'Fill it in'}>
                  <Plus size={12} aria-hidden /> {GAP_LABEL[g]}
                </button>
              ),
            )}
          </div>
        </section>
      )}
    </div>
  );
}

/** Next birthday and wedding anniversaries, as countdown cards. */
function Upcoming({ f, p }: { f: Family; p: GPerson }) {
  const bday = p.born ? nextOccurrence(p.born) : undefined;
  const anniversaries = (f.unionsOf.get(p.id) ?? [])
    .filter((u) => u.kind === 'marriage' && u.start && !u.end)
    .map((u) => ({ u, next: nextOccurrence(u.start!), other: f.byId.get(u.a === p.id ? u.b : u.a) }))
    .filter((x) => x.next && x.other?.living);
  if (!bday && !anniversaries.length) return null;
  return (
    <div className="pp-upcoming">
      {bday && (
        <div className="pp-countdown ui-card">
          <Cake size={20} />
          <div>
            <b>Birthday {inDays(daysUntil(bday))}</b>
            <div className="muted">{bday.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} · turns {(ageAt(p.born) ?? 0) + 1}</div>
          </div>
        </div>
      )}
      {anniversaries.map(({ u, next, other }) => (
        <div className="pp-countdown ui-card" key={u.id}>
          <Heart size={20} />
          <div>
            <b>Anniversary with {other!.given} {inDays(daysUntil(next!))}</b>
            <div className="muted">{next!.getFullYear() - yearOf(u.start)} years · married {fmtDate(u.start)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Call, write or find them: one button per way to reach them. */
function ContactActions({ p, detail, onMore }: { p: GPerson; detail: PersonDetail; onMore: () => void }) {
  const first = (k: string) => detail.contacts.find((c) => c.kind === k);
  const phone = first('phone'), email = first('email'), address = first('address');
  if (!phone && !email && !address) return null;
  return (
    <div className="pp-reach" role="group" aria-label={`Reach ${p.given}`}>
      {phone && <a className="btn" href={contactHref('phone', phone.value)}><Phone size={14} /> Call</a>}
      {email && <a className="btn" href={contactHref('email', email.value)}><Mail size={14} /> Email</a>}
      {address && <a className="btn" href={contactHref('address', address.value)} target="_blank" rel="noreferrer"><MapPin size={14} /> Directions</a>}
      {detail.contacts.length > [phone, email, address].filter(Boolean).length && <button className="btn ghost" onClick={onMore}>More</button>}
    </div>
  );
}

type LifeEvent = { year: number; date?: string; icon: ReactNode; text: ReactNode; key: string };

/** Birth, partnerships, children's births and death, in order, from the graph. */
function LifeTimeline({ f, tree, p, onSelect }: { f: Family; tree: string; p: GPerson; onSelect: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const events = useMemo(() => {
    const out: LifeEvent[] = [];
    if (!isNaN(yearOf(p.born))) out.push({ key: 'born', year: yearOf(p.born), date: p.born, icon: <Cake size={13} />, text: <>Born{p.bornPlace && <> in <PlaceLink tree={tree} name={p.bornPlace} /></>}</> });
    for (const u of f.unionsOf.get(p.id) ?? []) {
      const o = f.byId.get(u.a === p.id ? u.b : u.a);
      if (!o) continue;
      const who = <button className="pp-inline-link" onClick={() => onSelect(o.id)}>{displayName(o, f)}</button>;
      if (!isNaN(yearOf(u.start))) out.push({ key: `u${u.id}`, year: yearOf(u.start), date: u.start, icon: <Heart size={13} />, text: <>{u.kind === 'marriage' ? 'Married' : 'Partnered with'} {who}{u.place && <> in <PlaceLink tree={tree} name={u.place} /></>}</> });
      if (!isNaN(yearOf(u.end)) && u.endReason && u.endReason !== 'death') out.push({ key: `e${u.id}`, year: yearOf(u.end), date: u.end, icon: <HeartCrack size={13} />, text: <>{u.endReason === 'divorce' ? 'Divorced' : 'Parted from'} {who}</> });
    }
    for (const c of children(f, p.id)) {
      const kid = f.byId.get(c);
      if (!kid || isNaN(yearOf(kid.born))) continue;
      const word = kid.sex === 'm' ? 'A son' : kid.sex === 'f' ? 'A daughter' : 'A child';
      out.push({ key: `c${c}`, year: yearOf(kid.born), date: kid.born, icon: <Baby size={13} />, text: <>{word}, <button className="pp-inline-link" onClick={() => onSelect(c)}>{kid.given}</button>, is born</> });
    }
    if (!p.living && !isNaN(yearOf(p.died))) out.push({ key: 'died', year: yearOf(p.died), date: p.died, icon: <span aria-hidden>✝</span>, text: <>Died{p.diedPlace && <> in <PlaceLink tree={tree} name={p.diedPlace} /></>}{age(p) !== undefined && <span className="muted">, aged {age(p)}</span>}</> });
    const order = (e: LifeEvent) => (e.key === 'born' ? 0 : e.key === 'died' ? 2 : 1);
    return out.sort((a, b) => a.year - b.year || order(a) - order(b) || (a.date ?? '').localeCompare(b.date ?? ''));
  }, [f, tree, p, onSelect]);
  if (events.length < 2) return null;
  const shown = all || events.length <= 8 ? events : [...events.slice(0, 6), events[events.length - 1]];
  return (
    <section className="pp-ov-section">
      <div className="rule">Life</div>
      <ol className="pp-timeline">
        {shown.map((e, i) => (
          <li key={e.key} data-gap={!all && events.length > 8 && i === 6 ? true : undefined}>
            <span className="pp-tl-year">{e.year}</span>
            <span className="pp-tl-dot" aria-hidden>{e.icon}</span>
            <span className="pp-tl-text">{e.text}</span>
          </li>
        ))}
      </ol>
      {!all && events.length > 8 && <button className="btn ghost pp-more" onClick={() => setAll(true)}>Show all {events.length} events</button>}
    </section>
  );
}

// The small world map: the 110m countries the Atlas uses too, loaded once.
type MiniWorld = { land: GeoPermissibleObjects; borders: GeoPermissibleObjects };
let miniWorld: Promise<MiniWorld> | null = null;
const loadMiniWorld = () =>
  (miniWorld ??= import('world-atlas/countries-110m.json').then((m) => {
    const t = ((m as { default?: unknown }).default ?? m) as Parameters<typeof feature>[0] & { objects: { countries: Parameters<typeof feature>[1] } };
    return { land: feature(t, t.objects.countries) as GeoPermissibleObjects, borders: mesh(t, t.objects.countries as never, (x, y) => x !== y) as GeoPermissibleObjects };
  }));

const MAP_W = 360, MAP_H = 170;

/** Where their life happened: birth, partnerships and death on a small map, with the places listed below. */
function PlacesMap({ f, tree, p, bornPlace, diedPlace, unions }: { f: Family; tree: string; p: GPerson; bornPlace?: string; diedPlace?: string; unions: Family['graph']['unions'] }) {
  const [world, setWorld] = useState<MiniWorld | null>(null);
  const places = useMemo(() => {
    const at = new Map(f.graph.places.map((pl) => [pl.name, pl]));
    const list: { name: string; what: string; pl?: Place }[] = [];
    const push = (name: string | undefined, what: string) => {
      if (!name) return;
      const had = list.find((x) => x.name === name);
      if (had) had.what += `, ${what.toLowerCase()}`;
      else list.push({ name, what, pl: at.get(name) });
    };
    push(bornPlace, 'Born');
    for (const u of unions) push(u.place, u.kind === 'marriage' ? 'Married' : 'Partnership');
    if (!p.living) push(diedPlace, 'Died');
    return list;
  }, [f, p.living, bornPlace, diedPlace, unions]);
  const pinned = places.filter((x) => x.pl);
  useEffect(() => { if (pinned.length) void loadMiniWorld().then(setWorld); }, [pinned.length]);
  const drawn = useMemo(() => {
    if (!world || !pinned.length) return null;
    // Fit the pins with room around them: at least a country's worth of map, so one town still has context.
    const lngs = pinned.map((x) => x.pl!.lng), lats = pinned.map((x) => x.pl!.lat);
    const cx = (Math.min(...lngs) + Math.max(...lngs)) / 2, cy = (Math.min(...lats) + Math.max(...lats)) / 2;
    const hw = Math.max(7, (Math.max(...lngs) - Math.min(...lngs)) * 0.65), hh = Math.max(3.5, (Math.max(...lats) - Math.min(...lats)) * 0.75);
    const box = { type: 'MultiPoint', coordinates: [[cx - hw, Math.max(-80, cy - hh)], [cx + hw, Math.min(80, cy + hh)]] } as GeoPermissibleObjects;
    const proj = geoMercator().fitExtent([[16, 14], [MAP_W - 16, MAP_H - 14]], box);
    const path = geoPath(proj);
    return { land: path(world.land) ?? '', borders: path(world.borders) ?? '', pins: pinned.map((x) => ({ ...x, xy: proj([x.pl!.lng, x.pl!.lat]) ?? [0, 0] })) };
  }, [world, pinned]);
  if (!places.length) return null;
  return (
    <section className="pp-ov-section">
      <div className="rule">Places</div>
      {pinned.length > 0 && (
        <div className="pp-map ui-card" aria-hidden>
          <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} preserveAspectRatio="xMidYMid slice">
            <rect width={MAP_W} height={MAP_H} className="pp-map-sea" />
            {drawn && (
              <>
                <path className="pp-map-land" d={drawn.land} />
                <path className="pp-map-borders" d={drawn.borders} />
                {drawn.pins.map((x) => (
                  <g key={x.name} className="pp-map-pin" transform={`translate(${x.xy[0]} ${x.xy[1]})`}>
                    <circle r={5} />
                    {/* Near the right edge the name goes to the left of its pin. */}
                    <text x={x.xy[0] > MAP_W * 0.68 ? -8 : 8} y={4} textAnchor={x.xy[0] > MAP_W * 0.68 ? 'end' : 'start'}>{x.name}</text>
                  </g>
                ))}
              </>
            )}
          </svg>
        </div>
      )}
      <ul className="pp-placelist">
        {places.map((x) => (
          <li key={x.name}>
            <MapPin size={14} className={x.pl ? 'on' : undefined} aria-hidden />
            <PlaceLink tree={tree} name={x.name} />
            <span className="subtle">{x.what}{x.pl ? '' : ' · not on the map yet'}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- family ----------

function FamilyTab({ f, tree, id, canAdd, onSelect }: { f: Family; tree: string; id: string; canAdd: boolean; onSelect: (id: string) => void }) {
  const gps = [...new Set(parents(f, id).flatMap((p) => parents(f, p)))];
  const unions = f.unionsOf.get(id) ?? [];
  const groups: [string, string[]][] = [
    ['Parents', parents(f, id)],
    ['Partners', partnersOf(f, id)],
    ['Children', children(f, id)],
    ['Siblings', siblings(f, id)],
    ['Grandparents', gps],
  ];
  const any = groups.some(([, ids]) => ids.length);
  if (!any) return <p className="empty">No relatives recorded yet.{canAdd && <> Use the <Plus size={12} /> marks around the card to add some.</>}</p>;
  return (
    <>
      {groups.map(([label, ids]) =>
        ids.length ? (
          <section key={label}>
            <div className="rule">{label} <span className="faint">{ids.length}</span></div>
            <div className="pp-grid">
              {ids.map((r) => {
                const rp = f.byId.get(r)!;
                const u = label === 'Partners' ? unions.find((u) => u.a === r || u.b === r) : undefined;
                return (
                  <button key={r} className="pp-rel" onClick={() => onSelect(r)} title={`${displayName(rp, f)} · ${lifespan(rp)}`}>
                    <Portrait person={rp} tree={tree} size={58} frame />
                    <span className="pp-rel-name">{rp.given}</span>
                    {u ? <span className="pp-rel-sub">{u.kind === 'marriage' ? '⚭' : '♡'} {u.start ? yearOf(u.start) : ''}{u.end ? `–${yearOf(u.end)}` : ''}</span> : <span className="pp-rel-sub">{lifespan(rp)}</span>}
                    {f.disputed.has(`${id}>${r}`) && <span className="pp-disputed" title="Parentage disputed"><GameIcon name="uncertainty" size={12} /></span>}
                  </button>
                );
              })}
            </div>
          </section>
        ) : null,
      )}
    </>
  );
}

// ---------- stories ----------

const KINDS: { id: Story['kind']; label: string; icon: ReactNode }[] = [
  { id: 'memory', label: 'Memory', icon: <Sparkles size={14} /> },
  { id: 'quote', label: 'Saying', icon: <Quote size={14} /> },
  { id: 'anecdote', label: 'Anecdote', icon: <MessagesSquare size={14} /> },
  { id: 'recipe', label: 'Recipe', icon: <CookingPot size={14} /> },
  { id: 'note', label: 'Note', icon: <StickyNote size={14} /> },
];

function StoriesTab({ tree, p, details }: { tree: string; p: GPerson; details: DetailState }) {
  const detail = details.detail;
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const canWrite = useCan('add-story');
  const canDelete = useCan('edit-person');
  const remove = useMutation({
    mutationFn: (sid: string) => deleteStory({ data: { tree, id: sid } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['person', tree, p.id] }); qc.invalidateQueries({ queryKey: ['graph', tree] }); },
  });
  if (!detail) return <DetailFallback details={details} />;
  return (
    <>
      {detail.bio && <div className="pp-bio" dangerouslySetInnerHTML={{ __html: renderMarkdown(detail.bio) }} />}
      {!canWrite ? null : adding ? (
        <StoryForm tree={tree} person={p} done={() => setAdding(false)} />
      ) : (
        <button className="btn primary pp-add-story" onClick={() => setAdding(true)}><Plus size={14} /> Add a memory, saying or recipe</button>
      )}
      {detail.stories.length === 0 && !adding && (
        <p className="empty">Nothing written down about {p.given} yet.{canWrite ? ' What do you remember?' : ''}</p>
      )}
      {!canWrite && <p className="pp-ask subtle">Ask a steward if you’d like to add memories of your own.</p>}
      <div className="pp-stories">
        {detail.stories.map((s) => (
          <StoryCard key={s.id} s={s} onDelete={canDelete ? () => confirm('Remove this story?') && remove.mutate(s.id) : undefined} />
        ))}
      </div>
    </>
  );
}

/** One story: a saying in the hand font, anything else as safe Markdown. `compact` clamps it for the Overview. */
function StoryCard({ s, compact, onDelete }: { s: Story; compact?: boolean; onDelete?: () => void }) {
  const kind = KINDS.find((k) => k.id === s.kind);
  return (
    <article className={`story story-${s.kind}${compact ? ' compact' : ''}`}>
      <header>
        {kind?.icon}
        <span>{s.title ?? kind?.label}</span>
        {onDelete && <button className="btn icon ghost story-del" aria-label="Remove story" title="Remove story" onClick={onDelete}><Trash2 size={13} /></button>}
      </header>
      {s.kind === 'quote' ? (
        <blockquote>{s.body}</blockquote>
      ) : (
        <div className="story-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(s.body) }} />
      )}
      <footer>
        {s.context && <span>{s.context} · </span>}
        <span>added by {s.author}</span> · <time dateTime={s.at}>{new Date(s.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</time>
      </footer>
    </article>
  );
}

function StoryForm({ tree, person, done }: { tree: string; person: GPerson; done: () => void }) {
  const { leave } = useContext(DraftContext);
  const [saveError, setSaveError] = useState('');
  const qc = useQueryClient();
  // Stories are signed with the writer's account name; the server fills it in.
  const author = useSession()?.user?.name;
  // One key per attempt: a retry after a lost answer never adds the story twice.
  const [keys] = useState(opKeys);
  const form = useForm({
    defaultValues: { kind: 'memory' as Story['kind'], title: '', body: '', context: '' },
    onSubmit: async ({ value }) => {
      setSaveError('');
      try {
      const data = { tree, person: person.id, kind: value.kind, body: value.body.trim(), title: value.title.trim() || undefined, context: value.context.trim() || undefined };
      await addStory({ data: { ...data, opKey: keys.for('story', data) } });
      await qc.invalidateQueries({ queryKey: ['person', tree, person.id] });
      qc.invalidateQueries({ queryKey: ['graph', tree] });
      qc.invalidateQueries({ queryKey: ['chronicle', tree] });
      form.reset(value);
      done();
      } catch (e) { setSaveError(e instanceof Error ? e.message : 'Could not save story'); }
    },
  });
  return (
    <form className="story-form" onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }}>
      <DraftTracker form={form} />{saveError && <p role="alert" className="err">{saveError}</p>}
      <form.Field name="kind">
        {(field) => (
          <div className="seg">
            {KINDS.map((k) => (
              <button type="button" key={k.id} aria-pressed={field.state.value === k.id} className="btn" onClick={() => field.handleChange(k.id)}>
                {k.icon} {k.label}
              </button>
            ))}
          </div>
        )}
      </form.Field>
      <form.Subscribe selector={(s) => s.values.kind}>
        {(kind) => (
          <>
            {kind !== 'quote' && (
              <form.Field name="title">
                {(field) => <input aria-label="Story title (optional)" className="input" placeholder="Title (optional)" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />}
              </form.Field>
            )}
            <form.Field name="body" validators={{ onSubmit: ({ value }) => (value.trim() ? undefined : 'Write something first') }}>
              {(field) => (
                <>
                  <textarea
                    aria-label="Story" aria-describedby="story-body-error" aria-invalid={!!field.state.meta.errors.length}
                    autoFocus
                    className={`input${kind === 'quote' ? ' quote-input' : ''}`}
                    placeholder={kind === 'quote' ? `Something ${person.given} always said…` : kind === 'recipe' ? 'Ingredients and method…' : `What do you remember about ${person.given}?`}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && form.handleSubmit()}
                  />
                  {field.state.meta.errors.length ? <span id="story-body-error" className="err">{field.state.meta.errors.join(', ')}</span> : null}
                </>
              )}
            </form.Field>
            {kind === 'quote' && (
              <form.Field name="context">
                {(field) => <input aria-label="When or where" className="input" placeholder={tree === 'realm' ? 'At the winter feast…' : 'At every family dinner…'} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />}
              </form.Field>
            )}
          </>
        )}
      </form.Subscribe>
      <div className="row end">
        <span className="subtle pp-signed" title={author ? `Signed as ${author}` : undefined}>{author ? `Signed as ${author}` : ''}</span>
        <button type="button" className="btn ghost" onClick={() => leave(done)}>Cancel</button>
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(busy) => <button className="btn primary" disabled={busy}><Check size={14} /> Save <kbd>⌘↵</kbd></button>}
        </form.Subscribe>
      </div>
    </form>
  );
}

// ---------- everyday ----------

function nextOccurrence(date: string, from = new Date()): Date | undefined {
  if (!/^\d{4}-\d\d-\d\d$/.test(date)) return undefined;
  const [, m, d] = date.split('-').map(Number);
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let next = new Date(today.getFullYear(), m - 1, d);
  if (next < today) next = new Date(today.getFullYear() + 1, m - 1, d);
  return next;
}
const daysUntil = (d: Date) => Math.round((d.getTime() - new Date(new Date().toDateString()).getTime()) / 86_400_000);
const inDays = (n: number) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);

const CONTACT_ICON = { phone: <Phone size={14} />, email: <Mail size={14} />, address: <MapPin size={14} />, web: <MessageCircle size={14} />, messenger: <MessageCircle size={14} /> };
const contactHref = (kind: string, v: string) =>
  kind === 'phone' ? `tel:${v.replace(/\s/g, '')}` : kind === 'email' ? `mailto:${v}` : kind === 'address' ? `https://maps.apple.com/?q=${encodeURIComponent(v)}` : kind === 'web' ? v : undefined;

function EverydayTab({ f, tree, p, details }: { f: Family; tree: string; p: GPerson; details: DetailState }) {
  const detail = details.detail;
  const qc = useQueryClient();
  const canContact = useCan('edit-contact');
  const canEdit = useCan('edit-person');
  const [kind, setKind] = useState<'phone' | 'email' | 'address' | 'messenger'>('phone');
  const [value, setValue] = useState('');
  // One key per attempt: a retry after a lost answer never adds the contact twice.
  const [keys] = useState(opKeys);
  const add = useMutation({
    mutationFn: () => {
      const data = { tree, person: p.id, kind, value: value.trim() };
      return addContact({ data: { ...data, opKey: keys.for('contact', data) } });
    },
    onSuccess: () => { keys.clear('contact'); setValue(''); qc.invalidateQueries({ queryKey: ['person', tree, p.id] }); qc.invalidateQueries({ queryKey: ['contacts', tree] }); qc.invalidateQueries({ queryKey: ['graph', tree] }); },
  });
  const del = useMutation({
    mutationFn: (cid: number) => deleteContact({ data: { tree, id: cid } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['person', tree, p.id] }); qc.invalidateQueries({ queryKey: ['contacts', tree] }); },
  });

  const bday = p.born ? nextOccurrence(p.born) : undefined;
  const anniversaries = (f.unionsOf.get(p.id) ?? [])
    .filter((u) => u.kind === 'marriage' && u.start && !u.end)
    .map((u) => ({ u, next: nextOccurrence(u.start!), other: f.byId.get(u.a === p.id ? u.b : u.a) }))
    .filter((x) => x.next && x.other?.living);

  if (!detail) return <DetailFallback details={details} />;
  if (!p.living) {
    const died = p.died ? nextOccurrence(p.died) : undefined;
    return (
      <div className="pp-facts">
        <Fact icon={<Cake size={15} />} label="Born">{fmtDate(p.born) ?? 'unknown'}{detail?.bornPlace && <> in <PlaceLink tree={tree} name={detail.bornPlace} /></>}</Fact>
        <Fact icon={<span>✝</span>} label="Died">{fmtDate(p.died) ?? 'unknown'}{detail?.diedPlace && <> in <PlaceLink tree={tree} name={detail.diedPlace} /></>}{age(p) !== undefined && <span className="muted"> · aged {age(p)}</span>}</Fact>
        {died && daysUntil(died) < 60 && <Fact icon={<Heart size={15} />} label="Remembrance">{inDays(daysUntil(died))}</Fact>}
        {p.occupation && <Fact icon={<Pencil size={15} />} label="Occupation">{p.occupation}</Fact>}
        {(f.unionsOf.get(p.id) ?? []).map((u) => {
          const o = f.byId.get(u.a === p.id ? u.b : u.a);
          return o ? <Fact key={u.id} icon={<Heart size={15} />} label={u.kind === 'marriage' ? 'Married' : 'Partner'}>{displayName(o, f)}{u.start && <> · {fmtDate(u.start)}</>}{u.place && <> · {u.place}</>}{u.endReason && u.endReason !== 'death' && <span className="muted"> ({u.endReason})</span>}</Fact> : null;
        })}
      </div>
    );
  }

  return (
    <div className="pp-facts">
      {bday ? (
        <div className="pp-countdown ui-card">
          <Cake size={20} />
          <div>
            <b>Birthday {inDays(daysUntil(bday))}</b>
            <div className="muted">{bday.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} · turns {(ageAt(p.born) ?? 0) + 1}</div>
          </div>
        </div>
      ) : (
        <Fact icon={<Cake size={15} />} label="Born">{fmtDate(p.born) ?? (canEdit ? 'unknown, add it in Edit' : 'unknown')}</Fact>
      )}
      {anniversaries.map(({ u, next, other }) => (
        <div className="pp-countdown ui-card" key={u.id}>
          <Heart size={20} />
          <div>
            <b>Anniversary with {other!.given} {inDays(daysUntil(next!))}</b>
            <div className="muted">{next!.getFullYear() - yearOf(u.start)} years · married {fmtDate(u.start)}</div>
          </div>
        </div>
      ))}
      {p.nickname && <Fact icon={<UserRound size={15} />} label="Called">{p.nickname}</Fact>}
      {detail?.bornPlace && <Fact icon={<MapPin size={15} />} label="Born in"><PlaceLink tree={tree} name={detail.bornPlace} /></Fact>}
      {p.occupation && <Fact icon={<Pencil size={15} />} label="Does">{p.occupation}</Fact>}
      {(detail?.favourite || canEdit) && <Fact icon={<Gift size={15} />} label="Likes">{detail?.favourite ?? <span className="subtle">Gift ideas, favourite food, music… add them in Edit</span>}</Fact>}

      <div className="rule">Reach {p.given}</div>
      {detail?.contacts.map((c) => (
        <div key={c.id} className="pp-contact">
          {CONTACT_ICON[c.kind]}
          {contactHref(c.kind, c.value) ? <a href={contactHref(c.kind, c.value)} target={c.kind === 'address' ? '_blank' : undefined} rel="noreferrer">{c.value}</a> : <span>{c.value}</span>}
          {c.label && <span className="chip">{c.label}</span>}
          {canContact && <button className="btn icon ghost" aria-label="Remove contact" title="Remove contact" onClick={() => del.mutate(c.id)}><Trash2 size={13} /></button>}
        </div>
      ))}
      {!canContact ? (
        detail && !detail.contacts.length ? <p className="pp-ask subtle">No contact details yet. Ask an editor to add them.</p> : null
      ) : <form className="pp-contact-add" onSubmit={(e) => { e.preventDefault(); value.trim() && add.mutate(); }}>
        <Select aria-label="Contact kind" value={kind} onChange={setKind} options={(['phone', 'email', 'address', 'messenger'] as const).map((value) => ({value, label: value[0].toUpperCase() + value.slice(1)}))} />
        <input aria-label="Contact details" className="input" value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === 'address' ? 'Street, town' : kind === 'email' ? 'name@example.com' : '+49 …'} />
        <button aria-label="Add contact" className="btn" disabled={!value.trim() || add.isPending}><Plus size={14} /></button>
      </form>}
    </div>
  );
}

/** A place name that opens the Atlas there. */
function PlaceLink({ tree, name }: { tree: string; name: string }) {
  return <Link to="/$tree/atlas" params={{ tree }} search={{ place: name }} className="pp-place">{name}</Link>;
}

function Fact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="fact">
      <span className="fact-icon">{icon}</span>
      <span className="fact-label">{label}</span>
      <span className="fact-value">{children}</span>
    </div>
  );
}

// ---------- edit ----------

function EditTab({ tree, p, detail, done, onRemoved }: { tree: string; p: GPerson; detail: PersonDetail; done: () => void; onRemoved: () => void }) {
  const { leave } = useContext(DraftContext);
  const canRemove = useCan('remove-person');
  const medieval = tree === 'realm' || (!!p.born && yearOf(p.born) < 1500);
  const qc = useQueryClient();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [keys] = useState(opKeys);
  const remove = useMutation({
    mutationFn: () => removePerson({ data: { tree, id: p.id } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['graph', tree] });
      onRemoved();
    },
  });
  const form = useForm({
    defaultValues: {
      given: p.given, surname: p.surname ?? '', nickname: p.nickname ?? '', sex: (p.sex ?? '') as '' | 'm' | 'f' | 'x',
      born: p.born ?? '', bornPlace: placeValue(detail.bornPlace), died: p.died ?? '', diedPlace: placeValue(detail.diedPlace), living: p.living,
      title: p.title ?? '', epithet: p.epithet ?? '', occupation: p.occupation ?? '', favourite: detail.favourite ?? '', bio: detail.bio ?? '',
    },
    onSubmit: async ({ value }) => {
      setSaveError(null);
      try {
        // Pins first: repeating them on a retry changes nothing, and the Atlas has them as soon as the person points there.
        await savePlacesKeyed(tree, (pl) => keys.for('places', pl), value.bornPlace, value.living ? undefined : value.diedPlace);
        await updatePerson({ data: { tree, id: p.id, patch: { ...value, bornPlace: value.bornPlace.name, diedPlace: value.diedPlace.name, sex: value.sex || null } } });
        await Promise.all([qc.invalidateQueries({ queryKey: ['graph', tree] }), qc.invalidateQueries({ queryKey: ['person', tree, p.id] })]);
        form.reset(value);
        done();
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : 'Could not save');
      }
    },
  });
  const date = ({ value }: { value: string }) => (value === '' || validDate(value.trim()) ? undefined : 'Enter a year, year-month or year-month-day; use ~ for an approximate year');
  const text = (name: any, label: string, opts: { placeholder?: string; validate?: typeof date; wide?: boolean } = {}) => (
    <form.Field name={name} validators={opts.validate ? { onChange: opts.validate } : undefined}>
      {(field: any) => (
        <label className={`field${opts.wide ? ' wide' : ''}`}>
          <span>{label}</span>
          <input aria-invalid={!!field.state.meta.errors.length} aria-describedby={`edit-${name}-error`} className="input" value={field.state.value} placeholder={opts.placeholder} onChange={(e) => field.handleChange(e.target.value)} />
          {field.state.meta.errors.length ? <em id={`edit-${name}-error`} className="err">{field.state.meta.errors[0]}</em> : null}
        </label>
      )}
    </form.Field>
  );
  const place = (name: 'bornPlace' | 'diedPlace', label: string) => (
    <form.Field name={name}>
      {(field) => (
        <div className="field">
          <span id={`edit-${name}-label`}>{label}</span>
          <PlaceInput tree={tree} value={field.state.value} onChange={(v: PlaceValue) => field.handleChange(v)} aria-labelledby={`edit-${name}-label`} />
        </div>
      )}
    </form.Field>
  );
  return (
    <form className="pp-edit" onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }}>
      <DraftTracker form={form} />
      {text('given', 'Given name')}
      {text('surname', 'Surname at birth')}
      {text('nickname', 'Called', { placeholder: medieval ? 'A familiar name or byname' : 'Ellie, Grandpa Joe' })}
      <form.Field name="sex">
        {(field) => (
          <label className="field">
            <span>Sex</span>
            <Select aria-label="Sex" value={field.state.value} onChange={(v) => field.handleChange(v)} options={[{value: '', label: 'Unknown'}, {value: 'f', label: 'Female'}, {value: 'm', label: 'Male'}, {value: 'x', label: 'Other'}]} />
          </label>
        )}
      </form.Field>
      <div className="wide pi-pair">
        {text('born', 'Born', { placeholder: medieval ? '1120 or ~1120' : '1953 or 1953-08-08', validate: date })}
        {place('bornPlace', 'Birthplace')}
      </div>
      <form.Field name="living">
        {(field) => (
          <label className="field check wide">
            <Switch checked={field.state.value} onChange={(v) => field.handleChange(v)}>Living</Switch>
          </label>
        )}
      </form.Field>
      <form.Subscribe selector={(s) => s.values.living}>
        {(living) => (living ? null : <div className="wide pi-pair">{text('died', 'Died', { validate: date })}{place('diedPlace', 'Place of death')}</div>)}
      </form.Subscribe>
      {text('title', 'Title', { placeholder: medieval ? 'Duchess of Brennac' : 'Title, if any' })}
      {text('epithet', 'Epithet', { placeholder: 'the Bold' })}
      {text('occupation', 'Occupation', { wide: true })}
      {text('favourite', 'Likes & gift ideas', { wide: true, placeholder: medieval ? 'Honey cakes, falconry, music' : 'Liquorice, music, sailing' })}
      <form.Field name="bio">
        {(field) => (
          <label className="field wide">
            <span>Biography <small className="subtle">Markdown supported</small></span>
            <textarea className="input" rows={6} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
          </label>
        )}
      </form.Field>
      {saveError && <em role="alert" className="err wide">{saveError}</em>}
      <div className="row end wide">
        {canRemove && (
          <button
            type="button"
            className="btn ghost danger"
            disabled={remove.isPending}
            onClick={() => confirm(`Remove ${p.given} from the tree? Their family links, stories, contacts and photo go too.`) && remove.mutate()}
          >
            <Trash2 size={14} /> Remove from tree
          </button>
        )}
        <span className="spacer" />
        <button type="button" className="btn ghost" onClick={() => leave(done)}>Cancel</button>
        <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting] as const}>
          {([ok, busy]) => <button className="btn primary" disabled={!ok || busy}><Check size={14} /> Save</button>}
        </form.Subscribe>
      </div>
    </form>
  );
}

