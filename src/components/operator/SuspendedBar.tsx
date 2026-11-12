// The bar over a family the server's operator suspended: its members can read everything and change nothing until the
// operator lets it be used again (docs/hosting-many-families.md). The server refuses every change; this only says so.
import { PauseCircle } from 'lucide-react';
import { useT } from '~/lib/i18n';
import './operator.css';

export function SuspendedBar() {
  const t = useT();
  return (
    <div className="suspended-bar" role="status">
      <PauseCircle size={15} aria-hidden />
      <p>{t('operator.suspended_banner')}</p>
    </div>
  );
}
