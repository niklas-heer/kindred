// The Votes page's list (docs/votes.md): open votes first, closing soonest first, then closed ones with what was chosen.
// Each is a card that opens the vote. The server has already left out what this reader may not see (a guest gets only the
// votes that let guests in, and no author).
//
//   <VoteList tree={tree} votes={votes} />
import { Link } from '@tanstack/react-router';
import { CheckCircle2, ListOrdered, Lock, Users } from 'lucide-react';
import { useId } from 'react';
import { useT } from '~/lib/i18n';
import type { VoteSummary } from '~/lib/votes/types';
import { Outcome } from './Results';
import { When } from './When';

export function VoteList({ tree, votes }: { tree: string; votes: VoteSummary[] }) {
  const t = useT();
  const open = votes.filter((v) => !v.closed);
  const closed = votes.filter((v) => v.closed);
  return (
    <>
      {open.length > 0 && <Group title={t('votes.list_open')} tree={tree} votes={open} />}
      {closed.length > 0 && <Group title={t('votes.list_closed')} tree={tree} votes={closed} />}
    </>
  );
}

function Group({ title, tree, votes }: { title: string; tree: string; votes: VoteSummary[] }) {
  const id = useId();
  return (
    <section className="vt-group" aria-labelledby={id}>
      <h2 className="rule" id={id}>{title}</h2>
      <ul className="vt-list">{votes.map((v) => <Card key={v.id} tree={tree} vote={v} />)}</ul>
    </section>
  );
}

function Card({ tree, vote: v }: { tree: string; vote: VoteSummary }) {
  const t = useT();
  return (
    <li>
      <Link className="ui-card interactive vt-card" to="/$tree/votes/$vote" params={{ tree, vote: v.id }}>
        <h3 className="vt-card-title">{v.question}</h3>
        <p className="vt-badges">
          <span className="chip">{v.kind === 'ranked' ? <><ListOrdered size={12} aria-hidden /> {t('votes.kind_ranked')}</> : t('votes.kind_single')}</span>
          {v.secret && <span className="chip"><Lock size={12} aria-hidden /> {t('votes.badge_secret')}</span>}
          {v.guests && <span className="chip"><Users size={12} aria-hidden /> {t('votes.badge_guests')}</span>}
          {v.voted && <span className="chip vt-voted"><CheckCircle2 size={12} aria-hidden /> {t('votes.you_voted')}</span>}
        </p>
        {v.closed && v.winners && <Outcome winners={v.winners} />}
        <p className="vt-meta subtle">
          {v.author.name && <span>{t('votes.by', { name: v.author.name })}</span>}
          <span>{t('votes.voter_count', { count: v.voterCount })}</span>
          <When at={v.closesAt} closed={v.closed} />
        </p>
      </Link>
    </li>
  );
}
