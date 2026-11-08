// The arms designer: a big live shield and its blazon on the left; on the right the layers (field, division,
// ordinaries, charges, achievement) and a picker for the chosen one, plus presets and canting suggestions.
// Loaded on demand by ArmsEditor, so the house page does not carry it.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown, ArrowUp, Crown, Dices, Info, Layers, Plus, Redo2, RotateCcw, Search, Shield, Sparkles, Trash2, Undo2, Wand2,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { graphQuery, updateHouse } from '~/lib/api';
import { aiArmsFromName } from '~/lib/ai.functions';
import type { ArmsDesign } from '~/lib/ai/types';
import { toAiLocale } from '~/lib/ai/types';
import { myFamiliesQuery } from '~/lib/auth/functions';
import { useT } from '~/lib/i18n';
import type {
  Achievement, ArmsLayer, ArmsV2, ChargeArrangement, ChargeLayer, FieldDivision, HelmRank, OrdinaryKind, OrdinaryLayer,
  PartitionLine, ShieldShape, TinctureV2,
} from '~/lib/seed-format';
import { useCan } from '~/lib/session';
import { play } from '~/lib/sfx';
import { toast } from '~/lib/toast';
import type { House } from '~/lib/types';
import { useAiStatus } from '../assistant/store';
import { Dialog } from '../ui/Dialog';
import { Range } from '../ui/Range';
import { Select } from '../ui/Select';
import { Switch } from '../ui/Switch';
import { Tab, TabList, TabPanel, Tabs } from '../ui/Tabs';
import { chargeArtV2, glyph, loadLibrary, useLibraryReady } from './art';
import { blazonAchievement, blazonV2, chargeNoun } from './blazon';
import { CANTING_SOURCE_NOTE, cantingArms } from './canting';
import { CATEGORIES, CHARGE_BY_ID, CHARGES_V2, HELM_GLYPH, SUPPORTERS, type ChargeCategory } from './catalogue';
import { asV2, storeV2 } from './convert';
import { Flag } from './Flag';
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

/** "House Valcourt" → "Valcourt": the part of a house name a herald would pun on. */
export function surnameOf(name: string): string {
  return name.replace(/^(the\s+)?(house|haus|huis|hus|family|familie|clan)\s+(of\s+|von\s+)?/i, '').replace(/^the\s+/i, '').trim();
}

/** The tab a designer opens on: the design itself, or the suggestions ("Suggest arms from the name"). */
export type DesignerTab = 'design' | 'presets' | 'name';

export default function Designer({ open, onClose, house, tree, initialTab = 'design' }: {
  open: boolean; onClose: () => void; house: House; tree: string; initialTab?: DesignerTab;
}) {
  const qc = useQueryClient();
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
    void loadLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = useMutation({
    mutationFn: (d: Draft) =>
      // A v1 house left as it was keeps its v1 arms; anything edited is stored as v2 with a v1 summary.
      updateHouse({ data: { tree, id: house.id, name: d.name.trim(), motto: d.motto.trim() || null, arms: JSON.stringify(d.arms) === JSON.stringify(saved.arms) ? house.arms : storeV2(d.arms) } }),
    onSuccess: async (h2, d) => {
      await Promise.all([qc.invalidateQueries({ queryKey: graphQuery(tree).queryKey }), qc.invalidateQueries({ queryKey: myFamiliesQuery.queryKey })]);
      play('seal');
      const kept = !!h2.arms.v2 || JSON.stringify(d.arms) === JSON.stringify(saved.arms);
      toast(kept
        ? { title: 'Arms sealed', body: `${h2.name} bears its new arms.`, icon: 'crown' }
        : { title: 'Arms sealed, simplified', body: 'The server kept only the classic parts of this design for now; the full design is not stored yet.', icon: 'crown', ms: 9000 });
      onClose();
    },
  });

  const dirty = key(draft) !== key(saved);
  const nameOk = draft.name.trim().length > 0;
  const setArms = (next: ArmsV2, k?: string) => h.set({ ...draft, arms: next }, k);
  const clashes = tinctureClashesV2(a);
  const shield = blazonV2(a);
  const achievementText = blazonAchievement(a.achievement);

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
      title="Coat of arms"
      description={<>Design the arms of <b>{saved.name}</b>. Every shield in the family changes when you seal them.</>}
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
            <button type="button" className="btn" onClick={() => { setArms(randomArmsV2()); setSel('field'); play('tick'); }}>
              <Dices size={16} aria-hidden /> Randomise
            </button>
            <button type="button" className="btn ghost" onClick={h.undo} disabled={!h.canUndo} aria-keyshortcuts="Meta+Z Control+Z" title="Undo (⌘Z)">
              <Undo2 size={16} aria-hidden /> <span className="ae-tool-label">Undo</span>
            </button>
            <button type="button" className="btn ghost" onClick={h.redo} disabled={!h.canRedo} aria-keyshortcuts="Meta+Shift+Z Control+Y" title="Redo (⇧⌘Z)">
              <Redo2 size={16} aria-hidden /> <span className="ae-tool-label">Redo</span>
            </button>
            <button type="button" className="btn ghost" onClick={() => h.set(draftOf(house))} disabled={!dirty}>
              <RotateCcw size={16} aria-hidden /> <span className="ae-tool-label">Reset</span>
            </button>
          </div>
          {save.isError && (
            <p className="ae-error" role="alert">
              {save.error instanceof Error && save.error.message ? save.error.message : 'The arms could not be saved.'} Your design is still here; try again.
            </p>
          )}
          <div className="ae-actions">
            <button type="button" className="btn" onClick={onClose} disabled={save.isPending}>Cancel</button>
            <button type="button" className="btn primary" onClick={() => save.mutate(draft)} disabled={!dirty || !nameOk || save.isPending}>
              {save.isPending ? 'Sealing…' : 'Seal the arms'}
            </button>
          </div>
        </div>
      }
    >
      <div className="ae-grid">
        <div className="ae-left">
        <section className="ae-preview" aria-label="Preview">
          <div className="ae-stage" data-full={(full && !!a.achievement) || undefined}>
            <ArmsV2View arms={a} size={full && a.achievement ? 150 : 220} full={full} title={`Arms of ${draft.name.trim() || 'the house'}: ${shield}`} />
            {country && <span className="ae-flag"><Flag code={country} size={16} /></span>}
          </div>
          {a.achievement && (
            <Switch size="sm" checked={full} onChange={setFull} className="ae-full-switch">Show the full achievement</Switch>
          )}
          <div className="ae-caption">
            <b className="ae-name">{draft.name.trim() || 'Unnamed house'}</b>
            {draft.motto.trim() && <i className="ae-motto">“{draft.motto.trim()}”</i>}
            <p className="ae-blazon" aria-live="polite"><span className="ae-blazon-label">Blazon</span> {shield}.{achievementText && <> <span className="ae-blazon-ach">{achievementText}</span></>}</p>
          </div>
        </section>
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
                  <small>Heralds keep metal off metal and colour off colour so arms read from afar. You may keep it.</small>
                </div>
              </div>
            )}
          </div>
          <div className="ae-texts">
            <label className="field">
              <span>House name</span>
              <input className="input" value={draft.name} maxLength={80} required aria-invalid={!nameOk || undefined} onChange={(e) => h.set({ ...draft, name: e.target.value }, 'name')} />
            </label>
            <label className="field">
              <span>Motto</span>
              <input className="input" value={draft.motto} maxLength={160} placeholder="Words to live by" onChange={(e) => h.set({ ...draft, motto: e.target.value }, 'motto')} />
            </label>
          </div>
        </div>
        </div>

        <div className="ae-work">
          <Tabs value={tab} onChange={setTab} label="Designer">
            <TabList>
              <Tab value="design" icon={<Layers size={15} />}>Design</Tab>
              <Tab value="presets" icon={<Shield size={15} />}>Presets</Tab>
              <Tab value="name" icon={<Wand2 size={15} />}>Suggest from the name</Tab>
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
              <p className="subtle ae-lead">Classic designs to start from. Picking one replaces the shield; Undo brings yours back.</p>
              <div className="ae-gallery">
                {PRESETS.map((p) => (
                  <button key={p.id} type="button" className="ae-card" onClick={() => { setArms(structuredClone(p.arms)); setSel(p.arms.layers.length ? p.arms.layers.length - 1 : 'field'); setFull(!!p.arms.achievement); setTab('design'); play('tick'); }}>
                    <ArmsV2View arms={p.arms} size={64} />
                    <span className="ae-card-title">{p.label}</span>
                    <small>{blazonV2(p.arms)}</small>
                  </button>
                ))}
              </div>
            </TabPanel>
            <TabPanel value="name">
              <Suggestions tree={tree} initial={surnameOf(saved.name)} country={country} onPick={(arms) => { setArms(arms); setSel(arms.layers.length ? arms.layers.length - 1 : 'field'); setTab('design'); play('tick'); }} />
            </TabPanel>
          </Tabs>
        </div>
      </div>
    </Dialog>
  );
}

// ---------- canting suggestions ----------

function Suggestions({ tree, initial, country, onPick }: { tree: string; initial: string; country?: string; onPick: (a: ArmsV2) => void }) {
  const t = useT();
  const aiOn = !!useAiStatus(tree)?.features.arms;
  const [name, setName] = useState(initial);
  const list = useMemo(() => cantingArms(name, country), [name, country]);
  // The AI's designs for this name, added to the list each time "Ask the AI for more" finishes. A new name starts over.
  const [more, setMore] = useState<ArmsDesign[]>([]);
  const ask = useMutation({
    mutationFn: () => aiArmsFromName({
      data: { tree, surname: name.trim(), country: country && /^[A-Z]{2}$/.test(country) ? country : undefined, locale: toAiLocale(t.locale) },
    }),
    onSuccess: (designs) => setMore((m) => [...m, ...designs]),
  });
  useLibraryReady();
  return (
    <div className="ae-suggest">
      <label className="field ae-suggest-name">
        <span>Name to read</span>
        <input
          className="input"
          value={name}
          maxLength={60}
          onChange={(e) => { setName(e.target.value); setMore([]); ask.reset(); }}
          placeholder="A family name, e.g. Müller"
        />
      </label>
      <p className="subtle ae-lead">{CANTING_SOURCE_NOTE}</p>
      {list.length === 0 && more.length === 0 ? (
        <p className="subtle">Type a family name to see ideas.</p>
      ) : (
        <div className="ae-gallery ae-gallery-wide">
          {list.map((s, i) => (
            <button key={i} type="button" className="ae-card ae-card-wide" onClick={() => onPick(structuredClone(s.arms))}>
              <ArmsV2View arms={s.arms} size={72} />
              <span className="ae-card-text">
                <span className="ae-card-title">{s.explanation}</span>
                <small>{blazonV2(s.arms)}</small>
              </span>
            </button>
          ))}
          {more.map((d, i) => {
            const arms = asV2(d.arms);
            return (
              <button key={`ai${i}`} type="button" className="ae-card ae-card-wide" onClick={() => onPick(structuredClone(arms))}>
                <ArmsV2View arms={arms} size={72} />
                <span className="ae-card-text">
                  <span className="ae-card-title">{d.meaning}</span>
                  <small>{blazonV2(arms)}</small>
                </span>
              </button>
            );
          })}
        </div>
      )}
      {aiOn && name.trim() !== '' && (
        <div className="ae-ai-more">
          <button type="button" className="btn" onClick={() => ask.mutate()} disabled={ask.isPending} aria-busy={ask.isPending || undefined}>
            <Sparkles size={15} aria-hidden /> {ask.isPending ? t('arms.asking') : t('arms.ask_more')}
          </button>
          {ask.isError && <p className="err" role="alert">{t('arms.ask_more_failed')}</p>}
        </div>
      )}
    </div>
  );
}

// ---------- the layer list ----------

function layerTitle(l: ArmsLayer): string {
  if (l.type === 'ordinary') return `${ordinaryLabel(l.kind)}${l.line !== 'straight' ? ` ${l.line}` : ''}`;
  const n = l.arrangement === 'seme' ? 2 : l.count;
  const noun = chargeNoun(l.charge, n);
  return l.arrangement === 'seme' ? `Semé of ${noun}` : n === 1 ? noun.charAt(0).toUpperCase() + noun.slice(1) : `${n} ${noun}`;
}

function LayerList({ arms, sel, setSel, setArms }: { arms: ArmsV2; sel: Sel; setSel: (s: Sel) => void; setArms: (a: ArmsV2) => void }) {
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
    <nav className="ae-layers" aria-label="Layers">
      <ol>
        <li>
          <LayerRow current={sel === 'field'} onSelect={() => setSel('field')} title="Field" hint={`${SHIELDS.find((s) => s.id === arms.shield)?.label} · ${labelV2(ft[0])}`} icon={<TinctureSwatch t={ft[0]} size={22} />} />
        </li>
        <li>
          <LayerRow current={sel === 'division'} onSelect={() => setSel('division')} title="Division" hint={div === 'plain' ? 'None' : `${divisionLabel(div)}${arms.field.line !== 'straight' ? ` ${arms.field.line}` : ''}`}
            icon={<MiniShield arms={{ ...arms, layers: [], achievement: undefined }} />}
            onRemove={div !== 'plain' ? () => setArms({ ...arms, field: { ...arms.field, division: 'plain', tinctures: [ft[0]] } }) : undefined} removeLabel="Remove the division" />
        </li>
        {arms.layers.map((l, i) => (
          <li key={i}>
            <LayerRow
              current={sel === i}
              onSelect={() => setSel(i)}
              onKeyDown={(e) => rowKey(e, i)}
              title={layerTitle(l)}
              hint={l.counterchanged ? 'counterchanged' : labelV2(l.tincture)}
              icon={l.type === 'ordinary' ? <MiniShield arms={{ shield: arms.shield, field: { division: 'plain', tinctures: ['argent'], line: 'straight' }, layers: [{ ...l, counterchanged: false, tincture: l.tincture === 'argent' ? 'sable' : l.tincture }] }} /> : <ChargeGlyph id={l.charge} size={22} />}
              onUp={i > 0 ? () => move(i, -1) : undefined}
              onDown={i < arms.layers.length - 1 ? () => move(i, 1) : undefined}
              onRemove={() => remove(i)}
              removeLabel={`Remove ${layerTitle(l).toLowerCase()}`}
            />
          </li>
        ))}
        <li>
          <LayerRow current={sel === 'achievement'} onSelect={() => setSel('achievement')} title="Achievement" hint={arms.achievement ? 'Helm, crest, motto' : 'Shield only'} icon={<Crown size={18} aria-hidden />}
            onRemove={arms.achievement ? () => setArms({ ...arms, achievement: undefined }) : undefined} removeLabel="Remove the achievement" />
        </li>
      </ol>
      <div className="ae-add">
        <button type="button" className="btn ghost" onClick={addOrdinary} disabled={arms.layers.length >= 12}><Plus size={15} aria-hidden /> Ordinary</button>
        <button type="button" className="btn ghost" onClick={addCharges} disabled={arms.layers.length >= 12}><Plus size={15} aria-hidden /> Charges</button>
      </div>
    </nav>
  );
}

function LayerRow({ current, onSelect, title, hint, icon, onUp, onDown, onRemove, removeLabel, onKeyDown }: {
  current: boolean; onSelect: () => void; title: string; hint: string; icon: ReactNode;
  onUp?: () => void; onDown?: () => void; onRemove?: () => void; removeLabel?: string; onKeyDown?: (e: KeyboardEvent) => void;
}) {
  return (
    <div className="ae-layer" data-current={current || undefined}>
      <button type="button" className="ae-layer-main" aria-current={current} onClick={onSelect} onKeyDown={onKeyDown} aria-keyshortcuts={onUp || onDown ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}>
        <span className="ae-layer-icon" aria-hidden>{icon}</span>
        <span className="ae-layer-text"><b>{title}</b><small>{hint}</small></span>
      </button>
      {(onUp || onDown) && (
        <span className="ae-layer-move">
          <button type="button" className="ae-icon-btn" onClick={onUp} disabled={!onUp} aria-label={`Move ${title.toLowerCase()} up`} title="Move up (⌥↑)"><ArrowUp size={14} /></button>
          <button type="button" className="ae-icon-btn" onClick={onDown} disabled={!onDown} aria-label={`Move ${title.toLowerCase()} down`} title="Move down (⌥↓)"><ArrowDown size={14} /></button>
        </span>
      )}
      {onRemove && <button type="button" className="ae-icon-btn ae-remove" onClick={onRemove} aria-label={removeLabel} title={removeLabel}><Trash2 size={14} /></button>}
    </div>
  );
}

const MiniShield = ({ arms, size = 20 }: { arms: ArmsV2; size?: number }) => <ArmsV2View arms={arms} size={size} className="ae-mini" />;

function ChargeGlyph({ id, size = 30 }: { id: string; size?: number }) {
  useLibraryReady();
  const art = chargeArtV2(id);
  if (!art) return <span className="ae-glyph-wait" style={{ width: size, height: size }} />;
  return (
    <svg width={size} height={size} viewBox={art.viewBox} aria-hidden className="ae-glyph">
      <g fill="currentColor" color="currentColor" dangerouslySetInnerHTML={{ __html: art.body }} />
    </svg>
  );
}

// ---------- the inspector ----------

function Inspector({ arms, sel, setArms, motto, onFull }: { arms: ArmsV2; sel: Sel; setArms: (a: ArmsV2, k?: string) => void; motto: string; onFull: () => void }) {
  const ft = fieldTinctures(arms);
  if (sel === 'field') {
    return (
      <>
        <Section title="Shield">
          <Choices label="Shield shape" className="ae-shields" value={arms.shield} onChange={(shield: ShieldShape) => setArms({ ...arms, shield })}
            options={SHIELDS.map((s) => ({ value: s.id, label: `${s.label}: ${s.hint}` }))}
            render={(o) => <><MiniShield arms={{ ...arms, shield: o.value, achievement: undefined }} size={34} /><small>{SHIELDS.find((s) => s.id === o.value)?.label}</small></>} />
        </Section>
        <Section title="Field tincture">
          <TincturePicker label="Field tincture" value={ft[0]} onChange={(t) => setArms({ ...arms, field: { ...arms.field, tinctures: [t, ...ft.slice(1)] } })} />
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
        <Section title="Division">
          <Choices label="Division" className="ae-tiles ae-tiles-shield" value={div} onChange={setDiv}
            options={DIVISIONS_V2.map((d) => ({ value: d.id, label: d.label }))}
            render={(o) => <><MiniShield arms={{ shield: arms.shield, field: { division: o.value, tinctures: tinctureCount(o.value) === 3 ? [ft[0], ft[1] ?? contrastFor([ft[0]]), ft[2] ?? 'azure'] : [ft[0], ft[1] ?? contrastFor([ft[0]])], line: 'straight' }, layers: [] }} size={34} /><small>{o.label}</small></>} />
        </Section>
        {div !== 'plain' && info.lines && (
          <Section title="Line of partition">
            <LinePicker value={arms.field.line} onChange={(line) => setArms({ ...arms, field: { ...arms.field, line } })} />
          </Section>
        )}
        {info.pieces && (
          <Section title="Pieces">
            <Range value={arms.field.pieces ?? 6} min={4} max={10} step={1} ticks={[4, 6, 8, 10].map((v) => ({ value: v, label: String(v) }))} aria-label="Number of pieces" format={(v) => `${v} pieces`}
              onChange={(pieces) => setArms({ ...arms, field: { ...arms.field, pieces } }, 'pieces')} />
          </Section>
        )}
        {ft.slice(1).map((t, i) => (
          <Section key={i} title={i === 0 ? 'Second tincture' : 'Third tincture'}>
            <TincturePicker label={i === 0 ? 'Second tincture' : 'Third tincture'} value={t} under={[ft[0]]} onChange={(x) => setArms({ ...arms, field: { ...arms.field, tinctures: ft.map((y, k) => (k === i + 1 ? x : y)) } })} />
          </Section>
        ))}
        {div === 'plain' && <p className="subtle ae-lead">Pick a division to split the field into two or three tinctures.</p>}
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
        <Section title="Ordinary">
          <Choices label="Ordinary" className="ae-tiles ae-tiles-shield" value={layer.kind} onChange={(kind: OrdinaryKind) => patch({ kind })}
            options={ORDINARIES.map((o) => ({ value: o.id, label: o.label }))}
            render={(o) => <><MiniShield arms={{ shield: arms.shield, field: { division: 'plain', tinctures: [ft[0]], line: 'straight' }, layers: [{ ...layer, kind: o.value, counterchanged: false, tincture: contrastFor([ft[0]], layer.tincture) }] }} size={34} /><small>{o.label}</small></>} />
        </Section>
        <Section title="Line">
          <LinePicker value={layer.line} onChange={(line) => patch({ line })} />
        </Section>
        <Section title="Tincture">
          <TincturePicker label="Ordinary tincture" value={layer.tincture} under={under} disabled={!!layer.counterchanged && divided} onChange={(tincture) => patch({ tincture })} />
        </Section>
        <div className="ae-switches">
          <Switch checked={!!layer.cotised} disabled={!COTISABLE.has(layer.kind)} onChange={(cotised) => patch({ cotised })}>Cotised{!COTISABLE.has(layer.kind) && <small className="subtle"> · fess, pale, bend or chevron</small>}</Switch>
          <Switch checked={!!layer.counterchanged} disabled={!divided} onChange={(counterchanged) => patch({ counterchanged })}>Counterchanged{!divided && <small className="subtle"> · needs a divided field</small>}</Switch>
        </div>
      </>
    );
  }
  const def = CHARGE_BY_ID[layer.charge];
  const hasOrdinary = arms.layers.slice(0, sel).some((l) => l.type === 'ordinary');
  const arrs = arrangementsFor(layer.count);
  return (
    <>
      <Section title="Charge">
        <ChargePicker value={layer.charge} onChange={(charge) => patch({ charge, ...(CHARGE_BY_ID[charge]?.facing ? {} : { contourne: undefined }) })} />
      </Section>
      <Section title="Tincture">
        <TincturePicker label="Charge tincture" value={layer.tincture} under={under} allowProper charge={layer.charge} disabled={!!layer.counterchanged && divided} onChange={(tincture) => patch({ tincture })} />
      </Section>
      <div className="ae-row">
        <Section title="How many">
          <Range value={layer.arrangement === 'seme' ? 1 : layer.count} min={1} max={9} step={1} disabled={layer.arrangement === 'seme'} ticks={[1, 3, 5, 7, 9].map((v) => ({ value: v, label: String(v) }))} aria-label="How many charges" format={(v) => `${v}`}
            onChange={(count) => patch({ count, arrangement: arrangementsFor(count).includes(layer.arrangement) ? layer.arrangement : 'auto' }, 'count')} />
        </Section>
        <Section title="Arrangement">
          <Select<ChargeArrangement> value={layer.arrangement} onChange={(arrangement) => patch({ arrangement })} aria-label="Arrangement"
            options={arrs.map((x) => ({ value: x, label: ARRANGEMENTS.find((r) => r.id === x)!.label }))} />
        </Section>
      </div>
      <Section title="Placed">
        <Choices label="Where the charges lie" className="ae-seg" value={layer.on} onChange={(on: ChargeLayer['on']) => patch({ on })}
          options={[
            { value: 'field' as const, label: 'On the field' },
            { value: 'ordinary' as const, label: 'On the ordinary', disabled: !hasOrdinary },
            { value: 'chief' as const, label: 'In chief' },
            { value: 'base' as const, label: 'In base' },
          ]}
          render={(o) => <small>{o.label}</small>} />
      </Section>
      <Section title="Size">
        <Range value={Math.round((layer.scale ?? 1) * 100)} min={60} max={140} step={5} ticks={[{ value: 60, label: 'Small' }, { value: 100, label: 'Usual' }, { value: 140, label: 'Large' }]} aria-label="Charge size" format={(v) => `${v}%`}
          onChange={(v) => patch({ scale: v === 100 ? undefined : v / 100 }, 'scale')} />
      </Section>
      <div className="ae-switches">
        <Switch checked={!!layer.contourne} disabled={!def?.facing} onChange={(contourne) => patch({ contourne })}>Turned the other way (contourné){!def?.facing && <small className="subtle"> · this charge faces front</small>}</Switch>
        <Switch checked={!!layer.counterchanged} disabled={!divided} onChange={(counterchanged) => patch({ counterchanged })}>Counterchanged{!divided && <small className="subtle"> · needs a divided field</small>}</Switch>
      </div>
    </>
  );
}

function AchievementInspector({ arms, setArms, motto, onFull }: { arms: ArmsV2; setArms: (a: ArmsV2, k?: string) => void; motto: string; onFull: () => void }) {
  const ach = arms.achievement;
  const ft = fieldTinctures(arms);
  if (!ach) {
    return (
      <div className="ae-empty">
        <Crown size={28} aria-hidden />
        <p>The full achievement adds a helm, mantling, a crest on a wreath, a motto scroll and supporters. Small shields across the app stay shield only.</p>
        <button type="button" className="btn primary" onClick={() => {
          const lining = arms.layers.find((l) => l.type === 'charge')?.tincture;
          const outer = ft.find((t) => kindOf(t) === 'colour') ?? 'gules';
          setArms({ ...arms, achievement: { helm: 'esquire', torse: true, mantling: [outer, lining && kindOf(lining) === 'metal' ? lining : 'or'], ...(motto.trim() && { motto: motto.trim() }) } });
          onFull();
        }}><Sparkles size={16} aria-hidden /> Add an achievement</button>
      </div>
    );
  }
  const set = (p: Partial<Achievement>, k?: string) => { setArms({ ...arms, achievement: { ...ach, ...p } }, k); onFull(); };
  const mantling = ach.mantling ?? [ft[0], 'or'];
  return (
    <>
      <Section title="Helm">
        <Choices label="Helm" className="ae-tiles" value={ach.helm} onChange={(helm: HelmRank) => set({ helm })}
          options={HELMS.map((x) => ({ value: x.id, label: x.id === 'none' ? 'No helm' : HELM_GLYPH[x.id as Exclude<HelmRank, 'none'>].label }))}
          render={(o) => <>{o.value === 'none' ? <span className="ae-none" aria-hidden>—</span> : <HelmGlyph rank={o.value} />}<small>{HELMS.find((x) => x.id === o.value)?.label}</small></>} />
      </Section>
      {ach.helm !== 'none' && (
        <div className="ae-row">
          <Section title="Mantling">
            <TincturePicker label="Mantling, outside" compact value={mantling[0]} onChange={(t) => set({ mantling: [t, mantling[1]] })} />
          </Section>
          <Section title="Lined with">
            <TincturePicker label="Mantling, lining" compact value={mantling[1]} onChange={(t) => set({ mantling: [mantling[0], t] })} />
          </Section>
        </div>
      )}
      <Section title="Crest">
        <ChargePicker value={ach.crest?.charge ?? ''} allowNone compact onChange={(charge) => set({ crest: charge ? { charge, tincture: ach.crest?.tincture ?? 'or' } : undefined })} />
        {ach.crest && <TincturePicker label="Crest tincture" compact allowProper charge={ach.crest.charge} value={ach.crest.tincture} onChange={(tincture) => set({ crest: { ...ach.crest!, tincture } })} />}
        <Switch checked={!!ach.torse} onChange={(torse) => set({ torse })}>On a wreath (torse) of the colours</Switch>
      </Section>
      <Section title="Motto scroll">
        <Switch checked={ach.motto !== undefined} onChange={(on) => set({ motto: on ? motto.trim() || 'Fide et labore' : undefined })}>Show a scroll</Switch>
        {ach.motto !== undefined && (
          <input className="input" aria-label="Motto on the scroll" value={ach.motto} maxLength={80} onChange={(e) => set({ motto: e.target.value }, 'scroll')} />
        )}
      </Section>
      <Section title="Supporters">
        <Choices label="Supporters" className="ae-tiles" value={ach.supporters?.charge ?? ''} onChange={(charge: string) => set({ supporters: charge ? { charge, tincture: ach.supporters?.tincture ?? 'or' } : undefined })}
          options={[{ value: '', label: 'None' }, ...SUPPORTERS.map((s) => ({ value: s, label: CHARGE_BY_ID[s]?.label ?? s }))]}
          render={(o) => <>{o.value ? <ChargeGlyph id={o.value} size={28} /> : <span className="ae-none" aria-hidden>—</span>}<small>{o.label}</small></>} />
        {ach.supporters && <TincturePicker label="Supporters’ tincture" compact allowProper charge={ach.supporters.charge} value={ach.supporters.tincture} onChange={(tincture) => set({ supporters: { ...ach.supporters!, tincture } })} />}
      </Section>
    </>
  );
}

function HelmGlyph({ rank }: { rank: HelmRank }) {
  useLibraryReady();
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

const GROUPS: { kind: 'metal' | 'colour' | 'stain' | 'fur' | 'proper'; label: string }[] = [
  { kind: 'metal', label: 'Metals' }, { kind: 'colour', label: 'Colours' }, { kind: 'stain', label: 'Stains' }, { kind: 'fur', label: 'Furs' },
];
const STAIN_IDS = new Set(['murrey', 'sanguine', 'tenne', 'carnation']);
const groupOf = (t: TinctureV2) => (t === 'proper' ? 'proper' : STAIN_IDS.has(t) ? 'stain' : kindOf(t));

function TincturePicker({ label, value, onChange, under = [], allowProper, charge, disabled, compact }: {
  label: string; value: TinctureV2; onChange: (t: TinctureV2) => void; under?: TinctureV2[]; allowProper?: boolean; charge?: string; disabled?: boolean; compact?: boolean;
}) {
  if (compact) {
    // A dropdown where space is short (mantling, crest, supporters).
    return (
      <Select<TinctureV2> value={value} onChange={onChange} aria-label={label} disabled={disabled} className="ae-tincture-select"
        options={TINCTURES_V2.filter((t) => allowProper || t.id !== 'proper').map((t) => ({ value: t.id, label: t.label, hint: t.plain, icon: <TinctureSwatch t={t.id} size={16} charge={charge} />, group: GROUPS.find((g) => g.kind === groupOf(t.id))?.label ?? 'Proper' }))} />
    );
  }
  const options = TINCTURES_V2.filter((t) => allowProper || t.id !== 'proper').map((t) => {
    const breaks = under.some((u) => (kindOf(u) === 'metal' || kindOf(u) === 'colour') && kindOf(u) === kindOf(t.id));
    return { value: t.id, label: `${t.label} (${t.plain})${breaks ? ', breaks the rule of tincture here' : ''}`, group: groupOf(t.id), breaks };
  });
  return (
    <Choices label={label} className={`ae-tinctures${compact ? ' compact' : ''}`} value={value} onChange={onChange} disabled={disabled} options={options}
      groupLabel={(g) => GROUPS.find((x) => x.kind === g)?.label}
      render={(o) => (
        <>
          <TinctureSwatch t={o.value} size={compact ? 22 : 26} charge={charge} />
          <small>{labelV2(o.value)}</small>
          {o.breaks && <span className="ae-breaks" aria-hidden title="Breaks the rule of tincture here" />}
        </>
      )} />
  );
}

function LinePicker({ value, onChange }: { value: PartitionLine; onChange: (l: PartitionLine) => void }) {
  return (
    <Choices label="Line" className="ae-tiles ae-lines" value={value} onChange={onChange} options={LINES_V2.map((l) => ({ value: l.id, label: l.label }))}
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
function ChargePicker({ value, onChange, allowNone, compact }: { value: string; onChange: (id: string) => void; allowNone?: boolean; compact?: boolean }) {
  const ready = useLibraryReady();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<ChargeCategory | typeof ALL>(() => CHARGE_BY_ID[value]?.cat ?? 'classic');
  const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const list = useMemo(() => {
    const words = fold(q).split(/\s+/).filter(Boolean);
    if (words.length) return CHARGES_V2.filter((c) => words.every((w) => fold(`${c.label} ${c.id} ${c.keys ?? ''} ${c.cat}`).includes(w)));
    return cat === ALL ? CHARGES_V2 : CHARGES_V2.filter((c) => c.cat === cat);
  }, [q, cat]);
  const options = [...(allowNone ? [{ value: '', label: 'None' }] : []), ...list.map((c) => ({ value: c.id, label: c.label }))];
  const current = CHARGE_BY_ID[value];
  return (
    <div className={`ae-charges${compact ? ' compact' : ''}`}>
      <div className="ae-charge-search">
        <Search size={15} aria-hidden />
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search charges: lion, Mühlrad, key…" aria-label="Search charges" />
      </div>
      {!q && (
        <div className="ae-cats" role="group" aria-label="Categories">
          {[{ id: ALL, label: 'All' }, ...CATEGORIES].map((c) => (
            <button key={c.id} type="button" className="ae-chip" aria-pressed={cat === c.id} onClick={() => setCat(c.id as ChargeCategory)}>{c.label}</button>
          ))}
        </div>
      )}
      {options.length === 0 ? (
        <p className="subtle ae-lead">No charge matches “{q}”.</p>
      ) : (
        <Choices label="Charge" className="ae-tiles ae-glyphs" value={value} onChange={onChange} options={options}
          render={(o) => (o.value ? <ChargeGlyph id={o.value} size={compact ? 26 : 30} /> : <span className="ae-none" aria-hidden>—</span>)} />
      )}
      <p className="ae-charge-name subtle">{current ? <><b>{current.label}</b>{!ready && current.gi ? ' · loading the library…' : ''}</> : allowNone ? 'No crest' : ''}{q && ` · ${list.length} found`}</p>
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
  label, value, onChange, options, render, className = '', disabled, groupLabel,
}: {
  label: string;
  value: V;
  onChange: (v: V) => void;
  options: C[];
  render: (o: C) => ReactNode;
  className?: string;
  disabled?: boolean;
  groupLabel?: (g: string) => string | undefined;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
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
  );
}

