// Select: a popover listbox in the palette's style, replacing <select>. The WAI-ARIA "select-only
// combobox": focus stays on the button, the active option is announced via aria-activedescendant.
//
// Usage:
//   <Select value={house} onChange={setHouse} aria-label="House"
//     options={houses.map((h) => ({ value: h.id, label: h.name, hint: String(n), icon: <Arms arms={h.arms} size={18} /> }))} />
//
// Keys: ↓/↑/Enter/Space open; ↑/↓, Home/End, PageUp/PageDown move; typing jumps to a match (type-ahead,
// also while closed); Enter/Space choose; Escape or Tab close. Opening registers an overlay layer, so
// page hotkeys stand aside and Escape closes only the popover.
import { Check, ChevronDown } from 'lucide-react';
import {
  useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type KeyboardEvent, type ReactNode,
} from 'react';
import { isTopOverlay, useOverlayLayer } from './overlay';
import './ui.css';

export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
  /** Shown before the label, e.g. a house shield. */
  icon?: ReactNode;
  /** Right-aligned and muted, e.g. a count. */
  hint?: ReactNode;
  disabled?: boolean;
  /** Options with the same group are listed under that heading (keep them adjacent). */
  group?: string;
}

export interface SelectProps<V extends string = string> {
  value: V;
  onChange: (value: V) => void;
  options: readonly SelectOption<V>[];
  /** Shown when `value` matches no option. */
  placeholder?: string;
  disabled?: boolean;
  /** Renders a hidden input, so it submits with a native form. */
  name?: string;
  id?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  title?: string;
  /** `sm` matches the 28px toolbar buttons. */
  size?: 'sm' | 'md';
  className?: string;
  style?: CSSProperties;
  /** Minimum popover width; defaults to the button's width. */
  menuWidth?: number;
}

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function Select<V extends string = string>({
  value, onChange, options, placeholder = 'Choose…', disabled, name, id, title, size = 'md', className = '', style, menuWidth,
  ...aria
}: SelectProps<V>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const layer = useOverlayLayer(open);
  const base = useId();
  const optId = (i: number) => `${base}-o${i}`;
  const typed = useRef({ text: '', at: 0 });

  const selectedIndex = useMemo(() => options.findIndex((o) => o.value === value), [options, value]);
  const current = options[selectedIndex];
  const enabled = (i: number) => i >= 0 && i < options.length && !options[i].disabled;

  const step = (from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i < options.length; i += dir) if (enabled(i)) return i;
    return from;
  };
  const firstEnabled = () => step(-1, 1);
  const lastEnabled = () => step(options.length, -1);

  const place = useCallback(() => {
    const b = button.current?.getBoundingClientRect();
    if (!b) return;
    const below = innerHeight - b.bottom - 8;
    const above = b.top - 8;
    const want = Math.min(340, innerHeight * 0.5);
    const up = below < Math.min(want, 200) && above > below;
    const maxHeight = Math.max(120, Math.min(want, up ? above - 4 : below - 4));
    const width = Math.max(b.width, menuWidth ?? 0);
    const left = Math.max(8, Math.min(b.left, innerWidth - width - 8));
    const h = Math.min(maxHeight, pop.current?.scrollHeight ?? maxHeight);
    setPos({ top: up ? b.top - 4 - h : b.bottom + 4, left, width, maxHeight });
  }, [menuWidth]);

  const show = (at = selectedIndex >= 0 ? selectedIndex : firstEnabled()) => {
    if (disabled) return;
    setActive(at);
    setOpen(true);
  };
  const hide = (refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus({ preventScroll: true });
  };
  const choose = (i: number) => {
    if (!enabled(i)) return;
    if (options[i].value !== value) onChange(options[i].value);
    hide();
  };

  // Show in the top layer, so dialogs, transforms and overflow never clip it.
  useLayoutEffect(() => {
    const el = pop.current;
    if (!open || !el) return;
    try { if (!el.matches(':popover-open')) el.showPopover(); } catch {}
    place();
    return () => { try { el.hidePopover(); } catch {} };
  }, [open, place]);
  // Re-measure once the options have rendered, and keep up with scrolling and resizing.
  useLayoutEffect(() => { if (open) place(); }, [open, options.length, place]);
  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => { if (!pop.current?.contains(e.target as Node)) place(); };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !button.current?.contains(t)) hide(false);
    };
    addEventListener('scroll', onScroll, true);
    addEventListener('resize', place);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      removeEventListener('scroll', onScroll, true);
      removeEventListener('resize', place);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [open, place]);
  useEffect(() => {
    if (open && active >= 0) pop.current?.querySelector(`#${CSS.escape(optId(active))}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Type-ahead: consecutive keys within 700 ms build a prefix; repeating one letter cycles. */
  const typeAhead = (ch: string) => {
    const now = Date.now();
    const t = typed.current;
    t.text = now - t.at > 700 ? ch : t.text + ch;
    t.at = now;
    const q = fold(t.text);
    const cycling = q.length > 1 && [...q].every((c) => c === q[0]);
    const from = open ? active : selectedIndex;
    const n = options.length;
    for (let k = 1; k <= n; k++) {
      const i = (from + (cycling || q.length === 1 ? k : k - 1) + n) % n;
      if (enabled(i) && fold(options[i].label).startsWith(cycling ? q[0] : q)) return i;
    }
    return -1;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const k = e.key;
    if (!open) {
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ' || (k === 'ArrowDown' && e.altKey)) {
        e.preventDefault();
        e.stopPropagation();
        show();
      } else if (k.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && k !== ' ') {
        // Like a native select: typing while closed changes the value directly.
        e.stopPropagation();
        const i = typeAhead(k);
        if (i >= 0 && options[i].value !== value) onChange(options[i].value);
      }
      return;
    }
    // Open: every key belongs to the listbox.
    e.stopPropagation();
    if (k === 'Escape') { e.preventDefault(); if (isTopOverlay(layer)) hide(); }
    else if (k === 'Tab') { hide(false); }
    else if (k === 'ArrowDown') { e.preventDefault(); setActive((a) => step(a, 1)); }
    else if (k === 'ArrowUp') { e.preventDefault(); setActive((a) => (e.altKey ? a : step(a, -1))); if (e.altKey) choose(active); }
    else if (k === 'Home') { e.preventDefault(); setActive(firstEnabled()); }
    else if (k === 'End') { e.preventDefault(); setActive(lastEnabled()); }
    else if (k === 'PageDown') { e.preventDefault(); setActive((a) => { let i = a; for (let j = 0; j < 8; j++) i = step(i, 1); return i; }); }
    else if (k === 'PageUp') { e.preventDefault(); setActive((a) => { let i = a; for (let j = 0; j < 8; j++) i = step(i, -1); return i; }); }
    else if (k === 'Enter' || (k === ' ' && Date.now() - typed.current.at > 700)) { e.preventDefault(); choose(active); }
    else if (k.length === 1 && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      const i = typeAhead(k);
      if (i >= 0) setActive(i);
    }
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${base}-list` : undefined}
        aria-activedescendant={open && active >= 0 ? optId(active) : undefined}
        aria-disabled={disabled || undefined}
        disabled={disabled}
        title={title}
        className={`ui-select ${size === 'sm' ? 'sm' : ''} ${className}`}
        style={style}
        onClick={() => (open ? hide() : show())}
        onKeyDown={onKeyDown}
        // Focus moving elsewhere (Tab, a click that focuses something) closes the list.
        onBlur={(e) => { if (open && !pop.current?.contains(e.relatedTarget as Node)) hide(false); }}
        {...aria}
      >
        <span className="ui-select-value">
          {current?.icon}
          {current ? <span>{current.label}</span> : <span className="ui-select-placeholder">{placeholder}</span>}
        </span>
        <ChevronDown size={15} className="ui-select-chevron" aria-hidden />
      </button>
      {name !== undefined && <input type="hidden" name={name} value={value} />}
      {open && (
        <div
          ref={pop}
          popover="manual"
          id={`${base}-list`}
          role="listbox"
          aria-label={aria['aria-label']}
          aria-labelledby={aria['aria-labelledby']}
          className="ui-select-pop"
          style={pos ? { top: pos.top, left: pos.left, minWidth: pos.width, maxHeight: pos.maxHeight } : { visibility: 'hidden' }}
          // Keep focus on the button; a press on an option must not blur it first.
          onMouseDown={(e) => e.preventDefault()}
        >
          {options.map((o, i) => (
            <OptionRow
              key={o.value}
              o={o}
              id={optId(i)}
              heading={o.group && (i === 0 || options[i - 1].group !== o.group) ? o.group : undefined}
              selected={i === selectedIndex}
              active={i === active}
              onHover={() => enabled(i) && setActive(i)}
              onChoose={() => choose(i)}
            />
          ))}
        </div>
      )}
    </>
  );
}

function OptionRow({ o, id, heading, selected, active, onHover, onChoose }: {
  o: SelectOption<string>; id: string; heading?: string; selected: boolean; active: boolean; onHover: () => void; onChoose: () => void;
}) {
  return (
    <>
      {heading && <div className="ui-select-group" role="presentation">{heading}</div>}
      <div
        id={id}
        role="option"
        aria-selected={selected}
        aria-disabled={o.disabled || undefined}
        data-active={active}
        className="ui-option"
        onPointerMove={onHover}
        onClick={onChoose}
      >
        {o.icon !== undefined && <span className="ui-option-icon">{o.icon}</span>}
        <span className="ui-option-label">{o.label}</span>
        {o.hint !== undefined && <span className="ui-option-hint">{o.hint}</span>}
        <Check size={14} className="ui-option-check" aria-hidden />
      </div>
    </>
  );
}
