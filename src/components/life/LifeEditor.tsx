// The editor's part of a person's life on their Edit tab: the recorded events (add, change, order, remove) and the sources of
// each fact (birth, name, death, every event, partnership and parent link), where a fact with no source says so. Readers see
// the same events in the life timeline on the Overview; this is only where they are changed. The server checks the role
// again (events.server.ts, sources.server.ts).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, BookPlus, CalendarPlus, Pencil, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { PlaceInput, placeValue, savePlacesKeyed, type PlaceValue } from '~/components/PlaceInput';
import { ConfirmDialog, DatePicker, Dialog, Notice, Segmented, Select } from '~/components/ui';
import { opKeys } from '~/lib/api';
import { validDate } from '~/lib/dates';
import { errorText } from '~/lib/errortext';
import { AFTER_DEATH, EVENT_LABEL, EVENT_TYPES, QUALITIES, QUALITY_LABEL, factKey, type Citation, type EventType, type Fact, type LifeEvent, type Quality } from '~/lib/events';
import { personEventsQuery, removeLifeEvent, reorderLifeEvents, saveLifeEvent } from '~/lib/events.functions';
import { displayName, fmtDate, type Family } from '~/lib/graph';
import { useT, type Locale, type Translator } from '~/lib/i18n';
import { useCan } from '~/lib/session';
import { personCitationsQuery, removeCitation, saveCitation, sourcesQuery } from '~/lib/sources.functions';
import type { GPerson } from '~/lib/types';
import { eventIcon, eventTitle } from './records';
import { SourceDialog, useSourcesRefresh } from './SourceDialog';
import './life.css';

const WIDE = 'min(560px, 100vw - 24px)';

function useRefresh(tree: string) {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: ['events', tree] }), qc.invalidateQueries({ queryKey: ['sources', tree] })]);
}

/** "1940–1945", "1912", or nothing. */
export function spanText(e: Pick<LifeEvent, 'date' | 'endDate'>, locale: Locale): string {
  const a = e.date ? fmtDate(e.date, locale) : undefined;
  const b = e.endDate ? fmtDate(e.endDate, locale) : undefined;
  return a && b ? `${a} – ${b}` : a ?? (b ? `– ${b}` : '');
}

/** The whole of the editor's life section, for the Edit tab. Nothing for a reader who may not edit. */
export function LifeEditor({ tree, p, f }: { tree: string; p: GPerson; f: Family }) {
  const canEdit = useCan('edit-person');
  if (!canEdit) return null;
  return (
    <div className="life-editor" data-tour="life-editor">
      <EventsSection tree={tree} p={p} />
      <FactSources tree={tree} p={p} f={f} />
    </div>
  );
}

// ---------- events ----------

function EventsSection({ tree, p }: { tree: string; p: GPerson }) {
  const t = useT();
  const events = useQuery(personEventsQuery(tree, p.id)).data ?? [];
  const refresh = useRefresh(tree);
  const [editing, setEditing] = useState<LifeEvent | 'new' | null>(null);
  const [removing, setRemoving] = useState<LifeEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keys = useRef(opKeys());

  const move = async (i: number, by: -1 | 1) => {
    const ids = events.map((e) => e.id);
    [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
    setBusy(true);
    setError(null);
    try {
      await reorderLifeEvents({ data: { tree, person: p.id, ids, opKey: keys.current.for('order', ids) } });
      keys.current.clear('order');
      await refresh();
    } catch (e) {
      setError(errorText(e, t.locale));
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    setError(null);
    try {
      await removeLifeEvent({ data: { tree, id: removing.id, opKey: keys.current.for('remove', removing.id) } });
      keys.current.clear('remove');
      await refresh();
      setRemoving(null);
    } catch (e) {
      setError(errorText(e, t.locale));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="life-section" aria-labelledby="life-events-head">
      <div className="life-section-head">
        <h3 id="life-events-head" className="rule">{t('events.title')}</h3>
        <button type="button" className="btn" onClick={() => setEditing('new')}><CalendarPlus size={15} aria-hidden /> {t('events.add')}</button>
      </div>
      {events.length === 0 ? (
        <p className="subtle life-empty">{t('events.none', { name: p.given })}</p>
      ) : (
        <ol className="life-list">
          {events.map((e, i) => {
            const Icon = eventIcon(e.type);
            // Order only decides between events of the same date (or none), so the arrows are offered only there.
            const sameAsPrev = i > 0 && (events[i - 1].date ?? '') === (e.date ?? '');
            const sameAsNext = i < events.length - 1 && (events[i + 1].date ?? '') === (e.date ?? '');
            const title = eventTitle(e, t);
            return (
              <li key={e.id} className="life-row">
                <Icon size={15} aria-hidden className="life-row-icon" />
                <span className="life-row-main">
                  <span><b>{title}</b>{e.type !== 'custom' && e.label ? `: ${e.label}` : ''}</span>
                  <small className="subtle">{[spanText(e, t.locale), e.place].filter(Boolean).join(' · ') || t('events.no_date')}</small>
                </span>
                <span className="life-row-actions">
                  {sameAsPrev && <button type="button" className="btn icon ghost" disabled={busy} onClick={() => void move(i, -1)} aria-label={t('events.move_up', { what: title })} title={t('events.move_up', { what: title })}><ArrowUp size={14} /></button>}
                  {sameAsNext && <button type="button" className="btn icon ghost" disabled={busy} onClick={() => void move(i, 1)} aria-label={t('events.move_down', { what: title })} title={t('events.move_down', { what: title })}><ArrowDown size={14} /></button>}
                  <button type="button" className="btn icon ghost" onClick={() => setEditing(e)} aria-label={t('events.edit_one', { what: title })} title={t('events.edit_one', { what: title })}><Pencil size={14} /></button>
                  <button type="button" className="btn icon ghost" onClick={() => setRemoving(e)} aria-label={t('events.remove_one', { what: title })} title={t('events.remove_one', { what: title })}><Trash2 size={14} /></button>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {error && !removing ? <Notice>{error}</Notice> : null}
      {editing && <EventDialog tree={tree} p={p} event={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!removing}
        onClose={() => { setRemoving(null); setError(null); }}
        onConfirm={() => void remove()}
        busy={busy}
        error={removing ? error : null}
        title={t('events.remove_title')}
        confirmLabel={t('events.remove')}
      >
        <p>{removing ? t('events.remove_body', { what: eventTitle(removing, t) }) : null}</p>
      </ConfirmDialog>
    </section>
  );
}

/** Adding or changing one event. */
export function EventDialog({ tree, p, event, onClose }: { tree: string; p: GPerson; event?: LifeEvent; onClose: () => void }) {
  const t = useT();
  const refresh = useRefresh(tree);
  const [type, setType] = useState<EventType>(event?.type ?? 'residence');
  const [label, setLabel] = useState(event?.label ?? '');
  const [date, setDate] = useState(event?.date ?? '');
  const [endDate, setEndDate] = useState(event?.endDate ?? '');
  const [place, setPlace] = useState<PlaceValue>(placeValue(event?.place));
  const [note, setNote] = useState(event?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keys = useRef(opKeys());
  const badDate = (!!date && !validDate(date)) || (!!endDate && !validDate(endDate));
  const needsLabel = type === 'custom' && !label.trim();
  const dirty = type !== (event?.type ?? 'residence') || label !== (event?.label ?? '') || date !== (event?.date ?? '') || endDate !== (event?.endDate ?? '')
    || place.name !== (event?.place ?? '') || note !== (event?.note ?? '');
  // A burial or a cremation is for someone who has died; one already recorded stays editable.
  const types = EVENT_TYPES.filter((x) => !p.living || !AFTER_DEATH.has(x) || x === event?.type);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (badDate || needsLabel || busy) return;
    setBusy(true);
    setError(null);
    try {
      await savePlacesKeyed(tree, (pl) => keys.current.for('places', pl), place);
      const payload = { id: event?.id, person: p.id, type, label: label || null, date: date || null, endDate: endDate || null, place: place.name.trim() || null, note };
      await saveLifeEvent({ data: { tree, event: payload, opKey: keys.current.for('save', payload) } });
      keys.current.clear();
      await refresh();
      onClose();
    } catch (err) {
      setError(errorText(err, t.locale));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={event ? t('events.edit') : t('events.add_for', { name: p.given })}
      width={WIDE}
      dirty={dirty}
      footer={<button type="submit" form="life-event-form" className="btn primary" disabled={busy || badDate || needsLabel}>{t('events.save')}</button>}
    >
      <form id="life-event-form" className="life-form" onSubmit={(e) => void submit(e)}>
        <div className="field life-field">
          <span id="life-event-type">{t('events.field.type')}</span>
          <Select aria-labelledby="life-event-type" value={type} onChange={(v) => setType(v as EventType)} options={types.map((x) => ({ value: x, label: t(EVENT_LABEL[x]) }))} />
        </div>
        <label className="field life-field">
          <span>{type === 'custom' ? t('events.field.label_custom') : t('events.field.label')}</span>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} placeholder={t('events.field.label_ph')} required={type === 'custom'} data-autofocus />
        </label>
        <div className="life-pair">
          <DatePicker label={t('events.field.date')} value={date} onChange={setDate} />
          <DatePicker label={t('events.field.end')} value={endDate} onChange={setEndDate} hint={t('events.field.end_hint')} />
        </div>
        <div className="field life-field">
          <span id="life-event-place">{t('events.field.place')}</span>
          <PlaceInput tree={tree} value={place} onChange={setPlace} aria-labelledby="life-event-place" />
        </div>
        <label className="field life-field">
          <span>{t('events.field.note')}</span>
          <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} rows={3} />
        </label>
        {error ? <Notice>{error}</Notice> : null}
      </form>
    </Dialog>
  );
}

// ---------- sources of each fact ----------

interface FactRow { key: string; fact: Fact; label: ReactNode; what: string }

function factsOf(p: GPerson, f: Family, events: LifeEvent[], t: Translator): FactRow[] {
  const out: FactRow[] = [];
  const add = (fact: Fact, what: string, detail?: string) => out.push({ key: factKey(fact), fact, what, label: <>{what}{detail ? <small className="subtle"> · {detail}</small> : null}</> });
  const locale = t.locale;
  add({ fact: 'name', person: p.id }, t('sources.fact.name'), [p.given, p.surname].filter(Boolean).join(' '));
  add({ fact: 'birth', person: p.id }, t('sources.fact.birth'), [fmtDate(p.born, locale), p.bornPlace].filter(Boolean).join(', '));
  if (!p.living) add({ fact: 'death', person: p.id }, t('sources.fact.death'), [fmtDate(p.died, locale), p.diedPlace].filter(Boolean).join(', '));
  for (const parent of f.parentsOf.get(p.id) ?? []) {
    const pp = f.byId.get(parent);
    if (pp) add({ fact: 'parent', child: p.id, parent }, t('sources.fact.parent', { name: displayName(pp, f) }));
  }
  for (const u of f.unionsOf.get(p.id) ?? []) {
    const other = f.byId.get(u.a === p.id ? u.b : u.a);
    if (other) add({ fact: 'partnership', partnership: u.id }, t('sources.fact.partnership', { name: displayName(other, f) }), fmtDate(u.start, locale));
  }
  for (const e of events) add({ fact: 'event', event: e.id }, eventTitle(e, t), [spanText(e, locale), e.place].filter(Boolean).join(', '));
  return out;
}

function FactSources({ tree, p, f }: { tree: string; p: GPerson; f: Family }) {
  const t = useT();
  const events = useQuery(personEventsQuery(tree, p.id)).data;
  const citations = useQuery(personCitationsQuery(tree, p.id)).data;
  const facts = useMemo(() => factsOf(p, f, events ?? [], t), [p, f, events, t]);
  const byFact = useMemo(() => {
    const m = new Map<string, Citation[]>();
    for (const c of citations ?? []) m.set(factKey(c.target), [...(m.get(factKey(c.target)) ?? []), c]);
    return m;
  }, [citations]);
  const [citing, setCiting] = useState<{ row: FactRow; citation?: Citation } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const missing = facts.filter((x) => !byFact.has(x.key)).length;

  return (
    <section className="life-section" aria-labelledby="life-sources-head">
      <div className="life-section-head">
        <h3 id="life-sources-head" className="rule">{t('sources.of_facts')}</h3>
        <span className="subtle">{missing ? t('sources.unsourced_count', { count: missing }) : t('sources.all_sourced')}</span>
      </div>
      <ul className="life-list">
        {facts.map((x) => {
          const list = byFact.get(x.key) ?? [];
          const expanded = open === x.key;
          return (
            <li key={x.key} className="life-fact">
              <div className="life-row">
                <span className="life-row-main">{x.label}</span>
                {list.length ? (
                  <button type="button" className="chip life-count" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : x.key)}>
                    {t('sources.sourced', { count: list.length })}
                  </button>
                ) : (
                  <span className="chip life-none">{t('sources.no_source')}</span>
                )}
                <button type="button" className="btn icon ghost" onClick={() => setCiting({ row: x })} aria-label={t('sources.cite_for', { what: x.what })} title={t('sources.cite_for', { what: x.what })}><BookPlus size={15} /></button>
              </div>
              {expanded && (
                <ul className="life-cites">
                  {list.map((c) => <CitationLine key={c.id} tree={tree} c={c} onEdit={() => setCiting({ row: x, citation: c })} />)}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {citing && <CitationDialog tree={tree} row={citing.row} citation={citing.citation} onClose={() => setCiting(null)} />}
    </section>
  );
}

function CitationLine({ tree, c, onEdit }: { tree: string; c: Citation; onEdit: () => void }) {
  const t = useT();
  const refresh = useRefresh(tree);
  const keys = useRef(opKeys());
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    try {
      await removeCitation({ data: { tree, id: c.id, opKey: keys.current.for('remove', c.id) } });
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <li>
      <span>
        <b>{c.sourceTitle}</b>{c.page ? `, ${c.page}` : ''}
        {c.quality ? <small className="subtle"> · {t(QUALITY_LABEL[c.quality])}</small> : null}
        {c.transcription ? <q className="life-quote">{c.transcription}</q> : null}
      </span>
      <button type="button" className="btn icon ghost" onClick={onEdit} aria-label={t('sources.edit_citation', { source: c.sourceTitle })} title={t('sources.edit_citation', { source: c.sourceTitle })}><Pencil size={13} /></button>
      <button type="button" className="btn icon ghost" disabled={busy} onClick={() => void remove()} aria-label={t('sources.remove_citation', { source: c.sourceTitle })} title={t('sources.remove_citation', { source: c.sourceTitle })}><Trash2 size={13} /></button>
    </li>
  );
}

/** Citing a source for one fact, or changing a citation: which source, where in it, how good, and what it says. */
function CitationDialog({ tree, row, citation, onClose }: { tree: string; row: FactRow; citation?: Citation; onClose: () => void }) {
  const t = useT();
  const refresh = useRefresh(tree);
  const refreshSources = useSourcesRefresh(tree);
  const sources = useQuery(sourcesQuery(tree)).data ?? [];
  const [source, setSource] = useState(citation?.source ?? '');
  const [page, setPage] = useState(citation?.page ?? '');
  const [quality, setQuality] = useState<Quality | ''>(citation?.quality ?? '');
  const [transcription, setTranscription] = useState(citation?.transcription ?? '');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keys = useRef(opKeys());
  const dirty = source !== (citation?.source ?? '') || page !== (citation?.page ?? '') || quality !== (citation?.quality ?? '') || transcription !== (citation?.transcription ?? '');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!source || busy) return;
    setBusy(true);
    setError(null);
    try {
      const payload = { id: citation?.id, source, target: row.fact, page: page || null, quality: quality || null, transcription };
      await saveCitation({ data: { tree, citation: payload, opKey: keys.current.for('save', payload) } });
      keys.current.clear();
      await Promise.all([refresh(), refreshSources()]);
      onClose();
    } catch (err) {
      setError(errorText(err, t.locale));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog
        open={!creating}
        onClose={onClose}
        title={t('sources.cite_title', { what: row.what })}
        width={WIDE}
        dirty={dirty}
        footer={<button type="submit" form="life-cite-form" className="btn primary" disabled={busy || !source}>{t('sources.cite_save')}</button>}
      >
        <form id="life-cite-form" className="life-form" onSubmit={(e) => void submit(e)}>
          <div className="field life-field">
            <span id="life-cite-source">{t('sources.field.source')}</span>
            <div className="life-pair life-pair-tight">
              <Select
                aria-labelledby="life-cite-source"
                value={source}
                onChange={setSource}
                placeholder={sources.length ? t('sources.pick') : t('sources.none_yet')}
                options={sources.map((s) => ({ value: s.id, label: s.title, hint: s.author ?? undefined }))}
              />
              <button type="button" className="btn" onClick={() => setCreating(true)}>{t('sources.new')}</button>
            </div>
          </div>
          <label className="field life-field">
            <span>{t('sources.field.page')}</span>
            <input className="input" value={page} onChange={(e) => setPage(e.target.value)} maxLength={300} placeholder={t('sources.field.page_ph')} />
          </label>
          <div className="field life-field">
            <span id="life-cite-quality">{t('sources.field.quality')}</span>
            <Segmented
              aria-labelledby="life-cite-quality"
              block
              value={quality}
              onChange={(v) => setQuality(v as Quality | '')}
              options={[{ value: '', label: t('sources.quality.unknown') }, ...QUALITIES.map((x) => ({ value: x, label: t(QUALITY_LABEL[x]) }))]}
            />
          </div>
          <label className="field life-field">
            <span>{t('sources.field.transcription')}</span>
            <textarea className="input" value={transcription} onChange={(e) => setTranscription(e.target.value)} maxLength={4000} rows={3} placeholder={t('sources.field.transcription_ph')} />
          </label>
          {error ? <Notice>{error}</Notice> : null}
        </form>
      </Dialog>
      {creating && <SourceDialog tree={tree} onClose={() => setCreating(false)} onSaved={(id) => setSource(id)} />}
    </>
  );
}

/** "Add an event" where the life is read, for an editor: the same dialog as on the Edit tab. */
export function AddEventButton({ tree, p }: { tree: string; p: GPerson }) {
  const t = useT();
  const canEdit = useCan('edit-person');
  const [open, setOpen] = useState(false);
  if (!canEdit) return null;
  return (
    <>
      <button type="button" className="btn ghost pp-more" onClick={() => setOpen(true)}><CalendarPlus size={14} aria-hidden /> {t('events.add')}</button>
      {open && <EventDialog tree={tree} p={p} onClose={() => setOpen(false)} />}
    </>
  );
}
