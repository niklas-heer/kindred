// The stewards' picture of how Kindred is used in this family: counts only, kept in the family's own database (src/lib/stats).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { BarChart3, Eye, KeyRound, Minus, ShieldCheck, TrendingUp } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { TimeChart } from '~/components/statistics/TimeChart';
import { EmptyState, ErrorState, Notice, PageHeader, Segmented, Skeleton } from '~/components/ui';
import { Switch } from '~/components/ui/Switch';
import { errorText } from '~/lib/errortext';
import { useFamily, useTreeId } from '~/lib/family';
import { formatNumber, locales, useT, type Key, type Translator } from '~/lib/i18n';
import { useCan } from '~/lib/session';
import { setStatsCollecting, statsOverviewQuery } from '~/lib/stats/functions';
import { CHANGE_KINDS, percentChange, VIEWS, type ChangeKind, type Overview, type Tone, type ViewKey } from '~/lib/stats/overview';
import { CATEGORIES, RANGES, type EventName, type RangeDays, type RouteName } from '~/lib/stats/shared';
import { sectionHead } from '~/lib/title';
import '~/styles/statistics.css';

export const Route = createFileRoute('/$tree/statistics')({
  head: sectionHead('Statistics'),
  component: StatisticsPage,
});

const CHANGE_COLOR: Record<ChangeKind, string> = { people: 'var(--st-1)', photos: 'var(--st-2)', stories: 'var(--st-3)', research: 'var(--st-4)' };
const CHANGE_LABEL: Record<ChangeKind, Key> = { people: 'stats.change.people', photos: 'stats.change.photos', stories: 'stats.change.stories', research: 'stats.change.research' };
const CHANGE_COUNT: Record<ChangeKind, Key> = { people: 'stats.count.people', photos: 'stats.count.photos', stories: 'stats.count.stories', research: 'stats.count.research' };
const ROUTE_LABEL: Record<RouteName, Key> = {
  tree: 'stats.route.tree', almanac: 'stats.route.almanac', atlas: 'stats.route.atlas', contacts: 'stats.route.contacts', register: 'stats.route.register',
  houses: 'stats.route.houses', house: 'stats.route.house', needed: 'stats.route.needed', chronicle: 'stats.route.chronicle', gallery: 'stats.route.gallery',
  research: 'stats.route.research', 'research-project': 'stats.route.research_project', access: 'stats.route.access', settings: 'stats.route.settings',
};
const EVENT_LABEL: Record<EventName, Key> = {
  'assistant.asked': 'stats.event.assistant', 'arms.designed': 'stats.event.arms', 'research.added': 'stats.event.research',
  'tour.finished': 'stats.event.tour_finished', 'tour.skipped': 'stats.event.tour_skipped',
};
const TONE_ICON: Record<Tone, ReactNode> = { good: <TrendingUp size={17} />, neutral: <Minus size={17} />, watch: <Eye size={17} /> };

function StatisticsPage() {
  const t = useT();
  const tree = useTreeId();
  const f = useFamily();
  const steward = useCan('view-statistics');
  const [days, setDays] = useState<RangeDays>(30);
  const [view, setView] = useState<ViewKey>('family');
  const overview = useQuery({ ...statsOverviewQuery(tree, days), enabled: steward });

  if (!steward) {
    return <div className="page"><div className="page-inner"><EmptyState icon={<KeyRound size={30} />} title={t('stats.only_stewards_title')} text={t('stats.only_stewards_text', { family: f.graph.tree.name })} /></div></div>;
  }

  return (
    <div className="page"><div className="page-inner st">
      <PageHeader
        title={t('stats.title')}
        subtitle={t('stats.subtitle')}
        icon={<BarChart3 size={26} />}
        actions={<Segmented aria-label={t('stats.range')} value={String(days)} onChange={(v) => setDays(Number(v) as RangeDays)} options={RANGES.map((d) => ({ value: String(d), label: t('stats.days', { count: d }) }))} />}
      />
      {overview.isError ? <ErrorState title={t('stats.load_failed')} error={overview.error} onRetry={() => void overview.refetch()} />
        : overview.data ? <Report o={overview.data} t={t} tree={tree} view={view} setView={setView} />
        : <Skeleton height={420} />}
    </div></div>
  );
}

const VIEW_LABEL: Record<ViewKey, Key> = {
  family: 'stats.view.family', all: 'stats.view.all', steward: 'stats.view.steward', editor: 'stats.view.editor',
  contributor: 'stats.view.contributor', viewer: 'stats.view.viewer', guest: 'stats.view.guest',
};

function Report({ o, t, tree, view, setView }: { o: Overview; t: Translator; tree: string; view: ViewKey; setView: (v: ViewKey) => void }) {
  const s = o.slices[view];
  const count = (n: number) => formatNumber(n, t.locale);
  const short = new Intl.DateTimeFormat(locales[t.locale], { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const long = new Intl.DateTimeFormat(locales[t.locale], { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const dayLabel = (day: string) => short.format(Date.parse(`${day}T00:00:00Z`));
  const days = s.series.map((p) => p.day);
  const rangeActive = o.days === 7 ? s.active.d7 : o.days === 30 ? s.active.d30 : s.active.d90;
  const nothing = !o.since && o.slices.all.totals.changes === 0;
  const guest = view === 'guest';
  const category = (CATEGORIES as readonly string[]).includes(view);

  const delta = (now: number, before: number) => {
    const p = percentChange(now, before);
    return p === null ? t('stats.no_comparison') : t('stats.vs_previous', { change: `${p > 0 ? '+' : ''}${count(p)}%`, count: o.days });
  };

  return (
    <>
      {!o.collecting && <Notice>{t('stats.off_notice')}</Notice>}
      {nothing && o.collecting && <Notice>{t('stats.empty_notice')}</Notice>}

      <div className="st-view">
        <Segmented aria-label={t('stats.view.label')} value={view} onChange={setView} size="sm"
          options={VIEWS.map((v) => ({ value: v, label: t(VIEW_LABEL[v]) }))} />
        <p className="st-caption" id="st-scope">
          {view === 'family' ? t('stats.scope.family') : view === 'all' ? t('stats.scope.all') : t('stats.scope.one', { who: t(VIEW_LABEL[view]) })}
        </p>
        {category && !guest && s.members === 0 && <Notice>{t('stats.small_none')}</Notice>}
        {category && !guest && s.members === 1 && <Notice>{t('stats.small_one')}</Notice>}
        {guest && <Notice>{t('stats.guest_note')}</Notice>}
        {view === 'all' && o.beforeCategories > 0 && <Notice>{t('stats.before_cats', { count: o.beforeCategories })}</Notice>}
        {view !== 'all' && !guest && !s.changesKnown && o.categorized && <Notice>{t('stats.changes_partial', { day: dayLabel(o.categorized) })}</Notice>}
      </div>

      <section className="st-tiles" aria-label={t('stats.summary')} aria-describedby="st-scope">
        {!guest && <Tile label={t('stats.tile.views')} value={count(s.totals.views)} note={delta(s.totals.views, s.previous.views)} />}
        {!guest && <Tile label={t('stats.tile.active')} value={count(rangeActive)} note={t('stats.of_members', { count: s.members })} />}
        <Tile label={t('stats.tile.visits')} value={count(s.totals.visits + s.totals.guests)} note={guest ? delta(s.totals.guests, s.previous.guests) : t('stats.guests', { count: s.totals.guests })} />
        {!guest && <Tile label={t('stats.tile.changes')} value={count(s.totals.changes)} note={s.changesKnown ? delta(s.totals.changes, s.previous.changes) : o.categorized ? t('stats.changes_since', { day: dayLabel(o.categorized) }) : t('stats.no_comparison')} />}
      </section>

      <section className="st-card st-reception" data-verdict={s.reception.verdict}>
        <h2>{t('stats.reception_title')}</h2>
        <p className="st-verdict">{t(`stats.verdict.${s.reception.verdict}` as Key)}</p>
        <ul>
          {s.reception.points.map((p) => (
            <li key={p.key} data-tone={p.tone}><span aria-hidden>{TONE_ICON[p.tone]}</span>{t(p.key, p.vars)}</li>
          ))}
        </ul>
        <p className="st-caption">{t('stats.reception_limit')}</p>
      </section>

      <Card title={t('stats.chart.both')} note={t('stats.chart.both_note')}>
        <TimeChart mode="lines" days={days} dayLabel={dayLabel} locale={t.locale} label={t('stats.chart.both')} height={170}
          series={[
            { label: t('stats.tile.views'), color: 'var(--st-1)', values: s.series.map((p) => p.views) },
            { label: t('stats.tile.active'), color: 'var(--st-2)', values: s.series.map((p) => p.active) },
          ]} />
      </Card>

      <Card title={t('stats.chart.changes')} note={t('stats.chart.changes_note')}>
        <ul className="st-legend">
          {CHANGE_KINDS.map((k) => <li key={k}><i style={{ background: CHANGE_COLOR[k] }} />{t(CHANGE_LABEL[k])}</li>)}
        </ul>
        <TimeChart mode="bars" days={days} dayLabel={dayLabel} locale={t.locale} label={t('stats.chart.changes')} height={210}
          series={CHANGE_KINDS.map((k) => ({ label: t(CHANGE_LABEL[k]), color: CHANGE_COLOR[k], values: s.series.map((p) => p[k]) }))} />
      </Card>

      <Who o={o} t={t} count={count} />

      <details className="st-card st-table">
        <summary>{t('stats.show_table')}</summary>
        <div className="st-table-scroll" tabIndex={0}>
          <table>
            <thead><tr>
              <th scope="col">{t('stats.table.day')}</th><th scope="col">{t('stats.tile.views')}</th><th scope="col">{t('stats.tile.visits')}</th><th scope="col">{t('stats.tile.active')}</th>
              {CHANGE_KINDS.map((k) => <th scope="col" key={k}>{t(CHANGE_LABEL[k])}</th>)}
            </tr></thead>
            <tbody>
              {[...s.series].reverse().map((p) => (
                <tr key={p.day}><th scope="row">{dayLabel(p.day)}</th><td>{count(p.views)}</td><td>{count(p.visits)}</td><td>{count(p.active)}</td>{CHANGE_KINDS.map((k) => <td key={k}>{count(p[k])}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <div className="st-grid-2">
        <Card title={t('stats.most_visited')}>
          <Ranked rows={s.routes.map((r) => ({ id: r.name, label: t(ROUTE_LABEL[r.name]), n: r.n }))} empty={t('stats.none_yet')} count={count} />
        </Card>
        <Card title={t('stats.most_used')}>
          <Ranked rows={s.features.map((r) => ({ id: r.name, label: t(EVENT_LABEL[r.name]), n: r.n }))} empty={t('stats.none_yet')} count={count} />
        </Card>
      </div>

      <div className="st-grid-2">
        <Card title={t('stats.recent')}>
          {s.recent.length === 0 ? <p className="st-none">{t('stats.none_yet')}</p> : (
            <ul className="st-recent">
              {s.recent.map((r) => (
                <li key={r.day}>
                  <b>{long.format(Date.parse(`${r.day}T00:00:00Z`))}</b>
                  <span>{CHANGE_KINDS.filter((k) => r[k] > 0).map((k) => t(CHANGE_COUNT[k], { count: r[k] })).join(' · ')}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={t('stats.first_steps')}>
          <dl className="st-steps">
            <div><dt>{t('stats.tour_finished')}</dt><dd>{count(o.tour.finished)}</dd></div>
            <div><dt>{t('stats.tour_skipped')}</dt><dd>{count(o.tour.skipped)}</dd></div>
            <div><dt>{t('stats.feedback')}</dt><dd>{count(o.feedback)}</dd></div>
            <div><dt>{t('stats.active_week')}</dt><dd>{count(s.active.d7)}</dd></div>
          </dl>
        </Card>
      </div>

      <Collection on={o.collecting} tree={tree} t={t} />
    </>
  );
}

/** Who did what in this range, one row per category: totals only. A group of one may be one person, and the page says so above. */
function Who({ o, t, count }: { o: Overview; t: Translator; count: (n: number) => string }) {
  const cell = (v: ViewKey) => {
    const s = o.slices[v];
    return {
      v, visits: s.totals.visits + s.totals.guests, active: v === 'guest' ? null : o.days === 7 ? s.active.d7 : o.days === 30 ? s.active.d30 : s.active.d90,
      views: s.totals.views, changes: v === 'guest' ? null : s.changesKnown ? s.totals.changes : null, features: s.features.reduce((n, f) => n + f.n, 0), members: s.members,
    };
  };
  const rows = (['steward', 'editor', 'contributor', 'viewer', 'guest'] as const).map(cell);
  const dash = '–';
  return (
    <Card title={t('stats.who_title')} note={t('stats.who_note')}>
      <div className="st-table-scroll" tabIndex={0}>
        <table className="st-who">
          <thead><tr>
            <th scope="col">{t('stats.col.group')}</th><th scope="col">{t('stats.tile.visits')}</th><th scope="col">{t('stats.tile.active')}</th>
            <th scope="col">{t('stats.tile.views')}</th><th scope="col">{t('stats.tile.changes')}</th><th scope="col">{t('stats.col.features')}</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.v}>
                <th scope="row">{t(VIEW_LABEL[r.v])}</th><td>{count(r.visits)}</td><td>{r.active === null ? dash : count(r.active)}</td>
                <td>{r.v === 'guest' ? dash : count(r.views)}</td><td>{r.changes === null ? dash : count(r.changes)}</td><td>{r.v === 'guest' ? dash : count(r.features)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Collection({ on, tree, t }: { on: boolean; tree: string; t: Translator }) {
  const qc = useQueryClient();
  const change = useMutation({
    mutationFn: (next: boolean) => setStatsCollecting({ data: { tree, on: next } }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['statistics', tree] }),
  });
  return (
    <section className="st-card st-privacy">
      <h2><ShieldCheck size={18} /> {t('stats.privacy_title')}</h2>
      <Switch checked={on} disabled={change.isPending} onChange={(next) => change.mutate(next)}>{t('stats.collect_switch')}</Switch>
      {change.isError && <Notice>{errorText(change.error, t.locale)}</Notice>}
      <p>{t('stats.privacy_counted')}</p>
      <p>{t('stats.privacy_never')}</p>
      <p>{t('stats.privacy_dnt')}</p>
    </section>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="st-card st-tile"><span>{label}</span><b>{value}</b><small>{note}</small></div>;
}

function Card({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return <section className="st-card"><h2>{title}</h2>{note && <p className="st-caption">{note}</p>}{children}</section>;
}

function Ranked({ rows, empty, count }: { rows: { id: string; label: string; n: number }[]; empty: string; count: (n: number) => string }) {
  if (!rows.length) return <p className="st-none">{empty}</p>;
  const top = rows[0].n;
  return (
    <ul className="st-ranked">
      {rows.slice(0, 8).map((r) => (
        <li key={r.id}>
          <span className="st-ranked-label">{r.label}</span>
          <span className="st-ranked-track"><i style={{ width: `${Math.max(2, (r.n / top) * 100)}%` }} /></span>
          <b>{count(r.n)}</b>
        </li>
      ))}
    </ul>
  );
}
