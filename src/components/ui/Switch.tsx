// Switch: an on/off toggle that replaces checkboxes. A <button role="switch">, so Space and Enter work.
//
// Usage:
//   <Switch checked={living} onChange={setLiving}>Still living</Switch>
//   <Switch checked={on} onChange={setOn} aria-label="Sound" />      // no visible label
//
// With children it renders a <label>-like row (click anywhere on it). `name` adds a hidden input
// ("on" or empty) so it submits with a native form.
import { useId, type ReactNode } from 'react';
import './ui.css';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The visible label, placed after the switch. */
  children?: ReactNode;
  /** Put the label before the switch instead. */
  labelFirst?: boolean;
  disabled?: boolean;
  id?: string;
  name?: string;
  title?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  size?: 'sm' | 'md';
  className?: string;
}

export function Switch({ checked, onChange, children, labelFirst, disabled, id, name, title, size = 'md', className = '', ...aria }: SwitchProps) {
  const auto = useId();
  const sid = id ?? auto;
  const control = (
    <button
      id={sid}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={children ? `${sid}-l` : undefined}
      disabled={disabled}
      title={title}
      className={`ui-switch ${size === 'sm' ? 'sm' : ''} ${children ? '' : className}`}
      onClick={() => onChange(!checked)}
      {...aria}
    />
  );
  const hidden = name !== undefined ? <input type="hidden" name={name} value={checked ? 'on' : ''} /> : null;
  if (!children) return <>{control}{hidden}</>;
  const text = <span id={`${sid}-l`} onClick={() => !disabled && onChange(!checked)}>{children}</span>;
  return (
    <span className={`ui-switch-wrap ${className}`} data-disabled={disabled || undefined}>
      {labelFirst ? <>{text}{control}</> : <>{control}{text}</>}
      {hidden}
    </span>
  );
}
