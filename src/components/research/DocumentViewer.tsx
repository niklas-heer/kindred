// Shows a research document in the app. A picture is an <img>; a PDF is the browser's own viewer in a frame of its file
// route, which serves it as application/pdf with nosniff and a CSP that lets it load nothing else (the route file says why).
// A browser with no inline PDF viewer, and any phone, gets Open and Download instead of a frame that would not work.
import { Download, ExternalLink, FileText, Lock, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Dialog, useIsClient } from '~/components/ui';
import { useT } from '~/lib/i18n';
import { documentUrl, isPdf, type ResearchDocument } from '~/lib/research';
import { dateText } from './forms';

function inlinePdfWorks() {
  return typeof navigator !== 'undefined' && navigator.pdfViewerEnabled === true && window.matchMedia('(min-width: 761px)').matches;
}

export function DocumentViewer({ tree, doc, canChange, onEdit, onDelete, onClose }: {
  tree: string; doc: ResearchDocument; canChange: boolean; onEdit: () => void; onDelete: () => void; onClose: () => void;
}) {
  const t = useT();
  const client = useIsClient();
  const [inline, setInline] = useState(false);
  useEffect(() => setInline(inlinePdfWorks()), []);
  const url = documentUrl(tree, doc.key);
  const pdf = isPdf(doc.mime);

  return (
    <Dialog open onClose={onClose} title={doc.title} width="min(980px, 100vw - 24px)">
      <div className="rs-viewer">
        <div className="rs-viewer-file">
          {!client ? null : pdf ? (
            inline ? (
              <iframe className="rs-viewer-pdf" src={url} title={doc.title} />
            ) : (
              <div className="rs-viewer-nopdf">
                <FileText size={40} aria-hidden />
                <p className="muted">{t('research.preview_unavailable')}</p>
              </div>
            )
          ) : (
            <img className="rs-viewer-img" src={url} alt={doc.title} decoding="async" />
          )}
        </div>
        <div className="rs-viewer-meta">
          <p className="rs-viewer-line">
            {doc.date ? <span>{dateText(doc.date, t.locale)}</span> : null}
            {doc.source ? <span>{t('research.source', { source: doc.source })}</span> : null}
            <span className="subtle">{t('research.by', { name: doc.by || '—' })}</span>
            {doc.private ? <span className="rs-private" title={t('research.private_hint')}><Lock size={12} aria-hidden /> {t('research.private')}</span> : null}
          </p>
          {doc.notes ? <p className="rs-viewer-notes">{doc.notes}</p> : null}
          <div className="rs-viewer-actions">
            <a className="btn" href={url} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} aria-hidden /> {t('research.open_new')}</a>
            <a className="btn" href={documentUrl(tree, doc.key, true)}><Download size={15} aria-hidden /> {t('research.download')}</a>
            {canChange ? (
              <>
                <button type="button" className="btn" onClick={onEdit}><Pencil size={15} aria-hidden /> {t('research.edit')}</button>
                <button type="button" className="btn ghost" onClick={onDelete}><Trash2 size={15} aria-hidden /> {t('research.delete')}</button>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
