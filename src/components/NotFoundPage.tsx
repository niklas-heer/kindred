// "Family not found" and "Page not found": a friendly page with a link to each of the reader's
// families (none when signed out), never a developer hint. Used by the $tree route (unknown tree id)
// and as the router's default.
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Users } from 'lucide-react';
import { myFamiliesQuery } from '~/lib/auth/functions';
import { NotFound } from './ui/states';

export function NotFoundPage({ kind = 'page', id }: { kind?: 'family' | 'page'; id?: string }) {
  const { data: trees } = useQuery(myFamiliesQuery);
  return (
    <main className="page ui-notfound-page">
      <NotFound
        icon={kind === 'family' ? <Users size={28} /> : undefined}
        title={kind === 'family' ? 'Family not found' : 'Page not found'}
        text={
          kind === 'family'
            ? <>There’s no family {id ? <>called “{id}” </> : null}here. It may have been renamed, or the link is old.</>
            : 'This page doesn’t exist, or it has moved.'
        }
      >
        {trees && trees.length > 0 ? (
          <ul className="ui-state-links" aria-label="Your families">
            {trees.map((t) => (
              <li key={t.id}>
                <Link to="/$tree" params={{ tree: t.id }}>
                  <b className="name">{t.name}</b>
                  <span>{t.people.toLocaleString('en-GB')} {t.people === 1 ? 'person' : 'people'}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="ui-state-actions"><Link to="/" className="btn primary">Your families</Link></div>
        )}
      </NotFound>
    </main>
  );
}
