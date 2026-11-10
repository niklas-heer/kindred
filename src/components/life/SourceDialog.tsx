// Adding or changing a source of the family's register: its title, who wrote it, where it is held, a call number or web
// address, a date, a note, and optionally the research document or gallery picture it is. Used by the Sources page and by
// "Cite a source" on a person's Edit tab.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { DatePicker, Dialog, Notice, Select } from '~/components/ui';
import { opKeys } from '~/lib/api';
import { validDate } from '~/lib/dates';
import { errorText } from '~/lib/errortext';
import type { Source } from '~/lib/events';
import { useT } from '~/lib/i18n';
import { researchProjectQuery, researchProjectsQuery } from '~/lib/research.functions';
import { saveSource } from '~/lib/sources.functions';

const WIDE = 'min(560px, 100vw - 24px)';

/** Refreshes every read of sources and citations in this family. */
export function useSourcesRefresh(tree: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['sources', tree] });
}

export function SourceDialog({ tree, source, onClose, onSaved }: { tree: string; source?: Source; onClose: () => void; onSaved?: (id: string) => void }) {
  const t = useT();
  const refresh = useSourcesRefresh(tree);
  const [title, setTitle] = useState(source?.title ?? '');
  const [author, setAuthor] = useState(source?.author ?? '');
  const [publication, setPublication] = useState(source?.publication ?? '');
  const [reference, setReference] = useState(source?.reference ?? '');
  const [date, setDate] = useState(source?.date ?? '');
  const [note, setNote] = useState(source?.note ?? '');
  const [project, setProject] = useState(source?.document?.project ?? '');
  const [document, setDocument] = useState(source?.document?.id ?? '');
  const keys = useRef(opKeys());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projects = useQuery(researchProjectsQuery(tree)).data ?? [];
  const docs = useQuery({ ...researchProjectQuery(tree, project), enabled: !!project }).data?.documents ?? [];
  const badDate = !!date && !validDate(date);
  const dirty = title !== (source?.title ?? '') || author !== (source?.author ?? '') || publication !== (source?.publication ?? '')
    || reference !== (source?.reference ?? '') || date !== (source?.date ?? '') || note !== (source?.note ?? '') || document !== (source?.document?.id ?? '');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || badDate || busy) return;
    setBusy(true);
    setError(null);
    try {
      const payload = { id: source?.id, title, author: author || null, publication: publication || null, reference: reference || null, date: date || null, note, document: document || null, media: source?.media ?? null };
      const { id } = await saveSource({ data: { tree, source: payload, opKey: keys.current.for('save', payload) } });
      keys.current.clear('save');
      await refresh();
      onSaved?.(id);
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
      title={source ? t('sources.edit') : t('sources.new')}
      width={WIDE}
      dirty={dirty}
      footer={<button type="submit" form="life-source-form" className="btn primary" disabled={busy || !title.trim() || badDate}>{t('sources.save')}</button>}
    >
      <form id="life-source-form" className="life-form" onSubmit={(e) => void submit(e)}>
        <label className="life-field">
          <span>{t('sources.field.title')}</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} placeholder={t('sources.field.title_ph')} data-autofocus required />
        </label>
        <div className="life-pair">
          <label className="life-field">
            <span>{t('sources.field.author')}</span>
            <input className="input" value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={200} />
          </label>
          <label className="life-field">
            <span>{t('sources.field.publication')}</span>
            <input className="input" value={publication} onChange={(e) => setPublication(e.target.value)} maxLength={300} placeholder={t('sources.field.publication_ph')} />
          </label>
        </div>
        <label className="life-field">
          <span>{t('sources.field.reference')}</span>
          <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={500} placeholder={t('sources.field.reference_ph')} />
        </label>
        <DatePicker label={t('sources.field.date')} value={date} onChange={setDate} error={badDate ? t('events.err.not_a_date') : undefined} />
        <label className="life-field">
          <span>{t('sources.field.note')}</span>
          <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} rows={3} />
        </label>
        {projects.length > 0 && (
          <fieldset className="life-field life-link">
            <legend>{t('sources.field.document')}</legend>
            <div className="life-pair">
              <Select
                aria-label={t('sources.field.project')}
                value={project}
                onChange={(v) => { setProject(v); setDocument(''); }}
                options={[{ value: '', label: t('sources.field.no_document') }, ...projects.map((p) => ({ value: p.id, label: p.title }))]}
              />
              {project && (
                <Select
                  aria-label={t('sources.field.document')}
                  value={document}
                  onChange={setDocument}
                  options={[{ value: '', label: t('sources.field.pick_document') }, ...docs.map((d) => ({ value: d.id, label: d.title }))]}
                />
              )}
            </div>
          </fieldset>
        )}
        {error ? <Notice>{error}</Notice> : null}
      </form>
    </Dialog>
  );
}
