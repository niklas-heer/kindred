// The arms designer: a big live shield and its blazon on the left; on the right the layers (field, division,
// ordinaries, charges, achievement) and a picker for the chosen one, plus presets and canting suggestions.
// Loaded on demand by ArmsEditor, so the house page does not carry it.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown, ArrowUp, Crown, Dices, Info, Layers, Plus, Redo2, RotateCcw, Search, Shield, Sparkles, Trash2, Undo2, Wand2,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { graphQuery, opKeys, updateHouse } from '~/lib/api';
import { aiArmsRevisions } from '~/lib/ai/arms.functions';
import { checkArmsFit } from '~/lib/ai/arms-fit.functions';
import { toAiLocale, type ArmsRevision } from '~/lib/ai/types';
import { myFamiliesQuery } from '~/lib/auth/functions';
import { armsReviewsQuery, houseMeaningsQuery, settleArmsReview } from '~/lib/house-meaning.functions';
import { chosenMeanings, surnameOf, type ArmsReview } from '~/lib/house-meaning';
import { useT, type Key, type Translator } from '~/lib/i18n';
import type {
  Achievement, ArmsLayer, ArmsV2, ChargeArrangement, ChargeLayer, FieldDivision, HelmRank, OrdinaryKind, OrdinaryLayer,
  PartitionLine, ShieldShape, TinctureV2,
} from '~/lib/seed-format';
import { useCan } from '~/lib/session';
import { play } from '~/lib/sfx';
import { toast } from '~/lib/toast';
import type { House } from '~/lib/types';
import { useAiStatus } from '../assistant/store';
import { AiSetupHint } from '../assistant/AiSetup';
import { Dialog } from '../ui/Dialog';
import { Range } from '../ui/Range';
import { Select } from '../ui/Select';
import { Switch } from '../ui/Switch';
import { Tab, TabList, TabPanel, Tabs } from '../ui/Tabs';
import { ensureLibrary, glyph, useLibrary, useLibraryMeta } from './art';
import { blazonAchievement, blazonV2, chargeNoun } from './blazon';
import { CANTING_SOURCE_NOTE, cantingArms } from './canting';
import { CATEGORIES, HELM_GLYPH, SUPPORTERS, type ChargeCategory } from './catalogue';
import { searchCharges } from './charge-search';
import { asV2, storeV2 } from './convert';
import { Flag } from './Flag';
import { NameResearchPanel } from './NameResearch';
import { ArmsRevisions } from './ArmsRevisions';
import { ArmsMeanings, ChargeGlyph, useWide } from './ArmsMeanings';
import { chargeMeaning, divisionMeaning, ordinaryMeaning, tinctureMeaning } from './meanings';
import { allChargeDefs, chargeDef, chargeLabel, chargeName } from './registry';
import { arrangementsFor, COTISABLE, edge, tinctureCount, type Pt } from './geometry';
import { PRESETS } from './presets';
import { ArmsV2View, fieldTinctures, TinctureSwatch } from './render';
import { contrastFor, randomArmsV2, tinctureClashesV2, underOf } from './rules';
import { kindOf, labelV2, TINCTURES_V2 } from './tinctures';
import { ARRANGEMENTS, DIVISIONS_V2, divisionLabel, HELMS, LINES_V2, ORDINARIES, ordinaryLabel, SHIELDS } from './vocab';
import '../armseditor.css';

interface Draft {
  name: string;
  motto: string;
  arms: ArmsV2;
}
type Sel = 'field' | 'division' | 'achievement' | number;

const draftOf = (h: House): Draft => ({ name: h.name, motto: h.motto ?? '', arms: structuredClone(asV2(h.arms)) });
const key = (d: Draft) => JSON.stringify([d.name.trim(), d.motto.trim(), d.arms]);

/** The draft with undo and redo. Typing in one text field counts as a single step. */
function useHistory(initial: Draft) {
  const [s, setS] = useState<{ now: Draft; past: Draft[]; future: Draft[]; key?: string }>({ now: initial, past: [], future: [] });
  return {
    draft: s.now,
    canUndo: s.past.length > 0,
    canRedo: s.future.length > 0,
    set(next: Draft, k?: string) {
      setS((x) => {
        if (key(x.now) === key(next)) return x;
        const merge = k !== undefined && k === x.key;
        return { now: next, past: merge ? x.past : [...x.past.slice(-79), x.now], future: [], key: k };
      });
    },
    undo: () => setS((x) => (x.past.length ? { now: x.past[x.past.length - 1], past: x.past.slice(0, -1), future: [x.now, ...x.future] } : x)),
    redo: () => setS((x) => (x.future.length ? { now: x.future[0], past: [...x.past, x.now], future: x.future.slice(1) } : x)),
    restart: (d: Draft) => setS({ now: d, past: [], future: [] }),
  };
}

/** The tab a designer opens on: the design itself, or the suggestions ("Suggest arms from the name"). */
export type DesignerTab = 'design' | 'presets' | 'name';

export default function Designer({ open, onClose, house, tree, initialTab = 'design', revise }: {
  open: boolean; onClose: () => void; house: House; tree: string; initialTab?: DesignerTab;
  /** The check the steward asked suggestions from: the name tab asks for them once, when the designer opens with it. */
  revise?: ArmsReview;
}) {
  const qc = useQueryClient();
  const tr = useT();
  const allowed = useCan('edit-house');
  const country = (house as House & { country?: string }).country;
  const saved = useMemo(() => draftOf(house), [house]);
  const h = useHistory(saved);
  const { draft } = h;
  const a = draft.arms;
  const [rawSel, setSel] = useState<Sel>(a.layers.length ? a.layers.length - 1 : 'field');
  // After an undo the chosen layer may be gone: fall back to the field.
  const sel: Sel = typeof rawSel === 'number' && !a.layers[rawSel] ? 'field' : rawSel;
  const [tab, setTab] = useState<string>(initialTab);
  const [full, setFull] = useState(!!a.achievement);

  // Each opening starts from the arms as they are now, on the tab asked for, and fetches the charge library.
  useEffect(() => {
    if (!open) return;
    const d = draftOf(house);
    h.restart(d);
    setSel(d.arms.layers.length ? d.arms.layers.length - 1 : 'field');
    setTab(initialTab);
    setFull(!!d.arms.achievement);
    save.reset();
    void ensureLibrary().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // What the name means, as saved. The suggestions from the check draw on it; sealing checks the arms against it again.
  const meaningsQ = useQuery({ ...houseMeaningsQuery(tree), enabled: allowed });
  const researched = meaningsQ.data?.[house.id];
  const [checkKeys] = useState(() => opKeys());
  const [revisions, setRevisions] = useState<ArmsRevision[] | null>(null);
  const asked = useRef<ArmsReview | null>(null);
  // Whether the draft comes from a suggestion. Sealing it is the steward's decision, so it settles the check instead of asking again.
  const fromSuggestion = useRef(false);
  // Suggestions from the check: refinements of the arms as saved, and fresh designs from the chosen meanings. Only asked for on
  // the card's click; nothing is saved, and choosing one loads it into the editor.
  const revise$ = useMutation({
    mutationFn: (r: ArmsReview) => {
      if (!researched) throw new Error('houses.meaning.err_not_researched');
      return aiArmsRevisions({ data: {
        tree, surname: researched.name, country, familyHint: researched.familyWords || undefined, locale: toAiLocale(tr.locale),
        meanings: chosenMeanings(researched).map(({ chosen: _chosen, sources: _sources, ...m }) => m),
        arms: saved.arms, feedback: { reason: r.reason, advice: r.advice },
      } });
    },
    onSuccess: (list) => setRevisions(list),
  });
  useEffect(() => {
    if (!open) { asked.current = null; return; }
    fromSuggestion.current = false;
    setRevisions(null);
  }, [open]);
  useEffect(() => {
    if (!open || !revise || !researched || asked.current === revise) return;
    asked.current = revise;
    revise$.mutate(revise);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, revise, researched]);

  const save = useMutation({
    mutationFn: (d: Draft) =>
      // Saving from the designer always stores the design (v2), even when nothing changed: a v1 house saved as it was
      // is then no longer on generated arms, so the steward's badge goes.
      updateHouse({ data: { tree, id: house.id, name: d.name.trim(), motto: d.motto.trim() || null, arms: storeV2(d.arms) } }),
    onSuccess: async (h2, d) => {
      await Promise.all([qc.invalidateQueries({ queryKey: graphQuery(tree).queryKey }), qc.invalidateQueries({ queryKey: myFamiliesQuery.queryKey })]);
      play('seal');
      toast({ title: tr('heraldry.sealed'), body: tr('heraldry.sealed_body', { name: h2.name }), icon: 'crown' });
      // The review on screen is about the arms just replaced: read it again now, so the card stops speaking for them at once.
      const reviews = () => qc.invalidateQueries({ queryKey: armsReviewsQuery(tree).queryKey });
      void reviews();
      // A design picked from the suggestions settles the check. Arms drawn by hand are checked against the name, as after a saved research.
      if (researched) {
        const opKey = checkKeys.for('seal', { house: house.id, at: Date.now() });
        void (fromSuggestion.current
          ? settleArmsReview({ data: { tree, house: house.id, opKey } })
          : checkArmsFit({ data: { tree, house: house.id, opKey, locale: toAiLocale(tr.locale), force: false } })
        ).finally(() => { void reviews(); });
      }
      onClose();
    },
  });

  const dirty = key(draft) !== key(saved);
  const nameOk = draft.name.trim().length > 0;
  const setArms = (next: ArmsV2, k?: string) => h.set({ ...draft, arms: next }, k);
  const clashes = tinctureClashesV2(a, tr);
  useLibraryMeta();
  const shield = blazonV2(a, tr.locale);
  const achievementText = blazonAchievement(a.achievement, tr.locale);
  // "What it means" is open on a wide screen and folded on a phone, where the pickers have no hover.
  const wide = useWide();

  const onKeyDown = (e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || (e.target as HTMLElement).closest('input, textarea')) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); h.undo(); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); h.redo(); }
  };

  if (!allowed) return null;
  return (
    <Dialog
      open={open}
      onClose={() => { if (!save.isPending) onClose(); }}
      title={tr('heraldry.dialog_title')}
      description={<>{tr('heraldry.dialog_desc_pre')} <b>{saved.name}</b>{tr('heraldry.dialog_desc_post')}</>}
      variant="event"
      width={1180}
      dirty={dirty}
      dismissible={!save.isPending}
      initialFocus=".ae-layers [aria-current='true']"
      className="ae-dialog"
      bodyClassName="ae-body"
      onKeyDown={onKeyDown}
      footer={
        <div className="ae-foot">
          <div className="ae-tools">
            <button type="button" className="btn" onClick={() => { fromSuggestion.current = false; setArms(randomArmsV2()); setSel('field'); play('tick'); }}>
              <Dices size={16} aria-hidden /> {tr('heraldry.randomise')}
            </button>
            <button type="button" className="btn ghost" onClick={h.undo} disabled={!h.canUndo} aria-keyshortcuts="Meta+Z Control+Z" title={tr('heraldry.undo_title')}>
              <Undo2 size={16} aria-hidden /> <span className="ae-tool-label">{tr('heraldry.undo')}</span>
            </button>
            <button type="button" className="btn ghost" onClick={h.redo} disabled={!h.canRedo} aria-keyshortcuts="Meta+Shift+Z Control+Y" title={tr('heraldry.redo_title')}>
              <Redo2 size={16} aria-hidden /> <span className="ae-tool-label">{tr('heraldry.redo')}</span>
            </button>
            <button type="button" className="btn ghost" onClick={() => { fromSuggestion.current = false; h.set(draftOf(house)); }} disabled={!dirty}>
              <RotateCcw size={16} aria-hidden /> <span className="ae-tool-label">{tr('heraldry.reset')}</span>
            </button>
          </div>
          {save.isError && (
            <p className="ae-error" role="alert">
              {save.error instanceof Error && save.error.message ? save.error.message : tr('heraldry.save_failed')} {tr('heraldry.save_failed_hint')}
            </p>
          )}
          <div className="ae-actions">
            <button type="button" className="btn" onClick={onClose} disabled={save.isPending}>{tr('heraldry.cancel')}</button>
            <button type="button" className="btn primary" onClick={() => save.mutate(draft)} disabled={!dirty || !nameOk || save.isPending}>
              {save.isPending ? tr('heraldry.sealing') : tr('heraldry.seal')}
            </button>
          </div>
        </div>
      }
    >
      <div className="ae-grid">
        <div className="ae-left">
        <section className="ae-preview" aria-label={tr('heraldry.preview')}>
          <div className="ae-stage" data-full={(full && !!a.achievement) || undefined}>
            <ArmsV2View arms={a} size={full && a.achievement ? 150 : 220} full={full} title={tr('heraldry.arms_title', { name: draft.name.trim() || tr('heraldry.the_house'), blazon: shield })} />
            {country && <span className="ae-flag"><Flag code={country} size={16} /></span>}
          </div>
          {a.achievement && (
            <Switch size="sm" checked={full} onChange={setFull} className="ae-full-switch">{tr('heraldry.full_achievement')}</Switch>
          )}
          <div className="ae-caption">
            <b className="ae-name">{draft.name.trim() || tr('heraldry.unnamed')}</b>
            {draft.motto.trim() && <i className="ae-motto">“{draft.motto.trim()}”</i>}
            <p className="ae-blazon" aria-live="polite"><span className="ae-blazon-label">{tr('heraldry.blazon')}</span> {shield}.{achievementText && <> <span className="ae-blazon-ach">{achievementText}</span></>}</p>
          </div>
        </section>
        <ArmsMeanings arms={a} open={wide} />
        <div className="ae-meta">
          <div className="ae-rule" aria-live="polite">
            {clashes.length > 0 && (
              <div className="ae-warn">
                <Info size={16} aria-hidden />
                <div>
                  <ul>
                    {clashes.map((c, i) => (
                      <li key={i}>
                        {c.message}{' '}
                        {c.fix && <button type="button" className="ae-fix" onClick={() => setArms(c.fix!.apply(a))}>{c.fix.label}</button>}
                      </li>
                    ))}
                  </ul>
                  <small>{tr('heraldry.rule_note')}</small>
                </div>
              </div>
            )}
          </div>
          <div className="ae-texts">
            <label className="field">
              <span>{tr('heraldry.house_name')}</span>
              <input className="input" value={draft.name} maxLength={80} required aria-invalid={!nameOk || undefined} onChange={(e) => h.set({ ...draft, name: e.target.value }, 'name')} />
            </label>
            <label className="field">
              <span>{tr('heraldry.motto')}</span>
              <input className="input" value={draft.motto} maxLength={160} placeholder={tr('heraldry.motto_placeholder')} onChange={(e) => h.set({ ...draft, motto: e.target.value }, 'motto')} />
            </label>
          </div>
        </div>
        </div>

        <div className="ae-work">
          <Tabs value={tab} onChange={setTab} label={tr('heraldry.designer_label')}>
            <TabList>
              <Tab value="design" icon={<Layers size={15} />}>{tr('heraldry.tab_design')}</Tab>
              <Tab value="presets" icon={<Shield size={15} />}>{tr('heraldry.tab_presets')}</Tab>
              <Tab value="name" icon={<Wand2 size={15} />}>{tr('heraldry.tab_name')}</Tab>
            </TabList>
            <TabPanel value="design">
              <div className="ae-design">
                <LayerList arms={a} sel={sel} setSel={setSel} setArms={setArms} />
                <div className="ae-inspector">
                  <Inspector arms={a} sel={sel} setArms={setArms} motto={draft.motto} onFull={() => setFull(true)} />
                </div>
              </div>
            </TabPanel>
            <TabPanel value="presets">
              <p className="subtle ae-lead">{tr('heraldry.presets_lead')}</p>
              <div className="ae-gallery">
                {PRESETS.map((p) => (
                  <button key={p.id} type="button" className="ae-card" onClick={() => { fromSuggestion.current = false; setArms(structuredClone(p.arms)); setSel(p.arms.layers.length ? p.arms.layers.length - 1 : 'field'); setFull(!!p.arms.achievement); setTab('design'); play('tick'); }}>
                    <ArmsV2View arms={p.arms} size={64} />
                    <span className="ae-card-title">{tr(p.label)}</span>
                    <small>{blazonV2(p.arms, tr.locale)}</small>
                  </button>
                ))}
              </div>
            </TabPanel>
            <TabPanel value="name">
              {revise && (
                <ArmsRevisions
                  feedback={{ reason: revise.reason, advice: revise.advice }}
                  busy={revise$.isPending}
                  error={revise$.isError ? revise$.error : undefined}
                  revisions={revisions}
                  onRetry={() => revise$.mutate(revise)}
                  onPick={(arms) => { fromSuggestion.current = true; setArms(arms); setSel(arms.layers.length ? arms.layers.length - 1 : 'field'); setTab('design'); }}
                />
              )}
              <Suggestions tree={tree} house={house.id} initial={surnameOf(saved.name)} country={country} allowed={allowed} onPick={(arms) => { fromSuggestion.current = true; setArms(arms); setSel(arms.layers.length ? arms.layers.length - 1 : 'field'); setTab('design'); play('tick'); }} />
            </TabPanel>
          </Tabs>
        </div>
      </div>
    </Dialog>
  );
}

// ---------- suggestions from the name ----------

/** The offline ideas for a name, then (with AI arms on, for stewards) the AI's research and designs. */
function Suggestions({ tree, house, initial, country, allowed, onPick }: { tree: string; house: string; initial: string; country?: string; allowed: boolean; onPick: (a: ArmsV2) => void }) {
  const t = useT();
  const aiFeature = !!useAiStatus(tree)?.features.arms;
  const aiOn = aiFeature && allowed;
  const [name, setName] = useState(initial);
  // The library's names arrive after the first render: the offline ideas then name their charges, so they are made again.
  const metaReady = useLibraryMeta();
  const list = useMemo(() => cantingArms(name, country, t), [name, country, t.locale, metaReady]);
  return (
    <div className="ae-suggest">
      <label className="field ae-suggest-name">
        <span>{t('heraldry.name_to_read')}</span>
        <input
          className="input"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('heraldry.name_placeholder')}
        />
      </label>
      <p className="subtle ae-lead">{t(CANTING_SOURCE_NOTE)}</p>
      {list.length === 0 ? (
        <p className="subtle">{t('heraldry.type_name')}</p>
      ) : (
        <div className="ae-gallery ae-gallery-wide">
          {list.map((s, i) => (
            <button key={i} type="button" className="ae-card ae-card-wide" onClick={() => onPick(structuredClone(s.arms))}>
              <ArmsV2View arms={s.arms} size={72} />
              <span className="ae-card-text">
                <span className="ae-card-title">{s.explanation}</span>
                <small>{blazonV2(s.arms, t.locale)}</small>
              </span>
            </button>
          ))}
        </div>
      )}
      {aiOn && name.trim() !== '' && <NameResearchPanel tree={tree} surname={name} country={country} onPick={onPick} house={house} />}
      {allowed && !aiFeature && name.trim() !== '' && (
        <div className="ae-ai-more">
          <AiSetupHint tree={tree} feature={t('heraldry.research_name')} />
        </div>
      )}
    </div>
  );
}

// ---------- the layer list ----------

/** English reads mid-sentence in lower case; the other languages keep their own capitals. */
const low = (tr: Translator, s: string) => (tr.locale === 'en' ? s.toLowerCase() : s);
const lineName = (tr: Translator, line: PartitionLine) => low(tr, tr(`heraldry.line.${line}` as Key));

function layerTitle(l: ArmsLayer, tr: Translator): string {
  if (l.type === 'ordinary') return `${tr(ordinaryLabel(l.kind))}${l.line !== 'straight' ? ` ${lineName(tr, l.line)}` : ''}`;
  const n = l.arrangement === 'seme' ? 2 : l.count;
  // English blazons the noun ("three mullets"); the other languages name the charge and count it.
  const english = tr.locale === 'en';
  const noun = english ? chargeNoun(l.charge, n) : chargeName(l.charge, tr.locale);
  if (l.arrangement === 'seme') return tr('heraldry.seme_of', { noun: low(tr, noun) });
  if (n === 1) return english ? noun.charAt(0).toUpperCase() + noun.slice(1) : noun;
  return english ? `${n} ${noun}` : `${n} × ${noun}`;
}

function LayerList({ arms, sel, setSel, setArms }: { arms: ArmsV2; sel: Sel; setSel: (s: Sel) => void; setArms: (a: ArmsV2) => void }) {
  const tr = useT();
  const ft = fieldTinctures(arms);
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= arms.layers.length) return;
    const layers = [...arms.layers];
    [layers[i], layers[j]] = [layers[j], layers[i]];
    setArms({ ...arms, layers });
    setSel(j);
  };
  const remove = (i: number) => {
    setArms({ ...arms, layers: arms.layers.filter((_, k) => k !== i) });
    setSel(i > 0 ? i - 1 : arms.layers.length > 1 ? 0 : 'field');
  };
  const addOrdinary = () => {
    const kind: OrdinaryKind = arms.layers.some((l) => l.type === 'ordinary' && l.kind === 'chief') ? 'fess' : 'chief';
    const layer: OrdinaryLayer = { type: 'ordinary', kind, tincture: contrastFor(ft), line: 'straight' };
    // Ordinaries go under the charges, as heralds paint them.
    const at = arms.layers.findIndex((l) => l.type === 'charge');
    const layers = [...arms.layers];
    layers.splice(at < 0 ? layers.length : at, 0, layer);
    setArms({ ...arms, layers });
    setSel(at < 0 ? layers.length - 1 : at);
  };
  const addCharges = () => {
    const layer: ChargeLayer = { type: 'charge', charge: 'mullet', tincture: contrastFor(ft), count: arms.layers.some((l) => l.type === 'charge') ? 1 : 3, arrangement: 'auto', on: 'field' };
    setArms({ ...arms, layers: [...arms.layers, layer] });
    setSel(arms.layers.length);
  };
  const rowKey = (e: KeyboardEvent, i: number) => {
    if (!e.altKey) return;
    if (e.key === 'ArrowUp') { e.preventDefault(); move(i, -1); }
    if (e.key === 'ArrowDown') { e.preventDefault(); move(i, 1); }
  };
  const div = arms.field.division;
  return (
    <nav className="ae-layers" aria-label={tr('heraldry.layers')}>
      <ol>
        <li>
          <LayerRow current={sel === 'field'} onSelect={() => setSel('field')} title={tr('heraldry.field')} hint={`${tr(SHIELDS.find((s) => s.id === arms.shield)!.label)} · ${tr(labelV2(ft[0]))}`} icon={<TinctureSwatch t={ft[0]} size={22} />} />
        </li>
        <li>
          <LayerRow current={sel === 'division'} onSelect={() => setSel('division')} title={tr('heraldry.division')} hint={div === 'plain' ? tr('heraldry.none') : `${tr(divisionLabel(div))}${arms.field.line !== 'straight' ? ` ${lineName(tr, arms.field.line)}` : ''}`}
            icon={<MiniShield arms={{ ...arms, layers: [], achievement: undefined }} />}
            onRemove={div !== 'plain' ? () => setArms({ ...arms, field: { ...arms.field, division: 'plain', tinctures: [ft[0]] } }) : undefined} removeLabel={tr('heraldry.remove_division')} />
        </li>
        {arms.layers.map((l, i) => (
          <li key={i}>
            <LayerRow
              current={sel === i}
              onSelect={() => setSel(i)}
              onKeyDown={(e) => rowKey(e, i)}
              title={layerTitle(l, tr)}
              hint={l.counterchanged ? tr('heraldry.counterchanged') : tr(labelV2(l.tincture))}
              icon={l.type === 'ordinary' ? <MiniShield arms={{ shield: arms.shield, field: { division: 'plain', tinctures: ['argent'], line: 'straight' }, layers: [{ ...l, counterchanged: false, tincture: l.tincture === 'argent' ? 'sable' : l.tincture }] }} /> : <ChargeGlyph id={l.charge} size={22} />}
              onUp={i > 0 ? () => move(i, -1) : undefined}
              onDown={i < arms.layers.length - 1 ? () => move(i, 1) : undefined}
              onRemove={() => remove(i)}
              removeLabel={tr('heraldry.remove_layer', { what: low(tr, layerTitle(l, tr)) })}
            />
          </li>
        ))}
        <li>
          <LayerRow current={sel === 'achievement'} onSelect={() => setSel('achievement')} title={tr('heraldry.achievement')} hint={arms.achievement ? tr('heraldry.ach_hint') : tr('heraldry.shield_only')} icon={<Crown size={18} aria-hidden />}
            onRemove={arms.achievement ? () => setArms({ ...arms, achievement: undefined }) : undefined} removeLabel={tr('heraldry.remove_achievement')} />
        </li>
      </ol>
      <div className="ae-add">
        <button type="button" className="btn ghost" onClick={addOrdinary} disabled={arms.layers.length >= 12}><Plus size={15} aria-hidden /> {tr('heraldry.add_ordinary')}</button>
        <button type="button" className="btn ghost" onClick={addCharges} disabled={arms.layers.length >= 12}><Plus size={15} aria-hidden /> {tr('heraldry.add_charges')}</button>
      </div>
    </nav>
  );
}

function LayerRow({ current, onSelect, title, hint, icon, onUp, onDown, onRemove, removeLabel, onKeyDown }: {
  current: boolean; onSelect: () => void; title: string; hint: string; icon: ReactNode;
  onUp?: () => void; onDown?: () => void; onRemove?: () => void; removeLabel?: string; onKeyDown?: (e: KeyboardEvent) => void;
}) {
  const tr = useT();
  return (
    <div className="ae-layer" data-current={current || undefined}>
      <button type="button" className="ae-layer-main" aria-current={current} onClick={onSelect} onKeyDown={onKeyDown} aria-keyshortcuts={onUp || onDown ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}>
        <span className="ae-layer-icon" aria-hidden>{icon}</span>
        <span className="ae-layer-text"><b>{title}</b><small>{hint}</small></span>
      </button>
      {(onUp || onDown) && (
        <span className="ae-layer-move">
          <button type="button" className="ae-icon-btn" onClick={onUp} disabled={!onUp} aria-label={tr('heraldry.move_up', { what: low(tr, title) })} title={tr('heraldry.move_up_title')}><ArrowUp size={14} /></button>
          <button type="button" className="ae-icon-btn" onClick={onDown} disabled={!onDown} aria-label={tr('heraldry.move_down', { what: low(tr, title) })} title={tr('heraldry.move_down_title')}><ArrowDown size={14} /></button>
        </span>
      )}
      {onRemove && <button type="button" className="ae-icon-btn ae-remove" onClick={onRemove} aria-label={removeLabel} title={removeLabel}><Trash2 size={14} /></button>}
    </div>
  );
}

const MiniShield = ({ arms, size = 20 }: { arms: ArmsV2; size?: number }) => <ArmsV2View arms={arms} size={size} className="ae-mini" />;

// ---------- the inspector ----------

function Inspector({ arms, sel, setArms, motto, onFull }: { arms: ArmsV2; sel: Sel; setArms: (a: ArmsV2, k?: string) => void; motto: string; onFull: () => void }) {
  const ft = fieldTinctures(arms);
  const tr = useT();
  if (sel === 'field') {
    return (
      <>
        <Section title={tr('heraldry.shield')}>
          <Choices label={tr('heraldry.shield_shape')} className="ae-shields" value={arms.shield} onChange={(shield: ShieldShape) => setArms({ ...arms, shield })}
            options={SHIELDS.map((s) => ({ value: s.id, label: `${tr(s.label)}: ${tr(s.hint)}` }))}
            render={(o) => <><MiniShield arms={{ ...arms, shield: o.value, achievement: undefined }} size={34} /><small>{tr(SHIELDS.find((s) => s.id === o.value)!.label)}</small></>} />
        </Section>
        <Section title={tr('heraldry.field_tincture')}>
          <TincturePicker label={tr('heraldry.field_tincture')} value={ft[0]} onChange={(t) => setArms({ ...arms, field: { ...arms.field, tinctures: [t, ...ft.slice(1)] } })} />
        </Section>
      </>
    );
  }
  if (sel === 'division') {
    const div = arms.field.division;
    const info = DIVISIONS_V2.find((d) => d.id === div)!;
    const setDiv = (d: FieldDivision) => {
      const n = tinctureCount(d);
      const t = [...ft];
      while (t.length < n) t.push(t.length === 1 ? contrastFor([t[0]]) : (['gules', 'azure', 'vert', 'sable'] as TinctureV2[]).find((x) => !t.includes(x))!);
      setArms({ ...arms, field: { ...arms.field, division: d, tinctures: t.slice(0, n), line: DIVISIONS_V2.find((x) => x.id === d)!.lines ? arms.field.line : 'straight' } });
    };
    return (
      <>
        <Section title={tr('heraldry.division')}>
          <Choices label={tr('heraldry.division')} className="ae-tiles ae-tiles-shield" value={div} onChange={setDiv} hint={(v) => tr(divisionMeaning(v))}
            options={DIVISIONS_V2.map((d) => ({ value: d.id, label: tr(d.label) }))}
            render={(o) => <><MiniShield arms={{ shield: arms.shield, field: { division: o.value, tinctures: tinctureCount(o.value) === 3 ? [ft[0], ft[1] ?? contrastFor([ft[0]]), ft[2] ?? 'azure'] : [ft[0], ft[1] ?? contrastFor([ft[0]])], line: 'straight' }, layers: [] }} size={34} /><small>{o.label}</small></>} />
        </Section>
        {div !== 'plain' && info.lines && (
          <Section title={tr('heraldry.line_of_partition')}>
            <LinePicker value={arms.field.line} onChange={(line) => setArms({ ...arms, field: { ...arms.field, line } })} />
          </Section>
        )}
        {info.pieces && (
          <Section title={tr('heraldry.pieces')}>
            <Range value={arms.field.pieces ?? 6} min={4} max={10} step={1} ticks={[4, 6, 8, 10].map((v) => ({ value: v, label: String(v) }))} aria-label={tr('heraldry.number_of_pieces')} format={(v) => tr('heraldry.pieces_count', { count: v })}
              onChange={(pieces) => setArms({ ...arms, field: { ...arms.field, pieces } }, 'pieces')} />
          </Section>
        )}
        {ft.slice(1).map((t, i) => (
          <Section key={i} title={i === 0 ? tr('heraldry.second_tincture') : tr('heraldry.third_tincture')}>
            <TincturePicker label={i === 0 ? tr('heraldry.second_tincture') : tr('heraldry.third_tincture')} value={t} under={[ft[0]]} onChange={(x) => setArms({ ...arms, field: { ...arms.field, tinctures: ft.map((y, k) => (k === i + 1 ? x : y)) } })} />
          </Section>
        ))}
        {div === 'plain' && <p className="subtle ae-lead">{tr('heraldry.pick_division')}</p>}
      </>
    );
  }
  if (sel === 'achievement') return <AchievementInspector arms={arms} setArms={setArms} motto={motto} onFull={onFull} />;
  const layer = arms.layers[sel];
  if (!layer) return null;
  const patch = (p: Partial<ArmsLayer>, k?: string) => setArms({ ...arms, layers: arms.layers.map((l, i) => (i === sel ? ({ ...l, ...p } as ArmsLayer) : l)) }, k);
  const under = underOf(arms, sel);
  const divided = ft.length > 1;
  if (layer.type === 'ordinary') {
    return (
      <>
        <Section title={tr('heraldry.ordinary')}>
          <Choices label={tr('heraldry.ordinary')} className="ae-tiles ae-tiles-shield" value={layer.kind} onChange={(kind: OrdinaryKind) => patch({ kind })} hint={(v) => tr(ordinaryMeaning(v))}
            options={ORDINARIES.map((o) => ({ value: o.id, label: tr(o.label) }))}
            render={(o) => <><MiniShield arms={{ shield: arms.shield, field: { division: 'plain', tinctures: [ft[0]], line: 'straight' }, layers: [{ ...layer, kind: o.value, counterchanged: false, tincture: contrastFor([ft[0]], layer.tincture) }] }} size={34} /><small>{o.label}</small></>} />
        </Section>
        <Section title={tr('heraldry.line')}>
          <LinePicker value={layer.line} onChange={(line) => patch({ line })} />
        </Section>
        <Section title={tr('heraldry.tincture')}>
          <TincturePicker label={tr('heraldry.ordinary_tincture')} value={layer.tincture} under={under} disabled={!!layer.counterchanged && divided} onChange={(tincture) => patch({ tincture })} />
        </Section>
        <div className="ae-switches">
          <Switch checked={!!layer.cotised} disabled={!COTISABLE.has(layer.kind)} onChange={(cotised) => patch({ cotised })}>{tr('heraldry.cotised')}{!COTISABLE.has(layer.kind) && <small className="subtle"> · {tr('heraldry.cotised_hint')}</small>}</Switch>
          <Switch checked={!!layer.counterchanged} disabled={!divided} onChange={(counterchanged) => patch({ counterchanged })}>{tr('heraldry.counterchange')}{!divided && <small className="subtle"> · {tr('heraldry.needs_divided')}</small>}</Switch>
        </div>
      </>
    );
  }
  const def = chargeDef(layer.charge);
  const hasOrdinary = arms.layers.slice(0, sel).some((l) => l.type === 'ordinary');
  const arrs = arrangementsFor(layer.count);
  return (
    <>
      <Section title={tr('heraldry.charge')}>
        <ChargePicker value={layer.charge} onChange={(charge) => patch({ charge, ...(chargeDef(charge)?.facing ? {} : { contourne: undefined }) })} />
      </Section>
      <Section title={tr('heraldry.tincture')}>
        <TincturePicker label={tr('heraldry.charge_tincture')} value={layer.tincture} under={under} allowProper charge={layer.charge} disabled={!!layer.counterchanged && divided} onChange={(tincture) => patch({ tincture })} />
      </Section>
      <div className="ae-row">
        <Section title={tr('heraldry.how_many')}>
          <Range value={layer.arrangement === 'seme' ? 1 : layer.count} min={1} max={9} step={1} disabled={layer.arrangement === 'seme'} ticks={[1, 3, 5, 7, 9].map((v) => ({ value: v, label: String(v) }))} aria-label={tr('heraldry.how_many_aria')} format={(v) => `${v}`}
            onChange={(count) => patch({ count, arrangement: arrangementsFor(count).includes(layer.arrangement) ? layer.arrangement : 'auto' }, 'count')} />
        </Section>
        <Section title={tr('heraldry.arrangement')}>
          <Select<ChargeArrangement> value={layer.arrangement} onChange={(arrangement) => patch({ arrangement })} aria-label={tr('heraldry.arrangement')}
            options={arrs.map((x) => ({ value: x, label: tr(ARRANGEMENTS.find((r) => r.id === x)!.label) }))} />
        </Section>
      </div>
      <Section title={tr('heraldry.placed')}>
        <Choices label={tr('heraldry.where_lie')} className="ae-seg" value={layer.on} onChange={(on: ChargeLayer['on']) => patch({ on })}
          options={[
            { value: 'field' as const, label: tr('heraldry.on_field') },
            { value: 'ordinary' as const, label: tr('heraldry.on_ordinary'), disabled: !hasOrdinary },
            { value: 'chief' as const, label: tr('heraldry.in_chief') },
            { value: 'base' as const, label: tr('heraldry.in_base') },
          ]}
          render={(o) => <small>{o.label}</small>} />
      </Section>
      <Section title={tr('heraldry.size')}>
        <Range value={Math.round((layer.scale ?? 1) * 100)} min={60} max={140} step={5} ticks={[{ value: 60, label: tr('heraldry.small') }, { value: 100, label: tr('heraldry.usual') }, { value: 140, label: tr('heraldry.large') }]} aria-label={tr('heraldry.charge_size')} format={(v) => `${v}%`}
          onChange={(v) => patch({ scale: v === 100 ? undefined : v / 100 }, 'scale')} />
      </Section>
      <div className="ae-switches">
        <Switch checked={!!layer.contourne} disabled={!def?.facing} onChange={(contourne) => patch({ contourne })}>{tr('heraldry.contourne')}{!def?.facing && <small className="subtle"> · {tr('heraldry.faces_front')}</small>}</Switch>
        <Switch checked={!!layer.counterchanged} disabled={!divided} onChange={(counterchanged) => patch({ counterchanged })}>{tr('heraldry.counterchange')}{!divided && <small className="subtle"> · {tr('heraldry.needs_divided')}</small>}</Switch>
      </div>
    </>
  );
}

function AchievementInspector({ arms, setArms, motto, onFull }: { arms: ArmsV2; setArms: (a: ArmsV2, k?: string) => void; motto: string; onFull: () => void }) {
  const ach = arms.achievement;
  const ft = fieldTinctures(arms);
  const tr = useT();
  if (!ach) {
    return (
      <div className="ae-empty">
        <Crown size={28} aria-hidden />
        <p>{tr('heraldry.achievement_text')}</p>
        <button type="button" className="btn primary" onClick={() => {
          const lining = arms.layers.find((l) => l.type === 'charge')?.tincture;
          const outer = ft.find((t) => kindOf(t) === 'colour') ?? 'gules';
          setArms({ ...arms, achievement: { helm: 'esquire', torse: true, mantling: [outer, lining && kindOf(lining) === 'metal' ? lining : 'or'], ...(motto.trim() && { motto: motto.trim() }) } });
          onFull();
        }}><Sparkles size={16} aria-hidden /> {tr('heraldry.add_achievement')}</button>
      </div>
    );
  }
  const set = (p: Partial<Achievement>, k?: string) => { setArms({ ...arms, achievement: { ...ach, ...p } }, k); onFull(); };
  const mantling = ach.mantling ?? [ft[0], 'or'];
  return (
    <>
      <Section title={tr('heraldry.helm')}>
        <Choices label={tr('heraldry.helm')} className="ae-tiles" value={ach.helm} onChange={(helm: HelmRank) => set({ helm })}
          options={HELMS.map((x) => ({ value: x.id, label: x.id === 'none' ? tr('heraldry.no_helm') : tr(HELM_GLYPH[x.id as Exclude<HelmRank, 'none'>].label) }))}
          render={(o) => <>{o.value === 'none' ? <span className="ae-none" aria-hidden>—</span> : <HelmGlyph rank={o.value} />}<small>{tr(HELMS.find((x) => x.id === o.value)!.label)}</small></>} />
      </Section>
      {ach.helm !== 'none' && (
        <div className="ae-row">
          <Section title={tr('heraldry.mantling')}>
            <TincturePicker label={tr('heraldry.mantling_outside')} compact value={mantling[0]} onChange={(t) => set({ mantling: [t, mantling[1]] })} />
          </Section>
          <Section title={tr('heraldry.lined_with')}>
            <TincturePicker label={tr('heraldry.mantling_lining')} compact value={mantling[1]} onChange={(t) => set({ mantling: [mantling[0], t] })} />
          </Section>
        </div>
      )}
      <Section title={tr('heraldry.crest')}>
        <ChargePicker value={ach.crest?.charge ?? ''} allowNone compact onChange={(charge) => set({ crest: charge ? { charge, tincture: ach.crest?.tincture ?? 'or' } : undefined })} />
        {ach.crest && <TincturePicker label={tr('heraldry.crest_tincture')} compact allowProper charge={ach.crest.charge} value={ach.crest.tincture} onChange={(tincture) => set({ crest: { ...ach.crest!, tincture } })} />}
        <Switch checked={!!ach.torse} onChange={(torse) => set({ torse })}>{tr('heraldry.torse')}</Switch>
      </Section>
      <Section title={tr('heraldry.motto_scroll')}>
        <Switch checked={ach.motto !== undefined} onChange={(on) => set({ motto: on ? motto.trim() || 'Fide et labore' : undefined })}>{tr('heraldry.show_scroll')}</Switch>
        {ach.motto !== undefined && (
          <input className="input" aria-label={tr('heraldry.motto_on_scroll')} value={ach.motto} maxLength={80} onChange={(e) => set({ motto: e.target.value }, 'scroll')} />
        )}
      </Section>
      <Section title={tr('heraldry.supporters')}>
        <Choices label={tr('heraldry.supporters')} className="ae-tiles" value={ach.supporters?.charge ?? ''} onChange={(charge: string) => set({ supporters: charge ? { charge, tincture: ach.supporters?.tincture ?? 'or' } : undefined })}
          options={[{ value: '', label: tr('heraldry.none') }, ...SUPPORTERS.map((s) => ({ value: s, label: chargeName(s, tr.locale) }))]}
          render={(o) => <>{o.value ? <ChargeGlyph id={o.value} size={28} /> : <span className="ae-none" aria-hidden>—</span>}<small>{o.label}</small></>} />
        {ach.supporters && <TincturePicker label={tr('heraldry.supporters_tincture')} compact allowProper charge={ach.supporters.charge} value={ach.supporters.tincture} onChange={(tincture) => set({ supporters: { ...ach.supporters!, tincture } })} />}
      </Section>
    </>
  );
}

function HelmGlyph({ rank }: { rank: HelmRank }) {
  useLibrary([], ['weapons']);
  if (rank === 'none') return null;
  const art = glyph(HELM_GLYPH[rank].gi);
  if (!art) return <span className="ae-glyph-wait" style={{ width: 28, height: 28 }} />;
  return <svg width="28" height="28" viewBox={art.viewBox} aria-hidden><g fill={HELM_GLYPH[rank].metal} dangerouslySetInnerHTML={{ __html: art.body }} /></svg>;
}

// ---------- pickers ----------

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="ae-section" aria-labelledby={id}>
      <h3 className="ae-h" id={id}>{title}</h3>
      {children}
    </section>
  );
}

const GROUPS: { kind: 'metal' | 'colour' | 'stain' | 'fur' | 'proper'; label: Key }[] = [
  { kind: 'metal', label: 'heraldry.group.metal' }, { kind: 'colour', label: 'heraldry.group.colour' }, { kind: 'stain', label: 'heraldry.group.stain' }, { kind: 'fur', label: 'heraldry.group.fur' },
];
const STAIN_IDS = new Set(['murrey', 'sanguine', 'tenne', 'carnation']);
const groupOf = (t: TinctureV2) => (t === 'proper' ? 'proper' : STAIN_IDS.has(t) ? 'stain' : kindOf(t));

function TincturePicker({ label, value, onChange, under = [], allowProper, charge, disabled, compact }: {
  label: string; value: TinctureV2; onChange: (t: TinctureV2) => void; under?: TinctureV2[]; allowProper?: boolean; charge?: string; disabled?: boolean; compact?: boolean;
}) {
  const tr = useT();
  if (compact) {
    // A dropdown where space is short (mantling, crest, supporters).
    return (
      <Select<TinctureV2> value={value} onChange={onChange} aria-label={label} disabled={disabled} className="ae-tincture-select"
        options={TINCTURES_V2.filter((t) => allowProper || t.id !== 'proper').map((t) => ({ value: t.id, label: tr(t.label), hint: tr(t.plain), icon: <TinctureSwatch t={t.id} size={16} charge={charge} />, group: tr(GROUPS.find((g) => g.kind === groupOf(t.id))?.label ?? 'heraldry.group.proper') }))} />
    );
  }
  const options = TINCTURES_V2.filter((t) => allowProper || t.id !== 'proper').map((t) => {
    const breaks = under.some((u) => (kindOf(u) === 'metal' || kindOf(u) === 'colour') && kindOf(u) === kindOf(t.id));
    return { value: t.id, label: `${tr(t.label)} (${tr(t.plain)})${breaks ? tr('heraldry.breaks_rule') : ''}`, group: groupOf(t.id), breaks };
  });
  return (
    <Choices label={label} className={`ae-tinctures${compact ? ' compact' : ''}`} value={value} onChange={onChange} disabled={disabled} options={options} hint={(v) => tr(tinctureMeaning(v))}
      groupLabel={(g) => { const k = GROUPS.find((x) => x.kind === g)?.label; return k ? tr(k) : undefined; }}
      render={(o) => (
        <>
          <TinctureSwatch t={o.value} size={compact ? 22 : 26} charge={charge} />
          <small>{tr(labelV2(o.value))}</small>
          {o.breaks && <span className="ae-breaks" aria-hidden title={tr('heraldry.breaks_rule_title')} />}
        </>
      )} />
  );
}

function LinePicker({ value, onChange }: { value: PartitionLine; onChange: (l: PartitionLine) => void }) {
  const tr = useT();
  return (
    <Choices label={tr('heraldry.line')} className="ae-tiles ae-lines" value={value} onChange={onChange} options={LINES_V2.map((l) => ({ value: l.id, label: tr(l.label) }))}
      render={(o) => {
        const pts: Pt[] = [[0, 12], ...edge([0, 12], [64, 12], o.value, -1)];
        return (
          <>
            <svg width="64" height="24" viewBox="0 0 64 24" aria-hidden>
              <path d={`M${pts.map((p) => p.join(' ')).join('L')}L64 24L0 24Z`} fill="currentColor" opacity=".85" />
            </svg>
            <small>{o.label}</small>
          </>
        );
      }} />
  );
}

const ALL = 'all';
/** The tiles a page shows: a grid of every charge would be slow on a phone, so the rest come a page at a time. */
const PAGE = 120;
function ChargePicker({ value, onChange, allowNone, compact }: { value: string; onChange: (id: string) => void; allowNone?: boolean; compact?: boolean }) {
  const tr = useT();
  // The names of every charge are in the library's metadata; the search and the list wait for it, then grow.
  const metaReady = useLibraryMeta();
  const ready = useLibrary(value ? [value] : []);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<ChargeCategory | typeof ALL>(() => chargeDef(value)?.cat ?? 'classic');
  const [shown, setShown] = useState(PAGE);
  useEffect(() => setShown(PAGE), [q, cat]);
  const found = useMemo(() => {
    if (q.trim()) return searchCharges(q);
    return allChargeDefs().filter((c) => cat === ALL || c.cat === cat);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, cat, metaReady]);
  const page = found.slice(0, shown);
  const options = [...(allowNone ? [{ value: '', label: tr('heraldry.none') }] : []), ...page.map((c) => ({ value: c.id, label: chargeLabel(c, tr.locale) }))];
  const current = chargeDef(value);
  return (
    <div className={`ae-charges${compact ? ' compact' : ''}`}>
      <div className="ae-charge-search">
        <Search size={15} aria-hidden />
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('heraldry.search_charges')} aria-label={tr('heraldry.search_charges_aria')} />
      </div>
      {!q && (
        <div className="ae-cats" role="group" aria-label={tr('heraldry.categories')}>
          {[{ id: ALL, label: tr('heraldry.all') }, ...CATEGORIES.map((c) => ({ id: c.id, label: tr(c.label) }))].map((c) => (
            <button key={c.id} type="button" className="ae-chip" aria-pressed={cat === c.id} onClick={() => setCat(c.id as ChargeCategory)}>{c.label}</button>
          ))}
        </div>
      )}
      {options.length === 0 ? (
        <p className="subtle ae-lead">{tr('heraldry.no_charge_matches', { q })}</p>
      ) : (
        <Choices label={tr('heraldry.charge')} className="ae-tiles ae-glyphs" value={value} onChange={onChange} options={options} hint={(v) => (v ? tr(chargeMeaning(v)) : undefined)}
          render={(o) => (o.value ? <ChargeGlyph id={o.value} size={compact ? 26 : 30} /> : <span className="ae-none" aria-hidden>—</span>)} />
      )}
      {found.length > shown && (
        <button type="button" className="ae-chip ae-more" onClick={() => setShown((n) => n + PAGE)}>{tr('heraldry.show_more', { count: Math.min(PAGE, found.length - shown) })}</button>
      )}
      <p className="ae-charge-name subtle">{current ? <><b>{chargeLabel(current, tr.locale)}</b>{!ready && current.gi ? ` · ${tr('heraldry.loading_library')}` : ''}</> : allowNone ? tr('heraldry.no_crest') : ''}{q && ` · ${tr('heraldry.found', { count: found.length })}`}</p>
      {current && <p className="ae-charge-meaning subtle">{tr(chargeMeaning(current.id))}</p>}
    </div>
  );
}

interface Choice<V> {
  value: V;
  label: string;
  group?: string;
  disabled?: boolean;
  breaks?: boolean;
}

/**
 * A radio group of tiles with a roving tab stop: Tab enters at the chosen tile, the arrow keys move and choose,
 * Home and End jump to the ends. Each tile is labelled for screen readers.
 */
function Choices<V extends string, C extends Choice<V> = Choice<V>>({
  label, value, onChange, options, render, className = '', disabled, groupLabel, hint,
}: {
  label: string;
  value: V;
  onChange: (v: V) => void;
  options: C[];
  render: (o: C) => ReactNode;
  className?: string;
  disabled?: boolean;
  groupLabel?: (g: string) => string | undefined;
  /** The meaning of a tile, shown in a caption under the group while the tile is hovered or focused. */
  hint?: (v: V) => string | undefined;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [peek, setPeek] = useState<string | undefined>();
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
  const at = Math.max(0, options.findIndex((o) => o.value === value));
  const tabStop = options[at]?.disabled ? enabled[0] : at;
  const move = (e: KeyboardEvent, i: number) => {
    const pos = enabled.indexOf(i);
    const n = enabled.length;
    const to =
      e.key === 'ArrowRight' || e.key === 'ArrowDown' ? enabled[(pos + 1) % n]
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? enabled[(pos - 1 + n) % n]
          : e.key === 'Home' ? enabled[0]
            : e.key === 'End' ? enabled[n - 1]
              : -1;
    if (to === undefined || to < 0) return;
    e.preventDefault();
    refs.current[to]?.focus();
    onChange(options[to].value);
  };
  const tile = (o: C, i: number) => (
    <button
      key={o.value || '_'}
      ref={(el) => { refs.current[i] = el; }}
      type="button"
      role="radio"
      aria-checked={o.value === value}
      aria-label={o.label}
      title={o.label}
      tabIndex={i === tabStop ? 0 : -1}
      disabled={disabled || o.disabled}
      className="ae-tile"
      onClick={() => onChange(o.value)}
      onKeyDown={(e) => move(e, i)}
      onMouseEnter={hint ? () => setPeek(hint(o.value)) : undefined}
      onMouseLeave={hint ? () => setPeek(undefined) : undefined}
      onFocus={hint ? () => setPeek(hint(o.value)) : undefined}
      onBlur={hint ? () => setPeek(undefined) : undefined}
    >
      {render(o)}
    </button>
  );
  // Grouped options sit in labelled boxes that wrap as a whole ("Metals: or, argent").
  const groups: { group?: string; items: [C, number][] }[] = [];
  options.forEach((o, i) => {
    const last = groups[groups.length - 1];
    if (groupLabel && last && last.group === o.group) last.items.push([o, i]);
    else groups.push({ group: o.group, items: [[o, i]] });
  });
  return (
    <>
      <div role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} className={`ae-choices ${className}`}>
        {groupLabel
          ? groups.map((g, k) => (
            <span key={k} className="ae-group-box">
              <span className="ae-group" aria-hidden>{(g.group && groupLabel(g.group)) || '\u00a0'}</span>
              <span className="ae-group-tiles">{g.items.map(([o, i]) => tile(o, i))}</span>
            </span>
          ))
          : options.map((o, i) => tile(o, i))}
      </div>
      {hint && <p className="ae-peek" aria-hidden>{peek ?? ''}</p>}
    </>
  );
}

