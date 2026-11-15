// One vote's page (docs/votes.md): the question, the reader's ballot while it is open, the result as far as the reader may
// see it, who has voted, what the reader may do to it, and for a member the reactions and comments on it (the same thread
// as its entries in the feed). A share-link guest reaches it for a vote that lets guests in; any other is "not here" to
// them, as the server answers, and a guest gets no reactions or comments.
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ListOrdered, Lock, Users, Vote } from 'lucide-react';
import type { ReactNode } from 'react';
import { Responses } from '~/components/responses/Responses';
import { Ballot } from '~/components/votes/Ballot';
import { Results } from '~/components/votes/Results';
import { VoteActions } from '~/components/votes/VoteActions';
import { Voters } from '~/components/votes/Voters';
import { When } from '~/components/votes/When';
import '~/components/votes/votes.css';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '~/components/ui';
import { useTreeId } from '~/lib/family';
import { useMember } from '~/lib/session';
import { translate, useT, type Locale } from '~/lib/i18n';
import { treeTitle } from '~/lib/title';
import type { VoteView } from '~/lib/votes/types';
import { voteQuery } from '~/lib/votes/votes.functions';

export const Route = createFileRoute('/$tree/votes_/$vote')({
  head: (ctx) => ({ meta: [{ title: treeTitle(ctx, translate((ctx.match.context as { locale?: Locale }).locale ?? 'en', 'votes.title')) }] }),
  component: VotePage,
});

function VotePage() {
  const tree = useTreeId();
  const { vote } = Route.useParams();
  const t = useT();
  const q = useQuery(voteQuery(tree, vote));
  const back = <Link className="btn ghost vt-back" to="/$tree/votes" params={{ tree }}><ArrowLeft size={15} aria-hidden /> {t('votes.back')}</Link>;
  const frame = (children: ReactNode) => <div className="page"><div className="page-inner vt-page">{children}</div></div>;

  if (q.isPending) return frame(<Skeleton lines={5} height={18} />);
  if (q.isError) return frame(<>{back}<ErrorState title={t('votes.load_failed')} onRetry={() => void q.refetch()} error={q.error} /></>);
  if (!q.data) return frame(<>{back}<EmptyState icon={<Vote size={28} />} title={t('votes.not_found_title')} text={t('votes.not_found_text')} /></>);
  return frame(<><VoteBody tree={tree} view={q.data} />{back}</>);
}

function VoteBody({ tree, view }: { tree: string; view: VoteView }) {
  const t = useT();
  const navigate = useNavigate();
  const member = !!useMember(tree);
  const labelOf = (option: string) => view.options.find((o) => o.id === option)?.label ?? '';
  return (
    <>
      <PageHeader title={view.question} icon={<Vote size={26} />} />
      <div className="vt-detail">
        <p className="vt-badges">
          <span className="chip">{view.kind === 'ranked' ? <><ListOrdered size={12} aria-hidden /> {t('votes.kind_ranked')}</> : t('votes.kind_single')}</span>
          {view.secret && <span className="chip"><Lock size={12} aria-hidden /> {t('votes.badge_secret')}</span>}
          {view.guests && <span className="chip"><Users size={12} aria-hidden /> {t('votes.badge_guests')}</span>}
        </p>
        <p className="vt-meta subtle">
          {view.author.name && <span>{t('votes.by', { name: view.author.name })}</span>}
          <span>{t('votes.voter_count', { count: view.voterCount })}</span>
          <When at={view.closesAt} closed={view.closed} />
        </p>
        {view.description && <p className="vt-description">{view.description}</p>}
        {view.secret && <p className="vt-secret"><Lock size={14} aria-hidden /> {t('votes.secret_meaning')}</p>}
        {!view.closed ? (
          <Ballot key={view.id} tree={tree} view={view} />
        ) : view.mine ? (
          <p className="vt-note">{t('votes.ballot.yours', { options: view.mine.map(labelOf).join(', ') })}</p>
        ) : null}
        <Results view={view} />
        <Voters tree={tree} view={view} />
        <VoteActions tree={tree} view={view} onRemoved={() => void navigate({ to: '/$tree/votes', params: { tree } })} />
        {member && <Responses tree={tree} kind="vote" target={view.id} />}
      </div>
    </>
  );
}
