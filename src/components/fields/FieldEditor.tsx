// The Edit tab's fields, shaped like a contact card: each field is a card with its kind, its label and its inputs.
// The list is shown in three groups (contact, life, more), and the whole list is one array, so the order that is
// saved is the order the cards were added in. Fields are added from one searchable menu, grouped by kind, and put in
// order with the arrows (within their group), given a level (personal, editors, family), and removed.
import { ArrowDown, ArrowUp, Plus, Search, Trash2, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';
import { formatAddress, parseAddress, type AddressParts } from '~/lib/address';
import { countrySuggestions, languageSuggestions, wordSuggestions, type Used } from '~/lib/field-suggest';
import { familyWordsQuery, type FamilyWords } from '~/lib/field-suggest.functions';
import { faithSuggestions } from '~/lib/faiths';
import { COLOURS, favouriteWords, isColourLabel, parseColours, toggleColour } from '~/lib/favourites';
import type { Family } from '~/lib/graph';
import { displayName } from '~/lib/graph';
import { locales, useT, type Key } from '~/lib/i18n';
import { DatePicker, Select, Switch } from '../ui';
import { PlaceInput, type PlaceValue } from '../PlaceInput';
import { AddressFinder } from './AddressFinder';
import { TYPE_ICON } from './FieldsView';
import { VisibilityPicker } from './VisibilityMark';
import type { Visibility } from '~/lib/visibility';
import { blankValue, DEFAULT_LABEL, fieldIssue, isContactType, MAX_FIELDS, PRESETS, defaultVisibility, type FieldType, type FieldValue } from './model';
import { presetLabel } from './presets';
import { SuggestInput } from './SuggestInput';
import './suggest.css';

/** A field while it is being edited. `key` is for React; `id` is set once the family has saved it. */
export interface DraftField {
  key: string;
  id?: string;
  type: FieldType;
  label: string;
  value: FieldValue;
  visibility: Visibility;
}

/** A saved field as a draft: every key of its type present, so the inputs are all controlled. */
export const draftOf = (f: { id: string; type: FieldType; label: string; value: FieldValue; visibility: Visibility }): DraftField =>
  ({ key: f.id, id: f.id, type: f.type, label: f.label, value: { ...blankValue(f.type), ...f.value }, visibility: f.visibility });

const newKey = () => `n${Math.random().toString(36).slice(2, 10)}`;

/** The three groups the list is shown in, and the section each belongs to. */
export type FieldGroup = 'contact' | 'life' | 'more';
const LIFE_TYPES: readonly FieldType[] = ['dates', 'education', 'occupation', 'military'];
export const groupOf = (type: FieldType): FieldGroup => (isContactType(type) ? 'contact' : LIFE_TYPES.includes(type) ? 'life' : 'more');

/** The menu's sections, in order. */
const ADD_GROUPS: { title: Key; types: FieldType[] }[] = [
  { title: 'group.contact', types: ['phone', 'email', 'address', 'website', 'social'] },
  { title: 'group.names', types: ['names'] },
  { title: 'group.life', types: ['dates', 'education', 'occupation', 'military'] },
  { title: 'group.background', types: ['religion', 'nationality', 'languages'] },
  { title: 'group.health', types: ['medical', 'allergies'] },
  { title: 'group.likes', types: ['favourites', 'gifts'] },
  { title: 'group.other', types: ['related', 'notes', 'custom'] },
];

/**
 * One input for a value key. `kind` picks the control: a date (the date picker), a partial date that is usually a year
 * (the picker, year first), a place (the place picker, which suggests the family's own places), plain text, or text
 * with suggestions (see WordInput).
 */
type WordKind = 'language' | 'level' | 'country' | 'nationality' | 'religion' | 'favourite' | 'gift';
interface Input { key: string; label: Key; wide?: boolean; multi?: boolean; type?: string; placeholder?: string; kind?: 'date' | 'period' | 'place' | WordKind }
const from: Input = { key: 'from', label: 'input.from', kind: 'period' };
const to: Input = { key: 'to', label: 'input.to', kind: 'period' };
const note: Input = { key: 'note', label: 'input.note', wide: true };
const INPUTS: Record<FieldType, Input[]> = {
  phone: [{ key: 'number', label: 'input.number', type: 'tel', wide: true, placeholder: '+49 …' }],
  email: [{ key: 'address', label: 'input.email', type: 'email', wide: true, placeholder: 'name@example.com' }],
  address: [
    { key: 'street', label: 'input.street', wide: true },
    { key: 'postcode', label: 'input.postcode' },
    { key: 'city', label: 'input.city' },
    { key: 'country', label: 'input.country', wide: true, kind: 'country' },
  ],
  website: [{ key: 'url', label: 'input.url', type: 'url', wide: true, placeholder: 'example.org' }],
  social: [{ key: 'handle', label: 'input.handle', wide: true, placeholder: '@name' }],
  names: [{ key: 'name', label: 'input.name', wide: true }],
  dates: [{ key: 'date', label: 'input.date', wide: true, kind: 'date' }, note],
  education: [{ key: 'school', label: 'input.school', wide: true }, { key: 'place', label: 'input.place', wide: true, kind: 'place' }, from, to, note],
  occupation: [{ key: 'title', label: 'input.title', wide: true }, { key: 'employer', label: 'input.employer', wide: true }, from, to, note],
  military: [{ key: 'unit', label: 'input.unit', wide: true }, { key: 'rank', label: 'input.rank' }, from, to],
  religion: [{ key: 'name', label: 'input.name', wide: true, kind: 'religion' }],
  nationality: [{ key: 'country', label: 'input.country', wide: true, kind: 'nationality' }],
  languages: [{ key: 'language', label: 'input.language', kind: 'language' }, { key: 'level', label: 'input.level', kind: 'level' }],
  medical: [{ key: 'note', label: 'input.note', wide: true, multi: true }],
  allergies: [{ key: 'note', label: 'input.note', wide: true, multi: true }],
  favourites: [{ key: 'text', label: 'input.text', wide: true, kind: 'favourite' }],
  gifts: [{ key: 'text', label: 'input.text', wide: true, kind: 'gift' }],
  notes: [{ key: 'text', label: 'input.text', wide: true, multi: true }],
  related: [
    { key: 'person', label: 'input.person', wide: true },
    { key: 'name', label: 'input.nameOutside', wide: true },
    note,
  ],
  custom: [{ key: 'text', label: 'input.text', wide: true, multi: true }],
};

const LEVELS: readonly Key[] = ['suggest.level.native', 'suggest.level.fluent', 'suggest.level.good', 'suggest.level.basic'];
const FAMILY_WORD: Partial<Record<WordKind, keyof FamilyWords>> = { language: 'language', level: 'level', nationality: 'nationality', religion: 'religion' };

/** A text input that suggests words of its kind, what this family already uses first. Anything else can be typed. */
function WordInput({ tree, kind, value, onChange, labelledBy, fieldLabel }: { tree: string; kind: WordKind; value: string; onChange: (text: string) => void; labelledBy: string; fieldLabel: string }) {
  const c = useT();
  const { data } = useQuery(familyWordsQuery(tree));
  const key = FAMILY_WORD[kind];
  const used: Used[] = useMemo(() => (key && data ? data[key] : []), [key, data]);
  const options = useMemo(() => {
    const tag = locales[c.locale];
    if (kind === 'language') return languageSuggestions(value, tag, used);
    if (kind === 'country' || kind === 'nationality') return countrySuggestions(value, tag, used);
    if (kind === 'religion') return faithSuggestions(value, c.locale, used);
    if (kind === 'gift') return wordSuggestions(value, favouriteWords('gift', c.locale));
    if (kind === 'favourite') return wordSuggestions(value, favouriteWords(fieldLabel, c.locale));
    return wordSuggestions(value, LEVELS.map((k) => c(k)), used);
  }, [kind, value, used, c, fieldLabel]);
  return <SuggestInput value={value} onChange={onChange} options={options} labelledBy={labelledBy} />;
}

/** The colour favourite: a text box for any words, and a swatch for each named colour. Several can be chosen. */
function ColourInput({ value, onChange, labelledBy }: { value: string; onChange: (text: string) => void; labelledBy: string }) {
  const c = useT();
  const chosen = new Set(parseColours(value).map((t) => t.colour?.id));
  return (
    <>
      <input className="input" aria-labelledby={labelledBy} value={value} onChange={(e) => onChange(e.target.value)} />
      <div className="fe-swatches" role="group" aria-labelledby={labelledBy}>
        {COLOURS.map((col) => (
          <button type="button" key={col.id} className="fe-swatch" aria-pressed={chosen.has(col.id)} aria-label={col[c.locale]} title={col[c.locale]} onClick={() => onChange(toggleColour(value, col, c.locale))}>
            <i style={{ background: col.hex }} />
          </button>
        ))}
      </div>
    </>
  );
}

/** Whether they have left this church or faith, and, if anyone knows, when. */
function LeftFaith({ value, onChange }: { value: FieldValue; onChange: (v: FieldValue) => void }) {
  const c = useT();
  return (
    <div className="wide fe-left">
      <Switch size="sm" checked={!!value.left} onChange={(on) => onChange({ ...value, left: on ? '1' : '', leftOn: on ? value.leftOn ?? '' : '' })}>{c('faith.leftAsk')}</Switch>
      {value.left && <DatePicker label={c('faith.leftWhen')} value={value.leftOn ?? ''} onChange={(leftOn) => onChange({ ...value, leftOn })} precisions={['year', 'month', 'day']} defaultPrecision="year" />}
    </div>
  );
}

/** The address card's one box: a picked place or address fills the parts below it. */
function AddressCardFinder({ tree, f, onChange, id, fam, self }: { tree: string; f: DraftField; onChange: (patch: Partial<DraftField>) => void; id: string; fam: Family; self: string }) {
  const c = useT();
  const [text, setText] = useState('');
  const fill = (parts: AddressParts) => {
    // A town picked on its own must not wipe a street that is already there.
    onChange({ value: { ...f.value, ...Object.fromEntries(Object.entries(parts).filter(([, v]) => v)) } });
    setText('');
  };
  return (
    <div className="field wide">
      <span id={id}>{c('addr.find')}</span>
      <AddressFinder
        tree={tree}
        value={text}
        onChange={setText}
        onPick={fill}
        labelledBy={id}
        // Someone's copy is this person's own field, at the restricted default, whatever the original was.
        family={{ person: self, fam, onCopy: (parts) => { onChange({ value: { ...blankValue('address'), ...parts }, visibility: defaultVisibility('address') }); setText(''); } }}
        // Typed in full and not picked: read it into the empty boxes, never over what is there.
        onBlur={() => { if (text.trim() && !formatAddress(f.value)) fill(parseAddress(text)); }}
      />
    </div>
  );
}

/** Accent- and case-insensitive, so a search for "geburt" also finds "Gebürt". */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** The list (one group of it), with add, reorder and remove. `value` is the whole list; `group` picks what this shows. */
export function FieldEditor({ tree, value, onChange, fam, self, group, addMenu = false }: {
  tree: string; value: DraftField[]; onChange: (next: DraftField[]) => void; fam: Family; self: string;
  group: FieldGroup; addMenu?: boolean;
}) {
  const c = useT();
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const full = value.length >= MAX_FIELDS;
  const rows = value.map((f, i) => ({ f, i })).filter(({ f }) => groupOf(f.type) === group);
  const add = (type: FieldType) => {
    onChange([...value, { key: newKey(), type, label: DEFAULT_LABEL[type] ?? '', value: blankValue(type), visibility: defaultVisibility(type) }]);
    setAdding(false);
    setQuery('');
  };
  const update = (i: number, patch: Partial<DraftField>) => onChange(value.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  /** Moves a card past its neighbour in the same group, so the other groups keep their places. */
  const move = (i: number, d: -1 | 1) => {
    const same = rows.map((r) => r.i);
    const to = same[same.indexOf(i) + d];
    if (to === undefined) return;
    const next = [...value];
    [next[i], next[to]] = [next[to], next[i]];
    onChange(next);
  };
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));

  const needle = fold(query);
  const matches = (type: FieldType) => !needle || fold(c(`type.${type}` as Key)).includes(needle) || type.includes(needle);
  const anyMatch = ADD_GROUPS.some((g) => g.types.some(matches));

  return (
    <div className={`fe fe-${group}`}>
      {rows.length > 0 && (
        <ol className="fe-list">
          {rows.map(({ f, i }, k) => (
            <FieldRowEditor
              key={f.key} tree={tree} f={f} index={k} count={rows.length} fam={fam} self={self}
              onChange={(patch) => update(i, patch)} onMove={(d) => move(i, d)} onRemove={() => remove(i)}
            />
          ))}
        </ol>
      )}

      {addMenu && (adding ? (
        <div className="fe-menu" role="group" aria-label={c('fields.addMenu')}>
          <div className="fe-menu-head">
            <label className="fe-search">
              <Search size={15} aria-hidden />
              <input
                className="input"
                type="search"
                value={query}
                autoFocus
                placeholder={c('fields.searchPlaceholder')}
                aria-label={c('fields.searchPlaceholder')}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); if (query) setQuery(''); else setAdding(false); } }}
              />
            </label>
            <button type="button" className="btn icon ghost" onClick={() => { setAdding(false); setQuery(''); }} aria-label={c('fields.cancelAdd')} title={c('fields.cancelAdd')}><X size={16} /></button>
          </div>
          {ADD_GROUPS.map((g) => {
            const types = g.types.filter(matches);
            if (!types.length) return null;
            return (
              <div className="fe-menu-group" key={g.title}>
                <span className="fe-menu-title">{c(g.title)}</span>
                <div className="fe-menu-items">
                  {types.map((t) => (
                    <button type="button" className="fe-type" key={t} onClick={() => add(t)} disabled={full}>
                      <span className="fe-type-icon" aria-hidden>{TYPE_ICON[t]}</span>
                      <span>{c(`type.${t}` as Key)}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {!anyMatch && <p className="subtle fe-nomatch" role="status">{c('fields.noMatch', { query: query.trim() })}</p>}
        </div>
      ) : (
        <button type="button" className="btn fe-add" onClick={() => setAdding(true)} disabled={full} aria-expanded={false}>
          <Plus size={14} /> {c('fields.add')}
        </button>
      ))}
      {addMenu && full && <p className="subtle">{c('fields.full', { max: MAX_FIELDS })}</p>}
    </div>
  );
}

function FieldRowEditor({ tree, f, index, count, fam, self, onChange, onMove, onRemove }: {
  tree: string; f: DraftField; index: number; count: number; fam: Family; self: string;
  onChange: (patch: Partial<DraftField>) => void; onMove: (d: -1 | 1) => void; onRemove: () => void;
}) {
  const c = useT();
  const id = useId();
  const presets = PRESETS[f.type];
  // A label the family typed (not one of the offered words) keeps the box open for typing.
  const [typing, setTyping] = useState(!!f.label && !presets.includes(f.label) && presets.length > 0);
  const typeName = c(`type.${f.type}` as Key);
  const issue = fieldIssue(f.type, f.value);
  const issueText = issue ? c(`issue.${issue}`) : undefined;
  const labelOptions = [
    { value: '__none', label: c('label.none') },
    ...presets.map((p) => ({ value: p, label: presetLabel(p, c) })),
    { value: '__custom', label: c('label.custom') },
  ];
  const selectValue = typing ? '__custom' : f.label || '__none';

  return (
    <li className={`fe-row fe-row-${f.type}`} aria-labelledby={`${id}-name`}>
      <div className="fe-head">
        <span className="fe-icon" aria-hidden>{TYPE_ICON[f.type]}</span>
        <b id={`${id}-name`} className="fe-name">{typeName}</b>
        <span className="spacer" />
        <button type="button" className="btn icon ghost fe-move" onClick={() => onMove(-1)} disabled={index === 0} aria-label={c('fields.moveUp', { name: typeName })} title={c('fields.moveUp', { name: typeName })}><ArrowUp size={15} /></button>
        <button type="button" className="btn icon ghost fe-move" onClick={() => onMove(1)} disabled={index === count - 1} aria-label={c('fields.moveDown', { name: typeName })} title={c('fields.moveDown', { name: typeName })}><ArrowDown size={15} /></button>
        <button type="button" className="btn icon ghost fe-remove" onClick={onRemove} aria-label={c('fields.remove', { name: typeName })} title={c('fields.remove', { name: typeName })}><Trash2 size={15} /></button>
      </div>

      {presets.length > 0 && (
        <div className="fe-labelrow">
          <span className="fe-sub">{c('fields.label')}</span>
          <Select
            size="sm"
            aria-label={c('fields.labelFor', { name: typeName })}
            value={selectValue}
            options={labelOptions}
            onChange={(v) => {
              if (v === '__custom') { setTyping(true); onChange({ label: '' }); }
              else { setTyping(false); onChange({ label: v === '__none' ? '' : v }); }
            }}
          />
          {typing && (
            <input className="input fe-customlabel" aria-label={c('fields.customLabel')} placeholder={c('fields.customLabelPlaceholder')} value={f.label} autoFocus maxLength={60} onChange={(e) => onChange({ label: e.target.value })} />
          )}
        </div>
      )}
      {presets.length === 0 && (
        <label className="field fe-labelrow">
          <span className="fe-sub">{c('fields.label')}</span>
          <input className="input" value={f.label} maxLength={60} placeholder={typeName} onChange={(e) => onChange({ label: e.target.value })} />
        </label>
      )}

      <div className="fe-inputs">
        {f.type === 'address' && <AddressCardFinder tree={tree} f={f} onChange={onChange} id={`${id}-find`} fam={fam} self={self} />}
        {INPUTS[f.type].map((inp) => {
          const v = f.value[inp.key] ?? '';
          const setV = (text: string) => onChange({ value: { ...f.value, [inp.key]: text } });
          const label = c(inp.label);
          const cls = `field${inp.wide ? ' wide' : ''}`;
          if (inp.kind === 'date') {
            return <DatePicker key={inp.key} label={label} value={v} onChange={setV} className={inp.wide ? 'wide' : ''} precisions={['day', 'month', 'year']} />;
          }
          if (inp.kind === 'period') {
            return <DatePicker key={inp.key} label={label} value={v} onChange={setV} precisions={['year', 'month', 'day']} defaultPrecision="year" />;
          }
          if (inp.kind === 'place') {
            return (
              <div className={cls} key={inp.key}>
                <span id={`${id}-${inp.key}`}>{label}</span>
                <PlaceInput tree={tree} value={{ name: v }} onChange={(p: PlaceValue) => setV(p.name)} aria-labelledby={`${id}-${inp.key}`} />
              </div>
            );
          }
          if (inp.kind) {
            return (
              <div className={cls} key={inp.key}>
                <span id={`${id}-${inp.key}`}>{label}</span>
                {inp.kind === 'favourite' && isColourLabel(f.label)
                  ? <ColourInput value={v} onChange={setV} labelledBy={`${id}-${inp.key}`} />
                  : <WordInput tree={tree} kind={inp.kind} value={v} onChange={setV} labelledBy={`${id}-${inp.key}`} fieldLabel={f.label} />}
              </div>
            );
          }
          if (inp.key === 'person' && f.type === 'related') {
            const people = fam.graph.people
              .filter((p) => p.id !== self)
              .map((p) => ({ p, name: displayName(p, fam) }))
              .sort((a, b) => a.name.localeCompare(b.name, c.locale));
            return (
              <div className={cls} key={inp.key}>
                <span>{label}</span>
                <Select
                  aria-label={label}
                  value={v || 'none'}
                  onChange={(x) => onChange({ value: { ...f.value, person: x === 'none' ? '' : x } })}
                  options={[{ value: 'none', label: c('input.nobody') }, ...people.map(({ p, name }) => ({ value: p.id, label: name }))]}
                />
              </div>
            );
          }
          if (inp.multi) {
            return (
              <label className={cls} key={inp.key}>
                <span>{label}</span>
                <textarea className="input" rows={3} value={v} placeholder={inp.placeholder} onChange={(e) => setV(e.target.value)} />
              </label>
            );
          }
          return (
            <label className={cls} key={inp.key}>
              <span>{label}</span>
              <input className="input" type={inp.type ?? 'text'} value={v} placeholder={inp.placeholder} onChange={(e) => setV(e.target.value)} />
            </label>
          );
        })}
        {f.type === 'religion' && <LeftFaith value={f.value} onChange={(value) => onChange({ value })} />}
      </div>

      <VisibilityPicker value={f.visibility} onChange={(visibility) => onChange({ visibility })} />
      {issueText && <em className="err fe-issue" role="status">{issueText}</em>}
    </li>
  );
}
