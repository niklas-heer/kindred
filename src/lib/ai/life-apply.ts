// How an approved life-event, source or citation card becomes what the forms send (events.functions.ts, sources.functions.ts).
// Pure, so the browser's approval (components/assistant/apply.ts) and the tests share it. Nothing here writes.
import type { CitationInput, EventInput, Fact, LifeEvent, Quality, Source, SourceInput } from '../events';

type EventArgs = { id?: string; person: string; type: EventInput['type']; label?: string; date: string | null; endDate: string | null; place: string | null; note?: string };
type EventBefore = Pick<LifeEvent, 'type' | 'label' | 'date' | 'endDate' | 'place' | 'note'>;
type SourceArgs = { id?: string; title: string; author: string | null; publication: string | null; reference: string | null; date: string | null; note: string };
type Cite = { source?: string; sourceTitle?: string; page: string | null; quality: Quality | null; transcription: string };

const orNull = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

/** The event as the Edit tab's dialog sends it. */
export function eventInput(a: EventArgs): EventInput {
  return { ...(a.id && { id: a.id }), person: a.person, type: a.type, label: orNull(a.label), date: orNull(a.date), endDate: orNull(a.endDate), place: orNull(a.place), note: (a.note ?? '').trim() };
}

/** Whether an event still is what the card showed as its starting point. */
export function eventUnchanged(now: LifeEvent, before: EventBefore): boolean {
  return now.type === before.type && (now.label ?? null) === (before.label ?? null) && (now.date ?? null) === (before.date ?? null)
    && (now.endDate ?? null) === (before.endDate ?? null) && (now.place ?? null) === (before.place ?? null) && now.note === before.note;
}

/**
 * The source a card cites, from the family's list as it is now: by id, or by the title of a source another card of the same
 * reply adds. That card has to be approved first: until it is, there is no such source and nothing is written.
 */
export function pickSource(list: Pick<Source, 'id' | 'title'>[], cite: { source?: string; sourceTitle?: string }): string {
  if (cite.source) {
    if (!list.some((s) => s.id === cite.source)) throw new Error('sources.err.gone');
    return cite.source;
  }
  const title = (cite.sourceTitle ?? '').trim().toLowerCase();
  const found = list.find((s) => s.title.trim().toLowerCase() === title);
  if (!found) throw new Error('ailife.err.source_first');
  return found.id;
}

/** The source as the Sources page's dialog sends it. A change keeps the research document and the picture it links to. */
export function sourceInput(a: SourceArgs, current?: Pick<Source, 'document' | 'media'>): SourceInput {
  return {
    ...(a.id && { id: a.id }), title: a.title.trim(), author: orNull(a.author), publication: orNull(a.publication), reference: orNull(a.reference), date: orNull(a.date),
    note: a.note.trim(), document: current?.document?.id ?? null, media: current?.media ?? null,
  };
}

/** Whether a source still is what the card showed as its starting point. */
export function sourceUnchanged(now: Pick<Source, 'title' | 'author' | 'publication' | 'reference' | 'date' | 'note'>, before: Omit<SourceArgs, 'id'>): boolean {
  return now.title === before.title && now.author === before.author && now.publication === before.publication && now.reference === before.reference && now.date === before.date && now.note === before.note;
}

/** The citation as the cite dialog sends it. */
export function citationInput(cite: Cite & { id?: string }, source: string, target: Fact): CitationInput {
  return { ...(cite.id && { id: cite.id }), source, target, page: orNull(cite.page), quality: cite.quality ?? null, transcription: cite.transcription.trim() };
}
