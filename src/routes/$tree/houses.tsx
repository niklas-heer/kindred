// The roll of houses: every house of the family as a card with its arms, motto, size, founder, years
// and a sparkline of members per generation. Each card opens the house's page.
import { createFileRoute, Link } from '@tanstack/react-router';
import { Shield } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Arms } from '~/components/Heraldry';
import { EmptyState, PageHeader, Select } from '~/components/ui';
import { useFamily, useMeChosen, useTreeId } from '~/lib/family';
import { GenSpark, houseStats, maxGeneration, spanLabel, type HouseStats } from '~/lib/houses';
import { sectionHead } from '~/lib/title';
import '~/styles/house.css';

export const Route = createFileRoute('/$tree/houses')({
  head: sectionHead('Houses'),
  component: HousesPage,
});

type Sort = 'size' | 'living' | 'oldest' | 'name';
const SORTS: { value: Sort; label: string }[] = [
  { value: 'size', label: 'Largest first' },
  { value: 'living', label: 'Most living' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name', label: 'By name' },
];
const sortName = (s: HouseStats) => s.house.name.replace(/^House (of )?/i, '');
const COMPARE: Record<Sort, (a: HouseStats, b: HouseStats) => number> = {
  size: (a, b) => b.members.length - a.members.length,
  living: (a, b) => b.living - a.living || b.members.length - a.members.length,
  oldest: (a, b) => (a.from ?? 1e9) - (b.from ?? 1e9),
  name: (a, b) => sortName(a).localeCompare(sortName(b)),
};

function HousesPage() {
  const f = useFamily();
  const tree = useTreeId();
  const me = useMeChosen();
  const [sort, setSort] = useSort(tree);

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
          title="Houses"
          icon={<Shield size={24} />}
          subtitle={
            stats.length
              ? `${stats.length} ${stats.length === 1 ? 'house' : 'houses'}, ${inHouses.toLocaleString('en-GB')} of ${f.graph.people.length.toLocaleString('en-GB')} people`
              : 'The family’s houses and their arms'
          }
          actions={
            stats.length > 1 ? (
              <div className="hs-toolbar">
                <span id="hs-sort-label" className="sr-only">Sort houses</span>
                <Select aria-labelledby="hs-sort-label" value={sort} onChange={setSort} options={SORTS} menuWidth={180} />
              </div>
            ) : undefined
          }
        />
        {stats.length === 0 ? (
          <EmptyState
            icon={<Shield size={28} />}
            title="No houses yet"
            text="This family has no houses recorded. Houses gather a line under one name and one coat of arms."
            action={<Link className="btn primary" to="/$tree" params={{ tree }}>Open the tree</Link>}
          />
        ) : (
          <ul className="hs-grid">
            {sorted.map((s) => (
              <li key={s.house.id}>
                <HouseCard s={s} tree={tree} mine={s.house.id === myHouse} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function HouseCard({ s, tree, mine }: { s: HouseStats; tree: string; mine: boolean }) {
  const span = spanLabel(s);
  const total = s.members.length;
  return (
    <Link to="/$tree/house/$house" params={{ tree, house: s.house.id }} className="ui-card interactive hs-card">
      <div className="hs-arms">
        <Arms arms={s.house.arms} size={96} />
      </div>
      <div className="hs-main">
        <h2 className="hs-name">{s.house.name}</h2>
        {s.house.motto && <p className="hs-motto">“{s.house.motto}”</p>}
        {mine && <span className="hs-chip" style={{ justifySelf: 'start', marginTop: 4 }}>Your house</span>}
        <dl className="hs-facts">
          <dt>Members</dt>
          <dd className="hs-num">
            <b>{total.toLocaleString('en-GB')}</b>
            {s.living > 0 && <span className="muted"> · {s.living.toLocaleString('en-GB')} living</span>}
          </dd>
          {s.founder && (
            <>
              <dt>Founder</dt>
              <dd className="hs-person">
                {[s.founder.given, s.founder.surname].filter(Boolean).join(' ')}
                {s.founder.epithet && <i> {s.founder.epithet}</i>}
              </dd>
            </>
          )}
          {span && (
            <>
              <dt>Years</dt>
              <dd className="hs-num">{span}</dd>
            </>
          )}
        </dl>
      </div>
      {total > 0 && (
        <div className="hs-spark">
          <GenSpark perGen={s.perGen} label={`${s.house.name}: members per generation, across ${s.generations} ${s.generations === 1 ? 'generation' : 'generations'}`} />
          <small>Members per generation</small>
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
