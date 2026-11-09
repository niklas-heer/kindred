import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { FileText, Image, Lock, FolderSearch, MapPin, NotebookPen, Plus, Users } from 'lucide-react';
import { useState } from 'react';
import { ProjectDialog } from '~/components/research/forms';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '~/components/ui';
import { useTreeId } from '~/lib/family';
import { relativeTime, translate, useT, type Locale } from '~/lib/i18n';
import { researchProjectsQuery } from '~/lib/research.functions';
import type { ProjectSummary } from '~/lib/research';
import { useCan } from '~/lib/session';
import { treeTitle } from '~/lib/title';
import '~/styles/research.css';
import { useDealt } from '~/lib/dealt';

export const Route = createFileRoute('/$tree/research')({
  head: (ctx) => ({ meta: [{ title: treeTitle(ctx, translate((ctx.match.context as { locale?: Locale }).locale ?? 'en', 'research.title')) }] }),
  component: ResearchPage,
});

function ResearchPage() {
  const tree = useTreeId();
  const t = useT();
  const canAdd = useCan('add-research');
  const navigate = useNavigate();
  const q = useQuery(researchProjectsQuery(tree));
  const dealt = useDealt(!q.isPending);
  const [creating, setCreating] = useState(false);
  const projects = q.data ?? [];

  const addButton = canAdd ? (
    <button type="button" className="btn primary" onClick={() => setCreating(true)}><Plus size={16} aria-hidden /> {t('research.new')}</button>
  ) : null;

  return (
    <div className="page">
      <div className="page-inner research">
        <PageHeader title={t('research.title')} subtitle={t('research.subtitle')} icon={<FolderSearch size={26} />} actions={!q.isPending && !q.isError && projects.length === 0 ? undefined : addButton} />
        {q.isPending ? (
          <div className="rs-grid" aria-busy="true">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} height={132} radius={8} />)}</div>
        ) : q.isError ? (
          <ErrorState title={t('research.load_failed')} onRetry={() => void q.refetch()} error={q.error} />
        ) : projects.length === 0 ? (
          <EmptyState icon={<FolderSearch size={28} />} title={t('research.empty_title')} text={canAdd ? t('research.empty_text') : t('research.empty_viewer')} action={addButton} />
        ) : (
          <ul className={`rs-grid ${dealt}`}>{projects.map((p) => <ProjectCard key={p.id} tree={tree} project={p} />)}</ul>
        )}
      </div>
      {creating ? <ProjectDialog tree={tree} onClose={() => setCreating(false)} onSaved={(id) => void navigate({ to: '/$tree/research/$project', params: { tree, project: id } })} /> : null}
    </div>
  );
}

function ProjectCard({ tree, project: p }: { tree: string; project: ProjectSummary }) {
  const t = useT();
  const counts = [
    { icon: FileText, n: p.counts.documents, label: 'research.count_documents' },
    { icon: Image, n: p.counts.pictures, label: 'research.count_pictures' },
    { icon: NotebookPen, n: p.counts.notes, label: 'research.count_notes' },
    { icon: Users, n: p.counts.people, label: 'research.count_people' },
    { icon: MapPin, n: p.counts.places, label: 'research.count_places' },
  ] as const;
  return (
    <li>
      <Link className="ui-card interactive rs-card" to="/$tree/research/$project" params={{ tree, project: p.id }}>
        <h2 className="rs-card-title">
          {p.title}
          {p.private ? <span className="rs-private" title={t('research.private_hint')}><Lock size={13} aria-hidden /> <span className="sr-only">{t('research.private')}</span></span> : null}
        </h2>
        {p.summary ? <p className="rs-card-summary">{p.summary}</p> : null}
        <p className="rs-card-counts">
          {counts.filter((c) => c.n > 0).map((c) => <span key={c.label} title={t(c.label, { count: c.n })}><c.icon size={13} aria-hidden /> {t(c.label, { count: c.n })}</span>)}
        </p>
        <p className="subtle rs-card-updated">{t('research.updated', { when: relativeTime(new Date(p.updatedAt), t.locale) })}</p>
      </Link>
    </li>
  );
}
