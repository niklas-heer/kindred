// The ancestor chart: one sheet, the person on the left and a column for each generation before them. Every place of the
// pedigree is drawn where its child is known, so an unknown grandmother is an empty frame to write in, not a hole.
// Boxes are placed in millimetres; the nearer generations have room for a face and dates, the farthest for a line each.
import { Fragment, type CSSProperties } from 'react';
import { displayName, lifespan } from '~/lib/graph';
import { useT, type Translator } from '~/lib/i18n';
import { ancestorSlots } from '~/lib/print';
import type { GPerson } from '~/lib/types';
import { ChartFoot, ChartHead, Face, houseOf, Sheet, Shield, shortDate, type PaperCtx } from './parts';

const PAD = 11, HEAD = 17, LABEL = 6, FOOT = 7, GUTTER = 5;
const WEIGHTS = [1.3, 1.15, 1.05, 1, 0.95, 0.9];

type Kind = 'xl' | 'lg' | 'md' | 'sm';
const kindOf = (slot: number): Kind => (slot >= 36 ? 'xl' : slot >= 17 ? 'lg' : slot >= 8.6 ? 'md' : 'sm');
const BOX_H: Record<Kind, number> = { xl: 31, lg: 14.5, md: 8, sm: 4.5 };
const FACE: Record<Kind, number> = { xl: 19, lg: 10.5, md: 5.6, sm: 0 };
const SHIELD: Record<Kind, number> = { xl: 5.4, lg: 4.2, md: 2.6, sm: 2.2 };

export const generationLabel = (t: Translator, kind: 'anc' | 'desc', g: number): string =>
  g === 1 ? t(`print.${kind}.gen1`) : g === 2 ? t(`print.${kind}.gen2`) : g === 3 ? t(`print.${kind}.gen3`) : t(`print.${kind}.gen_n`, { n: g - 2 });

export function AncestorChart({ ctx, root, gens }: { ctx: PaperCtx; root: string; gens: number }) {
  const t = useT();
  const { f, size } = ctx;
  const person = f.byId.get(root);
  if (!person) return null;
  const slots = ancestorSlots(f, root, gens);
  const W = size.w - 2 * PAD, H = size.h - 2 * PAD - HEAD - LABEL - FOOT;
  const top = PAD + HEAD + LABEL;
  const total = WEIGHTS.slice(0, gens).reduce((s, w) => s + w, 0);
  const colW = WEIGHTS.slice(0, gens).map((w) => (W + GUTTER) * (w / total));
  const colX = colW.map((_, g) => PAD + colW.slice(0, g).reduce((s, w) => s + w, 0));
  const boxOf = (g: number, i: number) => {
    const slot = H / 2 ** g;
    const kind = g === 0 ? 'xl' : kindOf(slot);
    const w = colW[g] - GUTTER;
    // Six generations upright leave columns too narrow for a name beside a face, but tall places: there the face stands
    // above the name, and the smaller boxes take a second line.
    const slim = w < 36;
    const stack = slim && (kind === 'xl' || kind === 'lg') && slot >= 27;
    const roomy = slim && !stack && ((kind === 'md' && slot >= 13) || (kind === 'sm' && slot >= 7));
    const h = Math.min(stack ? (kind === 'xl' ? 47 : 26) : roomy ? (kind === 'md' ? 12.2 : 6.9) : BOX_H[kind], slot - 0.6);
    return { kind, x: colX[g], y: top + (i + 0.5) * slot - h / 2, w, h, mid: top + (i + 0.5) * slot, shape: stack ? ' is-stack' : roomy ? ' is-roomy' : '' };
  };
  const lines: string[] = [];
  const boxes: { key: string; g: number; i: number; id?: string }[] = [];
  slots.forEach((row, g) => row.forEach((id, i) => {
    const child = g === 0 ? undefined : slots[g - 1][i >> 1];
    if (g > 0 && !child) return;
    boxes.push({ key: `${g}:${i}`, g, i, id });
    if (g === 0) return;
    const a = boxOf(g - 1, i >> 1), b = boxOf(g, i);
    const mid = b.x - GUTTER / 2;
    lines.push(`M${a.x + a.w} ${a.mid}H${mid}V${b.mid}H${b.x}`);
  }));
  return (
    <Sheet size={size} label={t('print.page_n', { n: 1 })} className="pr-chart">
      <ChartHead ctx={ctx} title={t('print.anc.title', { name: displayName(person, f) })} sub={`${f.graph.tree.name} · ${t('print.generations_n', { count: gens })}`} />
      {colX.map((x, g) => g > 0 && <span key={g} className="pr-col-label" style={{ left: `${x}mm`, top: `${PAD + HEAD}mm`, width: `${colW[g] - GUTTER}mm` }}>{generationLabel(t, 'anc', g)}</span>)}
      <svg className="pr-lines" viewBox={`0 0 ${size.w} ${size.h}`} aria-hidden>
        <path d={lines.join('')} />
      </svg>
      {boxes.map((b) => {
        const box = boxOf(b.g, b.i);
        const style: CSSProperties = { left: `${box.x}mm`, top: `${box.y}mm`, width: `${box.w}mm`, height: `${box.h}mm` };
        const p = b.id ? f.byId.get(b.id) : undefined;
        return (
          <Fragment key={b.key}>
            {p ? <AncestorBox ctx={ctx} p={p} kind={box.kind} style={style} t={t} narrow={box.w < 50} shape={box.shape} /> : <div className={`pr-box is-${box.kind} is-open`} style={style} aria-hidden />}
          </Fragment>
        );
      })}
      <ChartFoot ctx={ctx} t={t} />
    </Sheet>
  );
}

function AncestorBox({ ctx, p, kind, style, t, narrow, shape }: { ctx: PaperCtx; p: GPerson; kind: Kind; style: CSSProperties; t: Translator; narrow: boolean; shape: string }) {
  const { f, tree } = ctx;
  const house = houseOf(f, p);
  const name = displayName(p, f);
  const span = lifespan(p, t.locale);
  // In a narrow column (six generations upright) a box has no room for two dated lines beside the face: the years do.
  const detailed = kind === 'xl' || (kind === 'lg' && !narrow);
  const withPlace = (date: string, place?: string) => (kind === 'xl' && place ? `${date}, ${place}` : date);
  return (
    <div className={`pr-box is-${kind}${narrow ? ' is-narrow' : ''}${shape}`} style={style}>
      {FACE[kind] ? <Face p={p} f={f} tree={tree} mm={narrow && kind === 'xl' ? 14 : FACE[kind]} badge={SHIELD[kind]} /> : house ? <Shield house={house} mm={SHIELD[kind]} /> : null}
      <div className="pr-box-text">
        <span className="pr-box-name">{name}</span>
        {detailed ? (
          <>
            {p.born ? <span className="pr-box-line">{withPlace(t('print.born_short', { date: shortDate(p.born, t) }), p.bornPlace)}</span> : null}
            {!p.living && p.died ? <span className="pr-box-line">{withPlace(t('print.died_short', { date: shortDate(p.died, t) }), p.diedPlace)}</span> : null}
            {kind === 'xl' && !narrow && p.occupation ? <span className="pr-box-line is-soft">{p.occupation}</span> : null}
          </>
        ) : span ? <span className="pr-box-line">{span}</span> : null}
      </div>
    </div>
  );
}
