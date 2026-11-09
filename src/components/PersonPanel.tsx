// The character window: who this is, how they're yours, their life at a glance (the Overview), their
// family, what the family remembers about them, and the everyday things (birthday, how to reach them).
import { useForm } from '@tanstack/react-form';
import { Link, useBlocker } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { geoMercator, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import {
  Baby, BriefcaseBusiness, Cake, CalendarOff, Camera, Check, ChevronDown, CookingPot, Crosshair, Crown, GitFork, Heart, HeartCrack, Mail, MapPin, Maximize2, MessagesSquare, Network, Pencil,
  Paintbrush, Phone, Plus, Quote, Route as RouteIcon, Sparkles, StickyNote, Trash2, Unlink, UserRound, X,
} from 'lucide-react';
import { feature, mesh } from 'topojson-client';
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type InputHTMLAttributes, type ReactNode } from 'react';
import { addStory, deleteStory, newOpKey, opKeys, setPartnershipEnd, uploadPhoto, unlinkRelative } from '~/lib/api';
import { addPersonField, deletePersonField, personDetailQuery, setLook } from '~/lib/person.functions';
import { kinshipLabel, locales, ordinal, translateMessage, useT, type Key, type Translator } from '~/lib/i18n';
import { occupationText } from '~/lib/occupations';
import { translateOccupation } from '~/lib/occupations.functions';
import { useAiStatus } from './assistant/store';
import { HeadOfHouse } from '~/lib/houses';
import {
  ageAt, age, children, displayName, fmtDate, fullName, kinship, lifespan, parents, partnersOf, personDisplayName, siblings, useNameMode, yearOf, type Family,
} from '~/lib/graph';
import { setPref, usePref } from '~/lib/prefs';
import { closestFamily, FOLD_KEYS, FOLD_PREF, lifeGlance, openFolds, partitionSoon, PROFILE_FOLD_PREF, toggleFold, type CloseRelative, type FoldKey, type GlanceItem } from '~/lib/person-overview';
import { meaningLine } from '~/lib/house-meaning';
import { houseMeaningsQuery, houseTranslationsQuery } from '~/lib/house-meaning.functions';
import { translateSaved } from '~/lib/house-translation';
import { personPhotosQuery } from '~/lib/photos.functions';
import { personResearchQuery } from '~/lib/research.functions';
import { mayPaintPerson } from '~/lib/ai/portrait-rules';
import { ageOn, widowedOn, type Age } from '~/lib/life';
import { chooseMe } from '~/lib/family';
import { useToday } from '~/lib/clock';
import { can, type Role } from '~/lib/roles';
import { useCan, useMembership, useRole, useSession } from '~/lib/session';
import type { GPerson, House, Look, PersonDetail, PersonField, Place, Story } from '~/lib/types';
import { TRAITS } from '~/lib/traits';
import { GAP_ACTION, GAP_LABEL, GAP_WHERE, gapsOf, useRequired, type GapKey } from '~/lib/gaps';
import { renderMarkdown } from '~/lib/markdown';
import { GameIcon } from './GameIcon';
import { Arms } from './Heraldry';
import { Portrait } from './Portrait';
import { DatePicker, Dialog, ErrorState, Segmented, Skeleton, Tabs, TabList, Tab as UiTab, TabPanel, Select, isOverlayOpen } from './ui';
import { QuickAdd } from './QuickAdd';
import type { AddRelation } from './Card';
import { DraftContext, DraftTracker, type Draft } from './fields/draft';
import { PersonEdit } from './fields/PersonEdit';
import { CharacterEditor } from './CharacterEditor';
import { PersonPhotos } from './photos/PersonPhotos';
import { PortraitZoom } from './photos/PortraitZoom';
import { mediaUrl } from './photos/types';
import { PersonResearch } from './research/PersonResearch';
import { ContactRow, FieldGroups, contactHref, contactsOf } from './fields/FieldsView';
import { RemoveOwnField, VisibilityMark } from './fields/VisibilityMark';
import { AddressFinder } from './fields/AddressFinder';
import { formatAddress, parseAddress, type AddressParts } from '~/lib/address';
import { DEFAULT_LABEL, defaultVisibility, fieldIssue, fieldText, type IssueCode } from './fields/model';
import './panel.css';
import './profile.css';

type Tab = 'overview' | 'family' | 'stories' | 'everyday' | 'edit';

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
  /** The full-page profile instead of the tree's side panel: the same content, laid out for the whole screen. */
  page?: boolean;
  /** The Edit tab was opened: on a phone the sheet around this panel makes room for the fields. */
  onEditOpen?: () => void;
}

/** True inside the full-page profile. */
const PageLayout = createContext(false);

/** The person's details (stories, contacts, places): loading, failed with a retry, or there. */
type DetailState = { detail?: PersonDetail; failed: boolean; retry: () => void };

export function PersonPanel({ family: f, tree, id, me, onSelect, onCenter, onPath, onDynasty, onAncestors, onClose, page = false, onEditOpen }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [add, setAdd] = useState<AddRelation | null>(null);
  const [appearance, setAppearance] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const leave = (next: () => void) => draft?.dirty || draft?.busy ? setPending(() => next) : next();
  const blocker = useBlocker({ shouldBlockFn: () => !!(draft?.dirty || draft?.busy), enableBeforeUnload: !!(draft?.dirty || draft?.busy), withResolver: true });
  const guarded = pending || (blocker.status === 'blocked' ? blocker.proceed : null);
  const keep = () => { setPending(null); blocker.reset?.(); };
  const proceed = () => { setPending(null); guarded?.(); };
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !page && (draft?.dirty || draft?.busy) && !isOverlayOpen()) {
        e.preventDefault(); e.stopImmediatePropagation(); setPending(() => onClose);
      }
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [draft, onClose, page]);
  const p = f.byId.get(id);
  const [tab, setTab] = useState<Tab>('overview');
  // Only when the tab changes: the callback is a new function on every render of the tree.
  useEffect(() => { if (tab === 'edit') onEditOpen?.(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  // The header steps aside. The Overview keeps the full one until its name scrolls out of view; then, and on
  // every other tab, a one-line header (small portrait, name, life dates) holds the top and the tabs stick under it.
  const scroller = useRef<HTMLDivElement>(null);
  const nameEl = useRef<HTMLHeadingElement>(null);
  // What scrolls: the panel's own scroll box; in the phone's sheet that box steps aside (display: contents, tree.css)
  // and the whole panel scrolls, so "Add relative" ends the content instead of taking room at the foot; on the profile, the page.
  const sheet = useSheetLayout();
  const scrollBox = (): Element | null => {
    const el = scroller.current;
    if (!el) return nameEl.current?.closest('.page') ?? null;
    return getComputedStyle(el).display === 'contents' ? el.parentElement : el;
  };
  const [stuck, setStuck] = useState(false);
  const compact = tab !== 'overview';
  // In the panel the one-line header is the real one, pinned; on the profile page it scrolls and the pinned copy takes over.
  const mini = page || !compact;
  useEffect(() => {
    const el = nameEl.current;
    if (!mini || !el || typeof IntersectionObserver === 'undefined') { setStuck(false); return; }
    const root = scrollBox();
    const io = new IntersectionObserver(
      ([e]) => setStuck(!e.isIntersecting && e.boundingClientRect.top < (e.rootBounds?.top ?? 0) + 1),
      { root },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [id, mini, page, sheet]); // eslint-disable-line react-hooks/exhaustive-deps
  // A new tab starts at its top (the panel scrolls as one under the header).
  useEffect(() => { if (!page) scrollBox()?.scrollTo({ top: 0 }); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  // What this reader may do here (the server checks the same; see src/lib/roles.ts).
  const role = useRole();
  const canEdit = can(role, 'edit-person');
  const canAdd = can(role, 'add-person');
  const canPhoto = can(role, 'upload-photo');
  const [required] = useRequired(tree);
  const detailQ = useQuery(personDetailQuery(tree, id));
  const details: DetailState = { detail: detailQ.data, failed: detailQ.isError && !detailQ.data, retry: () => void detailQ.refetch() };
  const detail = detailQ.data;
  const qc = useQueryClient();
  const c = useT();
  const nameMode = useNameMode(tree);
  const t = useT();
  const today = useToday();
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
    // A finished upload's key is spent: the next upload, even of the same file, is a new change.
    onSuccess: () => { photoKeys.clear('photo'); qc.invalidateQueries({ queryKey: ['graph', tree] }); },
  });

  if (!p) return null;
  const house = p.house ? f.house.get(p.house) : undefined;
  const a = age(p, today);
  const fillGap = (g: GapKey) => (g === 'photo' ? photoInput.current?.click() : GAP_WHERE[g] === 'tree' ? onAncestors() : leave(() => setTab(GAP_WHERE[g] as Tab)));
  // The name a person goes by now, and the birth surname when it differs ("née").
  const current = { ...p, given: p.currentGiven ?? p.given, surname: p.currentSurname ?? p.surname };
  const nee = p.currentSurname != null && p.currentSurname !== p.surname && p.surname ? p.surname : undefined;
  const shown = personDisplayName(current, nameMode, f);
  const Heading = page ? 'h1' : 'h2';
  const mode = `${compact ? ' pp-compact' : ''}${tab === 'edit' ? ' pp-editing' : ''}${mini && stuck ? ' pp-stuck' : ''}`;
  // The pinned one-line header. A copy for the eye only: the heading above it is the one that is read out.
  const miniBar = mini && (
    <div className="pp-mini" aria-hidden>
      <div className="pp-mini-bar" onClick={() => scrollBox()?.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })}>
        <Portrait person={p} tree={tree} size={40} frame={false} />
        <span className="pp-mini-id">
          <b>{shown}</b>
          <span>{lifespan(p, t.locale)}</span>
        </span>
      </div>
    </div>
  );
  // Who they are, what there is to read, and the dialogs: a docked column in the tree, a page of their own in the profile.
  // In the panel everything between the header and "Add relative" scrolls as one, so the tree buttons scroll away with the content.
  const shell = (head: ReactNode, extras: ReactNode, tabs: ReactNode, foot: ReactNode, dialogs: ReactNode) => page ? (
    <article className={`person-profile${mode}`} key={id}>
      {miniBar}
      <div className="pf-identity">{head}{extras}</div>
      <div className="pf-main">{tabs}{foot}</div>
      {dialogs}
    </article>
  ) : (
    <aside className={`person-panel panel${mode}`} key={id}>
      <button className="btn icon ghost panel-close" onClick={() => leave(onClose)} aria-label={t('panel.closeAria')} title={t('panel.closeTitle')}><X size={16} /></button>
      <div className="pp-scroll" ref={scroller}>{miniBar}{head}{extras}{tabs}</div>
      {foot}{dialogs}
    </aside>
  );

  return (
    <DraftContext.Provider value={{ register: setDraft, leave }}><PageLayout.Provider value={page}>
    {shell(<>
      <header className="pp-head">
        <span className="pp-portrait-slot">
          <PortraitZoom className="pp-portrait" person={p} tree={tree} size={page ? 320 : 124} />
          {canPhoto && (
            <>
              <button type="button" className="pp-photo" disabled={photo.isPending} aria-label={t('panel.changePortrait')} title={t('panel.changePortrait')} onClick={() => photoInput.current?.click()}><Camera size={14} aria-hidden /></button>
              <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" aria-label={t('panel.portraitImage')} hidden onChange={(e) => e.target.files?.[0] && photo.mutate(e.target.files[0])} />
            </>
          )}
        </span>
        <div className="pp-id">
          <Heading className="display" ref={nameEl}>
            {page ? shown : <Link className="pp-name-link" to="/$tree/person/$id" params={{ tree, id }}>{shown}</Link>}
            {nee && nameMode === 'full' && <span className="pp-nee"> {c('panel.nee', { name: nee })}</span>}
          </Heading>
          {p.title && <div className="pp-title">{p.title}</div>}
          <div className="pp-life">
            {p.living && <span className="pp-living" title={t('panel.living')}>●</span>}
            {lifespan(p, t.locale)}
            {a !== undefined && <span className="muted"> · {p.living ? t('panel.ageLiving', { count: a }) : t('panel.diedAgedLower', { n: a })}</span>}
          </div>
          {house && (
            <Link className="pp-house" to="/$tree/house/$house" params={{ tree, house: house.id }} title={t('panel.openHouse', { name: house.name })}>
              <Arms arms={house.arms} size={22} /> <span>{house.name}</span>
            </Link>
          )}
          {!page && <Link className="pp-open-profile" to="/$tree/person/$id" params={{ tree, id }} title={t('profile.openTitle', { name: shown })}><Maximize2 size={13} aria-hidden /> {t('profile.open')}</Link>}
        </div>
      </header>
    </>, <>
      {photo.isError && <p className="err pp-photo-err" role="alert">{t('panel.photoError')}</p>}

      {p.traits?.length ? (
        <div className="pp-traits">
          {p.traits.map((trait) => {
            const tr = TRAITS[trait];
            const name = tr ? t(tr.label) : trait;
            return (
              <span key={trait} className={`trait ${tr?.kind ?? 'other'}`} title={name}>
                <span className="trait-medal">{tr ? <GameIcon name={tr.icon} size={16} /> : '◆'}</span> {name}
              </span>
            );
          })}
        </div>
      ) : null}

      <div className="pp-actions">
        {page
          ? <button className="btn primary" onClick={onCenter}><Network size={15} aria-hidden /> {t('profile.showInTree')}</button>
          : <button className="btn" onClick={onCenter}><Crosshair size={14} /> {t('panel.centre')}</button>}
        <button className="btn" onClick={onAncestors}><GitFork size={14} style={{ transform: 'rotate(180deg)' }} /> {t('panel.ancestors')}</button>
        <button className="btn" onClick={onDynasty}><Crown size={14} /> {t('panel.dynasty')}</button>
      </div>
    </>, <>
      <Tabs value={tab} onChange={(v) => leave(() => setTab(v as Tab))} label={t('panel.tabsLabel')}>
      <TabList className="pp-tabs">
        {(
          [
            ['overview', t('panel.tab.overview'), undefined],
            ['family', t('panel.tab.family'), relativesCount(f, id)],
            ['stories', t('panel.tab.stories'), detail?.stories.length ?? p.stories],
            ['everyday', p.living ? t('panel.tab.everyday') : t('panel.tab.life'), undefined],
            ['edit', t('panel.tab.edit'), undefined],
          ] as const
        ).filter(([tb]) => tb !== 'edit' || canEdit).map(([tb, label, n]) => (
          <UiTab key={tb} value={tb} title={n ? `${label}: ${n}` : undefined}>
            {label}{n ? <span className="pp-count">{n}</span> : null}
          </UiTab>
        ))}
      </TabList>

      <div className="pp-body">
        <TabPanel value="overview">
          <OverviewTab
            f={f} tree={tree} p={p} me={me} details={details} role={role} gaps={gapsOf(f, p, required)}
            onSelect={(v) => leave(() => onSelect(v))} onPath={onPath} onGap={fillGap} onTab={(tb) => leave(() => setTab(tb))}
          />
        </TabPanel>
        <TabPanel value="family"><FamilyTab f={f} tree={tree} id={id} canAdd={canAdd} canEdit={canEdit} onSelect={(v) => leave(() => onSelect(v))} /></TabPanel>
        <TabPanel value="stories"><StoriesTab tree={tree} p={p} details={details} /></TabPanel>
        <TabPanel value="everyday"><EverydayTab f={f} tree={tree} p={p} details={details} canEdit={canEdit} onSelect={(v) => leave(() => onSelect(v))} /></TabPanel>
        <TabPanel value="edit">
          {canEdit && (
            <button type="button" className="pp-appearance" onClick={() => setAppearance(true)} aria-haspopup="dialog">
              <Paintbrush size={18} aria-hidden />
              <span><b>{t('panel.appearance')}</b><small>{t('panel.appearance_hint')}</small></span>
            </button>
          )}
          {canEdit && (detail ? <PersonEdit tree={tree} p={p} f={f} detail={detail} done={() => setTab('overview')} onRemoved={onClose} /> : <DetailFallback details={details} />)}
        </TabPanel>
      </div></Tabs>
    </>, <>
      {canAdd ? (
        <div className="pp-add-relative"><Select aria-label={t('panel.addRelative')} placeholder={t('panel.addRelative')} value="" onChange={(v) => { if (v) leave(() => setAdd(v as AddRelation)); }} options={(['parent', 'partner', 'child', 'sibling'] as const).map((v) => ({ value: v, label: t(`card.add${v[0].toUpperCase()}${v.slice(1)}` as Key) }))} /></div>
      ) : (
        <p className="pp-add-relative pp-ask subtle">{c('ask.editor')}</p>
      )}
    </>, <>
      {add && canAdd && <QuickAdd family={f} tree={tree} anchor={id} relation={add} onCancel={() => setAdd(null)} onDone={() => setAdd(null)} />}
      <Dialog open={!!guarded} onClose={keep} title={t('panel.unsavedTitle')} dismissible={!savingDraft && !draft?.busy} footer={<>
        <button className="btn ghost" disabled={savingDraft || draft?.busy} onClick={keep}>{t('panel.keepEditing')}</button>
        <button className="btn" disabled={savingDraft || draft?.busy} onClick={() => { draft?.discard?.(); proceed(); }}>{t('panel.discard')}</button>
        <button className="btn primary" disabled={savingDraft || draft?.busy} onClick={async () => { setSavingDraft(true); try { if (await draft?.save()) proceed(); } finally { setSavingDraft(false); } }}>{t('panel.save')}</button>
      </>}><p>{t('panel.unsavedBody')}</p></Dialog>
      {appearance && canEdit && <AppearanceDialog tree={tree} p={p} house={house ?? null} onClose={() => setAppearance(false)} />}
    </>)}
    </PageLayout.Provider></DraftContext.Provider>
  );
}

/** True while the tree shows this panel as a bottom sheet (phones and narrow tablets, as tree.css lays it out). */
function useSheetLayout(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = matchMedia('(max-width: 900px)');
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => matchMedia('(max-width: 900px)').matches,
    () => false,
  );
}

/**
 * The Edit tab's "Appearance": the character editor in a dialog. Its value is saved only on Save; closing with
 * changes asks first (the dialog's dirty guard). The save is retried with the same key until it lands.
 */
function AppearanceDialog({ tree, p, house, onClose }: { tree: string; p: GPerson; house: House | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Look | undefined>(p.look);
  const [keys] = useState(opKeys);
  const dirty = JSON.stringify(draft ?? null) !== JSON.stringify(p.look ?? null);
  const save = useMutation({
    mutationFn: () => setLook({ data: { tree, id: p.id, look: draft!, opKey: keys.for('look', [p.id, draft]) } }),
    onSuccess: async () => {
      keys.clear('look');
      await qc.invalidateQueries({ queryKey: ['person', tree, p.id] });
      await qc.invalidateQueries({ queryKey: ['graph', tree] });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('panel.appearance_title', { name: p.given })}
      dirty={dirty}
      width={880}
      dismissible={!save.isPending}
      footer={<button className="btn primary" onClick={() => save.mutate()} disabled={!dirty || !draft || save.isPending}>{t('panel.appearance_save')}</button>}
    >
      <CharacterEditor person={p} tree={tree} house={house} value={draft} onChange={setDraft} />
      {save.isError && <p className="err" role="alert">{t('panel.appearance_failed')}</p>}
    </Dialog>
  );
}

/** While the person's details load, a skeleton; when they failed, the error with Retry. Never a blank tab. */
function DetailFallback({ details, lines = 4 }: { details: DetailState; lines?: number }) {
  const t = useT();
  if (details.failed) return <ErrorState className="pp-error" title={t('panel.detailsFailedTitle')} message={t('panel.detailsFailedText')} onRetry={details.retry} />;
  return <div className="pp-loading" aria-busy="true"><span className="sr-only">{t('ui.loading')}</span><Skeleton lines={lines} height={16} /></div>;
}

function relativesCount(f: Family, id: string) {
  return parents(f, id).length + partnersOf(f, id).length + children(f, id).length + siblings(f, id).length;
}

// ---------- overview ----------

/** A position in figures, "2nd" and not "Second", so a glance tile stays on one line. German and Afrikaans already write figures. */
function shortOrdinal(n: number, locale: Parameters<typeof ordinal>[1]): string {
  if (locale !== 'en' && locale !== undefined) return ordinal(n, locale);
  const tens = n % 100;
  return `${n}${tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
}

/** The profile at a glance: how they're yours, the key facts, their life, places, words and what's missing. */
function OverviewTab({ f, tree, p, me, details, role, gaps, onSelect, onPath, onGap, onTab }: {
  f: Family; tree: string; p: GPerson; me: string | null; details: DetailState; role: Role; gaps: GapKey[];
  onSelect: (id: string) => void; onPath: () => void; onGap: (g: GapKey) => void; onTab: (t: Tab) => void;
}) {
  const detail = details.detail;
  const qc = useQueryClient();
  const k = useMemo(() => (me && me !== p.id ? kinship(f, me, p.id) : undefined), [f, me, p.id]);
  const house = p.house ? f.house.get(p.house) : undefined;
  const today = useToday();
  const unions = f.unionsOf.get(p.id) ?? [];
  const bornPlace = detail?.bornPlace ?? p.bornPlace;
  const diedPlace = detail?.diedPlace ?? p.diedPlace;
  // The newest story first (the server sorts them): one up front, the rest a click away.
  const latest = (detail?.stories ?? []).find((s) => s.kind !== 'recipe' && s.kind !== 'note');
  const c = useT();
  const { soon, later } = partitionSoon(p.living && today ? upcomingDates(f, p, today, c) : [], (d) => d.days);
  const wide = useContext(PageLayout);

  const lead = (
    <>
      <HeadOfHouse person={p.id} />
      <section className="pp-kin" aria-label={c('panel.howRelated')}>
        {!me ? (
          <span className="muted">{c('panel.sayWho')}</span>
        ) : me === p.id ? (
          <span className="pp-you"><UserRound size={14} /> {c('panel.thisIsYou')}</span>
        ) : k ? (
          <span>{c('panel.yourWord')} <b>{kinshipLabel(k, c.locale)}</b></span>
        ) : (
          <span className="muted">{c('panel.notRelated')}</span>
        )}
        <span className="spacer" />
        {me !== p.id && k && <button className="btn ghost" onClick={onPath} title={c('panel.howTitle')}><RouteIcon size={14} /> {c('panel.how')}</button>}
        {!me ? (
          <button className="btn ghost" onClick={() => void chooseMe(tree, p.id).then(() => qc.invalidateQueries({ queryKey: ['session'] }))} title={c('panel.thisIsMeTitle')}>{c('panel.thisIsMe')}</button>
        ) : me !== p.id && <button className="btn ghost" onClick={() => setPref(`me:${tree}`, p.id)} title={c('panel.beThemTitle')}>{c('panel.beThem')}</button>}
      </section>

      <LifeGlance f={f} p={p} today={today} />

      <div className="pp-facts pp-keyfacts">
        {(p.born || bornPlace) && (
          <Fact icon={<Cake size={15} />} label={c('fact.born')}>
            {fmtDate(p.born, locales[c.locale]) ?? c('panel.dateUnknown')}{bornPlace && <> {c('fact.in')} <PlaceLink tree={tree} name={bornPlace} /></>}
          </Fact>
        )}
        {!p.living && (p.died || diedPlace) && (
          <Fact icon={<span aria-hidden>✝</span>} label={c('fact.died')}>
            {fmtDate(p.died, locales[c.locale]) ?? c('panel.dateUnknown')}{diedPlace && <> {c('fact.in')} <PlaceLink tree={tree} name={diedPlace} /></>}
          </Fact>
        )}
        <OccupationFact tree={tree} p={p} icon={<BriefcaseBusiness size={15} />} label={c('fact.occupation')} />
        {p.furtherGiven?.length ? <Fact icon={<UserRound size={15} />} label={c('fact.fullName')}>{fullName(p)}</Fact> : null}
        {p.nickname && <Fact icon={<UserRound size={15} />} label={c('fact.called')}>{p.nickname}</Fact>}
      </div>

      {soon.length > 0 && <div className="pp-upcoming">{soon.map((d) => d.card)}</div>}
      {p.living && detail && <ContactActions p={p} detail={detail} onMore={() => onTab('everyday')} />}

      <ClosestFamily f={f} tree={tree} id={p.id} onSelect={onSelect} onAll={() => onTab('family')} />

      {details.failed ? (
        <DetailFallback details={details} lines={2} />
      ) : !detail ? (
        p.stories > 0 && <DetailFallback details={details} lines={2} />
      ) : latest && (
        <section className="pp-ov-section">
          <div className="rule">{c('panel.wordsRule')}</div>
          <div className="pp-stories">
            <StoryCard s={latest} compact />
            {detail.stories.length > 1 && <button className="btn ghost pp-more" onClick={() => onTab('stories')}>{c('panel.allStories', { count: detail.stories.length })}</button>}
          </div>
        </section>
      )}

      {house && <HouseSection tree={tree} house={house} />}
    </>
  );

  return (
    <div className="pp-overview">
      {wide ? <div className="pp-ov-main">{lead}</div> : lead}
      <div className="pp-folds">
        <LifeTimeline f={f} tree={tree} p={p} onSelect={onSelect} />
        <PlacesMap f={f} tree={tree} p={p} bornPlace={bornPlace} diedPlace={diedPlace} unions={unions} />
        <PhotosFold tree={tree} p={p} role={role} />
        <ResearchFold tree={tree} id={p.id} />
        {later.length > 0 && (
          <Fold id="dates" title={c('panel.ov_dates')} hint={inDays(later[0].days, c)}>
            <div className="pp-upcoming">{later.map((d) => d.card)}</div>
          </Fold>
        )}
        {gaps.length > 0 && (
          <Fold id="missing" title={c('panel.gapsTitle')} hint={String(gaps.length)}>
            <div className="pp-gaps pp-gaps-bare">
              <div>
                {gaps.map((g) =>
                  // Only the gaps this reader may fill in are buttons; the rest are just listed.
                  !can(role, GAP_ACTION[g]) ? (
                    <span key={g} className="chip">{c(GAP_LABEL[g])}</span>
                  ) : (
                    <button key={g} className="chip" onClick={() => onGap(g)} title={g === 'photo' ? c('panel.gapPhoto') : GAP_WHERE[g] === 'tree' ? c('panel.gapTree') : c('panel.gapFill')}>
                      <Plus size={12} aria-hidden /> {c(GAP_LABEL[g])}
                    </button>
                  ),
                )}
              </div>
            </div>
          </Fold>
        )}
      </div>
    </div>
  );
}

/** Which Overview sections are open here, and how to change that. The panel and the profile each remember their own. */
function useFolds() {
  const wide = useContext(PageLayout);
  const pref = wide ? PROFILE_FOLD_PREF : FOLD_PREF;
  const open = openFolds(usePref(pref), wide ? FOLD_KEYS : undefined);
  return { open, toggle: (id: FoldKey) => setPref(pref, JSON.stringify(toggleFold(open, id))) };
}

/** A section of the Overview that can be folded away. Which ones are open is kept in this browser, for everyone it shows. */
function Fold({ id, title, hint, peek, children }: { id: FoldKey; title: string; hint?: string; peek?: ReactNode; children: ReactNode }) {
  const { open, toggle } = useFolds();
  const isOpen = open.includes(id);
  const bodyId = useId();
  return (
    <section className="pp-fold">
      <button type="button" className="pp-fold-head" aria-expanded={isOpen} aria-controls={bodyId} onClick={() => toggle(id)}>
        <span className="pp-fold-title">{title}</span>
        {hint && <span className="pp-fold-hint">{hint}</span>}
        <ChevronDown size={16} className="pp-fold-chevron" aria-hidden />
        {!isOpen && peek && <span className="pp-fold-peek" aria-hidden>{peek}</span>}
      </button>
      <div id={bodyId} className="pp-fold-body" hidden={!isOpen}>{isOpen && children}</div>
    </section>
  );
}

const GLANCE_MAX = 4;

/** The few numbers that sum up a life. Nothing at all when the family hasn't recorded any. */
function LifeGlance({ f, p, today }: { f: Family; p: GPerson; today?: Date }) {
  const c = useT();
  const items = useMemo(() => lifeGlance(f, p, today).slice(0, GLANCE_MAX), [f, p, today]);
  if (!items.length) return null;
  const tile = (i: GlanceItem): [string, string] => {
    switch (i.key) {
      case 'together': return [c(i.married ? 'panel.ov_married' : 'panel.ov_together'), c(i.approx ? 'panel.ov_years_about' : 'panel.ov_years', { count: i.years })];
      case 'order': return [c('panel.ov_order'), c('panel.ov_order_value', { pos: shortOrdinal(i.position, c.locale), total: i.of })];
      case 'children': return [c('rel.children'), String(i.n)];
      case 'siblings': return [c('rel.siblings'), String(i.n)];
      case 'grandchildren': return [c('panel.ov_grandchildren'), String(i.n)];
      case 'descendants': return [c('panel.ov_descendants'), String(i.n)];
    }
  };
  return (
    <dl className="pp-glance" data-n={items.length} aria-label={c('panel.ov_glance')}>
      {items.map((i) => {
        const [label, value] = tile(i);
        return <div key={i.key} className="pp-glance-tile"><dd style={{ '--len': value.length } as CSSProperties}>{value}</dd><dt>{label}</dt></div>;
      })}
    </dl>
  );
}

const REL_WORD: Record<CloseRelative['kind'], Record<'m' | 'f' | 'x', Key>> = {
  parent: { m: 'panel.ov_rel_father', f: 'panel.ov_rel_mother', x: 'panel.ov_rel_parent' },
  child: { m: 'panel.ov_rel_son', f: 'panel.ov_rel_daughter', x: 'panel.ov_rel_child' },
  sibling: { m: 'panel.ov_rel_brother', f: 'panel.ov_rel_sister', x: 'panel.ov_rel_sibling' },
  partner: { m: 'panel.ov_rel_husband', f: 'panel.ov_rel_wife', x: 'panel.ov_rel_spouse' },
};

const CLOSEST_MAX = 8;

/** The nearest people as a row of faces. The whole family, and how to change it, is on the Family tab. */
function ClosestFamily({ f, tree, id, onSelect, onAll }: { f: Family; tree: string; id: string; onSelect: (id: string) => void; onAll: () => void }) {
  const c = useT();
  const { shown, more } = useMemo(() => closestFamily(f, id, CLOSEST_MAX), [f, id]);
  if (!shown.length) return null;
  const word = (r: CloseRelative, sex: GPerson['sex']): string => {
    if (r.kind === 'partner' && !r.married) return c('panel.ov_rel_partner');
    return c(REL_WORD[r.kind][r.neutral || (sex !== 'm' && sex !== 'f') ? 'x' : sex]);
  };
  return (
    <section className="pp-ov-section">
      <div className="rule">{c('panel.ov_closest')}</div>
      <div className="pp-grid pp-closest">
        {shown.map((r) => {
          const rp = f.byId.get(r.id)!;
          return (
            <button key={r.id} type="button" className="pp-rel" onClick={() => onSelect(r.id)} title={`${displayName(rp, f)} · ${lifespan(rp, c.locale)}`}>
              <Portrait person={rp} tree={tree} size={52} frame />
              <span className="pp-rel-name">{rp.given}</span>
              <span className="pp-rel-sub">{word(r, rp.sex)}</span>
            </button>
          );
        })}
      </div>
      {more > 0 && <button type="button" className="btn ghost pp-more" onClick={onAll}>{c('panel.ov_all_family', { count: shown.length + more })}</button>}
    </section>
  );
}

/** Their house as a card that opens its page: the arms, the motto, and what the name means once a steward has chosen that. */
function HouseSection({ tree, house }: { tree: string; house: House }) {
  const c = useT();
  const meanings = useQuery(houseMeaningsQuery(tree));
  const translations = useQuery(houseTranslationsQuery(tree, c.locale));
  const saved = meanings.data?.[house.id];
  // A steward's copy also holds the origins nobody chose; meaningLine reads only the chosen ones, so every reader gets the same line.
  const meaning = saved ? meaningLine(translateSaved(saved, translations.data?.meanings[house.id])) : '';
  return (
    <section className="pp-ov-section">
      <div className="rule">{c('panel.houseRule')}</div>
      <Link className="pp-house-card ui-card interactive" to="/$tree/house/$house" params={{ tree, house: house.id }}>
        <Arms arms={house.arms} size={40} />
        <span>
          <b>{house.name}</b>
          {house.motto && <i>“{house.motto}”</i>}
          {meaning && <small className="pp-house-meaning">{c('panel.ov_name_meaning', { meaning })}</small>}
        </span>
      </Link>
    </section>
  );
}

/** Their photographs and portraits. Gone for a reader with nothing to see and nothing they could do here. */
function PhotosFold({ tree, p, role }: { tree: string; p: GPerson; role: Role }) {
  const c = useT();
  const membership = useMembership(tree);
  const photos = useQuery(personPhotosQuery(tree, p.id)).data ?? [];
  if (!photos.length && !p.photo && !p.portrait && !can(role, 'edit-person') && !mayPaintPerson(membership, p.id)) return null;
  const hint = photos.length ? c('panel.ov_photos_count', { count: photos.length }) : p.photo || p.portrait ? undefined : c('panel.ov_photos_none');
  return (
    <Fold id="photos" title={c('panel.ov_photos')} hint={hint} peek={photos.length ? photos.slice(0, 5).map((m) => <img key={m.key} src={mediaUrl(tree, m.key)} alt="" loading="lazy" decoding="async" />) : undefined}>
      <PersonPhotos tree={tree} id={p.id} bare />
    </Fold>
  );
}

/** The research projects that name them, as far as this reader may see them. */
function ResearchFold({ tree, id }: { tree: string; id: string }) {
  const c = useT();
  const n = useQuery(personResearchQuery(tree, id)).data?.length ?? 0;
  if (!n) return null;
  return <Fold id="research" title={c('research.panel_title')} hint={c('panel.ov_projects', { count: n })}><PersonResearch tree={tree} id={id} bare /></Fold>;
}

/** The next birthday and wedding anniversaries as countdown cards, nearest first. */
function upcomingDates(f: Family, p: GPerson, today: Date, c: Translator): { days: number; card: ReactNode }[] {
  const out: { days: number; card: ReactNode }[] = [];
  const bday = p.born ? nextOccurrence(p.born, today) : undefined;
  if (bday) {
    out.push({ days: daysUntil(bday, today), card: (
      <div className="pp-countdown ui-card" key="birthday">
        <Cake size={20} />
        <div>
          <b>{c('fact.birthdayIn', { when: inDays(daysUntil(bday, today), c) })}</b>
          <div className="muted">{bday.toLocaleDateString(locales[c.locale], { weekday: 'long', day: 'numeric', month: 'long' })} · {c('fact.turns', { n: (ageAt(p.born, today) ?? 0) + 1 })}</div>
        </div>
      </div>
    ) });
  }
  for (const u of f.unionsOf.get(p.id) ?? []) {
    const next = u.kind === 'marriage' && u.start && !u.end ? nextOccurrence(u.start, today) : undefined;
    const other = f.byId.get(u.a === p.id ? u.b : u.a);
    if (!next || !other?.living) continue;
    out.push({ days: daysUntil(next, today), card: (
      <div className="pp-countdown ui-card" key={u.id}>
        <Heart size={20} />
        <div>
          <b>{c('fact.anniversaryWith', { name: other.given, when: inDays(daysUntil(next, today), c) })}</b>
          <div className="muted">{c('fact.years', { n: next.getFullYear() - yearOf(u.start) })} · {c('fact.marriedOn', { date: fmtDate(u.start, locales[c.locale]) ?? '' })}</div>
        </div>
      </div>
    ) });
  }
  return out.sort((a, b) => a.days - b.days);
}

/** Call, write or find them: one button per way to reach them. */
function ContactActions({ p, detail, onMore }: { p: GPerson; detail: PersonDetail; onMore: () => void }) {
  const c = useT();
  const list = contactsOf(detail.fields);
  const first = (k: string) => list.find((x) => x.type === k);
  const phone = first('phone'), email = first('email'), address = first('address');
  if (!phone && !email && !address) return null;
  return (
    <div className="pp-reach" role="group" aria-label={c('reach.group', { name: p.given })}>
      {phone && <a className="btn" href={contactHref(phone)}><Phone size={14} /> {c('reach.call')} <VisibilityMark level={phone.visibility} /></a>}
      {email && <a className="btn" href={contactHref(email)}><Mail size={14} /> {c('reach.email')} <VisibilityMark level={email.visibility} /></a>}
      {address && <a className="btn" href={contactHref(address)} target="_blank" rel="noreferrer"><MapPin size={14} /> {c('reach.directions')} <VisibilityMark level={address.visibility} /></a>}
      {list.length > [phone, email, address].filter(Boolean).length && <button className="btn ghost" onClick={onMore}>{c('reach.more')}</button>}
    </div>
  );
}

type LifeEvent = { year: number; date?: string; age?: Age; icon: ReactNode; text: ReactNode; key: string };

/** Birth, partnerships, children's births and death, in order, from the graph. */
function LifeTimeline({ f, tree, p, onSelect }: { f: Family; tree: string; p: GPerson; onSelect: (id: string) => void }) {
  const c = useT();
  const [all, setAll] = useState(false);
  const events = useMemo(() => {
    const out: LifeEvent[] = [];
    if (!isNaN(yearOf(p.born))) out.push({ key: 'born', year: yearOf(p.born), date: p.born, icon: <Cake size={13} />, text: <>{c('fact.born')}{p.bornPlace && <> {c('fact.in')} <PlaceLink tree={tree} name={p.bornPlace} /></>}</> });
    for (const u of f.unionsOf.get(p.id) ?? []) {
      const o = f.byId.get(u.a === p.id ? u.b : u.a);
      if (!o) continue;
      const who = <button className="pp-inline-link" onClick={() => onSelect(o.id)}>{displayName(o, f)}</button>;
      if (!isNaN(yearOf(u.start))) out.push({ key: `u${u.id}`, year: yearOf(u.start), date: u.start, age: ageOn(p.born, u.start), icon: <Heart size={13} />, text: <>{u.kind === 'marriage' ? c('fact.married') : c('panel.partneredWith')} {who}{u.place && <> {c('fact.in')} <PlaceLink tree={tree} name={u.place} /></>}</> });
      if (!isNaN(yearOf(u.end)) && u.endReason !== 'death') out.push({ key: `e${u.id}`, year: yearOf(u.end), date: u.end, age: ageOn(p.born, u.end), icon: <HeartCrack size={13} />, text: <>{u.endReason === 'divorce' ? c('panel.divorced') : c('panel.partedFrom')} {who}</> });
      // A spouse who died while this marriage stood (see widowedOn for when that is not so).
      const died = widowedOn(p, o, u);
      if (died && !isNaN(yearOf(died))) out.push({ key: `w${u.id}`, year: yearOf(died), date: died, age: ageOn(p.born, died), icon: <span aria-hidden>✝</span>, text: u.kind === 'marriage' ? <>{c('panel.widowed')} {who} {c('panel.widowedDied')}</> : <>{c('panel.partnerDied')} {who}</> });
    }
    for (const kidId of children(f, p.id)) {
      const kid = f.byId.get(kidId);
      if (!kid || isNaN(yearOf(kid.born))) continue;
      const word = kid.sex === 'm' ? c('panel.childSon') : kid.sex === 'f' ? c('panel.childDaughter') : c('panel.childAny');
      out.push({ key: `c${kidId}`, year: yearOf(kid.born), date: kid.born, age: ageOn(p.born, kid.born), icon: <Baby size={13} />, text: <>{word}, <button className="pp-inline-link" onClick={() => onSelect(kidId)}>{kid.given}</button>, {c('panel.isBorn')}</> });
    }
    if (!p.living && !isNaN(yearOf(p.died))) out.push({ key: 'died', year: yearOf(p.died), date: p.died, icon: <span aria-hidden>✝</span>, text: <>{c('fact.died')}{p.diedPlace && <> {c('fact.in')} <PlaceLink tree={tree} name={p.diedPlace} /></>}{age(p) !== undefined && <span className="muted">, {c('fact.agedN', { n: age(p)! })}</span>}</> });
    const order = (e: LifeEvent) => (e.key === 'born' ? 0 : e.key === 'died' ? 2 : 1);
    return out.sort((a, b) => a.year - b.year || order(a) - order(b) || (a.date ?? '').localeCompare(b.date ?? ''));
  }, [f, tree, p, onSelect, c]);
  if (events.length < 2) return null;
  const shown = all || events.length <= 8 ? events : [...events.slice(0, 6), events[events.length - 1]];
  return (
    <Fold id="life" title={c('panel.tab.life')} hint={c('panel.ov_moments', { count: events.length })}>
      <ol className="pp-timeline">
        {shown.map((e, i) => (
          <li key={e.key} data-gap={!all && events.length > 8 && i === 6 ? true : undefined}>
            <span className="pp-tl-year">{e.year}{e.age && <span className="pp-tl-age">{e.age.approx ? c('panel.aboutAge', { n: e.age.years }) : c('panel.ageAt', { n: e.age.years })}</span>}</span>
            <span className="pp-tl-dot" aria-hidden>{e.icon}</span>
            <span className="pp-tl-text">{e.text}</span>
          </li>
        ))}
      </ol>
      {!all && events.length > 8 && <button className="btn ghost pp-more" onClick={() => setAll(true)}>{c('panel.showAll', { count: events.length })}</button>}
    </Fold>
  );
}

// The small world map: the 110m countries the Atlas uses too, loaded once.
type MiniWorld = { land: GeoPermissibleObjects; borders: GeoPermissibleObjects };
let miniWorld: Promise<MiniWorld> | null = null;
// Only the browser draws it (in an effect), so the server's bundle leaves the map out.
const loadMiniWorld = () =>
  (miniWorld ??= (import.meta.env.SSR ? new Promise<never>(() => {}) : import('world-atlas/countries-110m.json')).then((m) => {
    const t = ((m as { default?: unknown }).default ?? m) as Parameters<typeof feature>[0] & { objects: { countries: Parameters<typeof feature>[1] } };
    return { land: feature(t, t.objects.countries) as GeoPermissibleObjects, borders: mesh(t, t.objects.countries as never, (x, y) => x !== y) as GeoPermissibleObjects };
  }));

const MAP_W = 360, MAP_H = 170;

/** Where their life happened: birth, partnerships and death on a small map, with the places listed below. */
function PlacesMap({ f, tree, p, bornPlace, diedPlace, unions }: { f: Family; tree: string; p: GPerson; bornPlace?: string; diedPlace?: string; unions: Family['graph']['unions'] }) {
  const c = useT();
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
    push(bornPlace, c('fact.born'));
    for (const u of unions) push(u.place, u.kind === 'marriage' ? c('fact.married') : c('panel.partnership'));
    if (!p.living) push(diedPlace, c('fact.died'));
    return list;
  }, [f, p.living, bornPlace, diedPlace, unions, c]);
  const pinned = places.filter((x) => x.pl);
  const mapOpen = useFolds().open.includes('places');
  useEffect(() => { if (mapOpen && pinned.length) void loadMiniWorld().then(setWorld); }, [mapOpen, pinned.length]);
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
    <Fold id="places" title={c('panel.placesRule')} hint={places.slice(0, 2).map((x) => x.name).join(', ') + (places.length > 2 ? ` +${places.length - 2}` : '')}>
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
            <span className="subtle">{x.what}{x.pl ? '' : ` · ${c('places.notOnMapShort')}`}</span>
          </li>
        ))}
      </ul>
    </Fold>
  );
}

// ---------- family ----------

type RelKind = 'parents' | 'partners' | 'children' | 'siblings' | 'grandparents';

/** The family as links: parents, partners, children, siblings and grandparents. Editors may take out a direct link. */
function FamilyTab({ f, tree, id, canAdd, canEdit, onSelect }: { f: Family; tree: string; id: string; canAdd: boolean; canEdit: boolean; onSelect: (id: string) => void }) {
  const c = useT();
  const qc = useQueryClient();
  const gps = [...new Set(parents(f, id).flatMap((p) => parents(f, p)))];
  const unions = f.unionsOf.get(id) ?? [];
  const groups: [RelKind, string[]][] = [
    ['parents', parents(f, id)],
    ['partners', partnersOf(f, id)],
    ['children', children(f, id)],
    ['siblings', siblings(f, id)],
    ['grandparents', gps],
  ];
  // The link waiting for its second click: "kind:id".
  const [armed, setArmed] = useState<string | null>(null);
  const unlink = useMutation({
    mutationFn: ({ kind, rid }: { kind: RelKind; rid: string }) => {
      if (kind === 'parents') return unlinkRelative({ data: { tree, parents: [{ child: id, parent: rid }] } });
      if (kind === 'children') return unlinkRelative({ data: { tree, parents: [{ child: rid, parent: id }] } });
      // A partnership is removed as one; the parents of their children stay.
      const u = unions.find((x) => x.a === rid || x.b === rid);
      return unlinkRelative({ data: { tree, parents: [], partnership: u?.id } });
    },
    onSuccess: async () => { setArmed(null); await qc.invalidateQueries({ queryKey: ['graph', tree] }); },
  });
  const any = groups.some(([, ids]) => ids.length);
  if (!any) return <p className="empty">{c('family.empty')}{canAdd && <> {c('family.addHint')}</>}</p>;
  return (
    <>
      {groups.map(([kind, ids]) =>
        ids.length ? (
          <section key={kind}>
            <div className="rule">{c(`rel.${kind}`)} <span className="faint">{ids.length}</span></div>
            <div className="pp-grid">
              {ids.map((r) => {
                const rp = f.byId.get(r)!;
                const u = kind === 'partners' ? unions.find((u) => u.a === r || u.b === r) : undefined;
                const key = `${kind}:${r}`;
                const removable = canEdit && kind !== 'siblings' && kind !== 'grandparents';
                return (
                  <div className="pp-rel-cell" key={r}>
                    <button className="pp-rel" onClick={() => onSelect(r)} title={`${displayName(rp, f)} · ${lifespan(rp, c.locale)}`}>
                      <Portrait person={rp} tree={tree} size={58} frame />
                      <span className="pp-rel-name">{rp.given}</span>
                      {u ? <span className="pp-rel-sub">{u.kind === 'marriage' ? '⚭' : '♡'} {u.start ? yearOf(u.start) : ''}{u.end ? `–${yearOf(u.end)}` : ''}</span> : <span className="pp-rel-sub">{lifespan(rp, c.locale)}</span>}
                      {f.disputed.has(`${id}>${r}`) && <span className="pp-disputed" title={c('rel.disputed')}><GameIcon name="uncertainty" size={12} /></span>}
                    </button>
                    {/* The chores (take the link out, say when a partnership ended) are small icons in the tile's corner, so the list reads as family. */}
                    {(removable || (canEdit && u)) && (
                      <span className="pp-rel-tools">
                        {removable && armed !== key && (
                          <button className="btn icon ghost pp-unlink" onClick={() => setArmed(key)} aria-label={`${c('family.removeLink')}: ${displayName(rp, f)}`} title={c('family.removeLink')}><Unlink size={14} aria-hidden /></button>
                        )}
                        {canEdit && u && <PartnershipEnd tree={tree} u={u} name={displayName(rp, f)} />}
                      </span>
                    )}
                    {removable && armed === key && (
                      <span className="pp-unlink-confirm">
                        <button className="btn ghost danger" onClick={() => unlink.mutate({ kind, rid: r })} disabled={unlink.isPending}>{c('family.removeYes')}</button>
                        <button className="btn ghost" onClick={() => setArmed(null)}>{c('common.cancel')}</button>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ) : null,
      )}
      {unlink.isError && <p className="err" role="alert">{c('family.removeFailed')}</p>}
    </>
  );
}

/** When a partnership ended, and why: the date and one of divorce, death or other. Editors only, as the link is. */
function PartnershipEnd({ tree, u, name }: { tree: string; u: Family['graph']['unions'][number]; name: string }) {
  const c = useT();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [end, setEnd] = useState(u.end ?? '');
  const [reason, setReason] = useState(u.endReason ?? '');
  const save = useMutation({
    mutationFn: () => setPartnershipEnd({ data: { tree, id: u.id, end: end || null, endReason: end && reason ? reason as 'divorce' | 'death' | 'other' : null } }),
    onSuccess: async () => { setOpen(false); await qc.invalidateQueries({ queryKey: ['graph', tree] }); },
  });
  const what = c(u.end || u.endReason ? 'family.endChange' : 'family.endEdit');
  if (!open) return <button className="btn icon ghost pp-end-open" onClick={() => setOpen(true)} aria-label={`${what}: ${name}`} title={what}><CalendarOff size={14} aria-hidden /></button>;
  return (
    <div className="pp-end" role="group" aria-label={c('family.endEdit')}>
      <DatePicker label={c('family.endDate')} value={end} onChange={setEnd} />
      <Select aria-label={c('family.endReason')} value={reason} onChange={setReason} options={[
        { value: '', label: c('family.endNone') }, { value: 'divorce', label: c('family.endDivorce') },
        { value: 'death', label: c('family.endDeath') }, { value: 'other', label: c('family.endOther') },
      ]} />
      <div className="pp-end-actions">
        <button className="btn primary" onClick={() => save.mutate()} disabled={save.isPending}>{c('family.endSave')}</button>
        <button className="btn ghost" onClick={() => setOpen(false)}>{c('common.cancel')}</button>
      </div>
      {save.isError && <p className="err" role="alert">{c('family.endFailed')}</p>}
    </div>
  );
}

// ---------- stories ----------

const KINDS: { id: Story['kind']; label: Key; icon: ReactNode }[] = [
  { id: 'memory', label: 'panel.kind.memory', icon: <Sparkles size={14} /> },
  { id: 'quote', label: 'panel.kind.quote', icon: <Quote size={14} /> },
  { id: 'anecdote', label: 'panel.kind.anecdote', icon: <MessagesSquare size={14} /> },
  { id: 'recipe', label: 'panel.kind.recipe', icon: <CookingPot size={14} /> },
  { id: 'note', label: 'panel.kind.note', icon: <StickyNote size={14} /> },
];

function StoriesTab({ tree, p, details }: { tree: string; p: GPerson; details: DetailState }) {
  const detail = details.detail;
  const c = useT();
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
        <button className="btn primary pp-add-story" onClick={() => setAdding(true)}><Plus size={14} /> {c('panel.addStory')}</button>
      )}
      {detail.stories.length === 0 && !adding && (
        <p className="empty">{c('panel.nothingWritten', { name: p.given })}{canWrite ? ` ${c('panel.rememberQ')}` : ''}</p>
      )}
      {!canWrite && <p className="pp-ask subtle">{c('ask.editor')}</p>}
      <div className="pp-stories">
        {detail.stories.map((s) => (
          <StoryCard key={s.id} s={s} onDelete={canDelete ? () => confirmed(c('panel.removeStoryConfirm')) && remove.mutate(s.id) : undefined} />
        ))}
      </div>
    </>
  );
}

const confirmed = (question: string) => window.confirm(question);

/** One story: a saying in the hand font, anything else as safe Markdown. `compact` clamps it for the Overview. */
function StoryCard({ s, compact, onDelete }: { s: Story; compact?: boolean; onDelete?: () => void }) {
  const c = useT();
  const kind = KINDS.find((k) => k.id === s.kind);
  return (
    <article className={`story story-${s.kind}${compact ? ' compact' : ''}`}>
      <header>
        {kind?.icon}
        <span>{s.title ?? (kind ? c(kind.label) : undefined)}</span>
        {onDelete && <button className="btn icon ghost story-del" aria-label={c('panel.removeStory')} title={c('panel.removeStory')} onClick={onDelete}><Trash2 size={13} /></button>}
      </header>
      {s.kind === 'quote' ? (
        <blockquote>{s.body}</blockquote>
      ) : (
        <div className="story-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(s.body) }} />
      )}
      <footer>
        {s.context && <span>{s.context} · </span>}
        <span>{c('panel.addedBy', { name: s.author })}</span> · <time dateTime={s.at}>{new Date(s.at).toLocaleDateString(locales[c.locale], { day: 'numeric', month: 'short', year: 'numeric' })}</time>
      </footer>
    </article>
  );
}

function StoryForm({ tree, person, done }: { tree: string; person: GPerson; done: () => void }) {
  const t = useT();
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
      // Saved: the next memory is a new change, even if it reads the same.
      keys.clear('story');
      await qc.invalidateQueries({ queryKey: ['person', tree, person.id] });
      qc.invalidateQueries({ queryKey: ['graph', tree] });
      qc.invalidateQueries({ queryKey: ['chronicle', tree] });
      form.reset(value);
      done();
      } catch (e) { setSaveError(e instanceof Error ? translateMessage(e.message, t.locale) : t('panel.storySaveFailed')); }
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
                {k.icon} {t(k.label)}
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
                {(field) => <input aria-label={t('panel.titleOptional')} className="input" placeholder={t('panel.titlePh')} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />}
              </form.Field>
            )}
            <form.Field name="body" validators={{ onSubmit: ({ value }) => (value.trim() ? undefined : t('panel.writeFirst')) }}>
              {(field) => (
                <>
                  <textarea
                    aria-label={t('panel.storyAria')} aria-describedby="story-body-error" aria-invalid={!!field.state.meta.errors.length}
                    autoFocus
                    className={`input${kind === 'quote' ? ' quote-input' : ''}`}
                    placeholder={kind === 'quote' ? t('panel.phQuote', { name: person.given }) : kind === 'recipe' ? t('panel.phRecipe') : t('panel.phMemory', { name: person.given })}
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
                {(field) => <input aria-label={t('panel.whenWhere')} className="input" placeholder={tree === 'realm' ? t('panel.ctxRealm') : t('panel.ctxOther')} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />}
              </form.Field>
            )}
          </>
        )}
      </form.Subscribe>
      <div className="row end">
        <span className="subtle pp-signed" title={author ? t('panel.signedAs', { name: author }) : undefined}>{author ? t('panel.signedAs', { name: author }) : ''}</span>
        <button type="button" className="btn ghost" onClick={() => leave(done)}>{t('common.cancel')}</button>
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(busy) => <button className="btn primary" disabled={busy}><Check size={14} /> {t('panel.save')} <kbd>⌘↵</kbd></button>}
        </form.Subscribe>
      </div>
    </form>
  );
}

// ---------- everyday ----------

function nextOccurrence(date: string, from: Date): Date | undefined {
  if (!/^\d{4}-\d\d-\d\d$/.test(date)) return undefined;
  const [, m, d] = date.split('-').map(Number);
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let next = new Date(today.getFullYear(), m - 1, d);
  if (next < today) next = new Date(today.getFullYear() + 1, m - 1, d);
  return next;
}
const daysUntil = (d: Date, today: Date) => Math.round((d.getTime() - today.getTime()) / 86_400_000);
const inDays = (n: number, c: Translator) => (n === 0 ? c('when.today') : n === 1 ? c('when.tomorrow') : c('when.inDays', { n }));

/** The kinds a contact can be quickly added as, from the Everyday tab. */
const QUICK_KINDS = ['phone', 'email', 'address', 'website'] as const;
type QuickKind = (typeof QUICK_KINDS)[number];
/** The value key each quick kind keeps its text under (see fields/model.ts). */
const QUICK_KEY: Record<QuickKind, string> = { phone: 'number', email: 'address', address: 'street', website: 'url' };
/** The keyboard and the phone's autofill for each kind. */
const VERBATIM = { autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false } as const;
const QUICK_INPUT: Record<Exclude<QuickKind, 'address'>, InputHTMLAttributes<HTMLInputElement>> = {
  phone: { type: 'tel', inputMode: 'tel', autoComplete: 'tel' },
  email: { type: 'email', inputMode: 'email', autoComplete: 'email', ...VERBATIM },
  website: { type: 'url', inputMode: 'url', autoComplete: 'url', ...VERBATIM },
};

function EverydayTab({ f, tree, p, details, canEdit, onSelect }: { f: Family; tree: string; p: GPerson; details: DetailState; canEdit: boolean; onSelect: (id: string) => void }) {
  const detail = details.detail;
  const qc = useQueryClient();
  const c = useT();
  const canContact = useCan('edit-contact');
  const today = useToday();
  const [kind, setKind] = useState<QuickKind>('phone');
  const [value, setValue] = useState('');
  const [issue, setIssue] = useState<IssueCode | null>(null);
  const addBox = useRef<HTMLInputElement>(null);
  const addRow = useRef<HTMLFormElement>(null);
  const { leave } = useContext(DraftContext);
  // The contact or field being edited in place, by its id.
  const [editing, setEditing] = useState<string | null>(null);
  const startEditing = (fid: string) => leave(() => setEditing(fid));
  const editorFor = (fid: string) => detail && editing === fid ? <PersonEdit key={fid} tree={tree} p={p} f={f} detail={detail} only={fid} done={() => setEditing(null)} onRemoved={() => setEditing(null)} /> : null;
  // One key per attempt: a retry after a lost answer never adds the contact twice.
  const [keys] = useState(opKeys);
  const quickValue = (copied?: AddressParts): Record<string, string> => kind === 'address' ? { ...(copied ?? parseAddress(value)) } : { [QUICK_KEY[kind]]: value.trim() };
  const add = useMutation({
    // `copied` is a relative's address: it becomes this person's own field, at the restricted default.
    mutationFn: (copied?: AddressParts) => {
      const data = { tree, person: p.id, field: { type: kind, label: DEFAULT_LABEL[kind] ?? '', value: quickValue(copied), visibility: defaultVisibility(kind) } };
      return addPersonField({ data: { ...data, opKey: keys.for('contact', data) } });
    },
    onSuccess: () => { keys.clear('contact'); setValue(''); qc.invalidateQueries({ queryKey: ['family-addresses', tree, p.id] }); qc.invalidateQueries({ queryKey: ['person', tree, p.id] }); qc.invalidateQueries({ queryKey: ['contacts', tree] }); qc.invalidateQueries({ queryKey: ['graph', tree] }); },
  });
  const del = useMutation({
    mutationFn: (fid: string) => deletePersonField({ data: { tree, id: fid, opKey: newOpKey() } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['person', tree, p.id] }); qc.invalidateQueries({ queryKey: ['contacts', tree] }); qc.invalidateQueries({ queryKey: ['graph', tree] }); },
  });

  const bday = p.born && today ? nextOccurrence(p.born, today) : undefined;
  const anniversaries = today ? (f.unionsOf.get(p.id) ?? [])
    .filter((u) => u.kind === 'marriage' && u.start && !u.end)
    .map((u) => ({ u, next: nextOccurrence(u.start!, today), other: f.byId.get(u.a === p.id ? u.b : u.a) }))
    .filter((x) => x.next && x.other?.living) : [];

  if (!detail) return <DetailFallback details={details} />;
  const contacts = contactsOf(detail.fields);
  const removeContact = (fid: string) => (
    <button className="btn icon ghost" aria-label={c('reach.remove')} title={c('reach.remove')} onClick={() => del.mutate(fid)} disabled={del.isPending}><Trash2 size={13} /></button>
  );
  const fieldsBlock = <FieldGroups fields={detail.fields} fam={f} onSelect={onSelect} removeOwn={canEdit ? undefined : (id) => <RemoveOwnField tree={tree} person={p.id} id={id} />} onEdit={canEdit ? startEditing : undefined} editor={canEdit ? editorFor : undefined} />;
  /** Adds what is in the box. Leaving the box adds it too, but only quietly: half a phone number just stays there. */
  const submitContact = (quiet: boolean) => {
    if (!value.trim() || add.isPending) return;
    const wrong = fieldIssue(kind, quickValue());
    if (wrong) { if (!quiet) setIssue(wrong); return; }
    add.mutate(undefined);
  };
  /** Not when the focus only moved within the row (to the kinds, the add button or a suggestion). */
  const leftAddRow = (next: EventTarget | null) => { if (!addRow.current?.contains(next as Node | null)) submitContact(true); };
  const editContact = (x: PersonField) => canEdit && (
    <button className="btn icon ghost" aria-label={`${c('fields.editValue', { name: c(`type.${x.type}` as Key) })}: ${fieldText(x.type, x.value)}`} title={c('fields.editValue', { name: c(`type.${x.type}` as Key) })} onClick={() => startEditing(x.id)}><Pencil size={13} /></button>
  );

  if (!p.living) {
    const died = p.died && today ? nextOccurrence(p.died, today) : undefined;
    return (
      <>
        <div className="pp-facts">
          <Fact icon={<Cake size={15} />} label={c('fact.born')}>{fmtDate(p.born, locales[c.locale]) ?? c('fact.unknown')}{detail?.bornPlace && <> {c('fact.in')} <PlaceLink tree={tree} name={detail.bornPlace} /></>}</Fact>
          <Fact icon={<span>✝</span>} label={c('fact.died')}>{fmtDate(p.died, locales[c.locale]) ?? c('fact.unknown')}{detail?.diedPlace && <> {c('fact.in')} <PlaceLink tree={tree} name={detail.diedPlace} /></>}{age(p) !== undefined && <span className="muted"> · {c('fact.agedN', { n: age(p)! })}</span>}</Fact>
          {died && today && daysUntil(died, today) < 60 && <Fact icon={<Heart size={15} />} label={c('fact.remembrance')}>{inDays(daysUntil(died, today), c)}</Fact>}
          <OccupationFact tree={tree} p={p} icon={<Pencil size={15} />} label={c('fact.occupation')} />
          {(f.unionsOf.get(p.id) ?? []).map((u) => {
            const o = f.byId.get(u.a === p.id ? u.b : u.a);
            return o ? <Fact key={u.id} icon={<Heart size={15} />} label={u.kind === 'marriage' ? c('fact.married') : c('fact.partner')}>{displayName(o, f)}{u.start && <> · {fmtDate(u.start, locales[c.locale])}</>}{u.place && <> · {u.place}</>}{u.endReason && u.endReason !== 'death' && <span className="muted"> ({u.endReason})</span>}</Fact> : null;
          })}
        </div>
        {fieldsBlock}
      </>
    );
  }

  return (
    <>
      <div className="pp-facts">
        {bday && today ? (
          <div className="pp-countdown ui-card">
            <Cake size={20} />
            <div>
              <b>{c('fact.birthdayIn', { when: inDays(daysUntil(bday, today), c) })}</b>
              <div className="muted">{bday.toLocaleDateString(locales[c.locale], { weekday: 'long', day: 'numeric', month: 'long' })} · {c('fact.turns', { n: (ageAt(p.born, today) ?? 0) + 1 })}</div>
            </div>
          </div>
        ) : (
          <Fact icon={<Cake size={15} />} label={c('fact.born')}>{fmtDate(p.born, locales[c.locale]) ?? (canEdit ? c('fact.unknownAdd') : c('fact.unknown'))}</Fact>
        )}
        {today && anniversaries.map(({ u, next, other }) => (
          <div className="pp-countdown ui-card" key={u.id}>
            <Heart size={20} />
            <div>
              <b>{c('fact.anniversaryWith', { name: other!.given, when: inDays(daysUntil(next!, today), c) })}</b>
              <div className="muted">{c('fact.years', { n: next!.getFullYear() - yearOf(u.start) })} · {c('fact.marriedOn', { date: fmtDate(u.start, locales[c.locale]) ?? '' })}</div>
            </div>
          </div>
        ))}
        {p.furtherGiven?.length ? <Fact icon={<UserRound size={15} />} label={c('fact.fullName')}>{fullName(p)}</Fact> : null}
        {p.nickname && <Fact icon={<UserRound size={15} />} label={c('fact.called')}>{p.nickname}</Fact>}
        {detail?.bornPlace && <Fact icon={<MapPin size={15} />} label={c('fact.bornIn')}><PlaceLink tree={tree} name={detail.bornPlace} /></Fact>}
        <OccupationFact tree={tree} p={p} icon={<Pencil size={15} />} label={c('fact.does')} />
      </div>

      <div className="rule">{c('reach.heading', { name: p.given })}</div>
      {contacts.map((x) => editorFor(x.id) ?? <ContactRow key={x.id} f={x} actions={<>{editContact(x)}{canContact ? removeContact(x.id) : x.visibility === 'personal' ? <RemoveOwnField tree={tree} person={p.id} id={x.id} /> : null}</>} />)}
      {!contacts.length && !canContact && <p className="pp-ask subtle">{c('reach.none')}</p>}
      {canContact && (
        <form ref={addRow} className="pp-contact-add pp-contact-quick" noValidate onBlur={(e) => leftAddRow(e.relatedTarget)} onSubmit={(e) => { e.preventDefault(); submitContact(false); }}>
          <Segmented aria-label={c('reach.kind')} block value={kind} onChange={(v) => { setKind(v); setIssue(null); addBox.current?.focus(); }} options={QUICK_KINDS.map((k) => ({ value: k, label: c(`type.${k}`) }))} />
          {kind === 'address'
            ? <AddressFinder tree={tree} value={value} onChange={(v) => { setValue(v); setIssue(null); }} onPick={(parts) => setValue(formatAddress(parts))} family={{ person: p.id, fam: f, onCopy: (parts) => add.mutate(parts) }} label={c('reach.details')} placeholder={c('reach.placeholder.address')} />
            : <input ref={addBox} aria-label={c('reach.details')} className="input" enterKeyHint="done" {...QUICK_INPUT[kind]} value={value} onChange={(e) => { setValue(e.target.value); setIssue(null); }} placeholder={c(`reach.placeholder.${kind}`)} />}
          <button aria-label={c('reach.add')} className="btn" disabled={!value.trim() || add.isPending}><Plus size={14} /></button>
          {issue && <em className="err pp-contact-err" role="status">{c(`issue.${issue}`)}</em>}
          {add.isError && <em className="err pp-contact-err" role="alert">{c('edit.saveStuck')}</em>}
        </form>
      )}
      {fieldsBlock}
    </>
  );
}

/** A place name that opens the Atlas there. */
function PlaceLink({ tree, name }: { tree: string; name: string }) {
  return <Link to="/$tree/atlas" params={{ tree }} search={{ place: name }} className="pp-place">{name}</Link>;
}

/**
 * The occupation fact: the vocabulary label in the reader's language, or the text as written. Without a code,
 * an AI translation can be asked for when the family's assistant is on. It is shown beside the text, never in
 * place of it, and the translation is cached in the tree.
 */
function OccupationFact({ tree, p, icon, label }: { tree: string; p: GPerson; icon: ReactNode; label: string }) {
  const t = useT();
  const status = useAiStatus(tree);
  // The server translates only for contributors and up, so viewers don't get the button.
  const mayTranslate = useCan('add-story');
  const shown = occupationText(p, t.locale);
  const translate = useMutation({
    mutationFn: () => translateOccupation({ data: { tree, text: p.occupation ?? '', locale: t.locale } }),
  });
  if (!shown) return null;
  const canTranslate = mayTranslate && !p.occupationCode && !!p.occupation && !!status?.features.assistant;
  return (
    <Fact icon={icon} label={label}>
      {shown}
      {canTranslate && !translate.data && (
        <>
          {' '}
          <button type="button" className="btn ghost occ-translate" disabled={translate.isPending} onClick={() => translate.mutate()}>
            {translate.isPending ? t('panel.occupation.translating') : t('panel.occupation.translate')}
          </button>
        </>
      )}
      {translate.data && translate.data.label !== shown && <span className="subtle"> · {t('panel.occupation.translatedAs', { label: translate.data.label })}</span>}
      {translate.isError && <span className="ai-card-error" role="alert"> {t('panel.occupation.translateFailed')}</span>}
    </Fact>
  );
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
