// The suggestions the steward asked for from the check card ("Suggest new arms from this"), shown on the designer's name tab:
// refinements of the arms as they are (what the check asks for, added), and fresh designs drawn from the chosen meanings.
// Choosing one loads it into the editor; nothing is saved until the arms are sealed. The loading and error states are the
// research flow's own.
import { Sparkles } from 'lucide-react';
import { errorText } from '~/lib/errortext';
import type { ArmsFeedback, ArmsRevision } from '~/lib/ai/types';
import type { ArmsV2 } from '~/lib/seed-format';
import { useT } from '~/lib/i18n';
import { play } from '~/lib/sfx';
import { ErrorState, Skeleton } from '../ui';
import { blazonV2 } from './blazon';
import { chargeName } from './registry';
import { ArmsV2View } from './render';

export function ArmsRevisions({ feedback, busy, error, revisions, onPick, onRetry }: {
  /** The check's reason and what to change: the suggestions answer them. */
  feedback: ArmsFeedback;
  busy: boolean;
  error?: unknown;
  revisions?: ArmsRevision[] | null;
  onPick: (arms: ArmsV2) => void;
  onRetry: () => void;
}) {
  const t = useT();
  const failure = error instanceof Error && error.message && !/^[[{]/.test(error.message) ? errorText(error, t.locale) : t('heraldry.revise_failed_text');
  return (
    <section className="ae-revise" aria-label={t('heraldry.revise_title')} aria-busy={busy || undefined}>
      <h3 className="ae-research-title"><Sparkles size={15} aria-hidden /> {t('heraldry.revise_title')}</h3>
      <p className="subtle ae-lead">{t('heraldry.revise_lead')}</p>
      {feedback.advice && <p className="subtle ae-basis">{t('heraldry.revise_asks', { advice: feedback.advice })}</p>}

      {busy && (
        <div className="ae-research-busy" role="status">
          <p className="subtle">{t('heraldry.revising')}</p>
          <Skeleton lines={3} />
        </div>
      )}

      {error !== undefined && !busy && (
        <ErrorState title={t('heraldry.revise_failed')} message={failure} onRetry={onRetry} />
      )}

      {revisions && !busy && (
        <div className="ae-gallery ae-gallery-wide">
          {revisions.map((d, i) => (
            <button key={i} type="button" className="ae-card ae-card-wide ae-revision" onClick={() => { onPick(structuredClone(d.arms)); play('tick'); }}>
              <ArmsV2View arms={d.arms} size={72} />
              <span className="ae-card-text">
                <span className={`ae-kind ${d.kind}`}>{t(d.kind === 'refinement' ? 'heraldry.revise_refinement' : 'heraldry.revise_fresh')}</span>
                {d.replaced?.map((r) => (
                  <small key={r.from} className="ae-design-draws">{t('heraldry.revise_replaces', { from: chargeName(r.from, t.locale), to: chargeName(r.to, t.locale) })}</small>
                ))}
                {d.added && d.added.length > 0 && (
                  <small className="ae-design-draws">{t('heraldry.revise_adds', { what: d.added.map((id) => chargeName(id, t.locale)).join(', ') })}</small>
                )}
                <small className="ae-design-draws">{t('heraldry.design_draws', { meaning: d.meaning })}</small>
                <span className="ae-card-title">{d.explanation}</span>
                {d.symbolism && d.symbolism.length > 0 && (
                  <span className="ae-symbolism">
                    <small className="subtle">{t('heraldry.means.ai_title')}</small>
                    {d.symbolism.slice(0, 3).map((s, k) => (
                      <span key={k}><b>{s.element}</b> {s.why}</span>
                    ))}
                  </span>
                )}
                <small>{blazonV2(d.arms, t.locale)}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
