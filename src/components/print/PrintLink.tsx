// The way to the Print page from a person: their chart, or their pages of the family book. For members only, as printing is.
import { Link } from '@tanstack/react-router';
import { Printer } from 'lucide-react';
import { useT } from '~/lib/i18n';
import { useMember } from '~/lib/session';

export function PrintLink({ tree, person, name }: { tree: string; person: string; name: string }) {
  const t = useT();
  if (!useMember(tree)) return null;
  return (
    <Link className="btn" to="/$tree/print" params={{ tree }} search={{ person }} aria-label={t('print.link_person', { name })}>
      <Printer size={14} aria-hidden /> {t('print.link')}
    </Link>
  );
}
