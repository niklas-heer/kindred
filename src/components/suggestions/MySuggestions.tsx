// A suggester's own suggestions (docs/suggestions.md): what they suggested, its state (waiting, approved, approved with
// changes or in part, declined with the reason, expired), and Withdraw while the server's `may` allows it. A suggestion
// approved where whether it was changed is not known reads "Approved", never "approved as suggested". On a person's page
// (PersonSuggestions) for that person, and on the Suggestions page for all of them. A guest's are theirs by their cookie.
//
//   <MySuggestions tree={tree} list={q.data} />
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Undo2 } from 'lucide-react';
import { useId, useState } from 'react';
import { When } from '~/components/votes/When';
import { ConfirmDialog } from '~/components/ui';
import { errorText } from '~/lib/errortext';
import { useFamily } from '~/lib/family';
import { useT } from '~/lib/i18n';
import { suggestionKeys, withdrawSuggestionFn } from '~/lib/suggestions/suggestions.functions';
import type { SuggestionView } from '~/lib/suggestions/types';
import { Change, Files } from './SuggestionCard';
import { headingOf, rowsFor, stateKey, useEventsOf } from './view';
import './suggestions.css';

export function MySuggestions({ tree, list }: { tree: string; list: SuggestionView[] }) {
  return (
    <ul className="sg-mine">
      {list.map((v) => <Mine key={v.id} tree={tree} v={v} />)}
    </ul>
  );
}

function Mine({ tree, v }: { tree: string; v: SuggestionView }) {
  const t = useT();
  const id = useId();
  const f = useFamily();
  const qc = useQueryClient();
  const events = useEventsOf(tree, v);
  const [asking, setAsking] = useState(false);
  const withdraw = useMutation({
    mutationFn: () => withdrawSuggestionFn({ data: { tree, id: v.id } }),
    onSuccess: async () => {
      setAsking(false);
      await Promise.all(suggestionKeys(tree).map((queryKey) => qc.invalidateQueries({ queryKey })));
    },
  });
  const heading = headingOf(v, f, t, events);
  return (
    <li className="ui-card sg-card sg-card-mine" aria-labelledby={`${id}-h`}>
      <header className="sg-card-head">
        <h3 className="sg-card-title" id={`${id}-h`}>
          {v.person && f.byId.has(v.person) ? <Link to="/$tree/person/$id" params={{ tree, id: v.person }}>{heading}</Link> : heading}
        </h3>
        <p className="sg-meta subtle">
          <span className="chip sg-state" data-state={v.status}>{t(stateKey(v))}</span>
          <When at={v.createdAt} />
        </p>
      </header>
      {v.status === 'declined' && v.reason && <p className="sg-reason">{t('suggest.reason', { reason: v.reason })}</p>}
      {v.note && <blockquote className="sg-note">{v.note}</blockquote>}
      <Change v={v} rows={rowsFor(v.kind, v.payload)} values={v.payload} correction={false} events={events} />
      {v.status === 'waiting' && v.files.length > 0 && <Files tree={tree} v={v} />}
      {v.may.withdraw && (
        <div className="sg-actions">
          <button type="button" className="btn ghost" aria-haspopup="dialog" onClick={() => { withdraw.reset(); setAsking(true); }}>
            <Undo2 size={15} aria-hidden /> {t('suggest.withdraw')}
          </button>
        </div>
      )}
      <ConfirmDialog
        open={asking} onClose={() => setAsking(false)} onConfirm={() => withdraw.mutate()} busy={withdraw.isPending}
        title={t('suggest.withdraw_title')} confirmLabel={t('suggest.withdraw')}
        error={withdraw.isError ? errorText(withdraw.error, t.locale) : undefined}
      >
        <p>{t('suggest.withdraw_text')}</p>
      </ConfirmDialog>
    </li>
  );
}
