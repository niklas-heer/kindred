// The roll of houses: every house of the family as a card with its arms and country, motto, size, founder,
// the head today, years and a sparkline of members per generation. Each card opens the house's page.
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Plus, Shield, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Arms } from '~/components/Heraldry';
import { ReviewBadgeChip, useStewardBadges } from '~/components/HouseMeaning';
import { HouseCreateDialog, SurnameHousesDialog } from '~/components/HouseCreate';
import { EmptyState, ErrorState, PageHeader, Select } from '~/components/ui';
import { useFamily, useMeChosen, useTreeId } from '~/lib/family';
import { useCan } from '~/lib/session';
import { meaningLine, type ReviewBadge, type SavedMeaning } from '~/lib/house-meaning';
import { houseTranslationsQuery } from '~/lib/house-meaning.functions';
import { translateSaved } from '~/lib/house-translation';
import { GenSpark, houseStats, houseSuccession, maxGeneration, spanLabel, useHouseSettings, type HouseStats } from '~/lib/houses';
import { locales, translate, useT, type Locale } from '~/lib/i18n';
import { treeTitle } from '~/lib/title';
import '~/styles/house.css';
import { useDealt } from '~/lib/dealt';

export const Route = createFileRoute('/$tree/houses')({
  head: (ctx) => ({ meta: [{ title: treeTitle(ctx, translate((ctx.match.context as { locale?: Locale }).locale ?? 'en', 'houses.title')) }] }),
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
  // A steward's review badges and count; a viewer gets none, and nothing is queried for them.
  const steward = useStewardBadges(tree);

  const stats = useMemo(() => {
    const max = maxGeneration(f);
    return f.graph.houses.map((h) => houseStats(f, h, max));
  }, [f]);
  const sorted = useMemo(() => [...stats].sort((a, b) => COMPARE[sort](a, b) || sortName(a).localeCompare(sortName(b))), [stats, sort]);
  const inHouses = stats.reduce((n, s) => n + s.members.length, 0);
  // While every house waits for the same review, the count in the header says so once. A card carries its badge only when
  // it is an exception: once some houses are reviewed, or when they wait for different things.
  const badgeKinds = new Set<string>(stats.map((s) => steward.badges[s.house.id] ?? ''));
  const sameForAll = stats.length > 1 && steward.count > 0 && badgeKinds.size === 1 && !badgeKinds.has('');
  const dealt = useDealt();
  const myHouse = me ? f.byId.get(me)?.house : undefined;
  // Making houses is for stewards. "From surnames" needs someone without a house to gather.
  const canEdit = useCan('edit-house');
  const unhoused = f.graph.people.filter((p) => !p.house).length;
  const [creating, setCreating] = useState(false);
  const [surnaming, setSurnaming] = useState(false);
  const makeActions = canEdit ? (
    <>
      <button type="button" className="btn primary" onClick={() => setCreating(true)} aria-haspopup="dialog">
        <Plus size={16} /> {t('houses.new')}
      </button>
      {unhoused > 0 && (
        <button type="button" className="btn" onClick={() => setSurnaming(true)} aria-haspopup="dialog">
          <Users size={16} /> {t('houses.fromSurnames')}
        </button>
      )}
    </>
  ) : null;

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
            stats.length > 1 || steward.count > 0 || (stats.length > 0 && makeActions) ? (
              <div className="hs-toolbar">
                {steward.count > 0 && (
                  <Link className="hs-review-count" to="/$tree/needed" params={{ tree }}>
                    {t('houses.review.count', { count: steward.count })}
                  </Link>
                )}
                {stats.length > 1 && (
                  <>
                    <span id="hs-sort-label" className="sr-only">{t('houses.sortLabel')}</span>
                    <Select aria-labelledby="hs-sort-label" value={sort} onChange={setSort} options={SORTS.map((value) => ({ value, label: t(SORT_KEY[value]) }))} menuWidth={180} />
                  </>
                )}
                {stats.length > 0 && makeActions}
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
            text={
              <>
                <span>{t('houses.emptyText')}</span>
                <span className="hs-empty-how">{canEdit ? (f.graph.people.length ? t('houses.emptyHow') : t('houses.emptyNoPeople')) : t('houses.emptyViewer')}</span>
              </>
            }
            action={
              canEdit ? (
                <div className="hs-empty-actions">
                  <button type="button" className="btn primary" onClick={() => setCreating(true)}><Plus size={16} /> {t('houses.new')}</button>
                  {unhoused > 0 && <button type="button" className="btn" onClick={() => setSurnaming(true)}><Users size={16} /> {t('houses.fromSurnames')}</button>}
                </div>
              ) : (
                <Link className="btn primary" to="/$tree" params={{ tree }}>{t('houses.openTree')}</Link>
              )
            }
          />
        ) : (
          <ul className={`hs-grid ${dealt}`}>
            {sorted.map((s) => {
              const succ = houseSuccession(f, s.house, settings?.[s.house.id]);
              return (
                <li key={s.house.id}>
                  <HouseCard
                    s={s}
                    tree={tree}
                    mine={s.house.id === myHouse}
                    country={settings?.[s.house.id]?.country ?? null}
                    head={succ.head?.id}
                    meaning={steward.meanings?.[s.house.id]}
                    badge={sameForAll ? undefined : steward.badges[s.house.id]}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {canEdit && creating && <HouseCreateDialog open onClose={() => setCreating(false)} tree={tree} />}
      {canEdit && surnaming && <SurnameHousesDialog open onClose={() => setSurnaming(false)} tree={tree} />}
    </div>
  );
}

function HouseCard({ s, tree, mine, country, head, meaning, badge }: {
  s: HouseStats; tree: string; mine: boolean; country: string | null; head?: string; meaning?: SavedMeaning; badge?: ReviewBadge;
}) {
  const t = useT();
  const f = useFamily();
  const span = spanLabel(s, t('houses.present'));
  const total = s.members.length;
  const headName = head ? f.byId.get(head) : undefined;
  const translations = useQuery(houseTranslationsQuery(tree, t.locale)).data;
  const line = meaningLine(meaning && translateSaved(meaning, translations?.meanings[s.house.id]));
  return (
    <Link to="/$tree/house/$house" params={{ tree, house: s.house.id }} className="ui-card interactive hs-card">
      <div className="hs-arms">
        <Arms arms={s.house.arms} size={120} country={country ?? undefined} />
      </div>
      <div className="hs-main">
        <h2 className="hs-name">{s.house.name}</h2>
        {s.house.motto && <p className="hs-motto">“{s.house.motto}”</p>}
        {line && <p className="hs-meaning" title={line}>{line}</p>}
        {mine && <span className="hs-chip" style={{ justifySelf: 'start', marginTop: 4 }}>{t('houses.yourHouse')}</span>}
        {badge && <span className="hs-badge"><ReviewBadgeChip badge={badge} /></span>}
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
