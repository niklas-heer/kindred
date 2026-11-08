// The language picker: the current language's flag on a small button, and a list of the three languages, each
// with its flag and its own name, and a check on the current one. Keys follow the Select: ↓/↑ move, Home/End,
// Enter or Space choose, Escape or Tab close and return focus to the button. The top bar, the sign-in card and
// the home page use LanguagePicker; the phone's More sheet uses LanguageChoices, the same three in a row.
import { Check } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Flag } from '~/components/heraldry/Flag';
import { LANGUAGE_NAME, LOCALES, useT, type Locale } from '~/lib/i18n';
import { isTopOverlay, useOverlayLayer } from './ui/overlay';
import './language.css';

/** Each language's flag: English is the United Kingdom's, Afrikaans is South Africa's. */
export const LANGUAGE_FLAG: Record<Locale, string> = { en: 'gb', de: 'de', af: 'za' };

export function LanguagePicker({ className = '' }: { className?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const layer = useOverlayLayer(open);
  const base = useId();
  const name = `${t('common.language')}: ${LANGUAGE_NAME[t.locale]}`;

  const show = () => {
    setActive(LOCALES.indexOf(t.locale));
    setOpen(true);
  };
  const hide = (refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus({ preventScroll: true });
  };
  const choose = (i: number) => {
    const next = LOCALES[i];
    if (next !== t.locale) t.setLocale(next);
    hide();
  };

  // Hang the list under the button, kept on the screen's right edge. It is shown in the top layer.
  const place = useCallback(() => {
    const b = button.current?.getBoundingClientRect();
    if (b) setPos({ top: Math.round(b.bottom + 6), right: Math.max(8, Math.round(innerWidth - b.right)) });
  }, []);
  useLayoutEffect(() => {
    const el = pop.current;
    if (!open || !el) return;
    try { if (!el.matches(':popover-open')) el.showPopover(); } catch {}
    place();
    return () => { try { el.hidePopover(); } catch {} };
  }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!pop.current?.contains(target) && !button.current?.contains(target)) hide(false);
    };
    addEventListener('resize', place);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      removeEventListener('resize', place);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [open, place]); // eslint-disable-line react-hooks/exhaustive-deps

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const k = e.key;
    if (!open) {
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') {
        e.preventDefault();
        show();
      }
      return;
    }
    // Open: every key belongs to the list.
    e.stopPropagation();
    if (k === 'Escape') { e.preventDefault(); if (isTopOverlay(layer)) hide(); }
    else if (k === 'Tab') hide(false);
    else if (k === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, LOCALES.length - 1)); }
    else if (k === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (k === 'Home') { e.preventDefault(); setActive(0); }
    else if (k === 'End') { e.preventDefault(); setActive(LOCALES.length - 1); }
    else if (k === 'Enter' || k === ' ') { e.preventDefault(); choose(active); }
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${base}-list` : undefined}
        aria-activedescendant={open ? `${base}-${active}` : undefined}
        aria-label={name}
        title={name}
        className={`btn ghost lang-picker ${className}`}
        onClick={() => (open ? hide() : show())}
        onKeyDown={onKeyDown}
        // Focus moving elsewhere (Tab, a click that focuses something) closes the list.
        onBlur={(e) => { if (open && !pop.current?.contains(e.relatedTarget as Node)) hide(false); }}
      >
        <span className="lang-flag" aria-hidden><Flag code={LANGUAGE_FLAG[t.locale]} size={16} /></span>
      </button>
      {open && (
        <div
          ref={pop}
          popover="manual"
          id={`${base}-list`}
          role="listbox"
          aria-label={t('common.language')}
          className="ui-select-pop lang-pop"
          style={pos ? { top: pos.top, right: pos.right } : { visibility: 'hidden' }}
          // Keep focus on the button; a press on a language must not blur it first.
          onMouseDown={(e) => e.preventDefault()}
        >
          {LOCALES.map((l, i) => (
            <div
              key={l}
              id={`${base}-${i}`}
              role="option"
              lang={l}
              aria-selected={l === t.locale}
              data-active={i === active}
              className="ui-option lang-option"
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(i)}
            >
              <span className="lang-flag" aria-hidden><Flag code={LANGUAGE_FLAG[l]} size={16} /></span>
              <span className="ui-option-label">{LANGUAGE_NAME[l]}</span>
              <Check size={15} className="ui-option-check" aria-hidden />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** The phone's More sheet: the three languages side by side across the full width, each with its flag and its name. */
export function LanguageChoices() {
  const t = useT();
  return (
    <div className="seg lang-choices" role="group" aria-label={t('common.language')}>
      {LOCALES.map((l) => (
        <button key={l} type="button" className="btn" lang={l} aria-pressed={t.locale === l} onClick={() => t.setLocale(l)}>
          <span className="lang-flag" aria-hidden><Flag code={LANGUAGE_FLAG[l]} size={16} /></span>
          <span>{LANGUAGE_NAME[l]}</span>
        </button>
      ))}
    </div>
  );
}
