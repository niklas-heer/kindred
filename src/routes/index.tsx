import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Cake, Shield } from 'lucide-react';
import { Arms } from '~/components/Heraldry';
import { PageHeader, EmptyState, ErrorState, Skeleton } from '~/components/ui';
import { treesQuery } from '~/lib/api';
import '~/styles/home.css';

export const Route = createFileRoute('/')({ component: Home });
function Home() {
  const { data: trees = [], isPending, isError, refetch } = useQuery(treesQuery);
  const [last, setLast] = useState<{ tree: string; person: string; name: string } | null>(null);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('kindred:last-visit') ?? 'null');
      if (saved && typeof saved.tree === 'string' && typeof saved.person === 'string') setLast(saved);
      const theme = localStorage.getItem('kindred:theme');
      if (theme && ['codex', 'modern', 'night'].includes(theme)) document.documentElement.dataset.theme = theme;
    } catch {}
  }, []);
  const birthdays = trees.flatMap((t) => (t.birthdays ?? []).map((p) => ({ ...p, tree: t.id, family: t.name })));
  return <main className="home"><div className="home-inner">
    <PageHeader title="Kindred" subtitle="A family tree you can live in. Pick a family." />
    {isPending ? <div className="home-grid" aria-busy="true" aria-label="Loading families">{[0, 1, 2].map((i) => <div className="ui-card" key={i} style={{ padding: 24 }}><Skeleton height={84} width={84} radius="50%" /><Skeleton lines={3} /></div>)}</div>
      : isError ? <ErrorState title="Could not load your families" onRetry={() => { void refetch(); }} />
      : trees.length === 0 ? <EmptyState icon={<Shield size={30} />} title="Your family starts here" text="There are no families in your library yet. Once a family is added, it will appear here." /> : <>
      {last && trees.some((t) => t.id === last.tree) && <Link className="home-continue ui-card interactive" to="/$tree" params={{ tree: last.tree }} search={{ focus: last.person }}>Continue where you left off <b>{last.name}</b><span aria-hidden>→</span></Link>}
      <div className="home-grid">{trees.map((t) => <div className="home-banner" key={t.id}><Link to="/$tree" params={{ tree: t.id }} className="home-card ui-card interactive" onClick={() => { try { localStorage.setItem('kindred:last-visit', JSON.stringify({ tree: t.id, person: t.focus, name: t.name })); } catch {} }}><span className="home-card-in">
        <span className="home-crest" aria-hidden>{t.crest ? <Arms arms={t.crest} size={80} /> : <Shield size={60} />}</span>
        <b className="home-name">{t.name}</b><span className="home-tagline muted">{t.tagline}</span><span className="home-people"><span className="home-count display">{t.people.toLocaleString('en-GB')}</span><span className="home-count-label">{t.people === 1 ? 'person' : 'people'}</span></span>
      </span></Link></div>)}</div>
      <section className="home-today ui-card"><h2><Cake size={20} /> Today across your families</h2>{birthdays.length ? <ul>{birthdays.map((p) => <li key={`${p.tree}:${p.id}`}><Link to="/$tree" params={{ tree: p.tree }} search={{ focus: p.id }}>{p.name}</Link><span className="muted">{p.family}</span></li>)}</ul> : <p className="muted">A quiet day: no birthdays recorded for today.</p>}</section>
    </>}
  </div></main>;
}
