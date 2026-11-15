// The Suggestions page (docs/suggestions.md). For editors and stewards: the waiting suggestions, newest first, filtered by the
// person they are about, each to approve (adjusted if need be), decline, or close as partly applied (SuggestionCard). For
// everyone else who suggests (a viewer, a contributor, a share-link guest): their own suggestions and what became of them.
// The server decides what each reader gets (reads.server.ts).
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Inbox } from 'lucide-react';
import { useMemo } from 'react';
import { z } from 'zod';
import { MySuggestions } from '~/components/suggestions/MySuggestions';
import { SuggestionCard } from '~/components/suggestions/SuggestionCard';
import '~/components/suggestions/suggestions.css';
import { EmptyState, ErrorState, PageHeader, Select, Skeleton } from '~/components/ui';
import { useFamily, useTreeId } from '~/lib/family';
import { displayName } from '~/lib/graph';
import { compareText, translate, useT, type Locale } from '~/lib/i18n';
import { useCan, useMember } from '~/lib/session';
import { mySuggestionsQuery, suggestionCountsQuery, waitingSuggestionsQuery } from '~/lib/suggestions/suggestions.functions';
import { treeTitle } from '~/lib/title';

const search = z.object({ person: z.string().min(1).max(200).optional() });

export const Route = createFileRoute('/$tree/suggestions')({
  validateSearch: search,
  head: (ctx) => ({ meta: [{ title: treeTitle(ctx, translate((ctx.match.context as { locale?: Locale }).locale ?? 'en', 'suggest.page.title')) }] }),
  component: SuggestionsPage,
});

function SuggestionsPage() {
  const tree = useTreeId();
  const t = useT();
  // A guest's session lists the family as a viewer's membership: only a member's role counts here.
  const member = !!useMember(tree);
  const reviewer = useCan('review-suggestions') && member;
  return (
    <div className="page">
      <div className="page-inner sg-page">
        <PageHeader title={t('suggest.page.title')} subtitle={t(reviewer ? 'suggest.page.subtitle_review' : 'suggest.page.subtitle_mine')} icon={<Inbox size={26} />} />
        {reviewer ? <Waiting tree={tree} /> : <Mine tree={tree} />}
      </div>
    </div>
  );
}

function Waiting({ tree }: { tree: string }) {
  const t = useT();
  const f = useFamily();
  const { person } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const q = useQuery(waitingSuggestionsQuery(tree, person));
  const counts = useQuery(suggestionCountsQuery(tree)).data;
  // The people anything waits about, and the one chosen even when nothing waits about them any more.
  const people = useMemo(() => {
    const ids = new Set([...Object.keys(counts?.people ?? {}), ...(person ? [person] : [])]);
    return [...ids].flatMap((id) => {
      const p = f.byId.get(id);
      return p ? [{ value: id, label: displayName(p, f), hint: counts?.people[id] ? String(counts.people[id]) : undefined }] : [];
    }).sort((a, b) => compareText(t.locale)(a.label, b.label));
  }, [counts, person, f, t.locale]);
  const list = q.data ?? [];
  return (
    <>
      {people.length > 0 && (
        <div className="sg-filter">
          <span className="sg-label" id="sg-filter">{t('suggest.page.person')}</span>
          <Select aria-labelledby="sg-filter" value={person ?? ''} onChange={(v) => void navigate({ search: { person: v || undefined }, replace: true })}
            options={[{ value: '', label: t('suggest.page.everyone') }, ...people]} />
        </div>
      )}
      {q.isPending ? (
        <div aria-busy="true">{Array.from({ length: 2 }, (_, i) => <Skeleton key={i} height={160} radius={8} />)}</div>
      ) : q.isError ? (
        <ErrorState title={t('suggest.page.load_failed')} onRetry={() => void q.refetch()} error={q.error} />
      ) : list.length === 0 ? (
        <EmptyState icon={<Inbox size={28} />} title={t('suggest.page.empty_title')} text={t('suggest.page.empty_text')} />
      ) : (
        <div className="sg-list">{list.map((v) => <SuggestionCard key={v.id} tree={tree} v={v} />)}</div>
      )}
    </>
  );
}

function Mine({ tree }: { tree: string }) {
  const t = useT();
  const q = useQuery(mySuggestionsQuery(tree));
  if (q.isPending) return <div aria-busy="true"><Skeleton height={120} radius={8} /></div>;
  if (q.isError) return <ErrorState title={t('suggest.page.load_failed')} onRetry={() => void q.refetch()} error={q.error} />;
  if (!q.data.length) return <EmptyState icon={<Inbox size={28} />} title={t('suggest.page.mine_empty_title')} text={t('suggest.page.mine_empty_text')} />;
  return <MySuggestions tree={tree} list={q.data} />;
}
