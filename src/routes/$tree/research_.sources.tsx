// The family's sources, under Research: every register, letter, book and web page the family's facts rest on, with what
// cites each one. Members read it; editors add, change and delete sources (sources.server.ts checks the same). A share-link
// guest gets no sources at all, so the page tells them so instead of asking the server.
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft, BookMarked, ExternalLink, FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { eventTitle } from '~/components/life/records';
import { SourceDialog, useSourcesRefresh } from '~/components/life/SourceDialog';
import { ConfirmDialog, EmptyState, ErrorState, PageHeader, Skeleton } from '~/components/ui';
import { opKeys } from '~/lib/api';
import { errorText } from '~/lib/errortext';
import { isWebAddress, QUALITY_LABEL, type Citation, type Source } from '~/lib/events';
import { useFamily, useTreeId } from '~/lib/family';
import { displayName, fmtDate } from '~/lib/graph';
import { compareText, translate, useT, type Locale } from '~/lib/i18n';
import { useCan, useMember } from '~/lib/session';
import { removeSource, sourceCitationsQuery, sourcesQuery } from '~/lib/sources.functions';
import { treeTitle } from '~/lib/title';
import '~/components/life/life.css';

export const Route = createFileRoute('/$tree/research_/sources')({
  head: (ctx) => ({ meta: [{ title: treeTitle(ctx, translate((ctx.match.context as { locale?: Locale }).locale ?? 'en', 'sources.title')) }] }),
  component: SourcesPage,
});

function SourcesPage() {
  const tree = useTreeId();
  const t = useT();
  // A guest's session lists the family as a viewer's membership; only a member's counts here (useMember).
  const member = !!useMember(tree);
  const canEdit = useCan('edit-person');
  const q = useQuery({ ...sourcesQuery(tree), enabled: member });
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<Source | 'new' | null>(null);
  const sources = useMemo(() => {
    const words = filter.trim().toLowerCase();
    const all = q.data ?? [];
    const shown = words ? all.filter((s) => [s.title, s.author, s.publication, s.reference, s.note].some((x) => x?.toLowerCase().includes(words))) : all;
    return [...shown].sort((a, b) => compareText(t.locale)(a.title, b.title));
  }, [q.data, filter, t.locale]);

  const addButton = canEdit ? <button type="button" className="btn primary" onClick={() => setEditing('new')}><Plus size={16} aria-hidden /> {t('sources.new')}</button> : null;
  const back = <Link to="/$tree/research" params={{ tree }} className="btn ghost"><ArrowLeft size={15} aria-hidden /> {t('research.title')}</Link>;

  return (
    <div className="page">
      <div className="page-inner sources">
        {back}
        <PageHeader title={t('sources.title')} subtitle={t('sources.subtitle')} icon={<BookMarked size={26} />} actions={addButton} />
        {!member ? (
          <EmptyState icon={<BookMarked size={28} />} title={t('sources.members_only_title')} text={t('sources.members_only')} />
        ) : q.isPending ? (
          <div aria-busy="true">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} height={84} radius={8} />)}</div>
        ) : q.isError ? (
          <ErrorState title={t('sources.load_failed')} onRetry={() => void q.refetch()} error={q.error} />
        ) : (q.data ?? []).length === 0 ? (
          <EmptyState icon={<BookMarked size={28} />} title={t('sources.empty_title')} text={canEdit ? t('sources.empty_text') : t('sources.empty_viewer')} action={addButton} />
        ) : (
          <>
            <div className="sources-tools">
              <input className="input" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('sources.filter')} aria-label={t('sources.filter')} />
              <span className="subtle" role="status">{t('sources.count', { count: sources.length })}</span>
            </div>
            <ul className="sources-list">{sources.map((s) => <SourceCard key={s.id} tree={tree} s={s} canEdit={canEdit} onEdit={() => setEditing(s)} />)}</ul>
          </>
        )}
      </div>
      {editing && <SourceDialog tree={tree} source={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SourceCard({ tree, s, canEdit, onEdit }: { tree: string; s: Source; canEdit: boolean; onEdit: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useSourcesRefresh(tree);
  const keys = useRef(opKeys());
  const meta = [s.author, s.publication, s.date ? fmtDate(s.date, t.locale) : null].filter(Boolean).join(' · ');
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await removeSource({ data: { tree, id: s.id, citations: s.citations, opKey: keys.current.for('remove', [s.id, s.citations]) } });
      await refresh();
      setRemoving(false);
    } catch (e) {
      setError(errorText(e, t.locale));
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="ui-card source-card">
      <h2>{s.title}</h2>
      {meta && <p className="source-card-meta">{meta}</p>}
      {s.reference && (
        <p className="source-card-meta">
          {isWebAddress(s.reference)
            ? <a href={s.reference.trim()} target="_blank" rel="noreferrer noopener">{s.reference} <ExternalLink size={12} aria-hidden /></a>
            : s.reference}
        </p>
      )}
      {s.document && (
        <p className="source-card-meta">
          <FileText size={13} aria-hidden /> <Link to="/$tree/research/$project" params={{ tree, project: s.document.project }}>{s.document.title}</Link>
        </p>
      )}
      {s.note && <p className="source-card-meta">{s.note}</p>}
      <div className="source-card-actions">
        <button type="button" className="btn ghost" aria-expanded={open} disabled={!s.citations} onClick={() => setOpen(!open)}>
          {s.citations ? t('sources.cited_by', { count: s.citations }) : t('sources.not_cited')}
        </button>
        {canEdit && <button type="button" className="btn icon ghost" onClick={onEdit} aria-label={t('sources.edit_one', { title: s.title })} title={t('sources.edit_one', { title: s.title })}><Pencil size={14} /></button>}
        {canEdit && <button type="button" className="btn icon ghost" onClick={() => setRemoving(true)} aria-label={t('sources.remove_one', { title: s.title })} title={t('sources.remove_one', { title: s.title })}><Trash2 size={14} /></button>}
      </div>
      {open && <SourceCites tree={tree} source={s.id} />}
      <ConfirmDialog
        open={removing}
        onClose={() => { setRemoving(false); setError(null); }}
        onConfirm={() => void remove()}
        busy={busy}
        error={error}
        title={t('sources.remove_title')}
        confirmLabel={s.citations ? t('sources.remove_with', { count: s.citations }) : t('sources.remove')}
      >
        <p>{s.citations ? t('sources.remove_body_cited', { title: s.title, count: s.citations }) : t('sources.remove_body', { title: s.title })}</p>
      </ConfirmDialog>
    </li>
  );
}

/** What cites one source: the person and the fact, each a link to the person's page. */
function SourceCites({ tree, source }: { tree: string; source: string }) {
  const t = useT();
  const f = useFamily();
  const q = useQuery(sourceCitationsQuery(tree, source));
  if (q.isPending) return <Skeleton height={40} radius={6} />;
  if (q.isError) return <ErrorState title={t('sources.load_failed')} onRetry={() => void q.refetch()} error={q.error} />;
  const name = (id: string) => { const p = f.byId.get(id); return p ? displayName(p, f) : id; };
  const what = (c: Citation): string => {
    switch (c.target.fact) {
      case 'birth': return t('sources.fact.birth');
      case 'death': return t('sources.fact.death');
      case 'name': return t('sources.fact.name');
      case 'event': return c.event ? eventTitle(c.event, t) : t('sources.fact.event');
      case 'partnership': return t('sources.fact.partnership', { name: name(c.about[1] ?? '') });
      case 'parent': return t('sources.fact.parent', { name: name(c.target.parent) });
    }
  };
  return (
    <ul className="source-cites">
      {q.data.map((c) => {
        const who = c.about[0];
        return (
          <li key={c.id}>
            {who && f.byId.has(who) ? <Link to="/$tree/person/$id" params={{ tree, id: who }}>{name(who)}</Link> : null}
            {' · '}{what(c)}{c.page ? `, ${c.page}` : ''}
            {c.quality ? <span className="subtle"> · {t(QUALITY_LABEL[c.quality])}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
