// The Research page's dialogs: a project, a note, a document (upload or edit), and the confirm before a delete.
import { useQueryClient } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { MarkdownEditor } from '~/components/MarkdownEditor';
import { scaledPicture } from '~/components/photos/image';
import { DatePicker, Dialog, Notice, Switch } from '~/components/ui';
import { opKeys } from '~/lib/api';
import { validDate } from '~/lib/dates';
import { errorText } from '~/lib/errortext';
import { formatNumber, useT, type Key, type Locale } from '~/lib/i18n';
import {
  addResearchDocument, removeResearchDocument, removeResearchNote, removeResearchProject, saveResearchDocument, saveResearchNote, saveResearchProject,
} from '~/lib/research.functions';
import { checkDocument, dateText, DOCUMENT_ACCEPT, isPdf, type DocumentMime, type ResearchDocument, type ResearchNote } from '~/lib/research';
import { useCan } from '~/lib/session';
import '~/styles/research.css';

/** Refreshes everything the Research page and the panel read for a family. */
export function useResearchRefresh(tree: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['research', tree] });
}

function useSubmit() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? errorText(e, t.locale) : t('research.failed'));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

const WIDE = 'min(560px, 100vw - 24px)';

// ---------- a project ----------

export function ProjectDialog({ tree, project, onClose, onSaved }: {
  tree: string;
  project?: { id: string; title: string; summary: string; private: boolean };
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const t = useT();
  const refresh = useResearchRefresh(tree);
  const canEdit = useCan('edit-research');
  const [title, setTitle] = useState(project?.title ?? '');
  const [summary, setSummary] = useState(project?.summary ?? '');
  const [priv, setPriv] = useState(project?.private ?? false);
  const keys = useRef(opKeys());
  const { busy, error, run } = useSubmit();
  const dirty = title !== (project?.title ?? '') || summary !== (project?.summary ?? '') || priv !== (project?.private ?? false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    void run(async () => {
      const payload = { id: project?.id, title, summary, private: priv };
      const { id } = await saveResearchProject({ data: { tree, ...payload, opKey: keys.current.for('save', payload) } });
      keys.current.clear('save');
      await refresh();
      onSaved(id);
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={project ? t('research.edit_project') : t('research.new')}
      width={WIDE}
      dirty={dirty}
      footer={<button type="submit" form="rs-project-form" className="btn primary" disabled={busy || !title.trim()}>{project ? t('research.save') : t('research.create')}</button>}
    >
      <form id="rs-project-form" className="rs-form" onSubmit={submit}>
        <label className="rs-field">
          <span>{t('research.project_title')}</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={t('research.project_title_ph')} data-autofocus required />
        </label>
        <label className="rs-field">
          <span>{t('research.project_summary')}</span>
          <textarea className="input" value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={2000} rows={4} placeholder={t('research.project_summary_ph')} />
        </label>
        {canEdit ? <Switch checked={priv} onChange={setPriv}>{t('research.private_project')}</Switch> : null}
        {error ? <Notice>{error}</Notice> : null}
      </form>
    </Dialog>
  );
}

// ---------- a note ----------

export function NoteDialog({ tree, project, note, onClose }: { tree: string; project: string; note?: ResearchNote; onClose: () => void }) {
  const t = useT();
  const refresh = useResearchRefresh(tree);
  const canEdit = useCan('edit-research');
  const [title, setTitle] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.body ?? '');
  const [date, setDate] = useState(note?.date ?? '');
  const [priv, setPriv] = useState(note?.private ?? false);
  const keys = useRef(opKeys());
  const { busy, error, run } = useSubmit();
  const dirty = title !== (note?.title ?? '') || body !== (note?.body ?? '') || date !== (note?.date ?? '') || priv !== (note?.private ?? false);
  const badDate = !!date && !validDate(date);
  const ready = !!title.trim() && !!body.trim() && !badDate;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    void run(async () => {
      const payload = { id: note?.id, project, title, body, date, private: priv };
      await saveResearchNote({ data: { tree, ...payload, opKey: keys.current.for('save', payload) } });
      keys.current.clear('save');
      await refresh();
      onClose();
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={note ? t('research.edit_note') : t('research.add_note')}
      width="min(680px, 100vw - 24px)"
      dirty={dirty}
      footer={<button type="submit" form="rs-note-form" className="btn primary" disabled={busy || !ready}>{t('research.save')}</button>}
    >
      <form id="rs-note-form" className="rs-form" onSubmit={submit}>
        <label className="rs-field">
          <span>{t('research.note_title')}</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} data-autofocus required />
        </label>
        <DatePicker label={t('research.field_date')} value={date} onChange={setDate} />
        <div className="rs-field">
          <span id="rs-note-body">{t('research.note_body')}</span>
          <MarkdownEditor tree={tree} value={body} onChange={setBody} label={t('research.note_body')} rows={9} />
        </div>
        {canEdit ? <Switch checked={priv} onChange={setPriv}>{t('research.private_item')}</Switch> : null}
        {error ? <Notice>{error}</Notice> : null}
      </form>
    </Dialog>
  );
}

// ---------- a document ----------

const byteSize = (n: number, locale: Locale) => (n >= 1_000_000 ? `${formatNumber(n / 1_000_000, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB` : `${formatNumber(Math.max(1, Math.round(n / 1000)), locale)} KB`);

interface Picked { file: File; mime: DocumentMime; width: number; height: number; preview?: string }

/** Upload a new document (`document` absent) or change the details of one. */
export function DocumentDialog({ tree, project, document: doc, onClose }: { tree: string; project: string; document?: ResearchDocument; onClose: () => void }) {
  const t = useT();
  const refresh = useResearchRefresh(tree);
  const canEdit = useCan('edit-research');
  const [picked, setPicked] = useState<Picked | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [title, setTitle] = useState(doc?.title ?? '');
  const [date, setDate] = useState(doc?.date ?? '');
  const [source, setSource] = useState(doc?.source ?? '');
  const [notes, setNotes] = useState(doc?.notes ?? '');
  const [priv, setPriv] = useState(doc?.private ?? false);
  const [dragging, setDragging] = useState(false);
  const keys = useRef(opKeys());
  const inputRef = useRef<HTMLInputElement>(null);
  const { busy, error, run } = useSubmit();
  const dirty = !!picked || title !== (doc?.title ?? '') || date !== (doc?.date ?? '') || source !== (doc?.source ?? '') || notes !== (doc?.notes ?? '') || priv !== (doc?.private ?? false);
  const badDate = !!date && !validDate(date);
  const ready = !!title.trim() && !badDate && (doc ? true : !!picked);

  async function take(file: File) {
    setFileError(null);
    setPreparing(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const checked = checkDocument(bytes, file.type);
      if ('refused' in checked) {
        setFileError(t(checked.refused));
        setPicked(null);
        return;
      }
      // A picture is scaled to a readable size with its EXIF and GPS dropped, as gallery pictures are. A PDF goes as it is.
      let next: Picked = { file, mime: checked.mime, width: 0, height: 0 };
      if (!isPdf(checked.mime)) {
        const scaled = await scaledPicture(file, 3600, 0.9);
        const jpeg = new File([scaled.blob], `${file.name.replace(/\.[^.]+$/, '') || 'document'}.jpg`, { type: 'image/jpeg' });
        next = { file: jpeg, mime: 'image/jpeg', width: scaled.width, height: scaled.height, preview: URL.createObjectURL(scaled.blob) };
      }
      setPicked(next);
      if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim());
    } catch {
      setFileError(t('research.err.file_type'));
      setPicked(null);
    } finally {
      setPreparing(false);
    }
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void take(file);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    void run(async () => {
      if (doc) {
        const payload = { id: doc.id, title, date, source, notes, private: priv };
        await saveResearchDocument({ data: { tree, ...payload, opKey: keys.current.for('save', payload) } });
        keys.current.clear('save');
      } else if (picked) {
        const fd = new FormData();
        fd.set('tree', tree);
        fd.set('project', project);
        fd.set('file', picked.file);
        fd.set('width', String(picked.width));
        fd.set('height', String(picked.height));
        fd.set('title', title);
        fd.set('date', date);
        fd.set('source', source);
        fd.set('notes', notes);
        fd.set('private', String(priv));
        fd.set('opKey', keys.current.for('add', [picked.file.name, picked.file.size, title, date, source, notes, priv]));
        await addResearchDocument({ data: fd });
        keys.current.clear('add');
      }
      await refresh();
      onClose();
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={doc ? t('research.edit_document') : t('research.add_document')}
      width={WIDE}
      dirty={dirty}
      footer={<button type="submit" form="rs-doc-form" className="btn primary" disabled={busy || preparing || !ready}>{doc ? t('research.save') : t('research.upload')}</button>}
    >
      <form id="rs-doc-form" className="rs-form" onSubmit={submit}>
        {doc ? null : (
          <div className="rs-field">
            <span>{t('research.field_file')}</span>
            <div
              className={`rs-drop${dragging ? ' is-over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              {picked?.preview ? <img className="rs-drop-preview" src={picked.preview} alt="" /> : picked ? <FileText size={34} aria-hidden /> : null}
              {picked ? <span className="rs-drop-name">{picked.file.name} · {byteSize(picked.file.size, t.locale)}</span> : null}
              <button type="button" className="btn" onClick={() => inputRef.current?.click()} disabled={preparing}>
                {t('research.choose_file')}
              </button>
              <input
                ref={inputRef}
                type="file"
                accept={DOCUMENT_ACCEPT}
                className="sr-only"
                aria-label={t('research.field_file')}
                tabIndex={-1}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void take(f); e.target.value = ''; }}
              />
            </div>
            <small className="subtle">{t('research.file_hint')}</small>
            {fileError ? <Notice>{fileError}</Notice> : null}
          </div>
        )}
        <label className="rs-field">
          <span>{t('research.field_title')}</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required data-autofocus={doc ? true : undefined} />
        </label>
        <DatePicker label={t('research.field_date')} value={date} onChange={setDate} />
        <label className="rs-field">
          <span>{t('research.field_source')}</span>
          <input className="input" value={source} onChange={(e) => setSource(e.target.value)} maxLength={300} placeholder={t('research.field_source_ph')} />
        </label>
        <label className="rs-field">
          <span>{t('research.field_notes')}</span>
          <textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} rows={3} />
        </label>
        {canEdit ? <Switch checked={priv} onChange={setPriv}>{t('research.private_item')}</Switch> : null}
        {error ? <Notice>{error}</Notice> : null}
      </form>
    </Dialog>
  );
}

// ---------- delete, with a second thought ----------

export function ConfirmDelete({ title, text, action, onClose, onConfirm }: {
  title: ReactNode; text: ReactNode; action: ReactNode; onClose: () => void; onConfirm: () => Promise<unknown>;
}) {
  const t = useT();
  const { busy, error, run } = useSubmit();
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      width="min(440px, 100vw - 24px)"
      footer={(
        <>
          <button type="button" className="btn" onClick={onClose}>{t('research.cancel')}</button>
          <button type="button" className="btn danger" disabled={busy} onClick={() => void run(onConfirm)}>{action}</button>
        </>
      )}
    >
      <p className="rs-confirm-text">{text}</p>
      {error ? <Notice>{error}</Notice> : null}
    </Dialog>
  );
}

/** Remove actions for the three kinds that take a confirm, in one place. */
export function useResearchRemove(tree: string) {
  const refresh = useResearchRefresh(tree);
  const keys = useRef(opKeys()).current;
  const send = async <P extends object>(step: string, fn: (a: { data: P & { opKey: string } }) => Promise<unknown>, payload: P) => {
    await fn({ data: { ...payload, opKey: keys.for(step, payload) } });
    keys.clear(step);
    await refresh();
  };
  return {
    project: (id: string) => send('project', removeResearchProject, { tree, id }),
    document: (id: string) => send('document', removeResearchDocument, { tree, id }),
    note: (project: string, id: string) => send('note', removeResearchNote, { tree, project, id }),
  };
}

export { dateText };
export type { Key };
