// The occupation box in the person editor. It suggests vocabulary entries as the reader types, in any language.
// Picking one stores its code and the label in the reader's language; typing your own words keeps the text and
// stores a code only when the text names exactly one entry. The text is always what the family wrote.
import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useT } from '~/lib/i18n';
import { occupationById, occupationEnglish, occupationForText, occupationLabel, suggestOccupations, type Sex } from '~/lib/occupations';
import './occupation.css';

export function OccupationField({
  label,
  text,
  code,
  sex,
  onChange,
}: {
  label: string;
  text: string;
  code: string;
  sex: Sex;
  onChange: (next: { text: string; code: string }) => void;
}) {
  const t = useT();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(-1);
  const chosen = occupationById(code);
  // Once an entry is chosen and shown, the list has nothing more to offer.
  const settled = !!chosen && text.trim() === occupationLabel(chosen, t.locale, sex);
  const options = useMemo(() => (settled ? [] : suggestOccupations(text, t.locale)), [text, t.locale, settled]);
  const showing = open && options.length > 0;

  function pick(id: string) {
    const o = occupationById(id);
    if (!o) return;
    onChange({ text: occupationLabel(o, t.locale, sex), code: o.id });
    setOpen(false);
    setSel(-1);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!showing) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter' && sel >= 0) {
      e.preventDefault();
      pick(options[sel].id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  }

  return (
    <div className="field wide occ-field">
      <span id={`${uid}-label`}>{label}</span>
      <div className="occ-box">
        <input
          id={`${uid}-input`}
          className="input"
          role="combobox"
          autoComplete="off"
          aria-labelledby={`${uid}-label`}
          aria-autocomplete="list"
          aria-expanded={showing}
          aria-controls={`${uid}-list`}
          aria-activedescendant={showing && sel >= 0 ? `${uid}-o${sel}` : undefined}
          value={text}
          onChange={(e) => {
            const next = e.target.value;
            onChange({ text: next, code: occupationForText(next)?.id ?? '' });
            setOpen(true);
            setSel(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        {showing && (
          <ul id={`${uid}-list`} role="listbox" aria-label={t('fields.occupation.listLabel')} className="occ-list">
            {options.map((o, i) => {
              const shown = occupationLabel(o, t.locale, sex);
              return (
                <li
                  key={o.id}
                  id={`${uid}-o${i}`}
                  role="option"
                  aria-selected={i === sel}
                  className={`occ-option${i === sel ? ' on' : ''}`}
                  // mousedown keeps the focus in the input, so the list does not close before the pick lands.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(o.id);
                  }}
                >
                  <span>{shown}</span>
                  {shown !== occupationEnglish(o) && <small>{occupationEnglish(o)}</small>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <small className="subtle">{t('fields.occupation.hint')}</small>
    </div>
  );
}
