// A project's timeline, derived by researchTimeline: its dated items and its linked people's events, grouped by year.
import { Link } from '@tanstack/react-router';
import { Cake, FileText, Heart, HeartOff, Image, NotebookPen, Skull, type LucideIcon } from 'lucide-react';
import { useFamily } from '~/lib/family';
import { displayName } from '~/lib/graph';
import { useT } from '~/lib/i18n';
import { researchTimeline, unionEndKey, type ProjectView, type TimelineEntry, type TimelineKind } from '~/lib/research';
import { dateText } from './forms';

const ICON: Record<TimelineKind, LucideIcon> = { birth: Cake, death: Skull, union: Heart, 'union-end': HeartOff, document: FileText, note: NotebookPen, picture: Image };

export function Timeline({ tree, view, onDocument, onNote, onPicture }: {
  tree: string; view: ProjectView; onDocument: (id: string) => void; onNote: (id: string) => void; onPicture: (key: string) => void;
}) {
  const t = useT();
  const f = useFamily();
  const entries = researchTimeline(view, f);
  const name = (id?: string) => {
    const p = id ? f.byId.get(id) : undefined;
    return p ? displayName(p, f) : '';
  };

  const personLink = (id: string | undefined, text: string) =>
    id && f.byId.has(id) ? <Link to="/$tree" params={{ tree }} search={{ focus: id }}>{text}</Link> : <>{text}</>;

  const label = (e: TimelineEntry) => {
    const who = name(e.person);
    const other = name(e.other);
    switch (e.kind) {
      case 'birth': return <span>{personLink(e.person, t('research.tl_birth', { name: who }))}</span>;
      case 'death': return <span>{personLink(e.person, t('research.tl_death', { name: who }))}</span>;
      case 'union': return <span>{personLink(e.person, t(e.unionKind === 'marriage' ? 'research.tl_marriage' : 'research.tl_union', { name: who, other: other || '—' }))}</span>;
      case 'union-end': return <span>{personLink(e.person, t(unionEndKey(e.endReason), { name: who, other: other || '—' }))}</span>;
      case 'document': return <button type="button" className="rs-tl-link" onClick={() => onDocument(e.ref!)}>{e.title}</button>;
      case 'note': return <button type="button" className="rs-tl-link" onClick={() => onNote(e.ref!)}>{e.title}</button>;
      case 'picture': return <button type="button" className="rs-tl-link" onClick={() => onPicture(e.ref!)}>{e.title || t('research.tl_picture')}</button>;
    }
  };

  if (!entries.length) return <p className="muted rs-empty-line">{t('research.timeline_empty')}</p>;

  const years = new Map<string, TimelineEntry[]>();
  for (const e of entries) {
    const y = e.date.replace(/^~/, '').slice(0, 4);
    const list = years.get(y) ?? [];
    list.push(e);
    years.set(y, list);
  }

  return (
    <ol className="rs-timeline">
      {[...years].map(([year, list]) => (
        <li key={year} className="rs-tl-year">
          <span className="rs-tl-yearmark">{year.replace(/^0+/, '') || year}</span>
          <ol className="rs-tl-events">
            {list.map((e) => {
              const Icon = ICON[e.kind];
              return (
                <li key={e.id} className={`rs-tl-event is-${e.kind}`}>
                  <span className="rs-tl-icon" aria-hidden><Icon size={14} /></span>
                  <span className="rs-tl-date">{dateText(e.date, t.locale)}</span>
                  <span className="rs-tl-text">{label(e)}</span>
                </li>
              );
            })}
          </ol>
        </li>
      ))}
    </ol>
  );
}
