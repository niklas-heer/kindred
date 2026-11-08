// A chart of one or more daily series: lines (series that differ greatly in size get a panel each, sharing the day axis and the hover), or columns that stack. Plain SVG drawn at the size it is shown, so text stays one
// size on a phone and on a desktop, and colours come from the theme's CSS variables. A chart library would add far more than these
// three shapes need, and would have to be taught the three themes.
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { formatNumber, type Locale } from '~/lib/i18n';
import { niceMax, planPanels } from './panels';

export { niceMax };

export interface ChartSeries { label: string; color: string; values: number[] }

interface Props {
  days: string[];
  series: ChartSeries[];
  mode: 'lines' | 'bars';
  /** What the chart shows, for a screen reader; the table under the charts has the numbers. */
  label: string;
  /** A day as the reader writes it. */
  dayLabel: (day: string) => string;
  locale: Locale;
  /** Height of one panel. */
  height?: number;
}

const MARGIN = { top: 10, right: 12, bottom: 24, left: 34 };
const PANEL_TITLE = 18;
const PANEL_GAP = 12;
const DASH = '6 4';

/** A column with rounded data-end and a square foot on the baseline. */
function column(x: number, y: number, w: number, h: number, round: boolean): string {
  const r = round ? Math.min(4, w / 2, h) : 0;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function TimeChart({ days, series, mode, label, dayLabel, locale, height = 190 }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const n = days.length;
  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerH = height - MARGIN.top - MARGIN.bottom;
  const lines = mode === 'lines';
  const totals = days.map((_, i) => series.reduce((sum, s) => sum + s.values[i], 0));
  const groups = lines ? planPanels(series.map((s) => Math.max(0, ...s.values))) : [series.map((_, k) => k)];
  const titled = lines && series.length > 1 && groups.length > 1;
  const plotH = (titled ? innerH - PANEL_TITLE : innerH);
  const stride = MARGIN.top + (titled ? PANEL_TITLE : 0) + plotH + PANEL_GAP;
  const svgH = groups.length * stride - PANEL_GAP + MARGIN.bottom;
  const panels = groups.map((members, g) => {
    const peak = lines ? Math.max(0, ...members.flatMap((k) => series[k].values)) : Math.max(0, ...totals);
    const topV = niceMax(peak);
    const y0 = g * stride + MARGIN.top + (titled ? PANEL_TITLE : 0);
    return { members, topV, y0, ticks: topV % 2 === 0 ? [0, topV / 2, topV] : [0, topV], yAt: (v: number) => y0 + plotH - (v / topV) * plotH };
  });
  const band = n ? innerW / n : 0;
  const xMid = (i: number) => MARGIN.left + band * i + band / 2;
  const count = (v: number) => formatNumber(v, locale);

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - rect.left - MARGIN.left) / (band || 1));
    setHover(i >= 0 && i < n ? i : null);
  };

  const ready = width > 0 && n > 0;
  const at = hover ?? n - 1;
  let marks: ReactNode = null;
  if (ready && lines) {
    marks = panels.map((p) => p.members.map((k) => {
      const s = series[k];
      const line = s.values.map((v, i) => `${i ? 'L' : 'M'}${xMid(i).toFixed(1)},${p.yAt(v).toFixed(1)}`).join('');
      const area = `${line}L${xMid(n - 1).toFixed(1)},${p.yAt(0)}L${xMid(0).toFixed(1)},${p.yAt(0)}Z`;
      const dashed = k % 2 === 1;
      const r = 4;
      return (
        <g key={s.label}>
          {k === p.members[0] && <path d={area} fill={s.color} opacity={0.12} />}
          <path d={line} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={dashed ? DASH : undefined} />
          {dashed
            ? <rect x={xMid(at) - r} y={p.yAt(s.values[at]) - r} width={r * 2} height={r * 2} rx={1.5} fill={s.color} stroke="var(--st-surface)" strokeWidth={2} />
            : <circle cx={xMid(at)} cy={p.yAt(s.values[at])} r={r} fill={s.color} stroke="var(--st-surface)" strokeWidth={2} />}
        </g>
      );
    }));
  } else if (ready) {
    const { yAt } = panels[0];
    const barW = Math.min(24, Math.max(1.5, band - 2));
    const gap = barW >= 6 ? 2 : 1;
    marks = days.map((day, i) => {
      let base = 0;
      const last = series.reduce((found, s, k) => (s.values[i] > 0 ? k : found), -1);
      return (
        <g key={day} opacity={hover === null || hover === i ? 1 : 0.55}>
          {series.map((s, k) => {
            const v = s.values[i];
            if (!v) return null;
            const y1 = yAt(base + v);
            const y0 = yAt(base);
            base += v;
            const h = Math.max(1, y0 - y1 - (k === last ? 0 : gap));
            return <path key={s.label} d={column(xMid(i) - barW / 2, y0 - h, barW, h, k === last && barW >= 6)} fill={s.color} />;
          })}
        </g>
      );
    });
  }

  const labelled = n ? [0, Math.floor((n - 1) / 2), n - 1] : [];
  const anchors = ['start', 'middle', 'end'] as const;
  const tip = hover === null ? null : Math.min(Math.max(70, xMid(hover)), width - 70);
  const legend = lines && series.length > 1;

  return (
    <div className="st-chart-wrap">
      {legend && (
        <ul className="st-legend" aria-hidden>
          {series.map((s, k) => <li key={s.label}><i className={k % 2 === 1 ? 'dashed' : 'solid'} style={{ '--swatch': s.color } as CSSProperties} />{s.label}</li>)}
        </ul>
      )}
      <div ref={box} className="st-chart" style={{ height: svgH }}>
        {width > 0 && (
          <svg width={width} height={svgH} role="img" aria-label={label} onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setHover(null)}>
            {panels.map((p) => (
              <g key={p.y0}>
                {titled && p.members.map((k) => (
                  <text key={k} x={MARGIN.left} y={p.y0 - 7} className="st-axis st-panel-title">{series[k].label}</text>
                ))}
                {p.ticks.map((v) => (
                  <g key={v}>
                    <line x1={MARGIN.left} x2={width - MARGIN.right} y1={p.yAt(v)} y2={p.yAt(v)} className="st-grid" />
                    <text x={MARGIN.left - 7} y={p.yAt(v) + 4} textAnchor="end" className="st-axis">{count(v)}</text>
                  </g>
                ))}
                {hover !== null && <line x1={xMid(hover)} x2={xMid(hover)} y1={p.y0} y2={p.y0 + plotH} className="st-cross" />}
              </g>
            ))}
            {marks}
            {labelled.map((i, k) => (
              <text key={days[i]} x={k === 0 ? MARGIN.left : k === 2 ? width - MARGIN.right : xMid(i)} y={svgH - 7} textAnchor={anchors[k]} className="st-axis">{dayLabel(days[i])}</text>
            ))}
          </svg>
        )}
        {hover !== null && tip !== null && (
          <div className="st-tip" style={{ left: tip }} role="status">
            <b>{dayLabel(days[hover])}</b>
            {series.map((s) => (
              <span key={s.label}><i style={{ background: s.color }} />{s.label}<em>{count(s.values[hover])}</em></span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
