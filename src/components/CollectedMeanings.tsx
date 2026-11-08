// What the background task collected for a house's name, on the house page, for stewards only. One prompt: choose the origin
// or those that fit. Several can be selected and confirmed with one action, and only then the existing check of the arms follows. The component stays mounted after
// the choice, so the check that follows can say what it is doing. Other readers get nothing from here: the collection is not
// in what they can read, and this component is only rendered for those who may edit the house.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { checkArmsFit } from '~/lib/ai/arms-fit.functions';
import { toAiLocale } from '~/lib/ai/types';
import { opKeys } from '~/lib/api';
import { errorText } from '~/lib/errortext';
import type { SavedMeaning } from '~/lib/house-meaning';
import { armsReviewsQuery, chooseCollectedMeaning, collectedMeaningsQuery, dismissCollectedMeanings, houseMeaningsQuery } from '~/lib/house-meaning.functions';
import { useT } from '~/lib/i18n';
import { OriginPicker, whenText } from './HouseMeaning';
import '~/styles/house.css';

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
  /** The origins ticked so far; with a single collected meaning it is ticked already, so choosing it stays one click. */
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const selected = picked ?? new Set(collected && collected.meanings.length === 1 ? [collected.meanings[0].id] : []);
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p ?? selected); if (n.has(id)) n.delete(id); else n.add(id); return n; });
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
    mutationFn: (meanings: string[]) => chooseCollectedMeaning({ data: { tree, house, opKey: keys.for('choose', { house, meanings }), meanings } }),
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
      <OriginPicker meanings={collected.meanings} selected={selected} onToggle={toggle} disabled={busy} label={t('houses.collected.title')} />
      <p className="hm-basis subtle">
        {t(collected.webSearched ? 'houses.meaning.basisWeb' : 'houses.meaning.basisKnowledge')} {t('houses.collected.when', { when: whenText(collected.savedAt, t.locale) })}
      </p>
      {collected.note && <p className="hm-basis subtle">{collected.note}</p>}
      <div className="hm-review-actions">
        <button type="button" className="btn primary" disabled={busy || selected.size === 0} onClick={() => choose.mutate(collected.meanings.filter((m) => selected.has(m.id)).map((m) => m.id))}>
          <Check size={16} aria-hidden /> {t('houses.collected.confirm', { count: selected.size })}
        </button>
        <button type="button" className="hm-link" onClick={onResearch} aria-haspopup="dialog"><Sparkles size={14} aria-hidden /> {t('houses.collected.more')}</button>
        <button type="button" className="btn" disabled={busy} onClick={() => dismiss.mutate()}><X size={16} aria-hidden /> {t('houses.collected.dismiss')}</button>
      </div>
      {(choose.isError || dismiss.isError) && !busy && <p className="hp-error" role="alert">{failure(choose.error ?? dismiss.error)}</p>}
    </section>
  );
}
