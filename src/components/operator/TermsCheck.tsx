// "I accept the terms": asked of whoever makes a family, and of whoever takes an invitation to be a family's steward, while the
// server's operator has written terms (src/lib/operator/terms.server.ts). The server refuses the step without it and records
// who accepted which version, and when. The terms open on the legal page, in a new tab, so the form keeps what was typed.
import { useT } from '~/lib/i18n';
import './operator.css';

export function TermsCheck({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  const t = useT();
  return (
    <div className="terms-check">
      <label>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} required />
        <span>{t('operator.accept_terms')}</span>
      </label>
      <a href="/legal#terms" target="_blank" rel="noopener">{t('operator.read_terms')}</a>
    </div>
  );
}
