import { formatNumber, useT } from '~/lib/i18n';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Cake, Shield } from 'lucide-react';
import { AccountMenu } from '~/components/AccountMenu';
import { Arms } from '~/components/Heraldry';
import { PageHeader, EmptyState, ErrorState, Skeleton } from '~/components/ui';
import { myFamiliesQuery, sessionQuery } from '~/lib/auth/functions';
import '~/styles/home.css';

export const Route = createFileRoute('/')({
  validateSearch: (s: Record<string, unknown>): { families?: 'all' } => s.families === 'all' ? { families: 'all' } : {},
  beforeLoad: async ({ context, search }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (session.needsSetup) throw redirect({ to: '/setup' });
    if (!session.user) throw redirect({ to: '/signin' });
    const trees = await context.queryClient.ensureQueryData(myFamiliesQuery);
    const target = trees.find((t) => t.id === session.defaultTree) ?? (trees.length === 1 ? trees[0] : undefined);
    if (target && search.families !== 'all') throw redirect({ to: '/$tree', params: { tree: target.id } });
  },
  component: Home,
});
function Home() {
  const t = useT();
  const tLocale = t.locale;
  const tr = t;
  // Only the families the reader belongs to.
  const { data: trees = [], isPending, isError, refetch } = useQuery(myFamiliesQuery);
  const [last, setLast] = useState<{ tree: string; person: string; name: string } | null>(null);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('kindred:last-visit') ?? 'null');
      if (saved && typeof saved.tree === 'string' && typeof saved.person === 'string') setLast(saved);
      const theme = localStorage.getItem('kindred:theme');
      if (theme && ['codex', 'modern', 'night'].includes(theme)) document.documentElement.dataset.theme = theme;
    } catch {}
  }, []);
  const today = trees.flatMap((t) => (t.today ?? []).map((p) => ({ ...p, tree: t.id, family: t.name })));
  return <main className="home"><div className="home-account"><AccountMenu /></div><div className="home-inner">
    <PageHeader title="Kindred" subtitle={t("index.a_family_tree_you_can_live_in_pick_a_family")}  />
    {isPending ? <div className="home-grid" aria-busy="true" aria-label={t("index.loading_families")}>{[0, 1, 2].map((i) => <div className="ui-card" key={i} style={{ padding: 24 }}><Skeleton height={84} width={84} radius="50%" /><Skeleton lines={3} /></div>)}</div>
      : isError ? <ErrorState title={t("index.could_not_load_your_families")} onRetry={() => { void refetch(); }} />
      : trees.length === 0 ? <EmptyState icon={<Shield size={30} />} title={t("index.no_families_yet")} text={t("index.you_don_t_belong_to_a_family_here_yet_when_a_steward_invites_you_open_their_link_and_the_family_will_appear_here")} /> : <>
      {last && trees.some((t) => t.id === last.tree) && <Link className="home-continue ui-card interactive" to="/$tree" params={{ tree: last.tree }} search={{ focus: last.person }}>{t("index.continue_where_you_left_off")} <b>{last.name}</b><span aria-hidden>→</span></Link>}
      <div className="home-grid">{trees.map((t) => <div className="home-banner" key={t.id}><Link to="/$tree" params={{ tree: t.id }} className="home-card ui-card interactive" onClick={() => { try { localStorage.setItem('kindred:last-visit', JSON.stringify({ tree: t.id, person: t.focus, name: t.name })); } catch {} }}><span className="home-card-in">
        <span className="home-crest" aria-hidden>{t.crest ? <Arms arms={t.crest} size={80} /> : <Shield size={60} />}</span>
        <b className="home-name">{t.name}</b><span className="home-tagline muted">{t.tagline}</span><span className="home-people"><span className="home-count display">{formatNumber(t.people, tLocale)}</span><span className="home-count-label">{tr('common.personUnit', {count: t.people})}</span></span>
      </span></Link></div>)}</div>
      <section className="home-today ui-card"><h2><Cake size={20} /> {t("index.today_across_your_families")}</h2>{today.length ? <ul>{today.map((p) => <li key={`${p.tree}:${p.key}`}><Link to="/$tree" params={{ tree: p.tree }} search={{ focus: p.id }}>{p.name}</Link><span>{p.label}</span><span className="muted">{p.family}</span></li>)}</ul> : <p className="muted">{t("index.a_quiet_day_no_birthdays_anniversaries_or_memorial_days_recorded_for_today")}</p>}</section>
    </>}
  </div></main>;
}
