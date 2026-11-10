// What a house's name means, and the steward's view of whether its arms still fit it. The meaning section is for every reader
// (the family's own words, the meanings the steward chose, their sources and an honest line on what was checked). The review
// card and the badges are for stewards only: a viewer or an editor gets no query for them, and the server refuses them too.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Check, ChevronDown, PenLine, Quote, RefreshCw, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useAiStatus } from './assistant/store';
import { checkArmsFit } from '~/lib/ai/arms-fit.functions';
import { toAiLocale } from '~/lib/ai/types';
import { opKeys } from '~/lib/api';
import { errorText } from '~/lib/errortext';
import { useFamily } from '~/lib/family';
import {
  chosenMeanings, generatedArms, needsAttention, reviewBadge, type ArmsReview, type FitVerdict, type ReviewBadge, type SavedMeaning,
} from '~/lib/house-meaning';
import { armsReviewsQuery, collectedMeaningsQuery, dismissArmsReview, houseMeaningsQuery, houseTranslationsQuery, saveHouseMeaning } from '~/lib/house-meaning.functions';
import { translateReview, translateSaved } from '~/lib/house-translation';
import { dateText, locales, useT, type Key } from '~/lib/i18n';
import type { SavedMeaningRow } from '~/lib/house-meaning';
import { useCan } from '~/lib/session';
import type { House } from '~/lib/types';
import '~/styles/house.css';

const ATTEST_KEY = { 'well-attested': 'houses.meaning.attested', speculative: 'houses.meaning.speculative', family: 'houses.meaning.family' } as const satisfies Record<string, Key>;
const VERDICT_KEY: Record<FitVerdict, Key> = { fits: 'houses.review.fits', partly: 'houses.review.partly', reconsider: 'houses.review.reconsider' };
const BADGE_KEY: Record<ReviewBadge, Key> = { 'arms-review': 'houses.review.arms', 'meanings-collected': 'houses.review.collected', 'name-unresearched': 'houses.review.name', 'generated-arms': 'houses.review.generated' };

/** A date for the reader, in their language. */
export const whenText = (ms: number, locale: keyof typeof locales) =>
  dateText(ms, locale, { day: 'numeric', month: 'short', year: 'numeric' });

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
  const collectedQ = useQuery({ ...collectedMeaningsQuery(tree), enabled: canEdit });
  const status = useAiStatus(tree);
  const aiOn = !!status?.features.arms;
  const ready = meaningsQ.isSuccess && (!canEdit || (reviewsQ.isSuccess && collectedQ.isSuccess && status !== undefined));
  const badges: Record<string, ReviewBadge> = {};
  if (canEdit && ready) {
    for (const h of f.graph.houses) {
      const badge = reviewBadge({
        aiOn,
        researched: !!meaningsQ.data?.[h.id],
        collected: !!collectedQ.data?.[h.id],
        generated: generatedArms(h.arms),
        review: reviewsQ.data?.[h.id],
      });
      if (badge) badges[h.id] = badge;
    }
  }
  return { canEdit, ready, badges, count: Object.keys(badges).length, meanings: meaningsQ.data };
}

/** One origin as the house and the pickers show it: where the root comes from, what it means, how sure that is, and the sources. */
export function OriginBody({ m }: { m: SavedMeaningRow }) {
  const t = useT();
  return (
    <>
      <span className="hm-head">
        {m.root && <span className="hm-root">{m.root}</span>}
        {m.language && <small className="hm-lang">{m.language}</small>}
        <span className={`hm-badge ${m.attestation}`}>{t(ATTEST_KEY[m.attestation])}</span>
      </span>
      <span className="hm-meaning">{m.meaning}</span>
    </>
  );
}

export function OriginSources({ m, className = 'hm-sources' }: { m: SavedMeaningRow; className?: string }) {
  const t = useT();
  if (!m.sources || m.sources.length === 0) return null;
  return (
    <p className={className}>
      <small>{t('houses.meaning.sources')}:</small>{' '}
      {m.sources.map((s, k) => (
        <span key={s.url}>
          {k > 0 && ', '}
          <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title || s.url}</a>
        </span>
      ))}
    </p>
  );
}

/** Several origins can be selected at once: each is a checkbox row, with its sources beneath. */
export function OriginPicker({ meanings, selected, onToggle, disabled, label }: {
  meanings: SavedMeaningRow[];
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <ul className="hm-choices" aria-label={label}>
      {meanings.map((m) => (
        <li key={m.id}>
          <label className={`hm-choice${selected.has(m.id) ? ' on' : ''}`}>
            <input type="checkbox" className="hm-check" checked={selected.has(m.id)} disabled={disabled} onChange={() => onToggle(m.id)} />
            <span className="hm-choice-body"><OriginBody m={m} /></span>
          </label>
          <OriginSources m={m} className="hm-sources hm-choice-sources" />
        </li>
      ))}
    </ul>
  );
}

/** How many origins show before "show more": a long list stays short on a phone. */
const ORIGINS_SHOWN = 3;

/**
 * The possible origins of a house's name, shown to everyone: every origin the steward selected, each as a possibility, not
 * one definite answer. A steward can change the selection here. Nothing is shown when nothing is saved, except the stewards'
 * link to research it.
 */
export function HouseMeaning({ tree, house, aiOn = false, saved, canEdit, onResearch }: {
  tree: string;
  house: string;
  aiOn?: boolean;
  saved?: SavedMeaning;
  canEdit: boolean;
  onResearch: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [keys] = useState(() => opKeys());
  const [all, setAll] = useState(false);
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const translations = useQuery(houseTranslationsQuery(tree, t.locale)).data;

  const save = useMutation({
    mutationFn: (body: NonNullable<typeof saved>) => saveHouseMeaning({
      data: {
        tree, house, opKey: keys.for('origins', body.meanings.map((m) => [m.id, m.chosen])),
        name: body.name, familyWords: body.familyWords, webSearched: body.webSearched, note: body.note,
        meanings: body.meanings.map(({ sources, ...m }) => ({ ...m, ...(sources && sources.length ? { sources } : {}) })),
      },
    }),
    onSuccess: (s) => {
      keys.clear();
      qc.setQueryData(houseMeaningsQuery(tree).queryKey, (old: Record<string, SavedMeaning> | undefined) => ({ ...old, [s.house]: s }));
      void qc.invalidateQueries({ queryKey: collectedMeaningsQuery(tree).queryKey });
      setEditing(false);
      // The selection changed, so the arms are checked against it again (the server skips a check it already has).
      if (aiOn) {
        void checkArmsFit({ data: { tree, house, opKey: opKeys().for('check', { house }), locale: toAiLocale(t.locale), force: false } })
          .catch(() => undefined)
          .finally(() => void qc.invalidateQueries({ queryKey: armsReviewsQuery(tree).queryKey }));
      }
    },
  });

  if (!saved) {
    if (!canEdit) return null;
    return (
      <p className="hm-quiet">
        <button type="button" className="hm-link" onClick={onResearch}><Sparkles size={14} aria-hidden /> {t('houses.meaning.research')}</button>
      </p>
    );
  }
  // What is shown is in the reader's language where a translation exists. What is saved below always comes from `saved`, the original.
  const shown = translateSaved(saved, translations?.meanings[house]);
  // The family's own words lead; the research's copy of them is not repeated in the list.
  const chosen = chosenMeanings(shown).filter((m) => !(m.attestation === 'family' && saved.familyWords && m.meaning === saved.familyWords));
  const guesses = chosen.some((m) => m.attestation === 'speculative');
  const visible = all ? chosen : chosen.slice(0, ORIGINS_SHOWN);
  const hidden = chosen.length - visible.length;
  const failure = (e: unknown) => (e instanceof Error && e.message ? errorText(e, t.locale) : t('houses.meaning.saveFailed'));
  const startEdit = () => { setPicked(new Set(chosenMeanings(saved).map((m) => m.id))); setEditing(true); };
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
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
          <h3 className="hm-chosen-title">{t(chosen.length > 1 ? 'houses.meaning.origins' : 'houses.meaning.origin')}</h3>
          {chosen.length > 1 && <p className="hm-basis subtle">{t('houses.meaning.possible', { count: chosen.length })}</p>}
          <ul className="hm-list">
            {visible.map((m) => (
              <li key={m.id} className="ui-card hm-item">
                <div className="hm-head">
                  {m.root && <span className="hm-root">{m.root}</span>}
                  {m.language && <small className="hm-lang">{m.language}</small>}
                  <span className={`hm-badge ${m.attestation}`}>{t(ATTEST_KEY[m.attestation])}</span>
                </div>
                <p className="hm-meaning">{m.meaning}</p>
                <OriginSources m={m} />
              </li>
            ))}
          </ul>
          {chosen.length > ORIGINS_SHOWN && (
            <p className="hm-quiet">
              <button type="button" className="hm-link" aria-expanded={all} onClick={() => setAll((v) => !v)}>
                <ChevronDown size={14} aria-hidden className={all ? 'hm-flip' : undefined} /> {t(all ? 'houses.meaning.showFewer' : 'houses.meaning.showMore', { count: hidden })}
              </button>
            </p>
          )}
        </>
      )}
      <p className="hm-basis subtle">{t(saved.webSearched ? 'houses.meaning.basisWeb' : 'houses.meaning.basisKnowledge')}</p>
      {guesses && <p className="hm-basis subtle">{t('houses.meaning.guessNote')}</p>}
      {shown.note && <p className="hm-basis subtle">{shown.note}</p>}
      {canEdit && editing && (
        <div className="ui-card hm-review hm-collected" aria-busy={save.isPending || undefined}>
          <p className="hm-reason">{t('houses.meaning.changePrompt')}</p>
          <OriginPicker
            meanings={shown.meanings}
            selected={picked}
            onToggle={toggle}
            disabled={save.isPending}
            label={t('houses.meaning.changeLabel')}
          />
          <div className="hm-review-actions">
            <button
              type="button"
              className="btn primary"
              disabled={picked.size === 0 || save.isPending}
              onClick={() => save.mutate({ ...saved, meanings: saved.meanings.map((m) => ({ ...m, chosen: picked.has(m.id) })) })}
            >
              <Check size={16} aria-hidden /> {t('houses.meaning.changeSave', { count: picked.size })}
            </button>
            <button type="button" className="btn" disabled={save.isPending} onClick={() => setEditing(false)}>{t('houses.meaning.changeCancel')}</button>
          </div>
          {save.isError && !save.isPending && <p className="hp-error" role="alert">{failure(save.error)}</p>}
        </div>
      )}
      {canEdit && !editing && (
        <p className="hm-quiet">
          {saved.meanings.length > 1 && (
            <button type="button" className="hm-link" onClick={startEdit}><PenLine size={14} aria-hidden /> {t('houses.meaning.change')}</button>
          )}
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
  const translations = useQuery(houseTranslationsQuery(tree, t.locale)).data;
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

  // Only a real problem asks anything of the steward. A "partly" is an idea they may ignore; a check that no longer matches the arms says nothing about them.
  const attention = needsAttention(review);
  const idea = review.current && review.verdict === 'partly' && !review.dismissed;
  const stale = !review.current;
  const chosen = review.chosen;
  const kept = review.dismissed && !chosen;
  // Shown in the reader's language; the buttons below hand the designer the original.
  const text = translateReview({ reason: review.reason, advice: review.advice }, translations?.reviews[house.id]);
  return (
    <section className="ui-card hm-review" data-verdict={stale ? undefined : chosen ? 'fits' : review.verdict} aria-labelledby="hm-review-title" aria-busy={check.isPending || keep.isPending || undefined}>
      <div className="hm-review-head">
        <h3 className="hp-eyebrow" id="hm-review-title">{t('houses.review.title')}</h3>
        {!stale && <span className={`hm-verdict ${chosen ? 'fits' : review.verdict}`}>{t(chosen ? 'houses.review.yours' : VERDICT_KEY[review.verdict])}</span>}
      </div>
      {chosen ? <p className="hm-reason">{t('houses.review.chosen')}</p> : !stale && <p className="hm-reason">{text.reason}</p>}
      {attention && review.advice && (
        <p className="hm-advice"><small>{t('houses.review.advice')}</small> {text.advice}</p>
      )}
      {idea && review.advice && (
        <p className="hm-advice"><small>{t('houses.review.idea')}</small> {text.advice}</p>
      )}
      {stale && <p className="hm-basis subtle">{t('houses.review.stale')}</p>}
      {kept && <p className="hm-basis subtle">{t('houses.review.kept')}</p>}
      {!stale && !chosen && <p className="hm-basis subtle">{t('houses.review.checked', { when: whenText(review.checkedAt, t.locale) })}</p>}
      <div className="hm-review-actions">
        {attention && aiOn && (
          <button type="button" className="btn primary" onClick={() => onDesigner('name', review)} aria-haspopup="dialog">
            <Sparkles size={16} aria-hidden /> {t('houses.review.revise')}
          </button>
        )}
        {attention && (
          <button type="button" className={aiOn ? 'btn' : 'btn primary'} onClick={() => onDesigner('design')} aria-haspopup="dialog">
            <PenLine size={16} aria-hidden /> {t('houses.review.open')}
          </button>
        )}
        {idea && aiOn && (
          <button type="button" className="btn ghost" onClick={() => onDesigner('name', review)} aria-haspopup="dialog">
            <Sparkles size={16} aria-hidden /> {t('houses.review.ideas')}
          </button>
        )}
        {aiOn && (
          <button type="button" className="btn" disabled={check.isPending} onClick={() => check.mutate(true)}>
            <RefreshCw size={16} aria-hidden /> {t('houses.review.again')}
          </button>
        )}
        {attention && (
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
  // When every house waits for the same thing, the label is said once and not on every card.
  const shared = list.every((h) => badges[h.id] === badges[list[0].id]) ? badges[list[0].id] : null;
  return (
    <section className="hm-needed" aria-labelledby="hm-needed-title">
      <h2 className="rule" id="hm-needed-title">{t('houses.review.neededTitle')} <span className="subtle hs-num">{list.length}</span></h2>
      <div className="hm-needed-intro">
        <p className="subtle">{t('houses.review.neededText')}</p>
        {shared && <ReviewBadgeChip badge={shared} />}
      </div>
      <ul className="hm-needed-list">
        {list.map((h) => (
          <li key={h.id}>
            <Link to="/$tree/house/$house" params={{ tree, house: h.id }} className="ui-card interactive hm-needed-item">
              <b>{h.name}</b>
              {!shared && <ReviewBadgeChip badge={badges[h.id]} />}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
