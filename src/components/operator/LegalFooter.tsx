// The quiet footer of the pages anyone can open (sign-in, setup, an invitation, the share link, the request forms): links to
// the legal page's sections the operator has filled in, and the address for data requests. A server run for one family
// usually fills none in, and then nothing shows. Read only in the browser, so the server's page and the first render agree.
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useT } from '~/lib/i18n';
import { publicInstanceQuery } from '~/lib/operator/operator.functions';
import { anyLegal } from '~/lib/operator/shared';
import './operator.css';

export function LegalFooter() {
  const t = useT();
  const { data } = useQuery(publicInstanceQuery);
  if (!data || !anyLegal(data.legal)) return null;
  const { legal } = data;
  return (
    <footer className="legal-footer">
      <nav aria-label={t('legal.footer')}>
        {legal.impressum && <Link to="/legal" hash="impressum">{t('legal.impressum')}</Link>}
        {legal.privacy && <Link to="/legal" hash="privacy">{t('legal.privacy')}</Link>}
        {legal.terms && <Link to="/legal" hash="terms">{t('legal.terms')}</Link>}
        {legal.report && <Link to="/legal" hash="report">{t('legal.report')}</Link>}
        <Link to="/privacy-request">{t('legal.data_request')}</Link>
      </nav>
    </footer>
  );
}

/** On the sign-in page, while this server takes requests for a family (or sign-ups): where to ask for one, or start one. */
export function RequestFamilyLink() {
  const t = useT();
  const { data } = useQuery(publicInstanceQuery);
  if (data?.familyCreation === 'signup') return <p className="auth-alt">{t('request.no_family_yet')} <Link to="/signup">{t('signup.start_link')}</Link></p>;
  if (data?.familyCreation !== 'requests') return null;
  return <p className="auth-alt">{t('request.no_family_yet')} <Link to="/request">{t('request.ask_link')}</Link></p>;
}
