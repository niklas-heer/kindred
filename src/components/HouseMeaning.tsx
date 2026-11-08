// What a house's name means, and the steward's view of whether its arms still fit it. The meaning section is for every reader
// (the family's own words, the meanings the steward chose, their sources and an honest line on what was checked). The review
// card and the badges are for stewards only: a viewer or an editor gets no query for them, and the server refuses them too.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Check, PenLine, Quote, RefreshCw, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useAiStatus } from './assistant/store';
import { checkArmsFit } from '~/lib/ai/arms-fit.functions';
import { toAiLocale } from '~/lib/ai/types';
import { opKeys } from '~/lib/api';
import { errorText } from '~/lib/errortext';
import { useFamily } from '~/lib/family';
import {
  chosenMeanings, generatedArms, reviewBadge, type ArmsReview, type FitVerdict, type ReviewBadge, type SavedMeaning,
} from '~/lib/house-meaning';
import { armsReviewsQuery, dismissArmsReview, houseMeaningsQuery } from '~/lib/house-meaning.functions';
import { locales, useT, type Key } from '~/lib/i18n';
import { useCan } from '~/lib/session';
import type { House } from '~/lib/types';
import '~/styles/house.css';

const ATTEST_KEY = { 'well-attested': 'houses.meaning.attested', speculative: 'houses.meaning.speculative', family: 'houses.meaning.family' } as const satisfies Record<string, Key>;
const VERDICT_KEY: Record<FitVerdict, Key> = { fits: 'houses.review.fits', partly: 'houses.review.partly', reconsider: 'houses.review.reconsider' };
const BADGE_KEY: Record<ReviewBadge, Key> = { 'arms-review': 'houses.review.arms', 'name-unresearched': 'houses.review.name', 'generated-arms': 'houses.review.generated' };

/** A date for the reader, in their language. */
export const whenText = (ms: number, locale: keyof typeof locales) =>
  new Date(ms).toLocaleDateString(locales[locale], { day: 'numeric', month: 'short', year: 'numeric' });

/** The one badge a steward sees on a house, in the list and on the house page. */
export function ReviewBadgeChip({ badge }: { badge: ReviewBadge }) {
  const t = useT();
  return <span className={`hm-badge-chip ${badge}`}>{t(BADGE_KEY[badge])}</span>;
}

/**
 * Every house's meaning for every reader, and, for stewards only, each house's review and badge. The review and the
 * badges wait until both have loaded, so a steward does not see a badge that a loaded review would take away.
 */
export function useStewardBadges(tree: string) {
  const f = useFamily();
  const canEdit = useCan('edit-house');
  const meaningsQ = useQuery(houseMeaningsQuery(tree));
  const reviewsQ = useQuery({ ...armsReviewsQuery(tree), enabled: canEdit });
  const status = useAiStatus(tree);
  const aiOn = !!status?.features.arms;
  const ready = meaningsQ.isSuccess && (!canEdit || (reviewsQ.isSuccess && status !== undefined));
  const badges: Record<string, ReviewBadge> = {};
  if (canEdit && ready) {
    for (const h of f.graph.houses) {
      const badge = reviewBadge({
        aiOn,
        researched: !!meaningsQ.data?.[h.id],
        generated: generatedArms(h.arms),
        review: reviewsQ.data?.[h.id],
      });
      if (badge) badges[h.id] = badge;
    }
  }
  return { canEdit, ready, badges, count: Object.keys(badges).length, meanings: meaningsQ.data };
}

/** The meaning of a house's name, shown to everyone. Nothing is shown when it is not saved, except the stewards' link to research it. */
export function HouseMeaning({ saved, canEdit, onResearch }: { saved?: SavedMeaning; canEdit: boolean; onResearch: () => void }) {
  const t = useT();
  if (!saved) {
    if (!canEdit) return null;
    return (
      <p className="hm-quiet">
        <button type="button" className="hm-link" onClick={onResearch}><Sparkles size={14} aria-hidden /> {t('houses.meaning.research')}</button>
      </p>
    );
  }
  // The family's own words lead; the research's copy of them is not repeated in the list.
  const chosen = chosenMeanings(saved).filter((m) => !(m.attestation === 'family' && saved.familyWords && m.meaning === saved.familyWords));
  const guesses = chosen.some((m) => m.attestation === 'speculative');
  return (
    <section className="hm" aria-labelledby="hm-title">
      <h2 className="rule" id="hm-title">{t('houses.meaning.title')}</h2>
      {saved.familyWords && (
        <figure className="hm-family">
          <Quote size={18} aria-hidden />
          <figcaption><small>{t('houses.meaning.familyWords')}</small></figcaption>
          <blockquote>{saved.familyWords}</blockquote>
        </figure>
      )}
      {chosen.length > 0 && (
        <>
          <h3 className="hm-chosen-title">{t('houses.meaning.chosen')}</h3>
          <ul className="hm-list">
            {chosen.map((m) => (
              <li key={m.id} className="ui-card hm-item">
                <div className="hm-head">
                  {m.root && <span className="hm-root">{m.root}</span>}
                  {m.language && <small className="hm-lang">{m.language}</small>}
                  <span className={`hm-badge ${m.attestation}`}>{t(ATTEST_KEY[m.attestation])}</span>
                </div>
                <p className="hm-meaning">{m.meaning}</p>
                {m.sources && m.sources.length > 0 && (
                  <p className="hm-sources">
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
        </>
      )}
      <p className="hm-basis subtle">{t(saved.webSearched ? 'houses.meaning.basisWeb' : 'houses.meaning.basisKnowledge')}</p>
      {guesses && <p className="hm-basis subtle">{t('houses.meaning.guessNote')}</p>}
      {saved.note && <p className="hm-basis subtle">{saved.note}</p>}
      {canEdit && (
        <p className="hm-quiet">
          <button type="button" className="hm-link" onClick={onResearch}><Sparkles size={14} aria-hidden /> {t('houses.meaning.researchAgain')}</button>
          <small className="subtle"> · {t('houses.meaning.savedWhen', { when: whenText(saved.savedAt, t.locale) })}</small>
        </p>
      )}
    </section>
  );
}

/**
 * The steward's card: whether the arms fit the saved meaning, why, and what to change. "Open the arms designer" goes to the
 * designer's design tab, where the arms are changed. Keeping the arms dismisses the review until either changes.
 */
export function ArmsReviewCard({ tree, house, review, aiOn, onDesigner }: {
  tree: string;
  house: House;
  /** The latest check, or none yet. */
  review?: ArmsReview;
  /** Whether the family's arms feature is on: a check is only offered then. */
  aiOn: boolean;
  /** Opens the designer on a tab. With `revise`, the designer also asks for suggestions from this check, on that one click. */
  onDesigner: (tab: 'design' | 'name', revise?: ArmsReview) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [keys] = useState(() => opKeys());
  const refresh = () => { keys.clear(); void qc.invalidateQueries({ queryKey: armsReviewsQuery(tree).queryKey }); };
  const check = useMutation({
    mutationFn: (force: boolean) => checkArmsFit({
      data: { tree, house: house.id, opKey: keys.for(force ? 'check-again' : 'check', { house: house.id, force }), locale: toAiLocale(t.locale), force },
    }),
    onSuccess: refresh,
  });
  const keep = useMutation({
    mutationFn: () => dismissArmsReview({ data: { tree, house: house.id, opKey: keys.for('keep', { house: house.id }) } }),
    onSuccess: refresh,
  });
  const failure = (e: unknown, fallback: string) => (e instanceof Error && e.message ? errorText(e, t.locale) : fallback);

  if (!review) {
    return (
      <section className="ui-card hm-review" aria-labelledby="hm-review-title">
        <h3 className="hp-eyebrow" id="hm-review-title">{t('houses.review.title')}</h3>
        <p className="hm-reason">{t('houses.review.lead')}</p>
        <div className="hm-review-actions">
          <button type="button" className="btn primary" disabled={check.isPending} onClick={() => check.mutate(false)}>
            <Check size={16} aria-hidden /> {t('houses.review.check')}
          </button>
        </div>
        {check.isPending && <p className="subtle" role="status">{t('houses.review.checking')}</p>}
        {check.isError && !check.isPending && <p className="hp-error" role="alert">{failure(check.error, t('houses.review.failed'))}</p>}
      </section>
    );
  }

  const bad = review.verdict !== 'fits';
  const kept = review.dismissed;
  // New arms are suggested from this check's reason and advice, so they are offered only while the check is current.
  const suggest = bad && aiOn && review.current;
  return (
    <section className="ui-card hm-review" data-verdict={review.verdict} aria-labelledby="hm-review-title" aria-busy={check.isPending || keep.isPending || undefined}>
      <div className="hm-review-head">
        <h3 className="hp-eyebrow" id="hm-review-title">{t('houses.review.title')}</h3>
        <span className={`hm-verdict ${review.verdict}`}>{t(VERDICT_KEY[review.verdict])}</span>
      </div>
      <p className="hm-reason">{review.reason}</p>
      {bad && review.advice && (
        <p className="hm-advice"><small>{t('houses.review.advice')}</small> {review.advice}</p>
      )}
      {!review.current && <p className="hm-basis subtle">{t('houses.review.stale')}</p>}
      {kept && <p className="hm-basis subtle">{t('houses.review.kept')}</p>}
      <p className="hm-basis subtle">{t('houses.review.checked', { when: whenText(review.checkedAt, t.locale) })}</p>
      <div className="hm-review-actions">
        {suggest && (
          <button type="button" className="btn primary" onClick={() => onDesigner('name', review)} aria-haspopup="dialog">
            <Sparkles size={16} aria-hidden /> {t('houses.review.revise')}
          </button>
        )}
        {bad && (
          <button type="button" className={suggest ? 'btn' : 'btn primary'} onClick={() => onDesigner('design')} aria-haspopup="dialog">
            <PenLine size={16} aria-hidden /> {t('houses.review.open')}
          </button>
        )}
        {aiOn && (
          <button type="button" className="btn" disabled={check.isPending} onClick={() => check.mutate(true)}>
            <RefreshCw size={16} aria-hidden /> {t('houses.review.again')}
          </button>
        )}
        {bad && review.current && !kept && (
          <button type="button" className="btn" disabled={keep.isPending} onClick={() => keep.mutate()}>
            {t('houses.review.keep')}
          </button>
        )}
      </div>
      {check.isPending && <p className="subtle" role="status">{t('houses.review.checking')}</p>}
      {check.isError && !check.isPending && <p className="hp-error" role="alert">{failure(check.error, t('houses.review.failed'))}</p>}
      {keep.isError && !keep.isPending && <p className="hp-error" role="alert">{failure(keep.error, t('houses.review.failed'))}</p>}
    </section>
  );
}

/** The Information needed page's section for stewards: the houses with a badge, each linked to its page. Nothing when there are none. */
export function HousesToReview({ tree }: { tree: string }) {
  const t = useT();
  const f = useFamily();
  const { canEdit, ready, badges } = useStewardBadges(tree);
  const list = canEdit && ready ? f.graph.houses.filter((h) => badges[h.id]) : [];
  if (list.length === 0) return null;
  return (
    <section className="hm-needed" aria-labelledby="hm-needed-title">
      <h2 className="rule" id="hm-needed-title">{t('houses.review.neededTitle')} <span className="subtle hs-num">{list.length}</span></h2>
      <p className="subtle">{t('houses.review.neededText')}</p>
      <ul className="hm-needed-list">
        {list.map((h) => (
          <li key={h.id}>
            <Link to="/$tree/house/$house" params={{ tree, house: h.id }} className="ui-card interactive hm-needed-item">
              <b>{h.name}</b>
              <ReviewBadgeChip badge={badges[h.id]} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
