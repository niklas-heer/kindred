// The Votes page (docs/votes.md): the family's votes, open ones first, then closed ones with what was chosen, and the way
// to start one for whoever may. A share-link guest reaches it too and sees only the votes that let guests in; the server
// decides what each reader gets.
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Plus, Vote } from 'lucide-react';
import { useState } from 'react';
import { useSettledRefresh } from '~/components/arms-proposals/settled';
import { VoteComposer } from '~/components/votes/VoteComposer';
import { VoteList } from '~/components/votes/VoteList';
import '~/components/votes/votes.css';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '~/components/ui';
import { useTreeId } from '~/lib/family';
import { translate, useT, type Locale } from '~/lib/i18n';
import { useCan, useMember } from '~/lib/session';
import { treeTitle } from '~/lib/title';
import { votesQuery } from '~/lib/votes/votes.functions';

export const Route = createFileRoute('/$tree/votes')({
  head: (ctx) => ({ meta: [{ title: treeTitle(ctx, translate((ctx.match.context as { locale?: Locale }).locale ?? 'en', 'votes.title')) }] }),
  component: VotesPage,
});

function VotesPage() {
  const tree = useTreeId();
  const t = useT();
  const navigate = useNavigate();
  // A guest's session lists the family as a viewer's membership; only a member starts a vote.
  const member = !!useMember(tree);
  const canStart = useCan('start-vote') && member;
  const q = useQuery(votesQuery(tree));
  const [starting, setStarting] = useState(false);
  const votes = q.data?.votes ?? [];
  // The read settled an arms vote: the house it chose for, and its proposals, are read again.
  useSettledRefresh(tree, q.data?.settled, q.dataUpdatedAt);

  const startButton = canStart ? (
    <button type="button" className="btn primary" onClick={() => setStarting(true)}><Plus size={16} aria-hidden /> {t('votes.new')}</button>
  ) : null;

  return (
    <div className="page">
      <div className="page-inner vt-page">
        <PageHeader title={t('votes.title')} subtitle={t('votes.subtitle')} icon={<Vote size={26} />} actions={votes.length ? startButton : null} />
        {q.isPending ? (
          <div className="vt-list" aria-busy="true">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} height={96} radius={8} />)}</div>
        ) : q.isError ? (
          <ErrorState title={t('votes.load_failed')} onRetry={() => void q.refetch()} error={q.error} />
        ) : votes.length === 0 ? (
          <EmptyState icon={<Vote size={28} />} title={t('votes.empty_title')} text={canStart ? t('votes.empty_text') : t('votes.empty_viewer')} action={startButton} />
        ) : (
          <VoteList tree={tree} votes={votes} />
        )}
      </div>
      {starting ? <VoteComposer tree={tree} onClose={() => setStarting(false)} onStarted={(id) => void navigate({ to: '/$tree/votes/$vote', params: { tree, vote: id } })} /> : null}
    </div>
  );
}
