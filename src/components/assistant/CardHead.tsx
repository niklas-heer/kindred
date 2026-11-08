// The top line of a proposal card: what kind of change it is, and its state (waiting for the reader, saved, or dismissed).
// Shared by the single-change cards and the family draft, so every card reads the same.
import { Check } from 'lucide-react';
import { useT } from '~/lib/i18n';

export type CardState = 'open' | 'done' | 'dismissed';

export function CardHead({ kind, state }: { kind: string; state: CardState }) {
  const t = useT();
  const label = state === 'open' ? t('ai.stateWaiting') : state === 'done' ? t('ai.done') : t('ai.dismissed');
  return (
    <div className="ai-card-head">
      <p className="ai-card-kind">{kind}</p>
      <span className={`ai-card-pill ai-card-pill-${state}`}>
        {state === 'done' && <Check size={12} aria-hidden />}
        {label}
      </span>
    </div>
  );
}
