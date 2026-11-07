import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { treesQuery } from '~/lib/api';
import '~/styles/home.css';

export const Route = createFileRoute('/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(treesQuery),
  component: Home,
});

function Home() {
  const { data: trees } = useSuspenseQuery(treesQuery);
  return (
    <main className="home">
      <div className="home-inner">
        <h1 className="display">Kindred</h1>
        <p className="muted">A family tree you can live in. Pick a family.</p>
        <div className="home-grid">
          {trees.map((t) => (
            <Link key={t.id} to="/$tree" params={{ tree: t.id }} className={`home-card panel theme-${t.theme}`}>
              <span className="home-count display">{t.people.toLocaleString('en-GB')}</span>
              <span className="home-count-label muted">people</span>
              <b className="display">{t.name}</b>
              <span className="muted">{t.tagline}</span>
            </Link>
          ))}
        </div>
        {trees.length === 0 && <p className="empty">No trees yet. Run <code>mise run seed</code>.</p>}
      </div>
    </main>
  );
}
