// The roll of houses: every house of the family as a card with its arms and country, motto, size, founder,
// the head today, years and a sparkline of members per generation. Each card opens the house's page.
import { createFileRoute, Link } from '@tanstack/react-router';
import { Shield } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Arms } from '~/components/Heraldry';
import { EmptyState, ErrorState, PageHeader, Select } from '~/components/ui';
import { useFamily, useMeChosen, useTreeId } from '~/lib/family';
import { GenSpark, houseStats, houseSuccession, maxGeneration, spanLabel, useHouseSettings, type HouseStats } from '~/lib/houses';
import { locales, useT } from '~/lib/i18n';
import { sectionHead } from '~/lib/title';
import '~/styles/house.css';

export const Route = createFileRoute('/$tree/houses')({
  head: sectionHead('Houses'),
  component: HousesPage,
});

type Sort = 'size' | 'living' | 'oldest' | 'name';
const SORTS: Sort[] = ['size', 'living', 'oldest', 'name'];
const SORT_KEY: Record<Sort, 'houses.sort.size' | 'houses.sort.living' | 'houses.sort.oldest' | 'houses.sort.name'> = {
  size: 'houses.sort.size',
  living: 'houses.sort.living',
  oldest: 'houses.sort.oldest',
  name: 'houses.sort.name',
};
const sortName = (s: HouseStats) => s.house.name.replace(/^House (of )?/i, '');
const COMPARE: Record<Sort, (a: HouseStats, b: HouseStats) => number> = {
  size: (a, b) => b.members.length - a.members.length,
  living: (a, b) => b.living - a.living || b.members.length - a.members.length,
  oldest: (a, b) => (a.from ?? 1e9) - (b.from ?? 1e9),
  name: (a, b) => sortName(a).localeCompare(sortName(b)),
};

function HousesPage() {
  const t = useT();
  const f = useFamily();
  const tree = useTreeId();
  const me = useMeChosen();
  const [sort, setSort] = useSort(tree);
  const settingsQ = useHouseSettings(tree);
  const settings = settingsQ.data;

  const stats = useMemo(() => {
    const max = maxGeneration(f);
    return f.graph.houses.map((h) => houseStats(f, h, max));
  }, [f]);
  const sorted = useMemo(() => [...stats].sort((a, b) => COMPARE[sort](a, b) || sortName(a).localeCompare(sortName(b))), [stats, sort]);
  const inHouses = stats.reduce((n, s) => n + s.members.length, 0);
  const myHouse = me ? f.byId.get(me)?.house : undefined;

  return (
    <div className="page">
      <div className="page-inner">
        <PageHeader
          title={t('shell.houses')}
          icon={<Shield size={24} />}
          subtitle={
            stats.length
              ? t('houses.listSubtitle', { houses: t('houses.houseCount', { count: stats.length }), inHouses, total: f.graph.people.length })
              : t('houses.listSubtitleNone')
          }
          actions={
            stats.length > 1 ? (
              <div className="hs-toolbar">
                <span id="hs-sort-label" className="sr-only">{t('houses.sortLabel')}</span>
                <Select aria-labelledby="hs-sort-label" value={sort} onChange={setSort} options={SORTS.map((value) => ({ value, label: t(SORT_KEY[value]) }))} menuWidth={180} />
              </div>
            ) : undefined
          }
        />
        {settingsQ.isError && (
          <ErrorState title={t('houses.listErrorTitle')} message={t('houses.listErrorText')} onRetry={() => { void settingsQ.refetch(); }} error={settingsQ.error} />
        )}
        {stats.length === 0 ? (
          <EmptyState
            icon={<Shield size={28} />}
            title={t('houses.emptyTitle')}
            text={t('houses.emptyText')}
            action={<Link className="btn primary" to="/$tree" params={{ tree }}>{t('houses.openTree')}</Link>}
          />
        ) : (
          <ul className="hs-grid">
            {sorted.map((s) => {
              const succ = houseSuccession(f, s.house, settings?.[s.house.id]);
              return (
                <li key={s.house.id}>
                  <HouseCard s={s} tree={tree} mine={s.house.id === myHouse} country={settings?.[s.house.id]?.country ?? null} head={succ.head?.id} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function HouseCard({ s, tree, mine, country, head }: { s: HouseStats; tree: string; mine: boolean; country: string | null; head?: string }) {
  const t = useT();
  const f = useFamily();
  const span = spanLabel(s, t('houses.present'));
  const total = s.members.length;
  const headName = head ? f.byId.get(head) : undefined;
  return (
    <Link to="/$tree/house/$house" params={{ tree, house: s.house.id }} className="ui-card interactive hs-card">
      <div className="hs-arms">
        <Arms arms={s.house.arms} size={96} country={country ?? undefined} />
      </div>
      <div className="hs-main">
        <h2 className="hs-name">{s.house.name}</h2>
        {s.house.motto && <p className="hs-motto">“{s.house.motto}”</p>}
        {mine && <span className="hs-chip" style={{ justifySelf: 'start', marginTop: 4 }}>{t('houses.yourHouse')}</span>}
        <dl className="hs-facts">
          <dt>{t('houses.membersHeading')}</dt>
          <dd className="hs-num">
            <b>{total.toLocaleString(locales[t.locale])}</b>
            {s.living > 0 && <span className="muted"> · {t('houses.livingCount', { count: s.living })}</span>}
          </dd>
          {headName && (
            <>
              <dt>{t('houses.headShort')}</dt>
              <dd className="hs-person">
                {[headName.given, headName.surname].filter(Boolean).join(' ')}
                {headName.epithet && <i> {headName.epithet}</i>}
              </dd>
            </>
          )}
          {s.founder && (
            <>
              <dt>{t('houses.founder')}</dt>
              <dd className="hs-person">
                {[s.founder.given, s.founder.surname].filter(Boolean).join(' ')}
                {s.founder.epithet && <i> {s.founder.epithet}</i>}
              </dd>
            </>
          )}
          {span && (
            <>
              <dt>{t('houses.years')}</dt>
              <dd className="hs-num">{span}</dd>
            </>
          )}
        </dl>
      </div>
      {total > 0 && (
        <div className="hs-spark">
          <GenSpark
            perGen={s.perGen}
            label={t('houses.sparkLabel', { name: s.house.name, generations: t('houses.generations', { count: s.generations }) })}
          />
          <small>{t('houses.perGeneration')}</small>
        </div>
      )}
    </Link>
  );
}

/** The chosen order, remembered per tree for this tab (read after hydration). */
function useSort(tree: string): [Sort, (s: Sort) => void] {
  const key = `houses:${tree}:sort`;
  const [sort, setSort] = useState<Sort>('size');
  useEffect(() => {
    try {
      const v = sessionStorage.getItem(key) as Sort | null;
      if (v && v in COMPARE) setSort(v);
    } catch { /* storage can be off */ }
  }, [key]);
  return [
    sort,
    (s) => {
      setSort(s);
      try { sessionStorage.setItem(key, s); } catch { /* storage can be off */ }
    },
  ];
}
