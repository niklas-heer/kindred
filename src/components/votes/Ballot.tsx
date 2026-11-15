// The reader's ballot in an open vote (docs/votes.md): a list of radio choices for a single-choice vote; for a ranked one,
// the options as buttons to tap in order of preference (each shows its number, a second tap takes it out and the rest
// move up), which works under a finger on a phone without dragging. It starts from the reader's own ballot, and casting
// again replaces it. A share-link guest gives a name with their first ballot (GuestName); this browser remembers it.
// A house's arms vote shows each option's shield beside its name, and describes it in words (its blazon) for screen readers.
//
//   <Ballot tree={tree} view={vote} />
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, RotateCcw } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Arms } from '~/components/Heraldry';
import type { ArmsJson } from '~/lib/arms-proposals/types';
import { blazonV2 } from '~/lib/heraldry/blazon';
import { asV2 } from '~/lib/heraldry/convert';
import { errorText } from '~/lib/errortext';
import { useT } from '~/lib/i18n';
import { useSession } from '~/lib/session';
import { castVote } from '~/lib/votes/votes.functions';
import { MAX_GUEST_NAME, type VoteView } from '~/lib/votes/types';
import { GuestName } from './GuestName';

/** Where this browser keeps the name a guest last voted under in a family. A convenience: without it the guest types it again. */
const nameKey = (tree: string) => `kindred:vote-guest-name:${tree}`;

export function Ballot({ tree, view }: { tree: string; view: VoteView }) {
  const t = useT();
  const id = useId();
  const qc = useQueryClient();
  const guest = useSession()?.guest?.tree === tree;
  const [choices, setChoices] = useState<string[]>(view.mine ?? []);
  const [name, setName] = useState('');
  const [remembered, setRemembered] = useState(false);
  const [saved, setSaved] = useState(false);
  // Read after hydration: the server has no idea what this browser keeps.
  useEffect(() => {
    if (!guest) return;
    try {
      const kept = localStorage.getItem(nameKey(tree)) ?? '';
      if (kept) { setName(kept); setRemembered(true); }
    } catch {}
  }, [guest, tree]);

  const cast = useMutation({
    mutationFn: () => castVote({ data: { tree, id: view.id, choices, ...(guest ? { name: name.trim() } : {}) } }),
    onSuccess: async () => {
      if (guest) {
        try { localStorage.setItem(nameKey(tree), name.trim()); } catch {}
        setRemembered(true);
      }
      setSaved(true);
      await qc.invalidateQueries({ queryKey: ['votes', tree] });
    },
  });

  const same = !!view.mine && view.mine.length === choices.length && view.mine.every((c, i) => c === choices[i]);
  const named = !guest || (name.trim().length > 0 && name.trim().length <= MAX_GUEST_NAME);
  const ready = choices.length > 0 && named && !same && !cast.isPending;
  const choose = (next: string[]) => { setChoices(next); setSaved(false); };
  const tap = (option: string) => choose(choices.includes(option) ? choices.filter((c) => c !== option) : [...choices, option]);

  return (
    <form className="ui-card vt-ballot" onSubmit={(e) => { e.preventDefault(); if (ready) cast.mutate(); }}>
      {view.kind === 'single' ? (
        <div role="radiogroup" aria-labelledby={`${id}-l`} className="vt-choices">
          <p className="vt-h" id={`${id}-l`}>{t('votes.ballot.single')}</p>
          {view.options.map((o) => (
            <label key={o.id} className="vt-choice" data-chosen={choices[0] === o.id || undefined}>
              <input type="radio" name={`${id}-choice`} value={o.id} checked={choices[0] === o.id} onChange={() => choose([o.id])} aria-describedby={o.arms ? `${id}-b-${o.id}` : undefined} />
              {o.arms && <Shield id={`${id}-b-${o.id}`} arms={o.arms} />}
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      ) : (
        <div role="group" aria-labelledby={`${id}-l`} aria-describedby={`${id}-hint`} className="vt-choices">
          <p className="vt-h" id={`${id}-l`}>{t('votes.ballot.ranked')}</p>
          <p className="vt-note subtle" id={`${id}-hint`}>{t('votes.ballot.ranked_hint')}</p>
          {view.options.map((o) => {
            const n = choices.indexOf(o.id) + 1;
            return (
              <button
                key={o.id} type="button" className="vt-choice vt-rank" aria-pressed={n > 0} onClick={() => tap(o.id)}
                aria-describedby={[n ? `${id}-n-${o.id}` : '', o.arms ? `${id}-b-${o.id}` : ''].filter(Boolean).join(' ') || undefined}
              >
                {/* The name is the option; its place is the description. The number is drawn by the stylesheet, so the
                    button's visible words are its name. */}
                <span className="vt-rank-n" data-n={n || undefined} aria-hidden />
                {o.arms && <Shield id={`${id}-b-${o.id}`} arms={o.arms} />}
                <span>{o.label}</span>
                {n > 0 && <span id={`${id}-n-${o.id}`} hidden>{n}</span>}
              </button>
            );
          })}
        </div>
      )}
      {guest && !(remembered && view.mine) && <GuestName value={name} onChange={(v) => { setName(v); setSaved(false); }} />}
      {cast.isError && <p role="alert" className="vt-note vt-error">{errorText(cast.error, t.locale)}</p>}
      <div className="vt-actions">
        <button type="submit" className="btn primary" disabled={!ready}>
          <Check size={16} aria-hidden /> {view.mine ? t('votes.ballot.change') : t('votes.ballot.cast')}
        </button>
        {view.kind === 'ranked' && choices.length > 0 && (
          <button type="button" className="btn ghost" onClick={() => choose([])}><RotateCcw size={15} aria-hidden /> {t('votes.ballot.again')}</button>
        )}
        <span role="status" className="vt-saved">{saved && !cast.isPending ? t('votes.ballot.saved') : ''}</span>
      </div>
    </form>
  );
}

/** An arms option's shield, drawn for the eye; `id` holds its blazon, which describes the option to a screen reader. */
function Shield({ id, arms }: { id: string; arms: ArmsJson }) {
  const t = useT();
  return (
    <span className="vt-arms">
      <Arms arms={arms} size={40} />
      <span id={id} hidden>{blazonV2(asV2(arms), t.locale)}</span>
    </span>
  );
}
