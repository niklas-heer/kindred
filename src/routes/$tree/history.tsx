// The family's change history: every change to its records, newest first, filtered by person, kind and author, a page at a
// time. Members read what their role may see (history.server.ts); a share-link guest is told the history is for members.
// Opening it counts as having seen the news, so the dot beside History in the account menu goes.
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { History as HistoryIcon } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { z } from 'zod';
import { HistoryList } from '~/components/history/HistoryList';
import { EmptyState, ErrorState, PageHeader, Select, Skeleton } from '~/components/ui';
import { useFamily, useTreeId } from '~/lib/family';
import { displayName } from '~/lib/graph';
import { HISTORY_FILTER_NAMES, type HistoryFilter } from '~/lib/history';
import { getHistory } from '~/lib/history.functions';
import { compareText, translate, useT, type Key, type Locale } from '~/lib/i18n';
import { useCan, useMember } from '~/lib/session';
import { treeTitle } from '~/lib/title';
import '~/components/history/history.css';

const search = z.object({
  person: z.string().min(1).max(120).optional(),
  filter: z.enum(HISTORY_FILTER_NAMES as [HistoryFilter, ...HistoryFilter[]]).optional(),
  author: z.string().regex(/^(?:[0-9a-f]{16}|kindred)$/).optional(),
});

export const Route = createFileRoute('/$tree/history')({
  validateSearch: search,
  head: (ctx) => ({ meta: [{ title: treeTitle(ctx, translate((ctx.match.context as { locale?: Locale }).locale ?? 'en', 'history.title')) }] }),
  component: HistoryPage,
});

function HistoryPage() {
  const tree = useTreeId();
  const t = useT();
  const f = useFamily();
  const member = !!useMember(tree);
  const canRestore = useCan('edit-person');
  const { person, filter, author } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const qc = useQueryClient();
  const q = useInfiniteQuery({
    queryKey: ['history', tree, { person, filter, author }, 'pages'],
    queryFn: ({ pageParam }) => getHistory({ data: { tree, person, filter, author, before: pageParam } }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
    enabled: member,
  });
  // Opening the page showed the news: the menu's dot reads again.
  useEffect(() => {
    if (q.isSuccess) void qc.invalidateQueries({ queryKey: ['news-count', tree] });
  }, [q.isSuccess, qc, tree]);

  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const authors = q.data?.pages[0]?.authors ?? [];
  const people = useMemo(
    () => f.graph.people.map((p) => ({ value: p.id, label: displayName(p, f) })).sort((a, b) => compareText(t.locale)(a.label, b.label)),
    [f, t.locale],
  );
  const set = (patch: Partial<z.infer<typeof search>>) => navigate({ search: (s) => ({ ...s, ...patch }), replace: true });
  const filtered = !!(person || filter || author);

  return (
    <div className="page">
      <div className="page-inner hist-page">
        <PageHeader title={t('history.title')} subtitle={member ? t('history.intro') : undefined} icon={<HistoryIcon size={26} />} />
        {!member ? (
          <EmptyState icon={<HistoryIcon size={28} />} title={t('history.title')} text={t('history.guest')} />
        ) : (
          <>
            <div className="hist-filters" role="group" aria-label={t('history.title')}>
              <label>
                {t('history.filter_person')}
                <Select
                  aria-label={t('history.filter_person')} value={person ?? ''} onChange={(v) => set({ person: v || undefined })}
                  options={[{ value: '', label: t('history.filter_everyone') }, ...people]}
                />
              </label>
              <label>
                {t('history.filter_kind')}
                <Select
                  aria-label={t('history.filter_kind')} value={filter ?? ''} onChange={(v) => set({ filter: (v || undefined) as HistoryFilter | undefined })}
                  options={[{ value: '', label: t('history.filter_everything') }, ...HISTORY_FILTER_NAMES.map((k) => ({ value: k, label: t(`history.group.${k}` as Key) }))]}
                />
              </label>
              <label>
                {t('history.filter_author')}
                <Select
                  aria-label={t('history.filter_author')} value={author ?? ''} onChange={(v) => set({ author: v || undefined })}
                  options={[{ value: '', label: t('history.filter_anyone') }, ...authors.map((a) => ({ value: a.key, label: a.name })), { value: 'kindred', label: t('history.kindred') }]}
                />
              </label>
              {filtered && <button type="button" className="btn ghost" onClick={() => set({ person: undefined, filter: undefined, author: undefined })}>{t('history.filter_clear')}</button>}
            </div>
            {q.isPending ? (
              <div aria-busy="true" aria-label={t('history.loading')}>{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} height={48} radius={6} />)}</div>
            ) : q.isError ? (
              <ErrorState title={t('history.failed')} onRetry={() => void q.refetch()} error={q.error} />
            ) : items.length === 0 ? (
              <EmptyState icon={<HistoryIcon size={28} />} title={filtered ? t('history.empty_filtered') : t('history.empty')} />
            ) : (
              <>
                <HistoryList tree={tree} items={items} canRestore={canRestore} showPerson={!person} />
                {q.hasNextPage && (
                  <button type="button" className="btn hist-more" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
                    {t('history.more')}
                  </button>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
