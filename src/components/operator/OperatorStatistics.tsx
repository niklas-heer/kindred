// The operator console's Statistics tab (docs/hosting-many-families.md, "Statistics"): how the whole server is used and how it
// grows, from the daily aggregates of the accounts database (src/lib/operator/stats.server.ts). It leads with four numbers and
// their change over 30 days, then growth charts, then cohorts, storage against the caps, AI spending and the families. Only
// counts, never a record; a breakdown below five is shown as "fewer than 5"; a family with usage statistics off shows no activity.
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { ErrorState, Segmented, Skeleton } from '~/components/ui';
import { formatDate, relativeTime, useT, type Key } from '~/lib/i18n';
import { operatorStatisticsQuery } from '~/lib/operator/insight.functions';
import { formatBytes } from '~/lib/operator/shared';
import { growth, inRange, series, shown, type InstanceDay, type Kind, type OperatorStatistics, type Point, type StatsRange } from '~/lib/operator/stats-shared';
import './operator.css';
import './ops.css';

const DAY = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (day: string) => Date.parse(`${day}T12:00:00Z`);

export function StatisticsTab() {
  const t = useT();
  const { data, isPending, isError, refetch } = useQuery(operatorStatisticsQuery);
  const [range, setRange] = useState<StatsRange>('12m');
  const rangeId = useId();
  if (isPending) return <div aria-busy="true" aria-label={t('operator.loading')}><Skeleton lines={8} /></div>;
  if (isError) return <ErrorState title={t('operator.err_load')} onRetry={() => { void refetch(); }} />;
  const today = data.now.day;
  // Today's live row ends every series, so the charts reach the present before tonight's count.
  const all = [...data.days.filter((d) => d.day < today), data.now];
  const days = inRange(all, range, today);
  return (
    <div className="operator-panel ops-stats">
      <p className="families-hint">{t('ops.stats_hint')}</p>
      <Headline data={data} all={all} />
      <section aria-labelledby="ops-growth" className="ops-section">
        <div className="operator-row">
          <h2 id="ops-growth" className="rule">{t('ops.growth')}</h2>
          <span className="operator-inline">
            <span id={rangeId} className="muted">{t('ops.range')}</span>
            <Segmented aria-labelledby={rangeId} value={range} onChange={setRange} size="sm"
              options={[{ value: '30d', label: t('ops.range_30d') }, { value: '12m', label: t('ops.range_12m') }, { value: 'all', label: t('ops.range_all') }]} />
          </span>
        </div>
        <div className="ops-charts">
          <Chart title="ops.chart_families" days={days} range={range} pick={(d) => d.families} kind="level" />
          <Chart title="ops.chart_accounts" days={days} range={range} pick={(d) => d.accounts} kind="level" />
          <Chart title="ops.chart_active" days={days} range={range} pick={(d) => d.activeMonth} kind="level" note="ops.active_note" />
          <Chart title="ops.chart_storage" days={days} range={range} pick={(d) => d.storageBytes} kind="level" bytes />
          <Chart title="ops.chart_views" days={days} range={range} pick={(d) => d.pageViews} kind="flow" />
        </div>
        {days.some((d) => d.backfilled) && <p className="families-hint">{t('ops.backfilled_note')}</p>}
      </section>
      <Cohorts data={data} />
      <Storage data={data} />
      <Activity data={data} />
      <Ai data={data} />
      <Families data={data} />
    </div>
  );
}

/** The value of a series on the first day of the last 30, for "+3 in 30 days"; null when that is not known. */
function before30(all: InstanceDay[], pick: (d: InstanceDay) => number | null, today: string): number | null {
  const start = isoDay(dayMs(today) - 30 * DAY);
  const d = all.find((x) => x.day >= start && pick(x) !== null);
  return d && d.day !== today ? pick(d) : null;
}

function Headline({ data, all }: { data: OperatorStatistics; all: InstanceDay[] }) {
  const t = useT();
  const n = data.now;
  const tiles: { label: Key; value: number | null; pick: (d: InstanceDay) => number | null }[] = [
    { label: 'ops.head_families', value: n.families, pick: (d) => d.families },
    { label: 'ops.head_active_families', value: n.activeFamilies, pick: (d) => d.activeFamilies },
    { label: 'ops.head_accounts', value: n.accounts, pick: (d) => d.accounts },
    { label: 'ops.head_monthly', value: n.activeMonth, pick: (d) => d.activeMonth },
  ];
  return (
    <dl className="ops-headline">
      {tiles.map((tile) => {
        const was = before30(all, tile.pick, n.day);
        const change = tile.value !== null && was !== null ? tile.value - was : null;
        return (
          <div key={tile.label} className="ui-card ops-tile">
            <dt>{t(tile.label)}</dt>
            <dd className="ops-tile-value">{tile.value ?? '–'}</dd>
            <dd className="ops-tile-change">
              {change === null ? t('ops.change_unknown') : t(change > 0 ? 'ops.change_up' : change < 0 ? 'ops.change_down' : 'ops.change_same', { count: Math.abs(change) })}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

const W = 320, H = 120, PAD = 4;

/** A small line chart: an SVG with its title and a description, and the same numbers as a table for a screen reader. */
function Chart({ title, days, range, pick, kind, bytes, note }: { title: Key; days: InstanceDay[]; range: StatsRange; pick: (d: InstanceDay) => number | null; kind: Kind; bytes?: boolean; note?: Key }) {
  const t = useT();
  const id = useId();
  const points = series(days, pick, kind, range);
  const known = points.filter((p): p is Point & { value: number } => p.value !== null);
  const fmt = (v: number) => (bytes ? formatBytes(v, t.locale) : new Intl.NumberFormat(t.locale).format(v));
  const g = growth(points);
  const max = Math.max(1, ...known.map((p) => p.value));
  const x = (i: number) => PAD + (points.length < 2 ? (W - 2 * PAD) / 2 : (i * (W - 2 * PAD)) / (points.length - 1));
  const y = (v: number) => H - PAD - (v / max) * (H - 2 * PAD);
  // Lines break where nothing is known (the days before active members were counted).
  const paths: string[] = [];
  let open = false;
  points.forEach((p, i) => {
    if (p.value === null) { open = false; return; }
    paths.push(`${open ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`);
    open = true;
  });
  const date = (day: string) => formatDate(dayMs(day), t.locale, range === 'all' && points.length > 60 ? { month: 'long', year: 'numeric' } : { day: 'numeric', month: 'long' });
  const desc = g ? t('ops.chart_desc', { from: fmt(g.from), to: fmt(g.to), start: date(points[0]!.day), end: date(points[points.length - 1]!.day) }) : t('ops.chart_empty');
  return (
    <figure className="ui-card ops-chart">
      <figcaption id={`${id}-t`}><b>{t(title)}</b> <span className="muted">{g ? fmt(g.to) : '–'}</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${id}-t ${id}-d`} preserveAspectRatio="none" className="ops-svg">
        <desc id={`${id}-d`}>{desc}</desc>
        <line x1={PAD} x2={W - PAD} y1={H - PAD} y2={H - PAD} className="ops-axis" />
        {paths.length > 0 && <path d={paths.join(' ')} className="ops-line" vectorEffect="non-scaling-stroke" />}
        {known.length === 1 && <circle cx={x(points.indexOf(known[0]!))} cy={y(known[0]!.value)} r={3} className="ops-dot" />}
      </svg>
      <div className="ops-chart-axis muted" aria-hidden><span>{points[0] ? date(points[0].day) : ''}</span><span>{points.length > 1 ? date(points[points.length - 1]!.day) : ''}</span></div>
      {note && <p className="families-hint">{t(note)}</p>}
      <details className="ops-details">
        <summary>{t('ops.as_table')}</summary>
        <div className="operator-table-wrap">
          <table className="operator-table">
            <thead><tr><th scope="col">{t('ops.col_period')}</th><th scope="col">{t(title)}</th></tr></thead>
            <tbody>{points.map((p) => <tr key={p.day}><td>{date(p.day)}</td><td>{p.value === null ? '–' : fmt(p.value)}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** A count in a breakdown: "fewer than 5" when it is small enough to point at a few people (the server already sent null). */
function Small({ n }: { n: number | null }) {
  const t = useT();
  const v = shown(n);
  return <>{v === null ? t('ops.fewer_than_5') : v}</>;
}

function Cohorts({ data }: { data: OperatorStatistics }) {
  const t = useT();
  return (
    <section aria-labelledby="ops-cohorts" className="ops-section">
      <h2 id="ops-cohorts" className="rule">{t('ops.cohorts')}</h2>
      <p className="families-hint">{t('ops.cohorts_hint')}</p>
      <div className="operator-table-wrap">
        <table className="operator-table">
          <thead><tr><th scope="col">{t('ops.col_families_made')}</th><th scope="col">{t('ops.col_families')}</th><th scope="col">{t('ops.col_visited_week')}</th></tr></thead>
          <tbody>
            {data.cohorts.map((c) => (
              <tr key={c.weeks}><td>{t('ops.weeks_ago_plus', { count: c.weeks })}</td><td>{c.families}</td><td><Small n={c.visitedLastWeek} /></td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>{t('ops.busy_families', { count: data.busyFamilies })}</p>
      <h3>{t('ops.retention')}</h3>
      <p className="families-hint">{t('ops.retention_hint')}</p>
      <div className="operator-table-wrap">
        <table className="operator-table">
          <thead><tr><th scope="col">{t('ops.col_accounts_made')}</th><th scope="col">{t('ops.col_accounts')}</th><th scope="col">{t('ops.col_active_week')}</th></tr></thead>
          <tbody>
            {data.retention.map((r) => (
              <tr key={r.weeksAgo}><td>{t('ops.weeks_ago', { count: r.weeksAgo })}</td><td><Small n={r.created} /></td><td>{shown(r.created) === null ? '–' : <Small n={r.activeLastWeek} />}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Storage({ data }: { data: OperatorStatistics }) {
  const t = useT();
  const s = data.storage;
  const share = s.capBytes ? Math.min(1, s.cappedUsedBytes / s.capBytes) : 0;
  return (
    <section aria-labelledby="ops-storage" className="ops-section">
      <h2 id="ops-storage" className="rule">{t('ops.storage')}</h2>
      <dl className="operator-facts">
        <div className="operator-fact"><dt>{t('ops.storage_used')}</dt><dd>{formatBytes(s.usedBytes, t.locale)}</dd></div>
        <div className="operator-fact"><dt>{t('ops.storage_capped')}</dt><dd>{s.cappedFamilies}</dd></div>
        <div className="operator-fact">
          <dt>{t('ops.storage_of_caps')}</dt>
          <dd>
            {s.cappedFamilies ? t('operator.storage_of', { used: formatBytes(s.cappedUsedBytes, t.locale), cap: formatBytes(s.capBytes, t.locale) }) : '–'}
            {s.cappedFamilies > 0 && <span className="operator-meter" role="presentation"><span style={{ width: `${Math.round(share * 100)}%` }} data-full={share >= 1 || undefined} /></span>}
          </dd>
        </div>
        <div className="operator-fact"><dt>{t('ops.storage_near')}</dt><dd>{s.nearCap}</dd></div>
      </dl>
    </section>
  );
}

function Activity({ data }: { data: OperatorStatistics }) {
  const t = useT();
  const n = data.now;
  // Sign-ins over the last 30 days, by method: summed on the server, before a count below five is suppressed.
  const methods = Object.entries(data.signIns30);
  return (
    <section aria-labelledby="ops-activity" className="ops-section">
      <h2 id="ops-activity" className="rule">{t('ops.activity')}</h2>
      <dl className="operator-facts">
        <div className="operator-fact"><dt>{t('ops.active_day')}</dt><dd>{n.activeDay ?? '–'}</dd></div>
        <div className="operator-fact"><dt>{t('ops.active_week')}</dt><dd>{n.activeWeek ?? '–'}</dd></div>
        <div className="operator-fact"><dt>{t('ops.members_median')}</dt><dd>{n.membersMedian ?? '–'}</dd></div>
        <div className="operator-fact"><dt>{t('ops.members_max')}</dt><dd>{n.membersMax ?? '–'}</dd></div>
        <div className="operator-fact"><dt>{t('ops.suspended_closed')}</dt><dd>{n.familiesSuspended ?? 0} / {n.familiesClosed ?? 0}</dd></div>
        <div className="operator-fact"><dt>{t('ops.requests_open')}</dt><dd>{n.requestsOpen ?? 0} / {n.dataRequestsOpen ?? 0}</dd></div>
        {methods.map(([k, v]) => (
          <div key={k} className="operator-fact"><dt>{t(k === 'passkey' ? 'ops.signins_passkey' : 'ops.signins_other')}</dt><dd><Small n={v} /></dd></div>
        ))}
      </dl>
      {data.statsOff > 0 && <p className="families-hint">{t('ops.stats_off_count', { count: data.statsOff })}</p>}
    </section>
  );
}

function Ai({ data }: { data: OperatorStatistics }) {
  const t = useT();
  const months = data.ai.slice(-12).reverse();
  const usd = (micros: number) => new Intl.NumberFormat(t.locale, { style: 'currency', currency: 'USD' }).format(micros / 1e6);
  return (
    <section aria-labelledby="ops-ai" className="ops-section">
      <h2 id="ops-ai" className="rule">{t('ops.ai')}</h2>
      {!months.length ? <p className="muted">{t('ops.ai_none')}</p> : (
        <div className="operator-table-wrap">
          <table className="operator-table">
            <thead><tr><th scope="col">{t('ops.col_month')}</th><th scope="col">{t('ops.col_spent')}</th></tr></thead>
            <tbody>{months.map((m) => <tr key={m.month}><td>{formatDate(Date.parse(`${m.month}-15T12:00:00Z`), t.locale, { month: 'long', year: 'numeric' })}</td><td>{usd(m.micros)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Families({ data }: { data: OperatorStatistics }) {
  const t = useT();
  return (
    <section aria-labelledby="ops-families" className="ops-section">
      <h2 id="ops-families" className="rule">{t('ops.families_table')}</h2>
      <p className="families-hint">{t('ops.families_table_hint')}</p>
      <div className="operator-table-wrap">
        <table className="operator-table">
          <thead>
            <tr>
              <th scope="col">{t('ops.col_family')}</th><th scope="col">{t('operator.members')}</th><th scope="col">{t('operator.storage')}</th>
              <th scope="col">{t('operator.last_activity')}</th><th scope="col">{t('ops.col_views')}</th>
            </tr>
          </thead>
          <tbody>
            {data.families.map((f) => (
              <tr key={f.id}>
                <td><span className="families-id">{f.id}</span>{f.status !== 'active' && <> <span className="chip operator-chip">{t(f.status === 'closed' ? 'operator.closed' : 'operator.suspended')}</span></>}</td>
                <td>{f.members}</td>
                <td>{f.capBytes === null ? formatBytes(f.usedBytes, t.locale) : t('operator.storage_of', { used: formatBytes(f.usedBytes, t.locale), cap: formatBytes(f.capBytes, t.locale) })}</td>
                {f.collecting
                  ? <><td>{f.lastActivity ? relativeTime(f.lastActivity, t.locale) : '–'}</td><td>{f.views30 ?? 0}</td></>
                  : <td colSpan={2} className="muted">{t('ops.stats_off')}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
