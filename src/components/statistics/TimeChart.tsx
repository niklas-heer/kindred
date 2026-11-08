// A chart of one or more daily series: an area line, or columns that stack. Plain SVG drawn at the size it is shown, so text stays one
// size on a phone and on a desktop, and colours come from the theme's CSS variables. A chart library would add far more than these
// three shapes need, and would have to be taught the three themes.
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { formatNumber, type Locale } from '~/lib/i18n';

export interface ChartSeries { label: string; color: string; values: number[] }

interface Props {
  days: string[];
  series: ChartSeries[];
  mode: 'area' | 'bars';
  /** What the chart shows, for a screen reader; the table under the charts has the numbers. */
  label: string;
  /** A day as the reader writes it. */
  dayLabel: (day: string) => string;
  locale: Locale;
  height?: number;
}

const MARGIN = { top: 10, right: 12, bottom: 24, left: 34 };

/** A round top for the axis: at least 2, so one member on one day is not a full-height column. */
export function niceMax(max: number): number {
  if (max <= 2) return 2;
  const step = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 1.5, 2, 3, 4, 5, 6, 8, 10]) if (m * step >= max) return Math.ceil(m * step);
  return Math.ceil(max);
}

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
  const totals = days.map((_, i) => series.reduce((sum, s) => sum + s.values[i], 0));
  const top = niceMax(Math.max(0, ...totals));
  const ticks = top % 2 === 0 ? [0, top / 2, top] : [0, top];
  const yAt = (v: number) => MARGIN.top + innerH - (v / top) * innerH;
  const band = n ? innerW / n : 0;
  const xMid = (i: number) => MARGIN.left + band * i + band / 2;
  const count = (v: number) => formatNumber(v, locale);

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - rect.left - MARGIN.left) / (band || 1));
    setHover(i >= 0 && i < n ? i : null);
  };

  let marks: ReactNode = null;
  if (width > 0 && n > 0 && mode === 'area') {
    const s = series[0];
    const line = s.values.map((v, i) => `${i ? 'L' : 'M'}${xMid(i).toFixed(1)},${yAt(v).toFixed(1)}`).join('');
    const area = `${line}L${xMid(n - 1).toFixed(1)},${yAt(0)}L${xMid(0).toFixed(1)},${yAt(0)}Z`;
    marks = (
      <>
        <path d={area} fill={s.color} opacity={0.12} />
        <path d={line} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={xMid(hover ?? n - 1)} cy={yAt(s.values[hover ?? n - 1])} r={4} fill={s.color} stroke="var(--st-surface)" strokeWidth={2} />
      </>
    );
  } else if (width > 0 && n > 0) {
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

  return (
    <div ref={box} className="st-chart" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label} onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setHover(null)}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={MARGIN.left} x2={width - MARGIN.right} y1={yAt(v)} y2={yAt(v)} className="st-grid" />
              <text x={MARGIN.left - 7} y={yAt(v) + 4} textAnchor="end" className="st-axis">{count(v)}</text>
            </g>
          ))}
          {marks}
          {labelled.map((i, k) => (
            <text key={days[i]} x={k === 0 ? MARGIN.left : k === 2 ? width - MARGIN.right : xMid(i)} y={height - 7} textAnchor={anchors[k]} className="st-axis">{dayLabel(days[i])}</text>
          ))}
          {hover !== null && <line x1={xMid(hover)} x2={xMid(hover)} y1={MARGIN.top} y2={MARGIN.top + innerH} className="st-cross" />}
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
  );
}
