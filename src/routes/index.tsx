import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { treesQuery } from '~/lib/api';
import '~/styles/home.css';

export const Route = createFileRoute('/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(treesQuery),
  component: Home,
});

/** The first letter that isn't an article: "The Realm of Aurelmarch" becomes R. */
const initialOf = (name: string) => name.replace(/^(the|a|an)\s+/i, '').charAt(0).toUpperCase() || '?';
/** A deterministic crest colour (0 to 3) from the tree id, so each banner keeps its colour between visits. */
const crestOf = (id: string) => [...id].reduce((n, c) => n + c.charCodeAt(0), 0) % 4;

function Home() {
  const { data: trees } = useSuspenseQuery(treesQuery);
  return (
    <main className="home">
      <div className="home-inner">
        <h1 className="display">Kindred</h1>
        <p className="muted">A family tree you can live in. Pick a family.</p>
        <div className="home-grid">
          {trees.map((t) => (
            <div key={t.id} className="home-banner">
              <Link to="/$tree" params={{ tree: t.id }} className={`home-card theme-${t.theme}`} data-crest={crestOf(t.id)}>
                <span className="home-card-in">
                  <span className="home-crest display" aria-hidden>
                    {initialOf(t.name)}
                  </span>
                  <b className="home-name display">{t.name}</b>
                  <span className="home-tagline muted">{t.tagline}</span>
                  <span className="home-people">
                    <span className="home-count display">{t.people.toLocaleString('en-GB')}</span>
                    <span className="home-count-label">{t.people === 1 ? 'person' : 'people'}</span>
                  </span>
                </span>
              </Link>
            </div>
          ))}
        </div>
        {trees.length === 0 && <p className="empty">No trees yet. Run <code>mise run seed</code>.</p>}
      </div>
    </main>
  );
}
