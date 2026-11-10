// What the two charts and the book share: a sheet of paper, a face, a shield, and the line that says when and how it was printed.
import type { CSSProperties, ReactNode } from 'react';
import { Arms, houseColour } from '~/components/Heraldry';
import { faceOf, faceSrc } from '~/components/Portrait';
import type { Family } from '~/lib/graph';
import { formatDate, locales, type Translator } from '~/lib/i18n';
import { familyCrest, PX_PER_MM } from '~/lib/print';
import type { GPerson, House } from '~/lib/types';

export interface SheetSize { w: number; h: number }

/** What every printed thing is drawn from: the family as paper shows it, and the choices that shaped it. */
export interface PaperCtx {
  /** The family with the living and the photos already as the paper shows them (forPaper). */
  f: Family;
  tree: string;
  size: SheetSize;
  living: boolean;
  /** The day of printing, from the reader's clock. */
  today: Date;
}

/**
 * One sheet of paper at its real size. On screen its wrapper takes the scaled size and the sheet is scaled into it, so the
 * layout inside is the paper's own; in print the scale is gone and each sheet is a page (print.css).
 */
export function Sheet({ size, label, className = '', children }: { size: SheetSize; label: string; className?: string; children: ReactNode }) {
  const style = { '--w': `${size.w}mm`, '--h': `${size.h}mm` } as CSSProperties;
  return (
    <div className="pr-sheet-wrap" style={style}>
      <section className={`pr-sheet ${className}`} aria-label={label}>{children}</section>
    </div>
  );
}

export const houseOf = (f: Family, p: GPerson): House | undefined => (p.house ? f.house.get(p.house) : undefined);

/**
 * A face on paper: the photo or the drawing, in colour, on a pale ground of the house's tincture. Never the mourning tone:
 * that is the screen's. With `badge`, the house's shield sits on its lower corner, which leaves a narrow box its width for the name.
 */
export function Face({ p, f, tree, mm, badge }: { p: GPerson; f: Family; tree: string; mm: number; badge?: number }) {
  const house = houseOf(f, p);
  const src = faceSrc(p, tree, house, faceOf(p), mm >= 16 ? 'lg' : 'md');
  const style = { width: `${mm}mm`, height: `${mm}mm`, '--house': house ? houseColour(house.arms) : '#8a8270' } as CSSProperties;
  const face = <span className="pr-face" style={style}><img src={src} alt="" loading="eager" decoding="async" draggable={false} /></span>;
  return badge && house ? <span className="pr-badged">{face}<Shield house={house} mm={badge} /></span> : face;
}

/** A house's shield, `mm` wide: the same vector drawing as on screen. */
export function Shield({ house, mm, full }: { house: House; mm: number; full?: boolean }) {
  return <span className="pr-shield" aria-hidden><Arms arms={house.arms} size={mm * PX_PER_MM} full={full} /></span>;
}

/**
 * A partial date on paper, in the reader's language: "12 March 1901", "March 1901", "1901", "c. 854". Years before 1000
 * are written as they are (the app's own formatter expects four digits).
 */
function paperDate(d: string | undefined | null, t: Translator, month: 'short' | 'long'): string {
  if (!d) return '';
  const [y, m, day] = d.replace(/^~/, '').split('-').map(Number);
  if (!Number.isFinite(y)) return d;
  const date = new Date(0);
  date.setUTCFullYear(y, (m || 1) - 1, day || 1);
  const text = m ? new Intl.DateTimeFormat(locales[t.locale], { year: 'numeric', month, ...(day ? { day: 'numeric' as const } : {}), timeZone: 'UTC' }).format(date) : String(y);
  return d.startsWith('~') ? `${t('life.circa')}${text}` : text;
}
/** A date for a narrow place: "12 Mar 1901". */
export const shortDate = (d: string | undefined | null, t: Translator) => paperDate(d, t, 'short');
/** A date written out: "12 March 1901". */
export const longDate = (d: string | undefined | null, t: Translator) => paperDate(d, t, 'long');

/** The colophon: when it was printed, how many people are on it, and what of the living it shows. */
export function colophon(t: Translator, o: { today: Date; living: boolean; people?: number }): string {
  return [
    t('print.colophon', { date: formatDate(o.today, t.locale) }),
    o.people !== undefined ? t('print.colophon_people', { count: o.people }) : '',
    o.living ? t('print.colophon_living_full') : t('print.colophon_living_names'),
  ].filter(Boolean).join(' ');
}

/** A chart's head: the family's arms, what the chart is, and of which family. */
export function ChartHead({ ctx, title, sub }: { ctx: PaperCtx; title: string; sub: string }) {
  const crest = familyCrest(ctx.f)?.arms;
  return (
    <header className="pr-chart-head">
      {crest ? <span className="pr-shield" aria-hidden><Arms arms={crest} size={11 * PX_PER_MM} /></span> : null}
      <div>
        <h2>{title}</h2>
        <p>{sub}</p>
      </div>
    </header>
  );
}

export function ChartFoot({ ctx, t, page, pages }: { ctx: PaperCtx; t: Translator; page?: number; pages?: number }) {
  return (
    <footer className="pr-chart-foot">
      <span>{ctx.f.graph.tree.name} · {colophon(t, ctx)}</span>
      {pages && pages > 1 ? <span>{page} / {pages}</span> : null}
    </footer>
  );
}
