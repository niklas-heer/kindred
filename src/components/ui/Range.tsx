// Range: a styled slider on <input type="range">, so arrows, PageUp/PageDown and Home/End work natively.
// A gold thumb and gilded track in Codex.
//
// Usage:
//   <Range value={speed} onChange={setSpeed} min={0.5} max={4} step={0.5}
//     ticks={[{ value: 0.5, label: '½×' }, { value: 1, label: '1×' }, { value: 4, label: '4×' }]}
//     aria-label="Replay speed" format={(v) => `${v} times`} />
//   <Range value={year} onChange={setYear} min={880} max={1210} ticks={5} />   // 5 evenly spaced, labelled ticks
import { useId, type CSSProperties } from 'react';
import './ui.css';

export type RangeTick = number | { value: number; label?: string };

export interface RangeProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Tick marks under the track: explicit values (with optional labels), or a count of evenly spaced labelled ticks. */
  ticks?: readonly RangeTick[] | number;
  /** Spoken value (aria-valuetext), and the label of evenly spaced ticks. */
  format?: (value: number) => string;
  disabled?: boolean;
  id?: string;
  name?: string;
  title?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  className?: string;
  style?: CSSProperties;
  /** Fires on release or key press, for expensive work; `onChange` fires on every move. */
  onCommit?: (value: number) => void;
}

export function Range({ value, onChange, min = 0, max = 100, step = 1, ticks, format, disabled, id, name, title, className = '', style, onCommit, ...aria }: RangeProps) {
  const auto = useId();
  const pct = max > min ? ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100 : 0;
  const list: { value: number; label?: string }[] =
    typeof ticks === 'number'
      ? Array.from({ length: Math.max(2, ticks) }, (_, i) => {
          const v = min + ((max - min) * i) / (Math.max(2, ticks) - 1);
          const r = Math.round(v / step) * step;
          return { value: r, label: format ? format(r) : String(r) };
        })
      : (ticks ?? []).map((t) => (typeof t === 'number' ? { value: t } : t));
  return (
    <div className={`ui-range ${className}`} style={{ ['--pct' as string]: `${pct}%`, ...style }}>
      <input
        id={id ?? auto}
        type="range"
        name={name}
        title={title}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={format?.(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
        {...aria}
      />
      {list.length > 0 && (
        <div className="ui-range-ticks" aria-hidden>
          {list.map((t) => (
            <span key={t.value} style={{ left: `${max > min ? ((t.value - min) / (max - min)) * 100 : 0}%` }}>{t.label}</span>
          ))}
        </div>
      )}
    </div>
  );
}
