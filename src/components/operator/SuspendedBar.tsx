// What the members of a family the server's operator suspended or closed see (docs/hosting-many-families.md). Suspended: a bar
// over the family, which they can read and not change until the operator lets it be used again. Closed: a page instead of the
// family. Both say how to reach the operator (the instance's contact address, when set): to ask why, or, for a suspended
// family, to have it deleted, which its stewards cannot do themselves while it is suspended. The server refuses every change
// (and a closed family's every read); this only says so.
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { DoorClosed, PauseCircle } from 'lucide-react';
import { useT } from '~/lib/i18n';
import { publicInstanceQuery } from '~/lib/operator/operator.functions';
import { Main } from '~/components/ui/Main';
import { NotFound } from '~/components/ui/states';
import './operator.css';

/** How to reach the operator: their address as a link, or a plain sentence when the server has none. */
function Contact({ withAddress, without }: { withAddress: 'operator.suspended_contact' | 'operator.closed_contact'; without: 'operator.suspended_no_contact' | 'operator.closed_no_contact' }) {
  const t = useT();
  const email = useQuery(publicInstanceQuery).data?.contactEmail;
  if (!email) return <>{t(without)}</>;
  const [before, after = ''] = t(withAddress, { email: '\u0000' }).split('\u0000');
  return <>{before}<a href={`mailto:${email}`}>{email}</a>{after}</>;
}

export function SuspendedBar() {
  const t = useT();
  return (
    <div className="suspended-bar" role="status">
      <PauseCircle size={15} aria-hidden />
      <p>{t('operator.suspended_banner')} <Contact withAddress="operator.suspended_contact" without="operator.suspended_no_contact" /></p>
    </div>
  );
}

export function ClosedFamilyPage() {
  const t = useT();
  return (
    <Main className="page ui-notfound-page">
      <NotFound icon={<DoorClosed size={28} />} title={t('operator.closed_title')}
        text={<>{t('operator.closed_text')} <Contact withAddress="operator.closed_contact" without="operator.closed_no_contact" /></>}>
        <div className="ui-state-actions">
          <Link to="/" search={{ families: 'all' }} className="btn">{t('noaccess.your_families')}</Link>
        </div>
      </NotFound>
    </Main>
  );
}
