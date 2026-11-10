// A person's recorded life events and the sources of their facts, as the life timeline reads them. The timeline itself is
// in PersonPanel.tsx (birth, partnerships, children, death from the family graph); this adds the events the family recorded,
// in date order among them, and a small "sourced" mark on any fact a source backs.
//
// Every reader gets the events the server gives them (a guest whose link protects the living gets none of a living person's).
// Citations are for members only, so a guest asks for none and sees no marks.
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  Award, BookCheck, BookOpen, Briefcase, Church, Flag, Flame, GraduationCap, House, Landmark, LogIn, LogOut, Medal, Shield, Sparkles, Star, Sunset, Users,
} from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { AFTER_DEATH, EVENT_LABEL, factKey, type EventType, type Fact, type LifeEvent } from '~/lib/events';
import { personEventsQuery } from '~/lib/events.functions';
import { yearOf } from '~/lib/graph';
import { useT, type Translator } from '~/lib/i18n';
import { ageOn, type Age } from '~/lib/life';
import { useMember } from '~/lib/session';
import { personCitationsQuery } from '~/lib/sources.functions';
import type { GPerson } from '~/lib/types';
import './life.css';

const ICON: Record<EventType, typeof Church> = {
  baptism: Church, christening: Church, confirmation: Church, 'bar-bat-mitzvah': Star, education: BookOpen, graduation: GraduationCap,
  military: Shield, occupation: Briefcase, residence: House, emigration: LogOut, immigration: LogIn, naturalisation: Flag,
  engagement: Sparkles, retirement: Sunset, burial: Landmark, cremation: Flame, census: Users, award: Medal, custom: Award,
};
const shownAge = (age: Age | undefined) => (age && age.years > 0 ? age : undefined);
/** For the Atlas and the editor: the icon of an event's type. */
export const eventIcon = (type: EventType) => ICON[type];

/** One moment of the timeline, as PersonPanel's LifeTimeline lays it out. `after` sorts it after the death in the same year. */
export interface RecordedRow { key: string; year: number; date?: string; age?: Age; icon: ReactNode; text: ReactNode; after?: boolean }

/** What an event is called: its type, or for a custom one its own label. */
export function eventTitle(e: Pick<LifeEvent, 'type' | 'label'>, t: Translator): string {
  if (e.type === 'custom') return e.label ?? t(EVENT_LABEL.custom);
  return t(EVENT_LABEL[e.type]);
}

/** A place name that opens the Atlas there. */
export function AtlasPlace({ tree, name }: { tree: string; name: string }) {
  return <Link to="/$tree/atlas" params={{ tree }} search={{ place: name }} className="pp-place">{name}</Link>;
}

/** "Sourced" with how many sources back a fact. Nothing at all for a fact with none: the Edit tab says that to editors. */
export function SourcedMark({ count }: { count: number }) {
  const t = useT();
  if (!count) return null;
  const words = t('sources.sourced', { count });
  return <span className="life-sourced" title={words}><BookCheck size={11} aria-hidden /><span className="sr-only">{words}</span><span aria-hidden>{count > 1 ? count : ''}</span></span>;
}

/** How many citations each fact has, for the marks. Empty for a guest, who gets no sources. */
export function useCitationCounts(tree: string, person: string): (f: Fact) => number {
  const member = !!useMember(tree);
  const q = useQuery({ ...personCitationsQuery(tree, person), enabled: member });
  return useMemo(() => {
    const n = new Map<string, number>();
    for (const c of q.data ?? []) n.set(factKey(c.target), (n.get(factKey(c.target)) ?? 0) + 1);
    return (f: Fact) => n.get(factKey(f)) ?? 0;
  }, [q.data]);
}

/** The person's recorded events as timeline moments, and the citation counts of their facts. */
export function useRecordedLife(tree: string, p: GPerson): { rows: RecordedRow[]; cites: (f: Fact) => number } {
  const t = useT();
  const events = useQuery(personEventsQuery(tree, p.id)).data;
  const cites = useCitationCounts(tree, p.id);
  const rows = useMemo(() => (events ?? [])
    // A burial is not drawn for someone the family marks as living (the server refuses to add one, but the flag can change).
    .filter((e) => !(p.living && AFTER_DEATH.has(e.type)))
    .map((e): RecordedRow => {
      const Icon = ICON[e.type];
      const year = e.date ? yearOf(e.date) : Number.POSITIVE_INFINITY;
      const until = e.endDate ? (yearOf(e.endDate) === year ? '' : String(yearOf(e.endDate))) : '';
      return {
        key: `ev:${e.id}`,
        year,
        date: e.date ?? undefined,
        // "about 0" under a baptism in the year of birth says nothing: the age starts at one.
        // Nor does an age under a burial: the line above it already says how old they were.
        age: e.date && !AFTER_DEATH.has(e.type) ? shownAge(ageOn(p.born, e.date)) : undefined,
        after: AFTER_DEATH.has(e.type),
        icon: <Icon size={13} />,
        text: (
          <>
            {eventTitle(e, t)}
            {e.type !== 'custom' && e.label ? <>: {e.label}</> : null}
            {e.place ? <> {t('fact.in')} <AtlasPlace tree={tree} name={e.place} /></> : null}
            {until ? <span className="muted"> {t('events.until', { year: until })}</span> : null}
            <SourcedMark count={cites({ fact: 'event', event: e.id })} />
            {e.note ? <span className="life-note">{e.note}</span> : null}
          </>
        ),
      };
    }), [events, p.born, p.living, tree, t, cites]);
  return useMemo(() => ({ rows, cites }), [rows, cites]);
}
