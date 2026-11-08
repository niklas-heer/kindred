import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, FileText, Lock, FolderSearch, MapPin, NotebookPen, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Lightbox, mediaUrl } from '~/components/photos';
import { Portrait } from '~/components/Portrait';
import { DocumentViewer } from '~/components/research/DocumentViewer';
import { ConfirmDelete, DocumentDialog, NoteDialog, ProjectDialog, dateText, useResearchRefresh, useResearchRemove } from '~/components/research/forms';
import { AddPersonDialog, AddPictureDialog, AddPlaceDialog } from '~/components/research/pickers';
import { Timeline } from '~/components/research/Timeline';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '~/components/ui';
import { opKeys } from '~/lib/api';
import { useFamily, useTreeId } from '~/lib/family';
import { displayName } from '~/lib/graph';
import { translate, useT, type Locale } from '~/lib/i18n';
import { renderMarkdown } from '~/lib/markdown';
import { galleryQuery } from '~/lib/photos.functions';
import { mayChangeResearch, type ProjectView, type ResearchDocument, type ResearchNote } from '~/lib/research';
import { researchProjectQuery, removeResearchLink } from '~/lib/research.functions';
import { useRole } from '~/lib/session';
import { treeTitle } from '~/lib/title';
import '~/styles/research.css';

export const Route = createFileRoute('/$tree/research_/$project')({
  head: (ctx) => ({ meta: [{ title: treeTitle(ctx, translate((ctx.match.context as { locale?: Locale }).locale ?? 'en', 'research.title')) }] }),
  component: ProjectPage,
});

function ProjectPage() {
  const tree = useTreeId();
  const { project } = Route.useParams();
  const t = useT();
  const q = useQuery(researchProjectQuery(tree, project));

  const back = (
    <Link className="btn ghost rs-back" to="/$tree/research" params={{ tree }}><ArrowLeft size={15} aria-hidden /> {t('research.back')}</Link>
  );

  if (q.isPending) {
    return <div className="page"><div className="page-inner research"><Skeleton lines={5} height={18} /></div></div>;
  }
  if (q.isError) {
    return <div className="page"><div className="page-inner research">{back}<ErrorState title={t('research.load_failed')} onRetry={() => void q.refetch()} error={q.error} /></div></div>;
  }
  if (!q.data) {
    return (
      <div className="page"><div className="page-inner research">
        {back}
        <EmptyState icon={<FolderSearch size={28} />} title={t('research.not_found_title')} text={t('research.not_found_text')} />
      </div></div>
    );
  }
  return <ProjectBody tree={tree} project={project} view={q.data} back={back} />;
}

function ProjectBody({ tree, project, view, back }: { tree: string; project: string; view: ProjectView; back: ReactNode }) {
  const t = useT();
  const f = useFamily();
  const navigate = useNavigate();
  const role = useRole();
  const canAdd = mayChangeResearch(role, true);
  const remove = useResearchRemove(tree);
  const refresh = useResearchRefresh(tree);

  const [editingProject, setEditingProject] = useState(false);
  const [confirm, setConfirm] = useState<'project' | { doc: ResearchDocument } | { note: ResearchNote } | null>(null);
  const [noteEdit, setNoteEdit] = useState<ResearchNote | 'new' | null>(null);
  const [docEdit, setDocEdit] = useState<ResearchDocument | 'new' | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [openPicture, setOpenPicture] = useState<string | null>(null);
  const [picking, setPicking] = useState<'picture' | 'person' | 'place' | null>(null);
  const [linkKeys] = useState(() => opKeys());

  const gallery = useQuery({ ...galleryQuery(tree), enabled: view.pictures.length > 0 || openPicture !== null });
  const pictureItems = (gallery.data?.media ?? []).filter((m) => view.pictures.some((p) => p.key === m.key));
  const viewingDoc = viewing ? view.documents.find((d) => d.id === viewing) : undefined;

  const canChange = (mine: boolean) => mayChangeResearch(role, mine);
  const canChangeProject = canChange(view.mine);

  const unlink = async (kind: 'picture' | 'person' | 'place', target: string) => {
    const payload = { project, kind, target };
    await removeResearchLink({ data: { tree, ...payload, opKey: linkKeys.for(`${kind}:${target}`, payload) } });
    linkKeys.clear(`${kind}:${target}`);
    await refresh();
  };

  const scrollToNote = (id: string) => {
    document.getElementById(`rs-note-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div className="page">
      <div className="page-inner research">
        {back}
        <PageHeader
          title={<>{view.title}{view.private ? <span className="rs-private rs-private-title" title={t('research.private_hint')}><Lock size={15} aria-hidden /> {t('research.private')}</span> : null}</>}
          subtitle={view.summary || undefined}
          icon={<FolderSearch size={26} />}
          actions={canChangeProject ? (
            <>
              <button type="button" className="btn" onClick={() => setEditingProject(true)}><Pencil size={15} aria-hidden /> {t('research.edit')}</button>
              <button type="button" className="btn ghost" onClick={() => setConfirm('project')}><Trash2 size={15} aria-hidden /> {t('research.delete')}</button>
            </>
          ) : null}
        />

        <div className="rs-layout">
          <div className="rs-main">
            <Section title={t('research.timeline')}>
              <Timeline tree={tree} view={view} onDocument={setViewing} onNote={scrollToNote} onPicture={setOpenPicture} />
            </Section>

            <Section
              title={t('research.documents')}
              action={canAdd ? <button type="button" className="btn" onClick={() => setDocEdit('new')}><Plus size={15} aria-hidden /> {t('research.add_document')}</button> : null}
            >
              {view.documents.length ? (
                <ul className="rs-doc-grid">
                  {view.documents.map((d) => (
                    <li key={d.id}>
                      <button type="button" className="rs-doc" onClick={() => setViewing(d.id)}>
                        {d.mime === 'application/pdf'
                          ? <span className="rs-doc-thumb is-pdf"><FileText size={28} aria-hidden /><small>PDF</small></span>
                          : <span className="rs-doc-thumb"><img src={`/api/research/${tree}/${d.key.replace(/^research\//, '')}`} alt="" loading="lazy" decoding="async" /></span>}
                        <span className="rs-doc-title">{d.title}{d.private ? <Lock size={12} className="rs-private-mark" aria-hidden /> : null}</span>
                        <span className="subtle rs-doc-meta">{[dateText(d.date, t.locale), d.source].filter(Boolean).join(' · ')}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : <p className="muted rs-empty-line">{t('research.documents_empty')}</p>}
            </Section>

            <Section
              title={t('research.pictures')}
              action={canAdd ? <button type="button" className="btn" onClick={() => setPicking('picture')}><Plus size={15} aria-hidden /> {t('research.add_picture')}</button> : null}
            >
              {view.pictures.length ? (
                <ul className="rs-pic-grid">
                  {view.pictures.map((p) => (
                    <li key={p.key} className="rs-pic">
                      <button type="button" className="rs-pic-open" onClick={() => setOpenPicture(p.key)} aria-label={p.caption || dateText(p.taken, t.locale) || t('research.tl_picture')}>
                        <img src={mediaUrl(tree, p.key)} alt="" loading="lazy" decoding="async" />
                      </button>
                      {canChange(p.mine) ? <button type="button" className="btn icon ghost rs-pic-remove" title={t('research.remove_picture')} aria-label={t('research.remove_picture')} onClick={() => void unlink('picture', p.key)}><X size={14} /></button> : null}
                    </li>
                  ))}
                </ul>
              ) : <p className="muted rs-empty-line">{t('research.pictures_empty')}</p>}
            </Section>

            <Section
              title={t('research.notes')}
              action={canAdd ? <button type="button" className="btn" onClick={() => setNoteEdit('new')}><Plus size={15} aria-hidden /> {t('research.add_note')}</button> : null}
            >
              {view.notes.length ? (
                <div className="rs-notes">
                  {view.notes.map((n) => (
                    <article key={n.id} id={`rs-note-${n.id}`} className="rs-note">
                      <header className="rs-note-head">
                        <h3>{n.title}{n.private ? <Lock size={13} className="rs-private-mark" aria-hidden /> : null}</h3>
                        <span className="subtle">{[dateText(n.date, t.locale), n.by].filter(Boolean).join(' · ')}</span>
                        {canChange(n.mine) ? (
                          <span className="rs-note-actions">
                            <button type="button" className="btn icon ghost" title={t('research.edit_note')} aria-label={t('research.edit_note')} onClick={() => setNoteEdit(n)}><Pencil size={14} /></button>
                            <button type="button" className="btn icon ghost" title={t('research.delete_note')} aria-label={t('research.delete_note')} onClick={() => setConfirm({ note: n })}><Trash2 size={14} /></button>
                          </span>
                        ) : null}
                      </header>
                      <div className="rs-note-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(n.body) }} />
                    </article>
                  ))}
                </div>
              ) : <p className="muted rs-empty-line">{t('research.notes_empty')}</p>}
            </Section>
          </div>

          <aside className="rs-side">
            <Section
              title={t('research.people')}
              action={canAdd ? <button type="button" className="btn icon" title={t('research.add_person')} aria-label={t('research.add_person')} onClick={() => setPicking('person')}><Plus size={15} /></button> : null}
            >
              {view.people.length ? (
                <ul className="rs-people">
                  {view.people.map((l) => {
                    const p = f.byId.get(l.person);
                    if (!p) return null;
                    const born = p.born?.match(/\d{4}/)?.[0];
                    const died = p.died?.match(/\d{4}/)?.[0];
                    return (
                      <li key={l.person} className="rs-person">
                        <Link to="/$tree/person/$id" params={{ tree, id: p.id }} className="rs-person-link">
                          <Portrait person={p} tree={tree} size={36} frame={false} />
                          <span className="rs-person-text">
                            <span className="name">{displayName(p, f)}</span>
                            {born || died ? <small className="subtle">{born ?? ''}{died ? `–${died}` : ''}</small> : null}
                          </span>
                        </Link>
                        {l.private ? <span className="rs-private" title={t('research.private_hint')}><Lock size={12} aria-hidden /></span> : null}
                        {canChange(l.mine) ? <button type="button" className="btn icon ghost" title={t('research.remove_person')} aria-label={t('research.remove_person')} onClick={() => void unlink('person', l.person)}><X size={14} /></button> : null}
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="muted rs-empty-line">{t('research.people_empty')}</p>}
            </Section>

            <Section
              title={t('research.places')}
              action={canAdd ? <button type="button" className="btn icon" title={t('research.add_place')} aria-label={t('research.add_place')} onClick={() => setPicking('place')}><Plus size={15} /></button> : null}
            >
              {view.places.length ? (
                <ul className="rs-places">
                  {view.places.map((pl) => (
                    <li key={pl.place} className="rs-place">
                      <Link to="/$tree/atlas" params={{ tree }} search={{ place: pl.place }}><MapPin size={14} aria-hidden /> {pl.place}</Link>
                      {canChange(pl.mine) ? <button type="button" className="btn icon ghost" title={t('research.remove_place')} aria-label={t('research.remove_place')} onClick={() => void unlink('place', pl.place)}><X size={14} /></button> : null}
                    </li>
                  ))}
                </ul>
              ) : <p className="muted rs-empty-line">{t('research.places_empty')}</p>}
            </Section>
          </aside>
        </div>
      </div>

      {viewingDoc ? (
        <DocumentViewer
          tree={tree}
          doc={viewingDoc}
          canChange={canChange(viewingDoc.mine)}
          onClose={() => setViewing(null)}
          onEdit={() => { setDocEdit(viewingDoc); setViewing(null); }}
          onDelete={() => { setConfirm({ doc: viewingDoc }); setViewing(null); }}
        />
      ) : null}

      {openPicture && pictureItems.length ? (
        <Lightbox
          tree={tree}
          items={pictureItems}
          index={Math.max(0, pictureItems.findIndex((m) => m.key === openPicture))}
          albums={gallery.data?.albums ?? []}
          onIndex={(i) => setOpenPicture(pictureItems[i]?.key ?? null)}
          onClose={() => setOpenPicture(null)}
        />
      ) : null}

      {editingProject ? <ProjectDialog tree={tree} project={view} onClose={() => setEditingProject(false)} onSaved={() => setEditingProject(false)} /> : null}
      {noteEdit ? <NoteDialog tree={tree} project={project} note={noteEdit === 'new' ? undefined : noteEdit} onClose={() => setNoteEdit(null)} /> : null}
      {docEdit ? <DocumentDialog tree={tree} project={project} document={docEdit === 'new' ? undefined : docEdit} onClose={() => setDocEdit(null)} /> : null}
      {picking === 'picture' ? <AddPictureDialog tree={tree} project={project} linked={new Set(view.pictures.map((p) => p.key))} onClose={() => setPicking(null)} /> : null}
      {picking === 'person' ? <AddPersonDialog tree={tree} project={project} onClose={() => setPicking(null)} /> : null}
      {picking === 'place' ? <AddPlaceDialog tree={tree} project={project} linked={new Set(view.places.map((p) => p.place))} onClose={() => setPicking(null)} /> : null}

      {confirm === 'project' ? (
        <ConfirmDelete
          title={t('research.delete_project_title')}
          text={t('research.delete_project_text')}
          action={t('research.delete_project')}
          onClose={() => setConfirm(null)}
          onConfirm={async () => { await remove.project(project); void navigate({ to: '/$tree/research', params: { tree } }); }}
        />
      ) : confirm && 'doc' in confirm ? (
        <ConfirmDelete
          title={t('research.delete_document_title')}
          text={t('research.delete_document_text')}
          action={t('research.delete_document')}
          onClose={() => setConfirm(null)}
          onConfirm={async () => { await remove.document(confirm.doc.id); setConfirm(null); }}
        />
      ) : confirm && 'note' in confirm ? (
        <ConfirmDelete
          title={t('research.delete_note_title')}
          text={t('research.delete_note_text')}
          action={t('research.delete_note')}
          onClose={() => setConfirm(null)}
          onConfirm={async () => { await remove.note(project, confirm.note.id); setConfirm(null); }}
        />
      ) : null}
    </div>
  );
}

function Section({ title, action, children }: { title: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="ui-card rs-section">
      <header className="rs-section-head">
        <h2>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}
