// The character editor: change how a person's generated portrait looks, in the manner of CK3's ruler
// designer. A controlled component: it shows `value` and reports every change through `onChange`,
// so the caller decides when to save. Each part is picked from tiles that show this person wearing
// it, at the age being previewed.
import { useMutation, useQuery } from '@tanstack/react-query';
import { Camera, Dices, RotateCcw, Sparkles, Undo2 } from 'lucide-react';
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { aiAvatarFromPhoto } from '~/lib/ai.functions';
import { toAiLocale } from '~/lib/ai/types';
import { useT, type Key } from '~/lib/i18n';
import { errorText } from '~/lib/errortext';
import { personPhotosQuery } from '~/lib/photos.functions';
import type { Mark } from '~/lib/seed-format';
import type { GPerson, House, Look } from '~/lib/types';
import { useAiStatus } from './assistant/store';
import { AiSetupHint } from './assistant/AiSetup';
import { mediaUrl } from './photos/types';
import { Portrait } from './Portrait';
import {
  BEARDS, BROWS, CLOTHING, EYE_LABELS, EYES, GLASSES, HAIR, HAIR_LABELS, HAIR_ORDER, HAIR_STYLES, HEADWEAR, MARKS,
  MOUSTACHES, SKIN, SKIN_LABELS, SKIN_NEUTRAL, SKIN_ORDER, defaultLook, shownAge,
} from './portrait/look';
import { Range, Switch, Tab, TabList, TabPanel, Tabs } from './ui';
import './charactereditor.css';

export interface CharacterEditorProps {
  /** Whose look this is: their id, sex and dates drive the automatic parts and the ages shown. */
  person: GPerson;
  tree: string;
  house?: House | null;
  /** The look being edited; absent means "automatic" until the first change. */
  value: Look | undefined;
  onChange: (look: Look) => void;
}

type Optional = Exclude<keyof Look, 'skin' | 'hair' | 'eyes'>;

const STAGES = [
  { label: 'character.stage.child', age: 8 },
  { label: 'character.stage.adult', age: 32 },
  { label: 'character.stage.elder', age: 76 },
] as const;
const LIFE = [1, 6, 12, 17, 28, 45, 62, 82];
const NOW = new Date().getFullYear();

/** Ages that make sense for this person: nobody is previewed older than they lived. */
function lifeAges(p: GPerson): number[] {
  const end = shownAge({ ...p, look: undefined }, NOW);
  if (end === undefined || p.living) return LIFE;
  // Up to the age they died, which closes the strip.
  return [...LIFE.filter((a) => a < end - 4), end];
}

export function CharacterEditor({ person, tree, house = null, value, onChange }: CharacterEditorProps) {
  const look = value ?? defaultLook(person);
  const initial = useRef(value);
  const [history, setHistory] = useState<(Look | undefined)[]>([]);
  // undefined: the age the portrait itself shows (age at death, today's age, or the fixed age).
  const [preview, setPreview] = useState<number | undefined>(undefined);
  const [life, setLife] = useState(false);
  const [tab, setTab] = useState('face');

  const commit = (next: Look) => {
    setHistory((h) => [...h.slice(-49), value]);
    onChange(next);
  };
  const set = <K extends keyof Look>(key: K, v: Look[K] | undefined) => {
    const next = { ...look };
    if (v === undefined) delete next[key];
    else next[key] = v;
    commit(next);
  };
  // "Make from photo": the AI reads one of the person's photos and the result loads here for review. Nothing is saved
  // until the caller saves the editor's value, and it counts as one undo step.
  const t = useT();
  const aiAvatar = !!useAiStatus(tree)?.features.avatar;
  const [picking, setPicking] = useState(false);
  const photos = useQuery({ ...personPhotosQuery(tree, person.id), enabled: aiAvatar && picking });
  const fromPhoto = useMutation({
    mutationFn: (mediaKey: string) => aiAvatarFromPhoto({ data: { tree, personId: person.id, mediaKey, locale: toAiLocale(t.locale) } }),
    // Over the current look: a photo says nothing about era-driven headwear, clothing or a fixed age.
    onSuccess: (next) => commit({ ...look, ...next }),
  });
  const undo = () => {
    if (!history.length) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    onChange(prev ?? defaultLook(person));
  };
  const reset = () => commit(initial.current ?? defaultLook(person));
  const randomise = () => commit(randomLook(person, look));
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      undo();
    }
  };

  const shown = useMemo(() => ({ ...person, look }), [person, look]);
  const ownAge = shownAge(shown, NOW);
  const heroAge = preview ?? ownAge;
  const ages = lifeAges(person);
  const sex = person.sex === 'm' || person.sex === 'f' ? person.sex : 'x';

  /** This person with one part changed, for a tile. Grown-up parts are shown on a grown-up. */
  const tile = (key: Optional, v: unknown, adultOnly = false): GPerson => {
    const next = { ...look } as Record<string, unknown>;
    if (v === undefined) delete next[key];
    else next[key] = v;
    const age = heroAge === undefined || !adultOnly ? heroAge : Math.max(heroAge, 30);
    return { ...person, look: { ...(next as unknown as Look), ...(age !== undefined ? { age } : {}) } };
  };

  // A render function, not a component: a component defined here would remount on every change and
  // drop keyboard focus from the tile just pressed.
  const tiles = <T extends string>({ field, options, adultOnly, auto = true }: { field: Optional; options: { id: T; label: Key }[]; adultOnly?: boolean; auto?: boolean }) => (
    <div className="ce-tiles" role="group">
      {auto && (
        <button type="button" className="ce-tile is-auto" aria-pressed={look[field] === undefined} onClick={() => set(field, undefined)}>
          <span className="ce-auto"><Sparkles size={20} aria-hidden="true" /></span>
          {t('character.auto')}
        </button>
      )}
      {options.map((o) => (
        <button key={o.id} type="button" className="ce-tile" aria-pressed={look[field] === o.id} onClick={() => set(field, o.id as never)}>
          <Portrait prefer="avatar" person={tile(field, o.id, adultOnly)} tree={tree} house={house} mourn={false} size={56} frame={false} />
          {t(o.label)}
        </button>
      ))}
    </div>
  );

  const marks = look.marks;
  const toggleMark = (m: Mark) => {
    const base = marks ?? [];
    set('marks', base.includes(m) ? base.filter((x) => x !== m) : [...base, m]);
  };

  return (
    <div className="ce" onKeyDown={onKeyDown}>
      <div className="ce-stage">
        <div className="ce-hero">
          <Portrait prefer="avatar" person={shown} tree={tree} house={house} mourn={false} size={176} age={preview} />
          <span className="ce-hero-caption">{heroAge === undefined ? t('character.age_unknown') : t('character.aged', { age: heroAge })}</span>
        </div>
        <div className="ce-ages" role="group" aria-label={t('character.preview_age')}>
          <button type="button" className="ce-age" aria-pressed={preview === undefined} onClick={() => setPreview(undefined)}>
            <Portrait prefer="avatar" person={shown} tree={tree} house={house} mourn={false} size={44} frame={false} />
            {t('character.as_shown')}
          </button>
          {STAGES.filter((s) => ages.some((a) => a >= s.age - 6) || s.age <= 8).map((s) => (
            <button key={s.label} type="button" className="ce-age" aria-pressed={preview === s.age} onClick={() => setPreview(s.age)}>
              <Portrait prefer="avatar" person={shown} tree={tree} house={house} mourn={false} size={44} frame={false} age={s.age} />
              {t(s.label)}
            </button>
          ))}
        </div>
        <Switch checked={life} onChange={setLife} size="sm">{t('character.life')}</Switch>
        {life && (
          <div className="ce-life">
            {ages.map((a) => (
              <figure key={a}>
                <Portrait prefer="avatar" person={shown} tree={tree} house={house} mourn={false} size={52} age={a} />
                <figcaption>{a}</figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>

      <div className="ce-controls">
        <div className="ce-toolbar">
          <button type="button" className="btn" onClick={randomise}><Dices size={16} aria-hidden="true" /> {t('character.randomise')}</button>
          {aiAvatar ? (
            <button type="button" className="btn" onClick={() => setPicking((p) => !p)} aria-expanded={picking} aria-controls="ce-photo-pick">
              <Camera size={16} aria-hidden="true" /> {t('character.make_from_photo')}
            </button>
          ) : <AiSetupHint tree={tree} feature={t('character.make_from_photo')} />}
          <span className="ce-spacer" />
          <button type="button" className="btn ghost" onClick={undo} disabled={!history.length} aria-keyshortcuts="Control+Z Meta+Z"><Undo2 size={16} aria-hidden="true" /> {t('character.undo')}</button>
          <button type="button" className="btn ghost" onClick={reset}><RotateCcw size={16} aria-hidden="true" /> {t('character.reset')}</button>
        </div>
        {aiAvatar && picking && (
          <div className="ce-photo-pick" id="ce-photo-pick" role="group" aria-label={t('character.make_from_photo')}>
            <p className="ce-hint">{t('character.photo_pick')}</p>
            {photos.data?.length ? (
              <div className="ce-photo-grid">
                {photos.data.map((m) => (
                  <button key={m.key} type="button" className="ce-photo" disabled={fromPhoto.isPending} onClick={() => fromPhoto.mutate(m.key)}>
                    <img src={mediaUrl(tree, m.key)} alt="" loading="lazy" />
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
        <Tabs value={tab} onChange={setTab} label={t('character.appearance')}>
          <TabList>
            <Tab value="face">{t('character.tab.face')}</Tab>
            <Tab value="hair">{t('character.tab.hair')}</Tab>
            <Tab value="beard">{t('character.tab.beard')}</Tab>
            <Tab value="extras">{t('character.tab.headwear')}</Tab>
            <Tab value="clothes">{t('character.tab.clothes')}</Tab>
            <Tab value="age">{t('character.tab.age')}</Tab>
          </TabList>
          <TabPanel value="face">
            <Section title={t('character.section.skin')}>
              <Swatches
                value={look.skin}
                order={[...SKIN_ORDER, SKIN_NEUTRAL]}
                colours={SKIN}
                labels={SKIN_LABELS.map((k) => t(k))}
                neutral={SKIN_NEUTRAL}
                onPick={(i) => set('skin', i)}
              />
            </Section>
            <Section title={t('character.section.eyes')}>
              <Swatches value={look.eyes} order={EYES.map((_, i) => i)} colours={EYES} labels={EYE_LABELS.map((k) => t(k))} onPick={(i) => set('eyes', i)} />
            </Section>
            <Section title={t('character.section.eyebrows')}>{tiles({ field: 'brows', options: BROWS })}</Section>
            <Section title={t('character.section.marks')}>
              <div className="ce-tiles" role="group">
                <button type="button" className="ce-tile is-auto" aria-pressed={marks === undefined} onClick={() => set('marks', undefined)}>
                  <span className="ce-auto"><Sparkles size={20} aria-hidden="true" /></span>
                  {t('character.auto')}
                </button>
                {MARKS.map((m) => (
                  <button key={m.id} type="button" className="ce-tile" aria-pressed={!!marks?.includes(m.id)} onClick={() => toggleMark(m.id)}>
                    <Portrait prefer="avatar" person={tile('marks', [m.id])} tree={tree} house={house} mourn={false} size={56} frame={false} />
                    {t(m.label)}
                  </button>
                ))}
              </div>
            </Section>
          </TabPanel>
          <TabPanel value="hair">
            <Section title={t('character.section.colour')}>
              <Swatches value={look.hair} order={HAIR_ORDER} colours={HAIR} labels={HAIR_LABELS.map((k) => t(k))} onPick={(i) => set('hair', i)} />
              <Switch checked={look.hairGreys !== false} onChange={(v) => set('hairGreys', v ? undefined : false)} size="sm">{t('character.greys')}</Switch>
            </Section>
            <Section title={t('character.section.style')}>{tiles({ field: 'hairStyle', options: HAIR_STYLES })}</Section>
          </TabPanel>
          <TabPanel value="beard">
            {heroAge !== undefined && heroAge < 20 && <p className="ce-hint">{t('character.hint.beard_young')}</p>}
            <Section title={t('character.section.beard')}>{tiles({ field: 'beardStyle', options: BEARDS, adultOnly: true })}</Section>
            <Section title={t('character.section.moustache')}>{tiles({ field: 'moustache', options: MOUSTACHES, adultOnly: true })}</Section>
            {sex !== 'm' && <p className="ce-hint">{t('character.hint.beard_men')}</p>}
          </TabPanel>
          <TabPanel value="extras">
            <Section title={t('character.section.headwear')}>{tiles({ field: 'headwear', options: HEADWEAR, adultOnly: true })}</Section>
            <Section title={t('character.section.glasses')}>{tiles({ field: 'glasses', options: GLASSES, adultOnly: true })}</Section>
          </TabPanel>
          <TabPanel value="clothes">
            <p className="ce-hint">{t('character.hint.clothes')}</p>
            <Section title={t('character.section.clothing')}>{tiles({ field: 'clothing', options: CLOTHING })}</Section>
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
          </TabPanel>
        </Tabs>
      </div>
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

function Swatches({ value, order, colours, labels, neutral, onPick }: { value: number; order: number[]; colours: string[]; labels: string[]; neutral?: number; onPick: (i: number) => void }) {
  return (
    <div className="ce-swatches" role="group">
      {order.map((i) => (
        <button
          key={i}
          type="button"
          className={`ce-swatch${i === neutral ? ' is-neutral' : ''}`}
          aria-pressed={value === i}
          aria-label={labels[i]}
          title={labels[i]}
          onClick={() => onPick(i)}
          style={{ ['--sw' as string]: colours[i] }}
        >
          <span />
        </button>
      ))}
    </div>
  );
}

/** A plausible new face for this person: colours and features change; era-driven parts stay automatic. */
function randomLook(p: GPerson, current: Look): Look {
  const r = (n: number) => Math.floor(Math.random() * n);
  const pickOf = <T,>(xs: readonly T[]) => xs[r(xs.length)];
  const sex = p.sex === 'm' || p.sex === 'f' ? p.sex : 'x';
  const styles = HAIR_STYLES.map((s) => s.id).filter((s) => (sex === 'm' ? !['braid', 'pigtails', 'chignon', 'bun'].includes(s) : sex === 'f' ? !['receding', 'bald', 'periwig'].includes(s) : true));
  const next: Look = {
    skin: pickOf(SKIN_ORDER),
    hair: r(HAIR.length),
    eyes: r(EYES.length),
    ...(current.headwear ? { headwear: current.headwear } : {}),
    ...(current.clothing ? { clothing: current.clothing } : {}),
    ...(current.age !== undefined ? { age: current.age } : {}),
  };
  if (Math.random() < 0.6) next.hairStyle = pickOf(styles);
  next.brows = pickOf(BROWS).id;
  if (sex === 'm') {
    next.beardStyle = Math.random() < 0.45 ? 'none' : pickOf(BEARDS.slice(1)).id;
    next.moustache = Math.random() < 0.5 ? 'none' : pickOf(MOUSTACHES.slice(1)).id;
  }
  const marks: Mark[] = [];
  if (Math.random() < 0.25) marks.push('freckles');
  if (Math.random() < 0.1) marks.push('mole');
  next.marks = marks;
  if (Math.random() < 0.15) next.glasses = pickOf(GLASSES.slice(1)).id;
  return next;
}
