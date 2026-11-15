// A vote's result (docs/votes.md), as the server let this reader see it: a bar per option for a single-choice vote, and
// for a ranked one each round of the count, with the options that dropped out and the ballots that had no choice left.
// Before there is a result to show, it says why: a secret vote shows nothing until it closes, an open one once the reader
// has voted.
//
//   <Results view={vote} />
import { Trophy } from 'lucide-react';
import { useId } from 'react';
import { listText, useT } from '~/lib/i18n';
import type { VoteResult, VoteView } from '~/lib/votes/types';

export function Results({ view }: { view: VoteView }) {
  const t = useT();
  const id = useId();
  const { result } = view;
  const labelOf = (option: string) => view.options.find((o) => o.id === option)?.label ?? '';
  return (
    <section className="ui-card vt-results" aria-labelledby={`${id}-h`}>
      <h2 className="vt-h" id={`${id}-h`}>{t('votes.results')}</h2>
      {!result ? (
        <p className="vt-note">{view.secret ? t('votes.results_later') : t('votes.results_after_voting')}</p>
      ) : (
        <>
          {view.closed && <Outcome winners={result.winners.map(labelOf)} />}
          {result.kind === 'single' ? (
            <Bars tallies={result.tallies} order={view.options.map((o) => o.id)} total={result.ballots} winners={view.closed ? result.winners : []} labelOf={labelOf} />
          ) : (
            <Rounds result={result} order={view.options.map((o) => o.id)} closed={view.closed} labelOf={labelOf} />
          )}
          <p className="vt-note subtle">{t('votes.counted', { count: result.ballots })}</p>
        </>
      )}
    </section>
  );
}

/** What was chosen: the winner, a tie, or nobody. */
export function Outcome({ winners }: { winners: string[] }) {
  const t = useT();
  return (
    <p className="vt-outcome">
      <Trophy size={18} aria-hidden />
      <span>{winners.length === 0 ? t('votes.nobody') : winners.length === 1 ? t('votes.winner', { option: winners[0] }) : t('votes.tie', { options: listText(winners, t.locale) })}</span>
    </p>
  );
}

function Bars({ tallies, order, total, winners, labelOf }: { tallies: Record<string, number>; order: string[]; total: number; winners: string[]; labelOf: (id: string) => string }) {
  const t = useT();
  const shown = order.filter((id) => id in tallies);
  return (
    <ul className="vt-bars">
      {shown.map((id) => {
        const n = tallies[id];
        const share = total ? Math.round((n / total) * 100) : 0;
        return (
          <li key={id} data-won={winners.includes(id) || undefined}>
            <span className="vt-bar-label">{labelOf(id)}</span>
            <span className="vt-bar-count">{t('votes.tally', { count: n })}</span>
            <span className="vt-bar" aria-hidden><span style={{ width: `${share}%` }} /></span>
          </li>
        );
      })}
    </ul>
  );
}

function Rounds({ result, order, closed, labelOf }: { result: Extract<VoteResult, { kind: 'ranked' }>; order: string[]; closed: boolean; labelOf: (id: string) => string }) {
  const t = useT();
  return (
    <ol className="vt-rounds">
      {result.rounds.map((round, i) => {
        const inPlay = Object.values(round.tallies).reduce((a, b) => a + b, 0);
        const last = i === result.rounds.length - 1;
        return (
          <li key={i}>
            <h3 className="vt-round-h">{t('votes.round', { n: i + 1 })}</h3>
            <Bars tallies={round.tallies} order={order} total={inPlay} winners={closed && last ? result.winners : []} labelOf={labelOf} />
            {round.out.length > 0 && <p className="vt-note">{t('votes.round_out', { options: listText(round.out.map(labelOf), t.locale) })}</p>}
            {round.exhausted > 0 && <p className="vt-note subtle">{t('votes.exhausted', { count: round.exhausted })}</p>}
          </li>
        );
      })}
    </ol>
  );
}
