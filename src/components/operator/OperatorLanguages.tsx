// The operator's choice of languages (docs/hosting-many-families.md, "Languages"): every complete language, new ones
// included as updates finish them, or only those ticked. English is always offered, and a language still being translated
// is listed but cannot be ticked.
import { useId } from 'react';
import { COMPLETE_LOCALES, LANGUAGE_NAME, LOCALES, useT, type Locale } from '~/lib/i18n';

export function LanguagesFieldset({ value, onChange }: { value: Locale[] | null; onChange: (next: Locale[] | null) => void }) {
  const t = useT();
  const ids = useId();
  const chosen = value ?? [...COMPLETE_LOCALES];
  const unfinished = LOCALES.filter((l) => !COMPLETE_LOCALES.includes(l));
  const toggle = (l: Locale, on: boolean) => onChange(LOCALES.filter((x) => x === 'en' || (x === l ? on : chosen.includes(x))));
  return (
    <fieldset className="operator-fieldset" data-testid="operator-languages">
      <legend>{t('operator.languages_title')}</legend>
      <label className="operator-radio">
        <input type="radio" name={`${ids}-languages`} checked={value === null} onChange={() => onChange(null)} />
        <span><b>{t('operator.languages_all')}</b><small>{t('operator.languages_all_hint')}</small></span>
      </label>
      <label className="operator-radio">
        <input type="radio" name={`${ids}-languages`} checked={value !== null} onChange={() => onChange([...COMPLETE_LOCALES])} />
        <span><b>{t('operator.languages_some')}</b><small>{t('operator.languages_some_hint')}</small></span>
      </label>
      {value !== null && (
        <div className="operator-languages">
          {COMPLETE_LOCALES.map((l) => (
            <label key={l} className="operator-check">
              <input type="checkbox" checked={chosen.includes(l)} disabled={l === 'en'} onChange={(e) => toggle(l, e.target.checked)} />
              <span lang={l}>{LANGUAGE_NAME[l]}</span>
            </label>
          ))}
        </div>
      )}
      <small className="families-hint">{t('operator.languages_fallback')}</small>
      {unfinished.length > 0 && (
        <small className="families-hint">
          {t('operator.languages_unfinished')}{' '}
          {unfinished.map((l, i) => <span key={l}>{i > 0 && ', '}<span lang={l}>{LANGUAGE_NAME[l]}</span></span>)}
        </small>
      )}
    </fieldset>
  );
}
