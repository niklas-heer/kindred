// The Edit tab's list of fields, shaped like a contact card: each field is a row with its label, its value
// and its controls. Fields can be added from a menu of types, several of each kind, put in order with the
// arrows, marked private (where that applies) and removed. The whole list is saved with the person.
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import type { Family } from '~/lib/graph';
import { displayName } from '~/lib/graph';
import { Select, Switch } from '../ui';
import { TYPE_ICON } from './FieldsView';
import { blankValue, DEFAULT_LABEL, fieldIssue, MAX_FIELDS, PRESETS, privateByDefault, type FieldType, type FieldValue } from './model';
import { presetLabel } from './presets';
import { useT, type Key } from '~/lib/i18n';

/** A field while it is being edited. `key` is for React; `id` is set once the family has saved it. */
export interface DraftField {
  key: string;
  id?: string;
  type: FieldType;
  label: string;
  value: FieldValue;
  private: boolean;
}

/** A saved field as a draft: every key of its type present, so the inputs are all controlled. */
export const draftOf = (f: { id: string; type: FieldType; label: string; value: FieldValue; private: boolean }): DraftField =>
  ({ key: f.id, id: f.id, type: f.type, label: f.label, value: { ...blankValue(f.type), ...f.value }, private: f.private });

const newKey = () => `n${Math.random().toString(36).slice(2, 10)}`;

/** The groups the add menu shows, in order. */
const ADD_GROUPS: { title: Key; types: FieldType[] }[] = [
  { title: 'group.contact', types: ['phone', 'email', 'address', 'website', 'social'] },
  { title: 'group.names', types: ['names'] },
  { title: 'group.life', types: ['dates', 'education', 'occupation', 'military'] },
  { title: 'group.background', types: ['religion', 'nationality', 'languages'] },
  { title: 'group.health', types: ['medical', 'allergies'] },
  { title: 'group.likes', types: ['favourites', 'gifts'] },
  { title: 'group.other', types: ['related', 'notes', 'custom'] },
];

/** One input for a value key: its label, and how it is typed. */
interface Input { key: string; label: Key; wide?: boolean; multi?: boolean; type?: string; placeholder?: string; select?: boolean }
const from: Input = { key: 'from', label: 'input.from', placeholder: '1985' };
const to: Input = { key: 'to', label: 'input.to', placeholder: '1990' };
const note: Input = { key: 'note', label: 'input.note', wide: true };
const INPUTS: Record<FieldType, Input[]> = {
  phone: [{ key: 'number', label: 'input.number', type: 'tel', wide: true, placeholder: '+49 …' }],
  email: [{ key: 'address', label: 'input.email', type: 'email', wide: true, placeholder: 'name@example.com' }],
  address: [
    { key: 'street', label: 'input.street', wide: true },
    { key: 'postcode', label: 'input.postcode' },
    { key: 'city', label: 'input.city' },
    { key: 'country', label: 'input.country', wide: true },
  ],
  website: [{ key: 'url', label: 'input.url', type: 'url', wide: true, placeholder: 'example.org' }],
  social: [{ key: 'handle', label: 'input.handle', wide: true, placeholder: '@name' }],
  names: [{ key: 'name', label: 'input.name', wide: true }],
  dates: [{ key: 'date', label: 'input.date', wide: true, placeholder: '1953-08-08' }, note],
  education: [{ key: 'school', label: 'input.school', wide: true }, { key: 'place', label: 'input.place' }, from, to, note],
  occupation: [{ key: 'title', label: 'input.title', wide: true }, { key: 'employer', label: 'input.employer', wide: true }, from, to, note],
  military: [{ key: 'unit', label: 'input.unit', wide: true }, { key: 'rank', label: 'input.rank' }, from, to],
  religion: [{ key: 'name', label: 'input.name', wide: true }],
  nationality: [{ key: 'country', label: 'input.country', wide: true }],
  languages: [{ key: 'language', label: 'input.language' }, { key: 'level', label: 'input.level' }],
  medical: [{ key: 'note', label: 'input.note', wide: true, multi: true }],
  allergies: [{ key: 'note', label: 'input.note', wide: true, multi: true }],
  favourites: [{ key: 'text', label: 'input.text', wide: true }],
  gifts: [{ key: 'text', label: 'input.text', wide: true }],
  notes: [{ key: 'text', label: 'input.text', wide: true, multi: true }],
  related: [
    { key: 'person', label: 'input.person', wide: true, select: true },
    { key: 'name', label: 'input.nameOutside', wide: true },
    note,
  ],
  custom: [{ key: 'text', label: 'input.text', wide: true, multi: true }],
};

/** The list, with add, reorder and remove. `fam` names the people a related field may link to. */
export function FieldEditor({ value, onChange, fam, self }: { value: DraftField[]; onChange: (next: DraftField[]) => void; fam: Family; self: string }) {
  const c = useT();
  const [adding, setAdding] = useState(false);
  const full = value.length >= MAX_FIELDS;
  const add = (type: FieldType) => {
    onChange([...value, { key: newKey(), type, label: DEFAULT_LABEL[type] ?? '', value: blankValue(type), private: privateByDefault(type) }]);
    setAdding(false);
  };
  const update = (i: number, patch: Partial<DraftField>) => onChange(value.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));

  return (
    <section className="fe" aria-labelledby="fe-title">
      <div className="rule" id="fe-title">{c('fields.title')}</div>
      {value.length === 0 && <p className="subtle fe-empty">{c('fields.empty')}</p>}
      <ol className="fe-list">
        {value.map((f, i) => (
          <FieldRowEditor
            key={f.key} f={f} index={i} count={value.length} fam={fam} self={self}
            onChange={(patch) => update(i, patch)} onMove={(d) => move(i, d)} onRemove={() => remove(i)}
          />
        ))}
      </ol>

      {adding ? (
        <div className="fe-menu" role="group" aria-label={c('fields.addMenu')}>
          {ADD_GROUPS.map((g) => (
            <div className="fe-menu-group" key={g.title}>
              <span className="subtle">{c(g.title)}</span>
              <div className="fe-menu-items">
                {g.types.map((t) => (
                  <button type="button" className="btn fe-type" key={t} onClick={() => add(t)}>{TYPE_ICON[t]} {c(`type.${t}` as Key)}</button>
                ))}
              </div>
            </div>
          ))}
          <div className="row end"><button type="button" className="btn ghost" onClick={() => setAdding(false)}>{c('fields.cancelAdd')}</button></div>
        </div>
      ) : (
        <button type="button" className="btn fe-add" onClick={() => setAdding(true)} disabled={full} aria-expanded={false}>
          <Plus size={14} /> {c('fields.add')}
        </button>
      )}
      {full && <p className="subtle">{c('fields.full', { max: MAX_FIELDS })}</p>}
    </section>
  );
}

function FieldRowEditor({ f, index, count, fam, self, onChange, onMove, onRemove }: {
  f: DraftField; index: number; count: number; fam: Family; self: string;
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
    <li className="fe-row" aria-labelledby={`${id}-name`}>
      <div className="fe-head">
        <span className="fe-icon" aria-hidden>{TYPE_ICON[f.type]}</span>
        <b id={`${id}-name`} className="fe-name">{typeName}</b>
        <span className="spacer" />
        <button type="button" className="btn icon ghost" onClick={() => onMove(-1)} disabled={index === 0} aria-label={c('fields.moveUp', { name: typeName })} title={c('fields.moveUp', { name: typeName })}><ArrowUp size={15} /></button>
        <button type="button" className="btn icon ghost" onClick={() => onMove(1)} disabled={index === count - 1} aria-label={c('fields.moveDown', { name: typeName })} title={c('fields.moveDown', { name: typeName })}><ArrowDown size={15} /></button>
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
        {INPUTS[f.type].map((inp) => {
          const v = f.value[inp.key] ?? '';
          const setV = (text: string) => onChange({ value: { ...f.value, [inp.key]: text } });
          const label = c(inp.label);
          const cls = `field${inp.wide ? ' wide' : ''}`;
          if (inp.select) {
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
              <input className="input" type={inp.type ?? 'text'} inputMode={inp.key === 'from' || inp.key === 'to' ? 'numeric' : undefined} value={v} placeholder={inp.placeholder} onChange={(e) => setV(e.target.value)} />
            </label>
          );
        })}
      </div>

      <div className="fe-private">
        <Switch checked={f.private} onChange={(on) => onChange({ private: on })}>{c('field.private')}</Switch>
        <span className="subtle">{c('field.privateHint')}</span>
      </div>
      {issueText && <em className="err fe-issue" role="status">{issueText}</em>}
    </li>
  );
}
