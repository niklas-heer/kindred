// How a suggestion reads on a page (src/lib/suggestions/types.ts): its heading, its state, and its change as rows of
// "what · now · suggested", each row's value in words and, for a reviewer who adjusts it, as an input. Shared by the
// reviewer's card (SuggestionCard), the suggester's list (MySuggestions) and the dialog's fields (SuggestDialog).
//
//   const rows = rowsOf(view);           // the rows of its payload, in a fixed order
//   <ValueInput row={row} value={v} onChange={…} />
import { useQuery } from '@tanstack/react-query';
import { eventTitle } from '~/components/life/records';
import { DatePicker, Select, Switch } from '~/components/ui';
import { EVENT_LABEL, EVENT_TYPES, type EventType, type LifeEvent } from '~/lib/events';
import { personEventsQuery } from '~/lib/events.functions';
import { displayName, fmtDate, type Family } from '~/lib/graph';
import type { Key, Translator } from '~/lib/i18n';
import type { EventPayload, FactValue, RelativePayload, SourcePayload, SuggestionPayload, SuggestionStatus, SuggestionView } from '~/lib/suggestions/types';

export type FieldType = 'text' | 'longtext' | 'date' | 'sex' | 'living' | 'eventKind' | 'union' | 'link' | 'parentKind' | 'list' | 'backs';

/** One value of a suggestion: where it is in the payload (`person.given`), its label, and how it is written and edited. */
export interface Row { path: string; label: Key; type: FieldType; editable: boolean }

const row = (path: string, label: Key, type: FieldType = 'text', editable = true): Row => ({ path, label, type, editable });

const DETAILS: Row[] = [
  row('given', 'suggest.field.given'), row('surname', 'suggest.field.surname'), row('birthName', 'suggest.field.birthName'),
  row('nickname', 'suggest.field.nickname'), row('title', 'suggest.field.title'), row('sex', 'suggest.field.sex', 'sex'),
  row('living', 'suggest.field.living', 'living'), row('born', 'suggest.field.born', 'date'), row('bornPlace', 'suggest.field.bornPlace'),
  row('died', 'suggest.field.died', 'date'), row('diedPlace', 'suggest.field.diedPlace'),
];
const RELATIVE: Row[] = [
  row('link.kind', 'suggest.field.link', 'link'), row('link.parentKind', 'suggest.parent_kind', 'parentKind'),
  row('link.partnerKind', 'suggest.field.partnershipKind', 'union'), row('person.given', 'suggest.field.given'),
  row('person.furtherGiven', 'suggest.field.furtherGiven', 'list', false), row('person.surname', 'suggest.field.birthName'),
  row('person.sex', 'suggest.field.sex', 'sex'), row('person.living', 'suggest.field.living', 'living'),
  row('person.born', 'suggest.field.born', 'date'), row('person.died', 'suggest.field.died', 'date'),
];
const NEW_EVENT: Row[] = [
  row('kind', 'suggest.field.kind', 'eventKind'), row('label', 'suggest.field.label'), row('date', 'suggest.field.date', 'date'),
  row('place', 'suggest.field.place'), row('note', 'suggest.field.note', 'longtext'),
];
const EVENT_FIX: Row[] = [row('date', 'suggest.field.date', 'date'), row('place', 'suggest.field.place'), row('note', 'suggest.field.note', 'longtext')];
const COUPLE_FIX: Row[] = [
  row('partnershipKind', 'suggest.field.partnershipKind', 'union'), row('start', 'suggest.field.start', 'date'), row('startPlace', 'suggest.field.startPlace'),
];
const SOURCE: Row[] = [
  row('title', 'suggest.field.source_title'), row('author', 'suggest.field.author'), row('publication', 'suggest.field.publication'),
  row('reference', 'suggest.field.reference'), row('date', 'suggest.field.date', 'date'), row('note', 'suggest.field.note', 'longtext'),
  row('transcription', 'suggest.field.transcription', 'longtext'), row('backs', 'suggest.field.backs', 'backs', false),
];

/** A value at a dotted path of a payload. */
export function valueAt(payload: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), payload);
}

/** A copy of the payload with the value at `path` set; undefined takes the key out. */
export function withValue<P>(payload: P, path: string, value: unknown): P {
  const [head, ...rest] = path.split('.');
  const o = { ...(payload as Record<string, unknown>) };
  if (rest.length) o[head] = withValue(o[head] ?? {}, rest.join('.'), value);
  else if (value === undefined) delete o[head];
  else o[head] = value;
  return o as P;
}

/** Whether an event suggestion corrects an event, a couple, or adds an event. */
export const eventMode = (p: EventPayload) => (p.partnership !== undefined ? 'couple' : p.event !== undefined ? 'fix' : 'new');

/**
 * The rows a suggestion of this kind can have, in order (a correction's only those it changes). While a reviewer adjusts it,
 * `original` is the payload as suggested, so a value they empty keeps its row.
 */
export function rowsFor(kind: SuggestionView['kind'], payload: SuggestionPayload, original?: SuggestionPayload): Row[] {
  const has = (path: string) => valueAt(payload, path) !== undefined || (original !== undefined && valueAt(original, path) !== undefined);
  if (kind === 'details') return DETAILS.filter((r) => has(r.path));
  if (kind === 'relative') {
    const link = (payload as RelativePayload).link?.kind;
    return RELATIVE.filter((r) =>
      r.path === 'link.parentKind' ? link === 'parent' || link === 'child' : r.path === 'link.partnerKind' ? link === 'partner' : r.path !== 'person.furtherGiven' || has(r.path));
  }
  if (kind === 'event') {
    const p = payload as EventPayload;
    const mode = eventMode(p);
    if (mode === 'new') return NEW_EVENT.filter((r) => r.path !== 'label' || p.kind === 'custom' || has('label'));
    return (mode === 'couple' ? COUPLE_FIX : EVENT_FIX).filter((r) => has(r.path));
  }
  return SOURCE.filter((r) => r.path === 'title' || has(r.path));
}

/** The value in words. */
export function valueText(r: Row, v: unknown, t: Translator, o: { events?: LifeEvent[] } = {}): string {
  if (v === undefined || v === null || v === '') return t('suggest.none');
  switch (r.type) {
    case 'date': return fmtDate(String(v), t.locale) ?? String(v);
    case 'sex': return t(`sex.${v as 'm'}`);
    case 'living': return t(v ? 'suggest.living.yes' : 'suggest.living.no');
    case 'eventKind': return t(EVENT_LABEL[v as EventType] ?? 'events.type.custom');
    case 'union': return t(`suggest.union.${v as 'marriage'}`);
    case 'link': return t(`suggest.link.${v as 'parent'}`);
    case 'parentKind': return t(`suggest.parent.${v as 'biological'}`);
    case 'list': return Array.isArray(v) ? v.join(' ') : String(v);
    case 'backs': {
      const b = v as NonNullable<SourcePayload['backs']>;
      if (b.fact === 'event') {
        const e = o.events?.find((x) => x.id === b.event);
        return e ? eventTitle(e, t) : t('suggest.what.an_event');
      }
      return t(`suggest.backs.${b.fact as 'birth'}`);
    }
    default: return typeof v === 'boolean' ? t(v ? 'suggest.living.yes' : 'suggest.living.no') : String(v);
  }
}

/** A row's value as a reviewer adjusts it. */
export function ValueInput({ row: r, value, onChange, t }: { row: Row; value: unknown; onChange: (v: unknown) => void; t: Translator }) {
  const label = t(r.label);
  const s = typeof value === 'string' ? value : '';
  switch (r.type) {
    case 'date':
      return <DatePicker label={<span className="sr-only">{label}</span>} value={s} onChange={(v) => onChange(v || null)} />;
    case 'sex':
      return (
        <Select aria-label={label} value={s} onChange={(v) => onChange(v || null)}
          options={[{ value: '', label: t('sex.unknown') }, { value: 'f', label: t('sex.f') }, { value: 'm', label: t('sex.m') }, { value: 'x', label: t('sex.x') }]} />
      );
    case 'living':
      return <Switch checked={!!value} onChange={onChange}>{label}</Switch>;
    case 'eventKind':
      return <Select aria-label={label} value={s} onChange={onChange} options={EVENT_TYPES.map((k) => ({ value: k, label: t(EVENT_LABEL[k]) }))} />;
    case 'union':
      return <Select aria-label={label} value={s} onChange={onChange} options={UNION_KINDS.map((k) => ({ value: k, label: t(`suggest.union.${k}`) }))} />;
    case 'link':
      return <Select aria-label={label} value={s} onChange={onChange} options={LINK_KINDS.map((k) => ({ value: k, label: t(`suggest.link.${k}`) }))} />;
    case 'parentKind':
      return <Select aria-label={label} value={s || 'biological'} onChange={onChange} options={PARENT_KINDS.map((k) => ({ value: k, label: t(`suggest.parent.${k}`) }))} />;
    case 'longtext':
      return <textarea className="input" rows={3} aria-label={label} value={s} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <input className="input" type="text" aria-label={label} value={s} onChange={(e) => onChange(e.target.value)} />;
  }
}

export const LINK_KINDS = ['parent', 'child', 'partner', 'sibling'] as const;
export const PARENT_KINDS = ['biological', 'adoptive', 'foster', 'step'] as const;
export const UNION_KINDS = ['marriage', 'partnership', 'betrothal', 'other'] as const;

/** The state shown on a suggestion: an approval in part, with changes, or plain (when whether it was changed is not known). */
export function stateKey(v: Pick<SuggestionView, 'status' | 'adjusted' | 'partial'>): Key {
  if (v.status !== 'approved') return `suggest.state.${v.status satisfies SuggestionStatus}`;
  return v.partial ? 'suggest.state.approved_part' : v.adjusted === true ? 'suggest.state.approved_changes' : 'suggest.state.approved';
}

/** The person's events, when a suggestion names one of theirs (a correction, or a source backing one). */
export function useEventsOf(tree: string, v: Pick<SuggestionView, 'kind' | 'person' | 'payload'>) {
  const p = v.payload as EventPayload & SourcePayload;
  const needs = !!v.person && ((v.kind === 'event' && p.event !== undefined) || (v.kind === 'source' && p.backs?.fact === 'event'));
  return useQuery({ ...personEventsQuery(tree, v.person ?? ''), enabled: needs }).data;
}

/** The suggestion in one line: what it is, about whom. */
export function headingOf(v: Pick<SuggestionView, 'kind' | 'person' | 'payload'>, f: Family, t: Translator, events?: LifeEvent[]): string {
  const who = v.person ? f.byId.get(v.person) : undefined;
  const name = who ? displayName(who, f) : t('suggest.what.someone');
  switch (v.kind) {
    case 'details': return t('suggest.what.details', { name });
    case 'relative': return t(`suggest.what.${(v.payload as RelativePayload).link.kind}`, { name });
    case 'event': {
      const p = v.payload as EventPayload;
      const mode = eventMode(p);
      if (mode === 'couple') {
        const u = f.graph.unions.find((x) => x.id === p.partnership);
        const other = u ? f.byId.get(u.a === v.person ? u.b : u.a) : undefined;
        return t('suggest.what.couple_fix', { name, other: other ? displayName(other, f) : t('suggest.what.someone') });
      }
      if (mode === 'fix') {
        const e = events?.find((x) => x.id === p.event);
        return t('suggest.what.event_fix', { name, event: e ? eventTitle(e, t) : t('suggest.what.an_event') });
      }
      return t('suggest.what.event_new', { name, event: p.kind === 'custom' && p.label ? p.label : t(EVENT_LABEL[p.kind as EventType] ?? 'events.type.custom') });
    }
    case 'source': return t('suggest.what.source', { title: (v.payload as SourcePayload).title });
  }
}

/** A file's size in words a reader knows: kB below a megabyte, else MB with one decimal. */
export function sizeText(bytes: number, locale: string): string {
  const mb = bytes / (1024 * 1024);
  return mb < 1 ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.max(1, bytes / 1024))} kB` : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(mb)} MB`;
}

/** The current value of a correction's field for "now", as the reviewer reads it. */
export const nowOf = (v: SuggestionView, r: Row): FactValue | undefined => (v.current ? v.current[r.path] : undefined);
