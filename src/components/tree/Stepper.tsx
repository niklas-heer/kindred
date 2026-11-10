import { Minus, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { useT, type Key } from '~/lib/i18n';

/** A count with − and +. `full`: a row of the Display sheet, with its whole name and touch-sized buttons. */
export function Stepper({ label, long, icon, value, onChange, full }: { label: Key; long: Key; icon: ReactNode; value: number; onChange: (v: number) => void; full?: boolean }) {
  const t = useT();
  return (
    <span className={`stepper${full ? ' full' : ''}`} role="group" aria-label={t(long)} title={full ? undefined : t(long)}>
      <span className={full ? 'tb-label' : 'faint tb-label'}>{t(full ? long : label)}</span>
      {!full && <span className="tb-icon faint" aria-hidden>{icon}</span>}
      <button className="btn icon" onClick={() => onChange(Math.max(1, value - 1))} disabled={value <= 1} aria-label={t('tp.fewer', { what: t(long) })}><Minus size={13} /></button>
      <b aria-live="polite">{value}</b>
      <button className="btn icon" onClick={() => onChange(Math.min(12, value + 1))} disabled={value >= 12} aria-label={t('tp.more', { what: t(long) })}><Plus size={13} /></button>
    </span>
  );
}
