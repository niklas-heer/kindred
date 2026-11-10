// Life events and sources as the browser and the server both see them: the fixed list of event types, the shapes the reads
// return, and how a citation names the fact it is about. Pure: no storage, so the pages, the exchange and the tests share it.
// The tables are life_event, source and citation (migrations/tree/0024_events_sources.sql).
import type { Key } from './i18n/dictionary.ts';

export const EVENT_TYPES = [
  'baptism', 'christening', 'confirmation', 'bar-bat-mitzvah', 'education', 'graduation', 'military', 'occupation',
  'residence', 'emigration', 'immigration', 'naturalisation', 'engagement', 'retirement', 'burial', 'cremation', 'census',
  'award', 'custom',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Each type's name, as a translation key: `t(EVENT_LABEL[type])`. */
export const EVENT_LABEL: Record<EventType, Key> = {
  baptism: 'events.type.baptism',
  christening: 'events.type.christening',
  confirmation: 'events.type.confirmation',
  'bar-bat-mitzvah': 'events.type.bar_bat_mitzvah',
  education: 'events.type.education',
  graduation: 'events.type.graduation',
  military: 'events.type.military',
  occupation: 'events.type.occupation',
  residence: 'events.type.residence',
  emigration: 'events.type.emigration',
  immigration: 'events.type.immigration',
  naturalisation: 'events.type.naturalisation',
  engagement: 'events.type.engagement',
  retirement: 'events.type.retirement',
  burial: 'events.type.burial',
  cremation: 'events.type.cremation',
  census: 'events.type.census',
  award: 'events.type.award',
  custom: 'events.type.custom',
};

/** Events that come after a life: they are only offered, and only drawn, for someone not living. */
export const AFTER_DEATH: ReadonlySet<EventType> = new Set(['burial', 'cremation']);

/** At most this many events per person, so a page and an export stay a sensible size. */
export const MAX_EVENTS = 200;

/** A life event as a read returns it. */
export interface LifeEvent {
  id: string;
  person: string;
  type: EventType;
  label: string | null;
  date: string | null;
  endDate: string | null;
  place: string | null;
  note: string;
  ord: number;
}

/** What an editor sends to add (no id) or change an event. */
export interface EventInput {
  id?: string;
  person: string;
  type: EventType;
  label: string | null;
  date: string | null;
  endDate: string | null;
  place: string | null;
  note: string;
}

/** Events of one person in the order the timeline reads them: by date (undated last), then the editor's order. */
export function byDate(a: Pick<LifeEvent, 'date' | 'ord' | 'id'>, b: Pick<LifeEvent, 'date' | 'ord' | 'id'>): number {
  const key = (d: string | null) => (d ? d.replace(/^~/, '') : '9999');
  return key(a.date).localeCompare(key(b.date)) || a.ord - b.ord || a.id.localeCompare(b.id);
}

// ---------- sources and citations ----------

export const QUALITIES = ['original', 'derivative', 'unsure'] as const;
export type Quality = (typeof QUALITIES)[number];
export const QUALITY_LABEL: Record<Quality, Key> = { original: 'sources.quality.original', derivative: 'sources.quality.derivative', unsure: 'sources.quality.unsure' };

export const FACT_KINDS = ['birth', 'death', 'name', 'event', 'partnership', 'parent'] as const;
export type FactKind = (typeof FACT_KINDS)[number];

/** The fact a citation is about, by what survives an edit to it. */
export type Fact =
  | { fact: 'birth' | 'death' | 'name'; person: string }
  | { fact: 'event'; event: string }
  | { fact: 'partnership'; partnership: string }
  | { fact: 'parent'; child: string; parent: string };

/** One string per fact, to count a fact's citations and to compare two facts. */
export function factKey(f: Fact): string {
  switch (f.fact) {
    case 'birth': case 'death': case 'name': return `${f.fact}:${f.person}`;
    case 'event': return `event:${f.event}`;
    case 'partnership': return `partnership:${f.partnership}`;
    case 'parent': return `parent:${f.child}>${f.parent}`;
  }
}

export interface Source {
  id: string;
  title: string;
  author: string | null;
  publication: string | null;
  reference: string | null;
  date: string | null;
  note: string;
  /** A research document it is (only when this reader may see it), and a gallery picture. */
  document: { id: string; title: string; project: string } | null;
  media: string | null;
  /** How many facts cite it. */
  citations: number;
}

export interface SourceInput {
  id?: string;
  title: string;
  author: string | null;
  publication: string | null;
  reference: string | null;
  date: string | null;
  note: string;
  document: string | null;
  media: string | null;
}

export interface Citation {
  id: string;
  source: string;
  /** The source's title, so a list can name it without the whole register. */
  sourceTitle: string;
  target: Fact;
  page: string | null;
  quality: Quality | null;
  transcription: string;
  /** The people the fact is about (the person, the event's person, both partners, child and parent), to name them in a list. */
  about: string[];
  /** For an event, what it is, to name it in a list. */
  event?: { type: EventType; label: string | null };
}

export interface CitationInput {
  id?: string;
  source: string;
  target: Fact;
  page: string | null;
  quality: Quality | null;
  transcription: string;
}

/** Whether a reference is a web address, so the page can link it. Only http and https: never a script. */
export const isWebAddress = (s: string | null | undefined): s is string => !!s && /^https?:\/\/[^\s]+$/i.test(s.trim());
