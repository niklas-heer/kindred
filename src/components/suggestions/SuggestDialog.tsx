// "Suggest a change" (docs/suggestions.md): a viewer, a contributor or a share-link guest suggests one of four kinds about the
// person they are on (their details, a missing relative, a life event, a source), with an optional note and up to MAX_FILES
// files. The server checks everything again (suggest.server.ts); the form only keeps the reader from sending what cannot be.
// A details suggestion sends only the fields changed; a correction of an event or a couple only what differs from it. A
// guest of a link that protects living people is never offered "living": what they suggest is about someone who is not.
// A guest's first suggestion asks for their name, and says who sees it. The files go one by one after the suggestion is
// made, each with its progress; if one fails, the suggestion stands and the dialog offers to send it again.
//
//   {open && <SuggestDialog tree={tree} p={person} onClose={() => setOpen(false)} />}
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Paperclip, Send, X } from 'lucide-react';
import { useId, useRef, useState, type ReactNode } from 'react';
import { eventTitle } from '~/components/life/records';
import { DatePicker, Dialog, Segmented, Select, Switch } from '~/components/ui';
import { opKeys } from '~/lib/api';
import { errorText } from '~/lib/errortext';
import { AFTER_DEATH, EVENT_LABEL, EVENT_TYPES, type EventType } from '~/lib/events';
import { personEventsQuery } from '~/lib/events.functions';
import { useFamily } from '~/lib/family';
import { displayName, fmtDate, parents } from '~/lib/graph';
import { useT, type Key } from '~/lib/i18n';
import { useSession } from '~/lib/session';
import { createSuggestionFn, mySuggestionsQuery, suggestionKeys, suggestSettingsQuery } from '~/lib/suggestions/suggestions.functions';
import { MAX_NOTE, SUGGESTION_KINDS, type SuggestionKind } from '~/lib/suggestions/types';
import { toast } from '~/lib/toast';
import type { GPerson } from '~/lib/types';
import { MAX_GUEST_NAME } from '~/lib/votes/types';
import { FILE_ACCEPT, fileProblem, MAX_FILES, MAX_MB, uploadSuggestionFile } from './upload';
import { LINK_KINDS, PARENT_KINDS, sizeText, UNION_KINDS } from './view';
import './suggestions.css';

const KIND_LABEL: Record<SuggestionKind, [Key, Key]> = {
  details: ['suggest.kind.details', 'suggest.kind.details_hint'],
  relative: ['suggest.kind.relative', 'suggest.kind.relative_hint'],
  event: ['suggest.kind.event', 'suggest.kind.event_hint'],
  source: ['suggest.kind.source', 'suggest.kind.source_hint'],
};

type Sex = '' | 'm' | 'f' | 'x';
interface Details { given: string; surname: string; birthName: string; nickname: string; title: string; sex: Sex; living: boolean; born: string; bornPlace: string; died: string; diedPlace: string }
interface Relative { link: (typeof LINK_KINDS)[number]; parentKind: (typeof PARENT_KINDS)[number]; partnerKind: (typeof UNION_KINDS)[number]; given: string; surname: string; sex: Sex; born: string; died: string; living: boolean }
interface EventForm { mode: 'new' | 'fix' | 'couple'; kind: EventType | ''; label: string; date: string; place: string; note: string; event: string; couple: string; unionKind: (typeof UNION_KINDS)[number] | ''; start: string; startPlace: string }
interface SourceForm { title: string; author: string; publication: string; reference: string; date: string; note: string; transcription: string; backs: string }
type Upload = { file: File; share: number; state: 'waiting' | 'sending' | 'sent' | 'failed'; error?: string };

const detailsOf = (p: GPerson): Details => ({
  given: p.given, surname: p.currentSurname ?? p.surname ?? '', birthName: p.surname ?? '', nickname: p.nickname ?? '', title: p.title ?? '',
  sex: p.sex ?? '', living: p.living, born: p.born ?? '', bornPlace: p.bornPlace ?? '', died: p.died ?? '', diedPlace: p.diedPlace ?? '',
});
const NO_RELATIVE: Relative = { link: 'parent', parentKind: 'biological', partnerKind: 'partnership', given: '', surname: '', sex: '', born: '', died: '', living: false };
const NO_EVENT: EventForm = { mode: 'new', kind: '', label: '', date: '', place: '', note: '', event: '', couple: '', unionKind: '', start: '', startPlace: '' };
const NO_SOURCE: SourceForm = { title: '', author: '', publication: '', reference: '', date: '', note: '', transcription: '', backs: '' };

/** Text that may be none: trimmed, '' is none. */
const orNull = (s: string) => s.trim() || null;
/** An object without its empty values: a new thing has no "none" to set. */
const filled = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ''));

export function SuggestDialog({ tree, p, onClose }: { tree: string; p: GPerson; onClose: () => void }) {
  const t = useT();
  const id = useId();
  const f = useFamily();
  const qc = useQueryClient();
  const session = useSession();
  const guest = session?.guest?.tree === tree;
  // A guest of a link that protects living people suggests nothing about the living (suggest.server.ts).
  const protect = guest && !!f.graph.livingProtected;
  const settings = useQuery({ ...suggestSettingsQuery(tree), enabled: guest }).data;
  const mayAttach = !guest || !!settings?.guestFiles;
  // A guest's name is needed with their first suggestion; later ones keep it.
  const mine = useQuery({ ...mySuggestionsQuery(tree), enabled: guest });
  const asksName = guest && !mine.data?.length;
  const name = displayName(p, f);

  const [kind, setKind] = useState<SuggestionKind>('details');
  const [base] = useState(() => detailsOf(p));
  const [details, setDetails] = useState<Details>(base);
  // What the add-relative plan refuses is not offered (suggest.server.ts): a third parent, or a sibling of someone with no parents.
  const parentCount = parents(f, p.id).length;
  const links = LINK_KINDS.filter((k) => !(k === 'parent' && parentCount >= 2) && !(k === 'sibling' && !parentCount));
  const [relative, setRelative] = useState<Relative>(() => ({ ...NO_RELATIVE, link: links[0] }));
  const [event, setEvent] = useState<EventForm>(NO_EVENT);
  const [source, setSource] = useState<SourceForm>(NO_SOURCE);
  const [note, setNote] = useState('');
  const [guestName, setGuestName] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [uploads, setUploads] = useState<Upload[] | null>(null);
  const [made, setMade] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  // One retry key per suggestion sent: the same one sent again after a lost response is not made twice.
  const keys = useRef(opKeys());

  const events = useQuery({ ...personEventsQuery(tree, p.id), enabled: kind === 'event' || kind === 'source' }).data ?? [];
  const couples = (f.unionsOf.get(p.id) ?? []).filter((u) => !protect || f.byId.get(u.a === p.id ? u.b : u.a)?.living === false);
  const chosenEvent = events.find((e) => e.id === event.event);
  const chosenCouple = couples.find((u) => u.id === event.couple);

  const payload = (): Record<string, unknown> => {
    switch (kind) {
      case 'details': {
        const out: Record<string, unknown> = {};
        // Someone living has no death: turning "Still living" on takes away a death date and place, typed or on record.
        const now: Details = details.living ? { ...details, died: '', diedPlace: '' } : details;
        for (const k of Object.keys(now) as (keyof Details)[]) {
          if (now[k] === base[k]) continue;
          if (protect && k === 'living') continue;
          out[k] = k === 'living' ? now.living : k === 'given' ? now.given.trim() : orNull(String(now[k]));
        }
        return out;
      }
      case 'relative': {
        const r = relative;
        return {
          person: filled({ given: r.given.trim(), surname: r.surname.trim(), sex: r.sex, born: r.born, died: r.living ? '' : r.died, living: protect ? false : r.living }),
          link: filled({ kind: r.link, parentKind: r.link === 'parent' || r.link === 'child' ? r.parentKind : undefined, partnerKind: r.link === 'partner' ? r.partnerKind : undefined }),
        };
      }
      case 'event': {
        const e = event;
        if (e.mode === 'fix' && chosenEvent) {
          const now = { date: chosenEvent.date ?? '', place: chosenEvent.place ?? '', note: chosenEvent.note };
          const out: Record<string, unknown> = { event: chosenEvent.id };
          if (e.date !== now.date) out.date = e.date || null;
          if (e.place.trim() !== now.place) out.place = orNull(e.place);
          if (e.note.trim() !== now.note) out.note = e.note.trim();
          return out;
        }
        if (e.mode === 'couple' && chosenCouple) {
          const out: Record<string, unknown> = { partnership: chosenCouple.id };
          if (e.unionKind && e.unionKind !== chosenCouple.kind) out.partnershipKind = e.unionKind;
          if (e.start !== (chosenCouple.start ?? '')) out.start = e.start || null;
          if (e.startPlace.trim() !== (chosenCouple.place ?? '')) out.startPlace = orNull(e.startPlace);
          return out;
        }
        return filled({ kind: e.kind, label: e.kind === 'custom' ? e.label.trim() : '', date: e.date, place: e.place.trim(), note: e.note.trim() });
      }
      case 'source': {
        const s = source;
        const backs = !s.backs ? undefined : s.backs.startsWith('event:') ? { fact: 'event', event: s.backs.slice(6) } : { fact: s.backs };
        return filled({
          title: s.title.trim(), author: s.author.trim(), publication: s.publication.trim(), reference: s.reference.trim(), date: s.date,
          note: s.note.trim(), transcription: s.transcription.trim(), backs,
        });
      }
    }
  };

  const ready = (() => {
    if (asksName && !guestName.trim()) return false;
    if (kind === 'relative') return !!relative.given.trim();
    if (kind === 'source') return !!source.title.trim();
    if (kind === 'event') return event.mode === 'new' ? !!event.kind && (event.kind !== 'custom' || !!event.label.trim()) : event.mode === 'fix' ? !!chosenEvent : !!chosenCouple;
    return true;
  })();

  const finished = async () => {
    await Promise.all(suggestionKeys(tree).map((queryKey) => qc.invalidateQueries({ queryKey })));
    toast({ title: t('suggest.sent_title'), body: t('suggest.sent'), icon: 'quill-ink' });
    onClose();
  };

  /** Sends the files not sent yet, one after another; the suggestion is closed when all went. */
  const sendFiles = async (suggestion: string, list: Upload[]) => {
    const now = [...list];
    const show = () => setUploads([...now]);
    for (const [i, u] of now.entries()) {
      if (u.state === 'sent') continue;
      now[i] = { ...u, state: 'sending', share: 0, error: undefined };
      show();
      try {
        await uploadSuggestionFile(tree, suggestion, u.file, (share) => { now[i] = { ...now[i], share }; show(); });
        now[i] = { ...now[i], state: 'sent', share: 1 };
      } catch (e) {
        now[i] = { ...now[i], state: 'failed', error: errorText(e, t.locale) };
      }
      show();
    }
    if (now.every((u) => u.state === 'sent')) await finished();
  };

  const send = useMutation({
    mutationFn: () => {
      const data = { tree, kind, person: p.id, payload: payload(), note: note.trim() || undefined, name: asksName ? guestName.trim() : undefined };
      return createSuggestionFn({ data: { ...data, opKey: keys.current.for('create', data) } });
    },
    onSuccess: async ({ id: suggestion }) => {
      setMade(suggestion);
      if (!files.length) return finished();
      await sendFiles(suggestion, files.map((file) => ({ file, share: 0, state: 'waiting' })));
    },
  });
  const sending = send.isPending || (!!uploads && uploads.some((u) => u.state === 'sending'));
  const failed = !!uploads && uploads.some((u) => u.state === 'failed') && !sending;

  const choose = (list: FileList | null) => {
    const next = [...files];
    const why: string[] = [];
    for (const file of list ? [...list] : []) {
      const problem = fileProblem(file);
      if (problem === 'type') why.push(t('suggest.file.wrong_type', { name: file.name }));
      else if (problem === 'empty') why.push(t('suggest.file.empty', { name: file.name }));
      else if (problem === 'size') why.push(t('suggest.file.too_big', { name: file.name, size: MAX_MB }));
      else if (next.length >= MAX_FILES) why.push(t('suggest.file.too_many', { count: MAX_FILES }));
      else next.push(file);
    }
    setFiles(next);
    setProblems([...new Set(why)]);
    setTouched(true);
  };

  const change = <T,>(set: (fn: (s: T) => T) => void) => (patch: Partial<T>) => { set((s) => ({ ...s, ...patch })); setTouched(true); };
  const d = change(setDetails), r = change(setRelative), e = change(setEvent), s = change(setSource);
  const close = () => {
    if (sending) return;
    if (made) void finished();
    else onClose();
  };

  const footer = made && failed ? (
    <>
      <button type="button" className="btn ghost" onClick={close}>{t('suggest.close')}</button>
      <button type="button" className="btn primary" onClick={() => void sendFiles(made, uploads!)}>{t('suggest.files_retry')}</button>
    </>
  ) : (
    <>
      <button type="button" className="btn ghost" onClick={onClose} disabled={sending || !!made}>{t('common.cancel')}</button>
      <button type="submit" form={`${id}-form`} className="btn primary" disabled={!ready || sending || !!made}>
        <Send size={15} aria-hidden /> {sending ? t('suggest.sending') : t('suggest.send')}
      </button>
    </>
  );

  return (
    <Dialog
      open onClose={close} title={t('suggest.dialog_title')} description={t('suggest.dialog_desc', { name })}
      width="min(620px, 100vw - 24px)" dismissible={!sending && !made} dirty={touched && !made} footer={footer}
    >
      <form id={`${id}-form`} className="sg-form" onSubmit={(ev) => { ev.preventDefault(); if (ready && !sending && !made) send.mutate(); }}>
        <fieldset className="sg-fields" disabled={sending || !!made}>
          <div className="sg-kinds" role="radiogroup" aria-labelledby={`${id}-kinds`}>
            <span className="sg-label" id={`${id}-kinds`}>{t('suggest.kind_label')}</span>
            {SUGGESTION_KINDS.map((k) => (
              <label key={k} className="sg-kind" data-chosen={kind === k || undefined}>
                <input type="radio" name={`${id}-kind`} value={k} checked={kind === k} onChange={() => setKind(k)} aria-describedby={`${id}-${k}`} />
                <span><b>{t(KIND_LABEL[k][0])}</b><small className="subtle" id={`${id}-${k}`}>{t(KIND_LABEL[k][1])}</small></span>
              </label>
            ))}
          </div>

          {kind === 'details' && (
            <div className="sg-grid">
              <p className="subtle sg-wide">{t('suggest.details_hint')}</p>
              <Text label={t('suggest.field.given')} value={details.given} onChange={(given) => d({ given })} max={120} />
              <Text label={t('suggest.field.surname')} value={details.surname} onChange={(surname) => d({ surname })} max={120} />
              <Text label={t('suggest.field.birthName')} value={details.birthName} onChange={(birthName) => d({ birthName })} max={120} />
              <Text label={t('suggest.field.nickname')} value={details.nickname} onChange={(nickname) => d({ nickname })} max={120} />
              <Text label={t('suggest.field.title')} value={details.title} onChange={(title) => d({ title })} max={200} />
              <SexField value={details.sex} onChange={(sex) => d({ sex })} />
              {!protect && <div className="sg-wide"><Switch checked={details.living} onChange={(living) => d({ living })}>{t('suggest.still_living')}</Switch></div>}
              <DatePicker label={t('suggest.field.born')} value={details.born} onChange={(born) => d({ born })} />
              <Text label={t('suggest.field.bornPlace')} value={details.bornPlace} onChange={(bornPlace) => d({ bornPlace })} max={200} />
              {!details.living && (
                <>
                  <DatePicker label={t('suggest.field.died')} value={details.died} onChange={(died) => d({ died })} />
                  <Text label={t('suggest.field.diedPlace')} value={details.diedPlace} onChange={(diedPlace) => d({ diedPlace })} max={200} />
                </>
              )}
            </div>
          )}

          {kind === 'relative' && (
            <div className="sg-grid">
              <Choice label={t('suggest.link.label', { name })} value={relative.link} onChange={(link) => r({ link })} options={links.map((k) => ({ value: k, label: t(`suggest.link.${k}`) }))} />
              {(relative.link === 'parent' || relative.link === 'child') && (
                <Choice label={t('suggest.parent_kind')} value={relative.parentKind} onChange={(parentKind) => r({ parentKind })} options={PARENT_KINDS.map((k) => ({ value: k, label: t(`suggest.parent.${k}`) }))} />
              )}
              {relative.link === 'partner' && (
                <Choice label={t('suggest.field.partnershipKind')} value={relative.partnerKind} onChange={(partnerKind) => r({ partnerKind })} options={UNION_KINDS.map((k) => ({ value: k, label: t(`suggest.union.${k}`) }))} />
              )}
              <Text label={t('suggest.field.given')} value={relative.given} onChange={(given) => r({ given })} max={120} required />
              <Text label={t('suggest.field.birthName')} value={relative.surname} onChange={(surname) => r({ surname })} max={120} />
              <SexField value={relative.sex} onChange={(sex) => r({ sex })} />
              <DatePicker label={t('suggest.field.born')} value={relative.born} onChange={(born) => r({ born })} />
              {protect
                ? <p className="subtle sg-wide">{t('suggest.guest_not_living')}</p>
                : <div className="sg-wide"><Switch checked={relative.living} onChange={(living) => r({ living })}>{t('suggest.still_living')}</Switch></div>}
              {(protect || !relative.living) && <DatePicker label={t('suggest.field.died')} value={relative.died} onChange={(died) => r({ died })} />}
            </div>
          )}

          {kind === 'event' && (
            <div className="sg-grid">
              <div className="field sg-wide">
                <span id={`${id}-mode`}>{t('suggest.event.mode')}</span>
                <Segmented aria-labelledby={`${id}-mode`} value={event.mode} onChange={(mode) => e({ ...NO_EVENT, mode })} options={[
                  { value: 'new', label: t('suggest.event.add') },
                  { value: 'fix', label: t('suggest.event.fix'), disabled: !events.length },
                  { value: 'couple', label: t('suggest.event.couple'), disabled: !couples.length },
                ]} />
              </div>
              {event.mode === 'new' && (
                <>
                  <Choice label={t('suggest.field.kind')} value={event.kind} placeholder={t('ui.choose')} onChange={(k) => e({ kind: k as EventType })}
                    options={EVENT_TYPES.filter((k) => !(p.living && AFTER_DEATH.has(k))).map((k) => ({ value: k, label: t(EVENT_LABEL[k]) }))} />
                  {event.kind === 'custom' && <Text label={t('suggest.field.label')} value={event.label} onChange={(label) => e({ label })} max={200} required />}
                </>
              )}
              {event.mode === 'fix' && (
                <Choice label={t('suggest.event.pick')} value={event.event} placeholder={t('ui.choose')}
                  onChange={(v) => { const x = events.find((y) => y.id === v); e({ event: v, date: x?.date ?? '', place: x?.place ?? '', note: x?.note ?? '' }); }}
                  options={events.map((x) => ({ value: x.id, label: eventTitle(x, t), hint: fmtDate(x.date ?? undefined, t.locale) }))} />
              )}
              {event.mode === 'couple' && (
                <>
                  <Choice label={t('suggest.event.pick_couple')} value={event.couple} placeholder={t('ui.choose')}
                    onChange={(v) => { const u = couples.find((y) => y.id === v); e({ couple: v, unionKind: u?.kind ?? '', start: u?.start ?? '', startPlace: u?.place ?? '' }); }}
                    options={couples.map((u) => { const o = f.byId.get(u.a === p.id ? u.b : u.a); return { value: u.id, label: t('suggest.event.with', { name: o ? displayName(o, f) : t('suggest.what.someone') }) }; })} />
                  {chosenCouple && (
                    <>
                      <Choice label={t('suggest.field.partnershipKind')} value={event.unionKind} onChange={(unionKind) => e({ unionKind })} options={UNION_KINDS.map((k) => ({ value: k, label: t(`suggest.union.${k}`) }))} />
                      <DatePicker label={t('suggest.field.start')} value={event.start} onChange={(start) => e({ start })} />
                      <Text label={t('suggest.field.startPlace')} value={event.startPlace} onChange={(startPlace) => e({ startPlace })} max={200} />
                    </>
                  )}
                </>
              )}
              {(event.mode === 'new' || (event.mode === 'fix' && chosenEvent)) && (
                <>
                  <DatePicker label={t('suggest.field.date')} value={event.date} onChange={(date) => e({ date })} />
                  <Text label={t('suggest.field.place')} value={event.place} onChange={(place) => e({ place })} max={200} />
                  <Area label={t('suggest.field.note')} value={event.note} onChange={(v) => e({ note: v })} max={4000} />
                </>
              )}
            </div>
          )}

          {kind === 'source' && (
            <div className="sg-grid">
              <Text label={t('suggest.field.source_title')} value={source.title} onChange={(title) => s({ title })} max={300} required wide />
              <Text label={t('suggest.field.author')} value={source.author} onChange={(author) => s({ author })} max={200} />
              <Text label={t('suggest.field.publication')} value={source.publication} onChange={(publication) => s({ publication })} max={300} />
              <Text label={t('suggest.field.reference')} value={source.reference} onChange={(reference) => s({ reference })} max={500} />
              <DatePicker label={t('suggest.field.date')} value={source.date} onChange={(date) => s({ date })} />
              <Choice label={t('suggest.field.backs')} value={source.backs} onChange={(backs) => s({ backs })} options={[
                { value: '', label: t('suggest.backs.none') },
                { value: 'birth', label: t('suggest.backs.birth') },
                ...(p.living ? [] : [{ value: 'death', label: t('suggest.backs.death') }]),
                { value: 'name', label: t('suggest.backs.name') },
                ...events.map((x) => ({ value: `event:${x.id}`, label: eventTitle(x, t), hint: fmtDate(x.date ?? undefined, t.locale) })),
              ]} />
              <Area label={t('suggest.field.note')} value={source.note} onChange={(v) => s({ note: v })} max={4000} />
              <Area label={t('suggest.field.transcription')} value={source.transcription} onChange={(transcription) => s({ transcription })} max={4000} />
            </div>
          )}

          <Area label={t('suggest.note')} hint={t('suggest.note_hint')} value={note} onChange={(v) => { setNote(v); setTouched(true); }} max={MAX_NOTE} />

          {mayAttach && (
            <div className="sg-files">
              <span className="sg-label" id={`${id}-files`}>{t('suggest.files')}</span>
              <p className="subtle sg-hint" id={`${id}-files-hint`}>{t('suggest.files_hint', { count: MAX_FILES, size: MAX_MB })}</p>
              {!uploads && files.length < MAX_FILES && (
                <label className="btn sg-pick">
                  <Paperclip size={15} aria-hidden /> {t('suggest.files_add')}
                  <input type="file" className="sr-only" multiple accept={FILE_ACCEPT} aria-describedby={`${id}-files-hint`}
                    onChange={(ev) => { choose(ev.target.files); ev.target.value = ''; }} />
                </label>
              )}
              {problems.map((why) => <p key={why} className="err sg-hint" role="alert">{why}</p>)}
              {files.length > 0 && (
                <ul className="sg-file-list" aria-labelledby={`${id}-files`}>
                  {files.map((file, i) => {
                    const u = uploads?.[i];
                    return (
                      <li key={`${file.name}-${i}`}>
                        <span className="sg-file-name">{file.name}</span> <small className="subtle">{sizeText(file.size, t.locale)}</small>
                        {u?.state === 'sending' && <progress max={1} value={u.share} aria-label={t('suggest.file.sending', { name: file.name })} />}
                        {u?.state === 'sent' && <small role="status">{t('suggest.file.sent', { name: file.name })}</small>}
                        {u?.state === 'failed' && <small className="err" role="alert">{t('suggest.file.failed', { name: file.name, error: u.error ?? '' })}</small>}
                        {!uploads && (
                          <button type="button" className="btn icon ghost" aria-label={t('suggest.file_remove', { name: file.name })} title={t('suggest.file_remove', { name: file.name })}
                            onClick={() => setFiles(files.filter((_, j) => j !== i))}><X size={14} aria-hidden /></button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {failed && <p className="err sg-hint" role="alert">{t('suggest.files_failed')}</p>}
            </div>
          )}

          {asksName && (
            <div className="field">
              <label htmlFor={`${id}-name`}>{t('suggest.guest_name')}</label>
              <input id={`${id}-name`} className="input" type="text" autoComplete="name" required maxLength={MAX_GUEST_NAME}
                value={guestName} onChange={(ev) => { setGuestName(ev.target.value); setTouched(true); }} aria-describedby={`${id}-name-hint`} />
              <p className="subtle sg-hint" id={`${id}-name-hint`}>{t('suggest.guest_name_hint')}</p>
            </div>
          )}
          {send.isError && <p className="err" role="alert">{errorText(send.error, t.locale)}</p>}
        </fieldset>
      </form>
    </Dialog>
  );
}

function Text({ label, value, onChange, max, required, wide }: { label: string; value: string; onChange: (v: string) => void; max: number; required?: boolean; wide?: boolean }) {
  return (
    <label className={`field${wide ? ' sg-wide' : ''}`}>
      <span>{label}</span>
      <input className="input" type="text" value={value} maxLength={max} required={required} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Area({ label, hint, value, onChange, max }: { label: string; hint?: ReactNode; value: string; onChange: (v: string) => void; max: number }) {
  const id = useId();
  return (
    <div className="field sg-wide">
      <label htmlFor={id}>{label}</label>
      <textarea id={id} className="input" rows={3} value={value} maxLength={max} onChange={(e) => onChange(e.target.value)} aria-describedby={hint ? `${id}-hint` : undefined} />
      {hint && <p className="subtle sg-hint" id={`${id}-hint`}>{hint}</p>}
    </div>
  );
}

function Choice<V extends string>({ label, value, onChange, options, placeholder }: {
  label: string; value: V; onChange: (v: V) => void; options: { value: V; label: string; hint?: string }[]; placeholder?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <span id={id}>{label}</span>
      <Select<V> aria-labelledby={id} value={value} onChange={onChange} options={options} placeholder={placeholder} />
    </div>
  );
}

function SexField({ value, onChange }: { value: Sex; onChange: (v: Sex) => void }) {
  const t = useT();
  return (
    <Choice<Sex> label={t('suggest.field.sex')} value={value} onChange={onChange}
      options={[{ value: '', label: t('sex.unknown') }, { value: 'f', label: t('sex.f') }, { value: 'm', label: t('sex.m') }, { value: 'x', label: t('sex.x') }]} />
  );
}
