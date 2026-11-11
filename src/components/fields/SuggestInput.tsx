// A text box that suggests as you type and still takes anything: free text is the point, the list only saves typing.
// Keys (WAI-ARIA combobox): ↓/↑ move, ↵ picks the highlighted one (with none highlighted it is left to the form),
// Escape closes the list.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useT } from '~/lib/i18n';
import type { Suggestion } from '~/lib/field-suggest';
import { useAnchoredPop } from '../ui/anchoredPop';
import { isTopOverlay, useOverlayLayer } from '../ui/overlay';
import './suggest.css';

export function SuggestInput({ value, onChange, onPick, onBlur, options, placeholder, label, labelledBy, describedBy, listLabel }: {
  value: string;
  onChange: (text: string) => void;
  /** Instead of putting the option's value in the box. */
  onPick?: (s: Suggestion) => void;
  onBlur?: () => void;
  options: Suggestion[];
  placeholder?: string;
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  listLabel?: string;
}) {
  const t = useT();
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // Once the box says exactly what the only suggestion says, there is nothing left to offer.
  const settled = options.length === 1 && options[0].value === value.trim();
  const showing = open && options.length > 0 && !settled;

  const layer = useOverlayLayer(showing);
  useAnchoredPop(showing, box, list);
  useEffect(() => { if (showing && active >= 0) list.current?.querySelector(`#${CSS.escape(`${id}-o${active}`)}`)?.scrollIntoView({ block: 'nearest' }); }, [showing, active, id]);
  useEffect(() => setActive(-1), [options]);

  const pick = (s: Suggestion) => {
    if (onPick) onPick(s); else onChange(s.value);
    setOpen(false);
    setActive(-1);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && options.length) {
      e.preventDefault();
      if (!showing) setOpen(true); else setActive((a) => Math.min(options.length - 1, a + 1));
    } else if (e.key === 'ArrowUp' && showing) {
      e.preventDefault();
      setActive((a) => Math.max(-1, a - 1));
    } else if (e.key === 'Enter' && showing && active >= 0) {
      e.preventDefault();
      e.stopPropagation();
      pick(options[active]);
    } else if (e.key === 'Escape' && showing && isTopOverlay(layer)) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div className="sg" ref={box}>
      <input
        className="input"
        type="text"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={showing}
        aria-controls={showing ? `${id}-list` : undefined}
        aria-activedescendant={showing && active >= 0 ? `${id}-o${active}` : undefined}
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        placeholder={placeholder}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => { setOpen(false); setActive(-1); onBlur?.(); }}
        onKeyDown={onKeyDown}
      />
      {showing && (
        <div
          ref={list}
          id={`${id}-list`}
          role="listbox"
          aria-label={listLabel ?? t('suggest.aria')}
          popover="manual"
          className="ui-select-pop sg-list"
          // A press on an option must not blur the box first.
          onMouseDown={(e) => e.preventDefault()}
        >
          {options.map((s, i) => (
            <div key={s.value}>
              {i === 0 && s.used && <div className="ui-select-group" role="presentation">{t('places.inFamily')}</div>}
              {i > 0 && options[i - 1].used && !s.used && !s.group && <div className="sg-gap" role="presentation" />}
              {s.group && s.group !== options[i - 1]?.group && <div className="ui-select-group" role="presentation">{s.group}</div>}
              <div id={`${id}-o${i}`} role="option" aria-selected={i === active} data-active={i === active} className="ui-option sg-option" onPointerMove={() => setActive(i)} onClick={() => pick(s)}>
                <span className="ui-option-label">{s.label}{s.hint && <small>{s.hint}</small>}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
