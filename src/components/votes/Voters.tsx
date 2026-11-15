// Who has voted and, in an open vote, who chose what (docs/votes.md), as the server let this reader see them: members get
// the list of who has voted (a secret vote's too, so people can nudge whoever is missing), and once they have voted in an
// open vote each ballot with its name. A guest gets neither. A steward may strike a guest's vote while the vote is open, and
// count it again; only a steward sees a struck one.
//
//   <Voters tree={tree} view={vote} />
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, UserX } from 'lucide-react';
import { useId } from 'react';
import { Portrait } from '~/components/Portrait';
import { newOpKey } from '~/lib/api';
import { errorText } from '~/lib/errortext';
import { useFamily } from '~/lib/family';
import { useT } from '~/lib/i18n';
import type { VoteView } from '~/lib/votes/types';
import { strikeVoter } from '~/lib/votes/votes.functions';

export function Voters({ tree, view }: { tree: string; view: VoteView }) {
  const t = useT();
  const id = useId();
  const qc = useQueryClient();
  const strike = useMutation({
    mutationFn: (v: { voter: string; struck: boolean }) => strikeVoter({ data: { tree, id: view.id, ...v, opKey: newOpKey() } }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['votes', tree] }),
  });
  const labelOf = (option: string) => view.options.find((o) => o.id === option)?.label ?? '';
  return (
    <>
      {view.ballots && view.ballots.length > 0 && (
        <section className="ui-card vt-people" aria-labelledby={`${id}-c`}>
          <h2 className="vt-h" id={`${id}-c`}>{t('votes.who_chose')}</h2>
          <ul>
            {view.ballots.map((b, i) => (
              <li key={i}>
                <Who tree={tree} name={b.name} person={b.person} guest={b.guest} />
                <span className="vt-person-choice">{b.choices.map(labelOf).join(view.kind === 'ranked' ? ' › ' : ', ')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {view.voters && view.voters.length > 0 && (
        <section className="ui-card vt-people" aria-labelledby={`${id}-v`}>
          <h2 className="vt-h" id={`${id}-v`}>{t('votes.who_voted')}</h2>
          {strike.isError && <p role="alert" className="vt-note vt-error">{errorText(strike.error, t.locale)}</p>}
          <ul>
            {view.voters.map((v) => (
              <li key={v.id} data-struck={v.struck || undefined}>
                <Who tree={tree} name={v.name} person={v.person} guest={v.guest} />
                {v.struck && <span className="chip">{t('votes.struck')}</span>}
                {view.may.strike && v.guest && (
                  <button
                    type="button" className="btn icon ghost" disabled={strike.isPending} onClick={() => strike.mutate({ voter: v.id, struck: !v.struck })}
                    aria-label={t(v.struck ? 'votes.restore' : 'votes.strike', { name: v.name })} title={t(v.struck ? 'votes.restore' : 'votes.strike', { name: v.name })}
                  >{v.struck ? <RotateCcw size={15} aria-hidden /> : <UserX size={15} aria-hidden />}</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** A voter's face (a member who is in the tree) and name, with guests marked. */
function Who({ tree, name, person, guest }: { tree: string; name: string; person: string | null; guest: boolean }) {
  const t = useT();
  const f = useFamily();
  const p = person ? f.byId.get(person) : undefined;
  return (
    <span className="vt-person">
      {p ? <Portrait person={p} tree={tree} size={24} decorative /> : <span className="vt-initial" aria-hidden>{(name.trim()[0] ?? '·').toUpperCase()}</span>}
      <span className="vt-person-name">{name}</span>
      {guest && <span className="chip">{t('votes.guest')}</span>}
    </span>
  );
}
