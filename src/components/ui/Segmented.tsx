// Segmented: a row of mutually exclusive choices, for two to four options such as sex or how much of a date is known.
// A radio group: focus stays on the selected choice, ←/→ (and ↑/↓) move and choose, Home/End jump to the ends.
//
// Usage:
//   <Segmented aria-label="Sex" value={sex} onChange={setSex}
//     options={[{ value: '', label: 'Unknown' }, { value: 'f', label: 'Female' }, { value: 'm', label: 'Male' }]} />
import { useId, type KeyboardEvent, type ReactNode, useRef } from 'react';
import './segmented.css';

export interface SegmentedOption<V extends string = string> {
  value: V;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SegmentedProps<V extends string = string> {
  value: V;
  onChange: (value: V) => void;
  options: readonly SegmentedOption<V>[];
  'aria-label'?: string;
  'aria-labelledby'?: string;
  size?: 'sm' | 'md';
  /** Stretch to the width of the field. */
  block?: boolean;
  className?: string;
}

export function Segmented<V extends string = string>({
  value, onChange, options, size = 'md', block = false, className = '', ...aria
}: SegmentedProps<V>) {
  const uid = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
  const choose = (i: number) => {
    const opt = options[i];
    onChange(opt.value);
    refs.current[i]?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = enabled.indexOf(options.findIndex((o) => o.value === value));
    let next: number | undefined;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = enabled[(at + 1) % enabled.length];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = enabled[(at - 1 + enabled.length) % enabled.length];
    else if (e.key === 'Home') next = enabled[0];
    else if (e.key === 'End') next = enabled[enabled.length - 1];
    if (next === undefined) return;
    e.preventDefault();
    choose(next);
  };
  return (
    <div
      role="radiogroup"
      className={`ui-seg ${size === 'sm' ? 'sm' : ''} ${block ? 'block' : ''} ${className}`}
      onKeyDown={onKey}
      {...aria}
    >
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value || '_'}
            ref={(el) => { refs.current[i] = el; }}
            id={`${uid}-${i}`}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected || (!options.some((x) => x.value === value && !x.disabled) && i === enabled[0]) ? 0 : -1}
            disabled={o.disabled}
            className="ui-seg-item"
            onClick={() => onChange(o.value)}
          >
            {o.icon}
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
