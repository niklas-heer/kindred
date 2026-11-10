// A person's History section: the latest changes to them, and a link to all of them on the History page. For members only;
// a share-link guest sees no section at all (the server would refuse them anyway).
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useId } from 'react';
import { historyQuery } from '~/lib/history.functions';
import { useT } from '~/lib/i18n';
import { useCan, useMembership } from '~/lib/session';
import { HistoryList } from './HistoryList';
import './history.css';

/** How many of a person's changes the section shows before "See all". */
const SHOWN = 5;

export function PersonHistory({ tree, person }: { tree: string; person: string }) {
  const t = useT();
  const member = !!useMembership(tree);
  const canRestore = useCan('edit-person');
  const heading = useId();
  const q = useQuery({ ...historyQuery(tree, { person }), enabled: member });
  if (!member) return null;
  const items = q.data?.items ?? [];
  return (
    <section className="hist-section" aria-labelledby={heading}>
      <h3 id={heading} className="rule">{t('history.person_title')}</h3>
      {q.isPending ? <p className="subtle">{t('history.loading')}</p>
        : q.isError ? <p className="subtle" role="alert">{t('history.failed')}</p>
        : items.length === 0 ? <p className="subtle">{t('history.person_empty')}</p>
        : (
          <>
            <HistoryList tree={tree} items={items.slice(0, SHOWN)} showPerson={false} canRestore={canRestore} />
            <Link to="/$tree/history" params={{ tree }} search={{ person }}>{t('history.person_all')}</Link>
          </>
        )}
    </section>
  );
}
