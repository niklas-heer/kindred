// A signed-in reader opened a family they don't belong to. Says so without revealing whether that
// family exists, and offers the families they do belong to.
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Lock } from 'lucide-react';
import { myFamiliesQuery } from '~/lib/auth/functions';
import { useSession } from '~/lib/session';
import { signOut } from './AccountMenu';
import { NotFound } from './ui/states';

export function NoAccessPage() {
  const session = useSession();
  const { data: trees } = useQuery(myFamiliesQuery);
  return (
    <main className="page ui-notfound-page">
      <NotFound
        icon={<Lock size={28} />}
        title="You don’t have access to this family"
        text={<>You’re signed in as <b>{session?.user?.name ?? 'someone else'}</b>. If you should be here, ask one of this family’s stewards to send you an invitation.</>}
      >
        {trees && trees.length > 0 && (
          <ul className="ui-state-links" aria-label="Your families">
            {trees.map((t) => (
              <li key={t.id}>
                <Link to="/$tree" params={{ tree: t.id }}>
                  <b className="display">{t.name}</b>
                  <span>{t.people.toLocaleString('en-GB')} {t.people === 1 ? 'person' : 'people'}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="ui-state-actions">
          <Link to="/" className="btn">Your families</Link>
          <button className="btn ghost" onClick={() => void signOut(session?.accessLogout)}>Sign out</button>
        </div>
      </NotFound>
    </main>
  );
}
