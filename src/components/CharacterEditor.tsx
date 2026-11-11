// The character editor: change how a person's drawn portrait looks, in the manner of a game's character creator.
// A large portrait that changes as you choose (and shows a choice while the pointer or the focus rests on it), the
// parts in categories, every choice shown on this person's own face, "Surprise me", ready-made looks, and steps
// back and forward. It shows `value` and reports every change through `onChange`: the caller decides when to save
// (AppearanceDialog.tsx). Its rules, apart from the screen, are in src/lib/portrait-editor.ts.
import { useMutation, useQuery } from '@tanstack/react-query';
import { Camera, Dices, Eye, History, Redo2, Sparkles, Undo2 } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { aiAvatarFromPhoto } from '~/lib/ai.functions';
import { toAiLocale } from '~/lib/ai/types';
import { useT, type Key } from '~/lib/i18n';
import { errorText } from '~/lib/errortext';
import { personPhotosQuery } from '~/lib/photos.functions';
import { useCan } from '~/lib/session';
import { play } from '~/lib/sfx';
import { portraitStatusQuery } from '~/lib/portrait.functions';
import { applyPreset, canRedo, canUndo, changed, commit, presetsFor, redo, revert, startDraft, surprise, undo, withAutoBeard, withBeard, withHairColour, type Draft } from '~/lib/portrait-editor';
import type { Extra, Mark } from '~/lib/seed-format';
import type { GPerson, House, Look } from '~/lib/types';
import { useAiStatus } from './assistant/store';
import { AiSetupHint } from './assistant/AiSetup';
import { PaintPortrait } from './PaintPortrait';
import { mediaUrl } from '~/lib/photos/types';
import { Portrait } from './Portrait';
import {
  BACKDROPS, BEARD_HAS_LENGTH, BEARD_HAS_SHAPE, BEARD_LENGTHS, BEARD_SHAPES, BEARDS, BROWS, CLOTH, CLOTH_LABELS, CLOTHING, CLOTHING_GROUP_LABELS, EARRINGS, EXPRESSIONS, EXTRAS, EYE_LABELS, EYE_ORDER, EYE_SHAPES, EYES,
  FACE_SHAPES, FRAME_LABELS, FRAMES, GLASSES, GREY_LABELS, HAIR, HAIR_DYED, HAIR_GROUP_LABELS, HAIR_LABELS, HAIR_ORDER, HAIR_STYLES, HEADWEAR,
  HEADWEAR_GROUP_LABELS, LEVEL_LABELS, LINES_LABELS, LIP_LABELS, LIPS, MARKS, MOUSTACHES, NECKLACES, NOSE_SHAPES, SKIN, SKIN_LABELS, SKIN_NEUTRAL,
  SKIN_ORDER, autoFeatures, autoGrey, defaultLook, headwearShows, hexColour, resolveAppearance, shownAge, stageOf,
  type ClothingGroup, type HeadwearGroup, type LevelKey, type Opt,
} from '~/lib/portrait-look';
import { Range, Switch, Tab, TabList, TabPanel, Tabs } from './ui';
import './charactereditor.css';

export interface CharacterEditorProps {
  /** Whose look this is: their id, sex and dates drive the automatic parts and the ages shown. */
  person: GPerson;
  tree: string;
  house?: House | null;
  /** The look being edited; absent means "automatic" until the first change. */
  value: Look | undefined;
  onChange: (look: Look | undefined) => void;
  /** Shown over the options when nothing made here will be saved: a demo, a preview, a reader who may not edit. */
  notice?: ReactNode;
}

type Field = Exclude<keyof Look, 'skin' | 'hair' | 'eyes'>;
/** What a thumbnail shows of the portrait: the part being chosen, close enough to tell one choice from the next. */
type Focus = 'bust' | 'head' | 'face' | 'eyes' | 'mouth' | 'chest';

const STAGES = [
  { label: 'character.stage.child', age: 8 },
  { label: 'character.stage.adult', age: 32 },
  { label: 'character.stage.elder', age: 76 },
] as const;
const LIFE = [1, 6, 12, 17, 28, 45, 62, 82];
const NOW = new Date().getFullYear();
/** Where each small thing is worn, so its thumbnail shows it. */
const EXTRA_FOCUS: Record<Extra, Focus> = { 'hearing-aid': 'face', flower: 'chest', brooch: 'chest', medal: 'chest', scarf: 'chest', pipe: 'face', bindi: 'face', 'nose-stud': 'face' };
const EARLY = new Set(['early-medieval', 'high-medieval', 'renaissance', 'c17']);

// Where the eyes and the mouth sit in the picture, in percent from the top: lower for a child, whose head is larger.
const EYE_Y = { baby: 54.6, child: 50.1, teen: 46.2, adult: 44.6 };
const MOUTH_Y = { baby: 64.6, child: 61.8, teen: 59.3, adult: 58.6 };

/** How a thumbnail is brought close to its part: a scale, the point it grows from, and the shift that centres that point. */
function focusStyle(focus: Focus, age: number | undefined): CSSProperties {
  const stage = age === undefined ? 'adult' : stageOf(age);
  const k = stage === 'baby' || stage === 'child' || stage === 'teen' ? stage : 'adult';
  const at = (s: number, y: number) => ({ '--s': s, '--oy': `${y}%`, '--ty': `${50 - y}%` }) as CSSProperties;
  switch (focus) {
    case 'bust': return {};
    case 'head': return { '--s': 1.3, '--oy': `${EYE_Y[k] - 22}%` } as CSSProperties;
    case 'chest': return { '--s': 1.45, '--oy': '100%' } as CSSProperties;
    case 'face': return at(1.8, (EYE_Y[k] + MOUTH_Y[k]) / 2 + 0.5);
    case 'eyes': return at(2.5, EYE_Y[k]);
    case 'mouth': return at(2.4, MOUTH_Y[k] - 2.5);
  }
}

/** Ages that make sense for this person: nobody is previewed older than they lived. */
function lifeAges(p: GPerson): number[] {
  const end = shownAge({ ...p, look: undefined }, NOW);
  if (end === undefined || p.living) return LIFE;
  // Up to the age they died, which closes the strip.
  return [...LIFE.filter((a) => a < end - 4), end];
}

/** True on a phone-sized screen, where the portrait sits small above the options and stays in view. */
function useNarrow(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = matchMedia('(max-width: 760px)');
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => matchMedia('(max-width: 760px)').matches,
    () => false,
  );
}

export function CharacterEditor({ person, tree, house = null, value, onChange, notice }: CharacterEditorProps) {
  const t = useT();
  const narrow = useNarrow();
  // The session's steps. The caller holds the look itself; this holds how it got there.
  const [draft, setDraft] = useState<Draft>(() => startDraft(value));
  const look = value ?? defaultLook(person);
  // A choice the pointer or the focus rests on, shown in the large portrait without being taken.
  const [peek, setPeek] = useState<Look | null>(null);
  const [comparing, setComparing] = useState(false);
  // undefined: the age the portrait itself shows (age at death, today's age, or the fixed age).
  const [preview, setPreview] = useState<number | undefined>(undefined);
  const [tab, setTab] = useState('looks');
  // Which "More" lists are open: the styles kept for stored looks and for anyone who wants them.
  const [more, setMore] = useState<Record<string, boolean>>({});
  // The 0–10 measures a slider shows when it is on automatic: the value the drawing will use.
  const auto = autoFeatures(person.id);

  // What a tool just did, for a screen reader: the picture changes without a word otherwise.
  const [said, setSaid] = useState('');
  const move = (next: Draft, say?: Key) => {
    if (next === draft) return;
    setSaid(say ? t(say) : '');
    setDraft(next);
    peeked.current = '';
    setPeek(null);
    setComparing(false);
    onChange(next.now);
  };
  const take = (next: Look, sound: 'tick' | 'page' = 'tick', say?: Key) => {
    play(sound);
    move(commit(draft, next), say);
  };
  const withField = <K extends keyof Look>(key: K, v: Look[K] | undefined): Look => {
    const next = { ...look };
    if (v === undefined) delete next[key];
    else next[key] = v;
    return next;
  };
  const set = <K extends keyof Look>(key: K, v: Look[K] | undefined) => take(withField(key, v));

  // "Make from photo": the AI reads one of the person's photos and the result loads here for review. Nothing is saved
  // until the caller saves the editor's value, and it counts as one step.
  const aiAvatar = !!useAiStatus(tree)?.features.avatar;
  const [picking, setPicking] = useState(false);
  // The photos feed both "Make from photo" and the painted portrait, which needs them to know it has one to paint.
  // The painted portrait is offered to editors when the feature is on for this family (its own status, not the assistant's).
  const canEdit = useCan('edit-person');
  const paint = useQuery({ ...portraitStatusQuery(tree), enabled: canEdit && !notice });
  const paintOn = !!paint.data?.enabled && !!paint.data?.configured;
  const photos = useQuery({ ...personPhotosQuery(tree, person.id), enabled: !notice && ((aiAvatar && picking) || (canEdit && paintOn)) });
  const fromPhoto = useMutation({
    mutationFn: (mediaKey: string) => aiAvatarFromPhoto({ data: { tree, personId: person.id, mediaKey, locale: toAiLocale(t.locale) } }),
    // Over the current look: a photo says nothing about era-driven headwear, clothing or a fixed age.
    onSuccess: (next) => take({ ...look, ...next }),
  });

  const onKeyDown = (e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.target instanceof HTMLInputElement) return;
    const key = e.key.toLowerCase();
    if (key === 'z' || key === 'y') {
      e.preventDefault();
      if (key === 'y' || e.shiftKey) move(redo(draft), 'character.said.redone');
      else move(undo(draft), 'character.said.undone');
    }
  };

  const shownLook = comparing ? draft.start : peek ?? look;
  const shown = useMemo(() => ({ ...person, look: shownLook }), [person, shownLook]);
  const current = useMemo(() => ({ ...person, look }), [person, look]);
  const ownAge = shownAge(current, NOW);
  const heroAge = preview ?? ownAge;
  const ages = lifeAges(person);
  const sex = person.sex === 'm' || person.sex === 'f' ? person.sex : 'x';
  const appearance = resolveAppearance(current, NOW, preview);
  const presets = presetsFor(person, look, NOW, preview);

  // The large portrait gives a small start when a part changes. Its key is the look, so the animation runs once per change.
  const heroKey = JSON.stringify(shownLook ?? null) + (preview ?? '');
  const tabs = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tabs.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [tab]);

  const tool = (label: string, icon: ReactNode, on: boolean, run: () => void, keys?: string) => (
    <button type="button" className="btn ghost icon" aria-disabled={!on} onClick={() => on && run()} aria-keyshortcuts={keys} aria-label={label} title={label}>{icon}</button>
  );
  /** The age a thumbnail shows: the one being previewed, and grown-up parts on a grown-up. */
  const tileAge = (adultOnly = false) => (heroAge === undefined || !adultOnly ? heroAge : Math.max(heroAge, 30));
  /** This person with one part changed, for a thumbnail. */
  const wearing = (next: Look, adultOnly = false): GPerson => {
    const age = tileAge(adultOnly);
    return { ...person, look: { ...next, ...(age !== undefined ? { age } : {}) } };
  };
  /**
   * What the pointer or the focus resting on a choice does: shows it large. Only a mouse that really moved counts. A
   * browser also reports a pointer "entering" whatever slides under it when the list scrolls or the category changes,
   * and the large portrait must not flicker through those; and a finger has no resting place, it only taps.
   */
  const peeked = useRef('');
  const show = (next: Look | null) => {
    const key = next ? JSON.stringify(next) : '';
    if (peeked.current === key) return;
    peeked.current = key;
    setPeek(next);
  };
  const peeks = (next: Look) => ({
    onPointerMove: (e: PointerEvent) => { if (e.pointerType === 'mouse' && (e.movementX !== 0 || e.movementY !== 0)) show(next); },
    onPointerLeave: () => show(null),
    onFocus: () => show(next),
    onBlur: () => show(null),
  });

  // Render functions, not components: a component defined here would remount on every change and drop keyboard focus
  // from the choice just pressed.
  const thumb = (next: Look, focus: Focus, adultOnly?: boolean) => (
    <span className="ce-thumb" style={focusStyle(focus, tileAge(adultOnly))}>
      <Portrait prefer="avatar" person={wearing(next, adultOnly)} tree={tree} house={house} mourn={false} size={76} frame={false} decorative />
    </span>
  );
  // `bare`: the thumbnail takes the glasses and the hat off, so that eyes and brows can be told apart under them.
  const tile = (key: string, label: string, next: Look, on: boolean, focus: Focus, opts: { adultOnly?: boolean; auto?: boolean; bare?: boolean } = {}) => (
    <button key={key} type="button" className={`ce-tile${opts.auto ? ' is-auto' : ''}`} aria-pressed={on} onClick={() => take(next)} {...peeks(next)}>
      {thumb(opts.bare ? { ...next, glasses: 'none', headwear: 'none' } : next, focus, opts.adultOnly)}
      <span className="ce-tile-name">{opts.auto ? <Sparkles size={12} aria-hidden="true" /> : null}{label}</span>
    </button>
  );

  /** One part chosen from a catalogue: "Automatic" first (as the portrait would choose), then each option on this face. */
  const tiles = <T extends string>({ field, options, focus, adultOnly, auto = true, label, bare }: { field: Field; options: readonly Opt<T>[]; focus: Focus; adultOnly?: boolean | ((id: T) => boolean); auto?: boolean; label: string; bare?: boolean }) => (
    <div className="ce-tiles" role="group" aria-label={label}>
      {auto && tile('auto', t('character.auto'), withField(field, undefined), look[field] === undefined, focus, { adultOnly: adultOnly === true, auto: true, bare })}
      {options.map((o) => tile(o.id, t(o.label), withField(field, o.id as never), look[field] === o.id, focus, { adultOnly: typeof adultOnly === 'function' ? adultOnly(o.id) : adultOnly, bare }))}
    </div>
  );
  /**
   * The choices past the first ones, folded away. Open when the look wears one of them, so what is chosen is always in
   * sight. Its tiles are made only while it is open: dozens of small portraits nobody sees are not worth drawing, and a
   * browser still measures what a closed <details> holds.
   */
  const moreOf = (key: string, chosen: boolean, children: () => ReactNode) => {
    const open = more[key] ?? chosen;
    return (
      <details className="ce-more" open={open} onToggle={(e) => { const now = e.currentTarget.open; setMore((m) => ((m[key] ?? chosen) === now ? m : { ...m, [key]: now })); }}>
        <summary>{t('character.more')}</summary>
        {open ? children() : null}
      </details>
    );
  };
  /** The same, under headings: hair by length, headwear and clothes by occasion. */
  /** `lead`: a group that needs no heading (headwear's "none"), set beside "Automatic". */
  const grouped = <T extends string, G extends string>({ field, options, order, labels, focus, adultOnly, lead }: { field: Field; options: readonly Opt<T, G>[]; order: readonly G[]; labels: Record<G, Key>; focus: Focus; adultOnly?: (id: T) => boolean; lead?: G }) => (
    <>
      <div className="ce-tiles" role="group" aria-label={t('character.auto')}>
        {tile('auto', t('character.auto'), withField(field, undefined), look[field] === undefined, focus, { auto: true })}
        {options.filter((o) => o.group === lead).map((o) => tile(o.id, t(o.label), withField(field, o.id as never), look[field] === o.id, focus))}
      </div>
      {order.filter((g) => g !== lead && options.some((o) => o.group === g && !o.more)).map((g) => (
        <div key={g} className="ce-group">
          <h4>{t(labels[g])}</h4>
          {tiles({ field, options: options.filter((o) => o.group === g && !o.more), focus, adultOnly, auto: false, label: t(labels[g]) })}
        </div>
      ))}
      {options.some((o) => o.more) && moreOf(field, options.some((o) => o.more && look[field] === o.id), () => (
        order.filter((g) => options.some((o) => o.group === g && o.more)).map((g) => (
          <div key={g} className="ce-group">
            <h4>{t(labels[g])}</h4>
            {tiles({ field, options: options.filter((o) => o.group === g && o.more), focus, adultOnly, auto: false, label: t(labels[g]) })}
          </div>
        ))
      ))}
    </>
  );
  /** A numbered part with a few named steps (greying, lines of age): automatic, then each step on this face. */
  const steps = (field: 'grey' | 'lines', labels: Key[], focus: Focus, label: string) => (
    <div className="ce-tiles" role="group" aria-label={label}>
      {tile('auto', t('character.auto'), withField(field, undefined), look[field] === undefined, focus, { auto: true })}
      {labels.map((k, i) => tile(String(i), t(k), withField(field, i), look[field] === i, focus))}
    </div>
  );
  /** Several at once (marks, things worn and carried). */
  const toggles = <T extends Mark | Extra>({ field, options, focus, label, auto }: { field: 'marks' | 'extras'; options: readonly Opt<T>[]; focus: Focus | ((id: T) => Focus); label: string; auto: boolean }) => {
    const whole = typeof focus === 'function' ? 'bust' : focus;
    const chosen = (look[field] ?? []) as T[];
    const flip = (id: T) => (chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);
    return (
      <div className="ce-tiles" role="group" aria-label={label}>
        {auto
          ? tile('auto', t('character.auto'), withField(field, undefined), look[field] === undefined, whole, { auto: true })
          : tile('none', t('character.none_extra'), withField(field, undefined), !chosen.length, whole)}
        {options.map((o) => {
          const next = flip(o.id);
          const preview = { ...look, [field]: chosen.includes(o.id) ? chosen : [...chosen, o.id] } as Look;
          return (
            <button key={o.id} type="button" className="ce-tile" aria-pressed={chosen.includes(o.id)} onClick={() => take(field === 'extras' && !next.length ? withField(field, undefined) : ({ ...look, [field]: next } as Look))} {...peeks(preview)}>
              {thumb(preview, typeof focus === 'function' ? focus(o.id) : focus, field === 'extras')}
              <span className="ce-tile-name">{t(o.label)}</span>
            </button>
          );
        })}
      </div>
    );
  };

  /** A 0–10 measure: a slider, showing the automatic value until it is set by hand. */
  const measure = (key: LevelKey | 'build', label: string) => {
    const base = key === 'build' ? 5 : auto[key];
    return (
      <div className="ce-measure">
        <span className="ce-measure-name">{label}</span>
        <Range aria-label={label} value={look[key] ?? base} min={0} max={10} step={1} ticks={[0, 5, 10]} format={(v) => String(v)} onChange={(v) => set(key, v)} />
        <span className="ce-measure-state">
          {look[key] === undefined ? t(key === 'build' ? 'character.average' : 'character.auto') : (
            <button type="button" className="ce-link" onClick={() => set(key, undefined)}>{t(key === 'build' ? 'character.average' : 'character.auto')}</button>
          )}
        </span>
      </div>
    );
  };

  const swatches = ({ field, order, colours, labels, neutral, auto, label }: { field: 'skin' | 'hair' | 'eyes' | 'lips' | 'frames' | 'clothColour' | 'trimColour' | 'hatColour'; order: readonly number[]; colours: readonly string[]; labels: readonly Key[]; neutral?: number; auto?: string; label: string }) => (
    <div className="ce-swatches" role="group" aria-label={label}>
      {auto !== undefined && (
        <button type="button" className="ce-swatch is-auto" aria-pressed={look[field] === undefined} aria-label={auto} title={auto} onClick={() => set(field, undefined)} {...peeks(withField(field, undefined))}>
          <span><Sparkles size={14} aria-hidden="true" /></span>
        </button>
      )}
      {order.map((i) => (
        <button
          key={i}
          type="button"
          className={`ce-swatch${i === neutral ? ' is-neutral' : ''}`}
          aria-pressed={look[field] === i && !(field === 'hair' && look.hairHex)}
          aria-label={t(labels[i])}
          title={t(labels[i])}
          onClick={() => take(field === 'hair' ? withHairColour(look, i) : withField(field, i))}
          {...peeks(field === 'hair' ? withHairColour(look, i) : withField(field, i))}
          style={{ ['--sw' as string]: colours[i] }}
        >
          <span />
        </button>
      ))}
    </div>
  );
  const all = (xs: readonly unknown[]) => xs.map((_, i) => i);

  const clothingOrder: ClothingGroup[] = appearance.stage === 'child'
    ? ['children', 'everyday', 'best', 'traditional', 'work', 'c19', 'early']
    : EARLY.has(appearance.era) ? ['early', 'c19', 'traditional', 'best', 'work', 'everyday', 'children']
      : appearance.era === 'c18' || appearance.era === 'c19' ? ['c19', 'best', 'work', 'traditional', 'everyday', 'early', 'children']
        : ['everyday', 'best', 'work', 'traditional', 'c19', 'early', 'children'];
  const headwearOrder: HeadwearGroup[] = EARLY.has(appearance.era) ? ['none', 'realm', 'period', 'faith', 'occasion', 'everyday', 'work'] : ['none', 'everyday', 'faith', 'occasion', 'work', 'period', 'realm'];
  const greyNow = autoGrey(current, NOW, preview);

  return (
    <div className="ce" onKeyDown={onKeyDown}>
      <div className="ce-stage">
        <div className="ce-hero">
          <span className="ce-hero-pop" key={heroKey}>
            <Portrait prefer="avatar" person={shown} tree={tree} house={house} mourn={false} size={narrow ? 128 : 248} age={preview} />
          </span>
          {comparing ? <span className="ce-hero-flag">{t('character.before')}</span> : null}
          <span className="ce-hero-caption">{heroAge === undefined ? t('character.age_unknown') : t('character.aged', { age: heroAge })}</span>
        </div>

        <div className="ce-tools" role="toolbar" aria-label={t('character.tools')}>
          <button type="button" className="btn primary ce-surprise" onClick={() => take(surprise(person, look, NOW, Math.random, preview), 'page', 'character.said.surprised')} title={t('character.surprise_hint')}>
            <Dices size={16} aria-hidden="true" /> {t('character.surprise')}
          </button>
          {/* aria-disabled, not disabled: a tool that has just run out keeps the focus, so the keyboard is not thrown back to the top. */}
          {tool(t('character.undo'), <Undo2 size={16} aria-hidden="true" />, canUndo(draft), () => move(undo(draft), 'character.said.undone'), 'Control+Z Meta+Z')}
          {tool(t('character.redo'), <Redo2 size={16} aria-hidden="true" />, canRedo(draft), () => move(redo(draft), 'character.said.redone'), 'Control+Shift+Z Meta+Shift+Z')}
          <button type="button" className="btn ghost icon" aria-pressed={comparing} aria-disabled={!changed(draft)} onClick={() => changed(draft) && setComparing((c) => !c)} aria-label={t('character.compare')} title={t('character.compare')}><Eye size={16} aria-hidden="true" /></button>
          {tool(t('character.revert'), <History size={16} aria-hidden="true" />, changed(draft), () => move(revert(draft), 'character.said.reverted'))}
          <span className="sr-only" role="status" aria-live="polite">{said}</span>
        </div>

        <div className="ce-ages" role="group" aria-label={t('character.preview_age')}>
          <button type="button" className="ce-age" aria-pressed={preview === undefined} onClick={() => setPreview(undefined)}>{t('character.as_shown')}</button>
          {STAGES.filter((s) => ages.some((a) => a >= s.age - 6) || s.age <= 8).map((s) => (
            <button key={s.label} type="button" className="ce-age" aria-pressed={preview === s.age} onClick={() => setPreview(s.age)}>{t(s.label)}</button>
          ))}
        </div>

        <div className="ce-sizes" aria-label={t('character.sizes')} role="group">
          <Portrait prefer="avatar" person={shown} tree={tree} house={house} size={84} age={preview} decorative />
          <Portrait prefer="avatar" person={shown} tree={tree} house={house} size={40} age={preview} decorative />
          <Portrait prefer="avatar" person={shown} tree={tree} house={house} size={28} frame={false} age={preview} decorative />
          <span className="ce-sizes-note">{t('character.sizes')}</span>
        </div>
      </div>

      <div className="ce-controls">
        {notice ? <p className="ce-notice" role="note">{notice}</p> : null}
        <Tabs value={tab} onChange={setTab} label={t('character.appearance')}>
          <div ref={tabs} className="ce-tabs">
            <TabList>
              <Tab value="looks">{t('character.tab.looks')}</Tab>
              <Tab value="face">{t('character.tab.face')}</Tab>
              <Tab value="eyes">{t('character.tab.eyes')}</Tab>
              <Tab value="hair">{t('character.tab.hair')}</Tab>
              <Tab value="beard">{t('character.tab.beard')}</Tab>
              <Tab value="details">{t('character.tab.details')}</Tab>
              <Tab value="clothes">{t('character.tab.clothes')}</Tab>
              <Tab value="headwear">{t('character.tab.headwear')}</Tab>
              <Tab value="extras">{t('character.tab.extras')}</Tab>
              <Tab value="age">{t('character.tab.age')}</Tab>
            </TabList>
          </div>
          <div className="ce-panels">
            <TabPanel value="looks">
              <Section title={t('character.section.presets')}>
                <p className="ce-hint">{t(presets.length ? 'character.hint.presets' : 'character.hint.no_presets')}</p>
                <div className="ce-tiles is-wide" role="group" aria-label={t('character.section.presets')}>
                  {presets.map((p) => {
                    const next = applyPreset(look, p);
                    return tile(p.id, t(p.label), next, JSON.stringify(next) === JSON.stringify(look), 'bust');
                  })}
                </div>
              </Section>
              {!notice && (
                <Section title={t('character.section.from_photo')}>
                  <div className="ce-row">
                    {aiAvatar ? (
                      <button type="button" className="btn" onClick={() => setPicking((p) => !p)} aria-expanded={picking} aria-controls="ce-photo-pick">
                        <Camera size={16} aria-hidden="true" /> {t('character.make_from_photo')}
                      </button>
                    ) : <AiSetupHint tree={tree} feature={t('character.make_from_photo')} />}
                  </div>
                  {aiAvatar && picking && (
                    <div className="ce-photo-pick" id="ce-photo-pick" role="group" aria-label={t('character.make_from_photo')}>
                      <p className="ce-hint">{t('character.photo_pick')}</p>
                      {photos.data?.length ? (
                        <div className="ce-photo-grid">
                          {photos.data.map((m) => (
                            <button key={m.key} type="button" className="ce-photo" disabled={fromPhoto.isPending} onClick={() => fromPhoto.mutate(m.key)}>
                              <img src={mediaUrl(tree, m.key, 'thumb')} alt="" loading="lazy" />
                            </button>
                          ))}
                        </div>
                      ) : photos.data ? (
                        <p className="ce-hint">{t('character.no_photos')}</p>
                      ) : null}
                      {fromPhoto.isPending && <p className="ce-hint" role="status" aria-busy="true">{t('character.photo_loading')}</p>}
                      {fromPhoto.isError && <p className="ce-hint ce-err" role="alert">{t('character.photo_failed')} {errorText(fromPhoto.error, t.locale)}</p>}
                      {fromPhoto.isSuccess && !fromPhoto.isPending && <p className="ce-hint" role="status">{t('character.photo_loaded')}</p>}
                    </div>
                  )}
                  {canEdit && paintOn ? <PaintPortrait tree={tree} person={person} photos={photos.data ?? []} /> : null}
                </Section>
              )}
            </TabPanel>

            <TabPanel value="face">
              <Section title={t('character.section.skin')}>
                {swatches({ field: 'skin', order: [...SKIN_ORDER, SKIN_NEUTRAL], colours: SKIN, labels: SKIN_LABELS, neutral: SKIN_NEUTRAL, label: t('character.section.skin') })}
              </Section>
              <Section title={t('character.section.face_shape')}>
                {tiles({ field: 'face', options: FACE_SHAPES, focus: 'head', label: t('character.section.face_shape') })}
                {measure('jaw', t(LEVEL_LABELS.jaw))}
                {measure('build', t('character.section.build'))}
              </Section>
              <Section title={t('character.section.expression')}>{tiles({ field: 'expression', options: EXPRESSIONS, focus: 'face', label: t('character.section.expression') })}</Section>
              <Section title={t('character.section.nose')}>
                {tiles({ field: 'noseShape', options: NOSE_SHAPES, focus: 'mouth', label: t('character.section.nose') })}
                {measure('noseSize', t(LEVEL_LABELS.noseSize))}
              </Section>
              <Section title={t('character.section.mouth')}>
                {measure('mouthWidth', t(LEVEL_LABELS.mouthWidth))}
                {measure('mouthFullness', t(LEVEL_LABELS.mouthFullness))}
                <h4>{t('character.section.lips')}</h4>
                {swatches({ field: 'lips', order: all(LIPS), colours: LIPS, labels: LIP_LABELS, auto: t('look.lips.natural'), label: t('character.section.lips') })}
              </Section>
              <Section title={t('character.section.ears')}>{measure('earSize', t(LEVEL_LABELS.earSize))}</Section>
            </TabPanel>

            <TabPanel value="eyes">
              <Section title={t('character.section.colour')}>
                {swatches({ field: 'eyes', order: EYE_ORDER, colours: EYES, labels: EYE_LABELS, label: t('character.section.eyes') })}
              </Section>
              <Section title={t('character.section.eye_shape')}>
                {tiles({ field: 'eyeShape', options: EYE_SHAPES, focus: 'eyes', label: t('character.section.eye_shape'), bare: true })}
                {measure('eyeSize', t(LEVEL_LABELS.eyeSize))}
                {measure('eyeSpacing', t(LEVEL_LABELS.eyeSpacing))}
              </Section>
              <Section title={t('character.section.eyebrows')}>
                {tiles({ field: 'brows', options: BROWS, focus: 'eyes', label: t('character.section.eyebrows'), bare: true })}
                {measure('browHeight', t(LEVEL_LABELS.browHeight))}
              </Section>
              <Section title={t('character.section.glasses')}>
                {tiles({ field: 'glasses', options: GLASSES, focus: 'face', adultOnly: true, label: t('character.section.glasses') })}
                <h4>{t('character.section.frames')}</h4>
                {swatches({ field: 'frames', order: all(FRAMES), colours: FRAMES, labels: FRAME_LABELS, auto: t('look.frames.auto'), label: t('character.section.frames') })}
              </Section>
            </TabPanel>

            <TabPanel value="hair">
              {appearance.stage === 'baby' && <p className="ce-hint">{t('character.hint.baby')}</p>}
              {appearance.headwear !== 'none' && ['hijab', 'turban', 'headwrap', 'wimple', 'hood'].includes(appearance.headwear) && <p className="ce-hint">{t('character.hint.covered')}</p>}
              <Section title={t('character.section.colour')}>
                {swatches({ field: 'hair', order: HAIR_ORDER, colours: HAIR, labels: HAIR_LABELS, label: t('character.section.colour') })}
                <h4>{t('character.section.dyed')}</h4>
                {swatches({ field: 'hair', order: HAIR_DYED, colours: HAIR, labels: HAIR_LABELS, label: t('character.section.dyed') })}
                <h4>{t('character.section.own_colour')}</h4>
                <OwnColour
                  value={hexColour(look.hairHex)} shown={appearance.hairBase} label={t('character.section.own_colour')}
                  onPreview={(hex) => show(withHairColour(look, hex))} onChange={(hex) => take(withHairColour(look, hex))}
                />
              </Section>
              <Section title={t('character.section.grey')}>
                <div className="ce-tiles" role="group" aria-label={t('character.section.grey')}>
                  {tile('auto', `${t('character.auto')} · ${t(GREY_LABELS[greyNow])}`, withField('grey', undefined), look.grey === undefined, 'head', { auto: true })}
                  {GREY_LABELS.map((k, i) => tile(String(i), t(k), withField('grey', i), look.grey === i, 'head'))}
                </div>
              </Section>
              <Section title={t('character.section.style')}>
                {grouped({ field: 'hairStyle', options: HAIR_STYLES, order: ['short', 'medium', 'long', 'up', 'textured', 'thin', 'period'], labels: HAIR_GROUP_LABELS, focus: 'head' })}
              </Section>
              <Section title={t('character.section.hairline')}>{measure('hairline', t(LEVEL_LABELS.hairline))}</Section>
            </TabPanel>

            <TabPanel value="beard">
              {heroAge !== undefined && heroAge < 20 && <p className="ce-hint">{t('character.hint.beard_young')}</p>}
              <Section title={t('character.section.beard')}>
                <div className="ce-tiles" role="group" aria-label={t('character.section.beard')}>
                  {tile('auto', t('character.auto'), withAutoBeard(look), look.beardStyle === undefined, 'face', { adultOnly: true, auto: true })}
                  {BEARDS.map((o) => tile(o.id, t(o.label), withBeard(look, appearance, { cover: o.id }), look.beardStyle !== undefined && appearance.beardCover === o.id, 'face', { adultOnly: true }))}
                </div>
              </Section>
              {BEARD_HAS_LENGTH.has(appearance.beardCover) && (
                <Section title={t('character.section.beard_length')}>
                  <div className="ce-tiles" role="group" aria-label={t('character.section.beard_length')}>
                    {BEARD_LENGTHS.map((l) => tile(String(l.length), t(l.label), withBeard(look, appearance, { length: l.length }), appearance.beardLength === l.length, 'face', { adultOnly: true }))}
                  </div>
                  <div className="ce-measure">
                    <span className="ce-measure-name">{t('character.exact_length')}</span>
                    <Range aria-label={t('character.exact_length')} value={appearance.beardLength} min={0} max={10} step={1} ticks={[0, 5, 10]} format={(v) => String(v)} onChange={(v) => take(withBeard(look, appearance, { length: v }))} />
                    <span className="ce-measure-state" />
                  </div>
                </Section>
              )}
              {BEARD_HAS_SHAPE.has(appearance.beardCover) && (
                <Section title={t('character.section.beard_shape')}>
                  <div className="ce-tiles" role="group" aria-label={t('character.section.beard_shape')}>
                    {BEARD_SHAPES.map((o) => tile(o.id, t(o.label), withBeard(look, appearance, { shape: o.id }), appearance.beardShape === o.id, 'face', { adultOnly: true }))}
                  </div>
                </Section>
              )}
              <Section title={t('character.section.moustache')}>
                {tiles({ field: 'moustache', options: MOUSTACHES.filter((o) => !o.more), focus: 'mouth', adultOnly: true, label: t('character.section.moustache') })}
                {moreOf('moustache', MOUSTACHES.some((o) => o.more && look.moustache === o.id), () => tiles({ field: 'moustache', options: MOUSTACHES.filter((o) => o.more), focus: 'mouth', adultOnly: true, auto: false, label: t('character.more') }))}
                <p className="ce-hint">{t('character.hint.moustache_own')}</p>
              </Section>
              <Section title={t('character.section.beard_colour')}>
                <div className="ce-swatches" role="group" aria-label={t('character.section.beard_colour')}>
                  <button type="button" className="ce-swatch is-auto" aria-pressed={!look.beardHex} aria-label={t('character.beard_match_hair')} title={t('character.beard_match_hair')} onClick={() => set('beardHex', undefined)} {...peeks(withField('beardHex', undefined))}>
                    <span><Sparkles size={14} aria-hidden="true" /></span>
                  </button>
                  {HAIR_ORDER.map((i) => (
                    <button key={i} type="button" className="ce-swatch" aria-pressed={look.beardHex === HAIR[i]} aria-label={t(HAIR_LABELS[i])} title={t(HAIR_LABELS[i])} onClick={() => set('beardHex', HAIR[i])} {...peeks(withField('beardHex', HAIR[i]))} style={{ ['--sw' as string]: HAIR[i] }}>
                      <span />
                    </button>
                  ))}
                </div>
                <OwnColour
                  value={hexColour(look.beardHex)} shown={appearance.beardColour} label={t('character.section.beard_colour')}
                  onPreview={(hex) => show(withField('beardHex', hex))} onChange={(hex) => set('beardHex', hex)}
                />
              </Section>
              {sex !== 'm' && <p className="ce-hint">{t('character.hint.beard_men')}</p>}
            </TabPanel>

            <TabPanel value="details">
              <Section title={t('character.section.marks')}>{toggles({ field: 'marks', options: MARKS, focus: 'face', label: t('character.section.marks'), auto: true })}</Section>
              <Section title={t('character.section.lines')}>{steps('lines', LINES_LABELS, 'face', t('character.section.lines'))}</Section>
            </TabPanel>

            <TabPanel value="clothes">
              <p className="ce-hint">{t('character.hint.clothes')}</p>
              <Section title={t('character.section.cloth_colour')}>
                {swatches({ field: 'clothColour', order: all(CLOTH), colours: CLOTH, labels: CLOTH_LABELS, auto: t('look.cloth.house'), label: t('character.section.cloth_colour') })}
                <h4>{t('character.section.trim_colour')}</h4>
                {swatches({ field: 'trimColour', order: all(CLOTH), colours: CLOTH, labels: CLOTH_LABELS, auto: t('look.cloth.house'), label: t('character.section.trim_colour') })}
                <p className="ce-hint">{t('character.hint.house_colours')}</p>
              </Section>
              <Section title={t('character.section.clothing')}>
                {grouped({ field: 'clothing', options: CLOTHING, order: clothingOrder, labels: CLOTHING_GROUP_LABELS, focus: 'chest' })}
              </Section>
            </TabPanel>

            <TabPanel value="headwear">
              {look.headwear && !headwearShows(look.headwear, appearance.stage) && <p className="ce-hint">{t('character.hint.not_at_age')}</p>}
              <Section title={t('character.section.headwear')}>
                {grouped({ field: 'headwear', options: HEADWEAR, order: headwearOrder, labels: HEADWEAR_GROUP_LABELS, focus: 'head', adultOnly: (id) => !headwearShows(id, appearance.stage), lead: 'none' })}
              </Section>
              <Section title={t('character.section.hat_colour')}>
                {swatches({ field: 'hatColour', order: all(CLOTH), colours: CLOTH, labels: CLOTH_LABELS, auto: t('character.auto'), label: t('character.section.hat_colour') })}
              </Section>
            </TabPanel>

            <TabPanel value="extras">
              <Section title={t('character.section.extras')}>{toggles({ field: 'extras', options: EXTRAS, focus: (id) => EXTRA_FOCUS[id], label: t('character.section.extras'), auto: false })}</Section>
              <Section title={t('character.section.earrings')}>{tiles({ field: 'earrings', options: EARRINGS, focus: 'face', auto: false, label: t('character.section.earrings') })}</Section>
              <Section title={t('character.section.necklace')}>{tiles({ field: 'necklace', options: NECKLACES, focus: 'chest', auto: false, label: t('character.section.necklace') })}</Section>
              <Section title={t('character.section.backdrop')}>{tiles({ field: 'backdrop', options: BACKDROPS, focus: 'bust', auto: false, label: t('character.section.backdrop') })}</Section>
            </TabPanel>

            <TabPanel value="age">
              <Section title={t('character.section.age')}>
                <Switch checked={look.age !== undefined} onChange={(v) => set('age', v ? ownAge ?? 40 : undefined)} size="sm">{t('character.show_fixed_age')}</Switch>
                <p className="ce-hint">
                  {look.age === undefined ? t(person.living ? 'character.age_auto_today' : 'character.age_auto_died') : t('character.age_fixed_note')}
                </p>
                {look.age !== undefined && (
                  <div className="ce-age-range">
                    <Range aria-label={t('character.section.age')} value={look.age} min={0} max={100} ticks={[0, 25, 50, 75, 100]} onChange={(v) => set('age', v)} format={(v) => String(v)} />
                  </div>
                )}
              </Section>
              <Section title={t('character.life')}>
                <div className="ce-life">
                  {ages.map((a) => (
                    <button key={a} type="button" className="ce-life-age" aria-pressed={preview === a} onClick={() => setPreview(preview === a ? undefined : a)} aria-label={t('character.aged', { age: a })}>
                      <Portrait prefer="avatar" person={current} tree={tree} house={house} mourn={false} size={64} age={a} decorative />
                      <span>{a}</span>
                    </button>
                  ))}
                </div>
              </Section>
            </TabPanel>
          </div>
        </Tabs>
      </div>
    </div>
  );
}

/**
 * A colour of one's own: the browser's colour picker, and a field for the code (#rrggbb) for anyone who has one. The
 * picker shows the colour in the large portrait while it is dragged and takes it when it closes, so a drag is one step;
 * the field takes a code the moment it is whole. A component of its own, outside the editor, so typing keeps its focus.
 */
function OwnColour({ value, shown, label, onPreview, onChange }: { value: string | undefined; shown: string; label: string; onPreview: (hex: string) => void; onChange: (hex: string) => void }) {
  const t = useT();
  const id = useId();
  // What is typed, until it is a whole colour. Null: the field shows the colour in use.
  const [typed, setTyped] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  // The colour picker's own "change" fires once, when it closes. React's onChange is its "input", which fires all the way through a drag.
  const taken = useRef(onChange);
  useEffect(() => { taken.current = onChange; });
  useEffect(() => {
    const el = picker.current;
    if (!el) return;
    const done = () => { const hex = hexColour(el.value); if (hex) taken.current(hex); };
    el.addEventListener('change', done);
    return () => el.removeEventListener('change', done);
  }, []);
  const text = typed ?? value ?? '';
  const bad = typed !== null && typed !== '' && !hexColour(typed);
  return (
    <div className="ce-own">
      <label className="ce-own-pick">
        <input ref={picker} type="color" value={value ?? shown} aria-label={`${label}: ${t('character.pick_colour')}`} onChange={(e) => { const hex = hexColour(e.target.value); if (hex) onPreview(hex); }} />
        <span>{t('character.pick_colour')}</span>
      </label>
      <label className="ce-own-code" htmlFor={id}>
        <span>{t('character.hex')}</span>
        <input
          id={id} className="input" type="text" inputMode="text" autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={7} placeholder="#8a5631"
          value={text} aria-invalid={bad} aria-describedby={`${id}-hint`}
          onChange={(e) => {
            const raw = e.target.value.trim();
            const next = raw && !raw.startsWith('#') ? `#${raw}` : raw;
            const hex = hexColour(next);
            if (hex) { setTyped(null); onChange(hex); } else setTyped(next);
          }}
          onBlur={() => setTyped(null)}
        />
      </label>
      <p className={`ce-hint${bad ? ' ce-err' : ''}`} id={`${id}-hint`}>{t('character.hex_hint')}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ce-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
