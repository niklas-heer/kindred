// What the background task collected for a house's name, on the house page, for stewards only. One prompt: choose the meaning
// that fits best. One click saves it, and only then the existing check of the arms follows. The component stays mounted after
// the choice, so the check that follows can say what it is doing. Other readers get nothing from here: the collection is not
// in what they can read, and this component is only rendered for those who may edit the house.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { checkArmsFit } from '~/lib/ai/arms-fit.functions';
import { toAiLocale } from '~/lib/ai/types';
import { opKeys } from '~/lib/api';
import { errorText } from '~/lib/errortext';
import type { SavedMeaning, SavedMeaningRow } from '~/lib/house-meaning';
import { armsReviewsQuery, chooseCollectedMeaning, collectedMeaningsQuery, dismissCollectedMeanings, houseMeaningsQuery } from '~/lib/house-meaning.functions';
import { useT, type Key } from '~/lib/i18n';
import { whenText } from './HouseMeaning';
import '~/styles/house.css';

const ATTEST_KEY: Record<SavedMeaningRow['attestation'], Key> = {
  'well-attested': 'houses.meaning.attested', speculative: 'houses.meaning.speculative', family: 'houses.meaning.family',
};

type Saved = Record<string, SavedMeaning> | undefined;

export function CollectedMeanings({ tree, house, collected, aiOn, onResearch }: {
  tree: string;
  house: string;
  /** What the task found for this house. Undefined when there is nothing to choose from. */
  collected?: SavedMeaning;
  /** Whether the family's arms feature is on: the check follows the choice only then. */
  aiOn: boolean;
  onResearch: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [keys] = useState(() => opKeys());
  const failure = (e: unknown) => (e instanceof Error && e.message ? errorText(e, t.locale) : t('houses.collected.failed'));

  /** This house leaves the list of collections on the steward's screen. */
  const drop = () => qc.setQueryData(collectedMeaningsQuery(tree).queryKey, (old: Saved) => {
    if (!old) return old;
    const { [house]: _gone, ...rest } = old;
    return rest;
  });

  const check = useMutation({
    mutationFn: () => checkArmsFit({ data: { tree, house, opKey: keys.for('check', { house }), locale: toAiLocale(t.locale), force: false } }),
    onSuccess: () => {
      keys.clear('check');
      void qc.invalidateQueries({ queryKey: armsReviewsQuery(tree).queryKey });
    },
  });

  const choose = useMutation({
    mutationFn: (meaning: string) => chooseCollectedMeaning({ data: { tree, house, opKey: keys.for('choose', { house, meaning }), meaning } }),
    onSuccess: (saved) => {
      keys.clear('choose');
      qc.setQueryData(houseMeaningsQuery(tree).queryKey, (old: Saved) => ({ ...old, [saved.house]: saved }));
      drop();
      if (aiOn) check.mutate();
    },
  });

  const dismiss = useMutation({
    mutationFn: () => dismissCollectedMeanings({ data: { tree, house, opKey: keys.for('dismiss', { house }) } }),
    onSuccess: () => {
      keys.clear('dismiss');
      drop();
    },
  });

  if (!collected) {
    if (check.isPending) return <p className="subtle hm-after-choice" role="status">{t('houses.review.checking')}</p>;
    if (check.isError) return <p className="hp-error hm-after-choice" role="alert">{failure(check.error)}</p>;
    return null;
  }

  const busy = choose.isPending || dismiss.isPending;
  return (
    <section className="ui-card hm-review hm-collected" aria-labelledby="hm-collected-title" aria-busy={busy || undefined}>
      <h3 className="hp-eyebrow" id="hm-collected-title">{t('houses.collected.title')}</h3>
      <p className="hm-reason">{t('houses.collected.prompt', { name: collected.name })}</p>
      <ul className="hm-choices">
        {collected.meanings.map((m) => (
          <li key={m.id}>
            <button type="button" className="hm-choice" disabled={busy} onClick={() => choose.mutate(m.id)}>
              <span className="hm-choice-body">
                <span className="hm-head">
                  {m.root && <span className="hm-root">{m.root}</span>}
                  {m.language && <small className="hm-lang">{m.language}</small>}
                  <span className={`hm-badge ${m.attestation}`}>{t(ATTEST_KEY[m.attestation])}</span>
                </span>
                <span className="hm-meaning">{m.meaning}</span>
              </span>
              <span className="hm-choice-go">{t('houses.collected.choose')}</span>
            </button>
            {m.sources && m.sources.length > 0 && (
              <p className="hm-sources hm-choice-sources">
                <small>{t('houses.meaning.sources')}:</small>{' '}
                {m.sources.map((s, k) => (
                  <span key={s.url}>
                    {k > 0 && ', '}
                    <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title || s.url}</a>
                  </span>
                ))}
              </p>
            )}
          </li>
        ))}
      </ul>
      <p className="hm-basis subtle">
        {t(collected.webSearched ? 'houses.meaning.basisWeb' : 'houses.meaning.basisKnowledge')} {t('houses.collected.when', { when: whenText(collected.savedAt, t.locale) })}
      </p>
      {collected.note && <p className="hm-basis subtle">{collected.note}</p>}
      <div className="hm-review-actions">
        <button type="button" className="hm-link" onClick={onResearch} aria-haspopup="dialog"><Sparkles size={14} aria-hidden /> {t('houses.collected.more')}</button>
        <button type="button" className="btn" disabled={busy} onClick={() => dismiss.mutate()}><X size={16} aria-hidden /> {t('houses.collected.dismiss')}</button>
      </div>
      {(choose.isError || dismiss.isError) && !busy && <p className="hp-error" role="alert">{failure(choose.error ?? dismiss.error)}</p>}
    </section>
  );
}
