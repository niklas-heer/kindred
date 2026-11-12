// "I accept the terms": asked of whoever makes a family, and of whoever takes an invitation to be a family's steward, while the
// server's operator has written terms (src/lib/operator/terms.server.ts). The server refuses the step without it and records
// who accepted which version, and when. The terms open on the legal page, in a new tab, so the form keeps what was typed.
import { useQuery } from '@tanstack/react-query';
import { useT } from '~/lib/i18n';
import { publicInstanceQuery } from '~/lib/operator/operator.functions';
import './operator.css';

/**
 * One box for both the terms and the processing agreement (docs/gdpr.md), whichever the server has: its sentence names them,
 * and each has its link.
 */
export function TermsCheck({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  const t = useT();
  const legal = useQuery(publicInstanceQuery).data?.legal;
  const agreement = !!legal?.processingAgreement;
  const terms = legal ? legal.terms : true;
  return (
    <div className="terms-check">
      <label>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} required />
        <span>{agreement ? t(terms ? 'gdpr.accept_terms_agreement' : 'gdpr.accept_agreement') : t('operator.accept_terms')}</span>
      </label>
      {terms && <a href="/legal#terms" target="_blank" rel="noopener">{t('operator.read_terms')}</a>}
      {agreement && <a href="/legal#processing-agreement" target="_blank" rel="noopener">{t('gdpr.read_agreement')}</a>}
    </div>
  );
}
