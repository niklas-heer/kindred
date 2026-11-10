// The descendant chart: the person on the left, a column for each generation after them, partners named with each person.
// A family that fits on one sheet is drawn as a tree, each parent level with the middle of their children. A larger one is
// an outline, everyone on a row of their own under their parent, in as many columns and pages as it needs; the lines carry
// on from the foot of one column to the head of the next.
import { useMemo, type CSSProperties } from 'react';
import { displayName, lifespan } from '~/lib/graph';
import { useT, type Translator } from '~/lib/i18n';
import { countNodes, descendantTree, placeDescendants, type DescendantNode, type PlacedNode } from '~/lib/print';
import { generationLabel } from './AncestorChart';
import { ChartFoot, ChartHead, Face, Sheet, type PaperCtx } from './parts';

const PAD = 11, HEAD = 17, LABEL = 6, FOOT = 7;
/** Tree: the least room a row needs, and the most it is given. */
const ROW_MIN = 9.4, ROW_MAX = 21, GUTTER = 8, COL_MAX = 80;
/** Outline: a row, a step to the right per generation, a card, and the space between two columns of it. */
const OUT_ROW = 9.4, OUT_STEP = 8, OUT_CARD = 70, OUT_GAP = 7;

interface Drawn { key: string; node: DescendantNode; x: number; y: number; w: number; h: number; big: boolean }
interface Page { cards: Drawn[]; lines: string[]; labels: { x: number; w: number; text: string }[] }

const depthOf = (n: DescendantNode): number => n.children.reduce((d, c) => Math.max(d, depthOf(c)), n.depth);

function layout(root: DescendantNode, size: { w: number; h: number }, t: Translator): Page[] {
  const W = size.w - 2 * PAD, H = size.h - 2 * PAD - HEAD - LABEL - FOOT;
  const top = PAD + HEAD + LABEL;
  const cols = depthOf(root) + 1;
  const tree = placeDescendants(root, 'tree');
  if (tree.rows * ROW_MIN <= H) {
    const rowH = Math.min(ROW_MAX, H / tree.rows);
    const colW = Math.min(COL_MAX, (W + GUTTER) / cols);
    const big = rowH >= 15;
    const h = big ? Math.min(rowH - 1.6, 18) : Math.min(rowH - 1.2, 8.4);
    const at = new Map<string, Drawn>();
    const cards = tree.placed.map(({ node, row }): Drawn => {
      const d = { key: node.key, node, x: PAD + node.depth * colW, y: top + (row + 0.5) * rowH, w: colW - GUTTER, h, big };
      at.set(node.key, d);
      return d;
    });
    const lines: string[] = [];
    for (const { node } of tree.placed) {
      if (!node.children.length) continue;
      const p = at.get(node.key)!;
      const kids = node.children.map((c) => at.get(c.key)!);
      const mid = p.x + p.w + GUTTER / 2;
      lines.push(`M${p.x + p.w} ${p.y}H${mid}`, `M${mid} ${Math.min(p.y, kids[0].y)}V${Math.max(p.y, kids[kids.length - 1].y)}`, ...kids.map((k) => `M${mid} ${k.y}H${k.x}`));
    }
    const labels = Array.from({ length: cols - 1 }, (_, i) => ({ x: PAD + (i + 1) * colW, w: colW - GUTTER, text: generationLabel(t, 'desc', i + 1) }));
    return [{ cards, lines, labels }];
  }
  // The outline, over frames (columns) and pages.
  const out = placeDescendants(root, 'outline');
  const frameW = Math.min(W, (cols - 1) * OUT_STEP + OUT_CARD);
  const cardW = frameW - (cols - 1) * OUT_STEP;
  const perPage = Math.max(1, Math.floor((W + OUT_GAP) / (frameW + OUT_GAP)));
  const perFrame = Math.max(1, Math.floor((H + LABEL) / OUT_ROW));
  const frames = Math.ceil(out.rows / perFrame);
  const pages: Page[] = Array.from({ length: Math.ceil(frames / perPage) }, () => ({ cards: [], lines: [], labels: [] }));
  const y0 = top - LABEL;
  const h = 8.2;
  const where = (p: PlacedNode) => {
    const frame = Math.floor(p.row / perFrame);
    return { frame, page: Math.floor(frame / perPage), x: PAD + (frame % perPage) * (frameW + OUT_GAP) + p.node.depth * OUT_STEP, y: y0 + ((p.row % perFrame) + 0.5) * OUT_ROW };
  };
  const frameX = (frame: number) => PAD + (frame % perPage) * (frameW + OUT_GAP);
  const placedBy = new Map(out.placed.map((p) => [p.node.key, p]));
  for (const p of out.placed) {
    const at = where(p);
    pages[at.page].cards.push({ key: p.node.key, node: p.node, x: at.x, y: at.y, w: cardW, h, big: false });
    if (!p.node.children.length) continue;
    // The trunk under this parent, down to the last child, through every column it crosses; then a stub to each child.
    const trunk = p.node.depth * OUT_STEP + 3;
    const last = where(placedBy.get(p.node.children[p.node.children.length - 1].key)!);
    for (let frame = at.frame; frame <= last.frame; frame++) {
      const from = frame === at.frame ? at.y + h / 2 : y0;
      const to = frame === last.frame ? last.y : y0 + perFrame * OUT_ROW;
      pages[Math.floor(frame / perPage)].lines.push(`M${frameX(frame) + trunk} ${from}V${to}`);
    }
    for (const c of p.node.children) {
      const k = where(placedBy.get(c.key)!);
      pages[k.page].lines.push(`M${frameX(k.frame) + trunk} ${k.y}H${k.x}`);
    }
  }
  return pages;
}

/** How many sheets the chart takes, so the page can say so before anyone prints. */
export function useDescendantChart(ctx: PaperCtx, root: string, gens: number) {
  const t = useT();
  return useMemo(() => {
    const tree = descendantTree(ctx.f, root, gens);
    return tree ? { tree, pages: layout(tree, ctx.size, t), people: countNodes(tree) } : undefined;
  }, [ctx.f, ctx.size, root, gens, t]);
}

export function DescendantChart({ ctx, chart, gens }: { ctx: PaperCtx; chart: NonNullable<ReturnType<typeof useDescendantChart>>; gens: number }) {
  const t = useT();
  const { f, size } = ctx;
  const person = f.byId.get(chart.tree.id)!;
  const title = t('print.desc.title', { name: displayName(person, f) });
  return (
    <>
      {chart.pages.map((page, i) => (
        <Sheet key={i} size={size} label={t('print.page_n', { n: i + 1 })} className="pr-chart">
          <ChartHead ctx={ctx} title={i ? `${title} (${t('print.continued')})` : title} sub={`${f.graph.tree.name} · ${t('print.generations_n', { count: gens })}`} />
          {page.labels.map((l) => <span key={l.x} className="pr-col-label" style={{ left: `${l.x}mm`, top: `${PAD + HEAD}mm`, width: `${l.w}mm` }}>{l.text}</span>)}
          <svg className="pr-lines" viewBox={`0 0 ${size.w} ${size.h}`} aria-hidden>
            <path d={page.lines.join('')} />
          </svg>
          {page.cards.map((c) => <DescendantCard key={c.key} ctx={ctx} card={c} t={t} />)}
          <ChartFoot ctx={ctx} t={t} page={i + 1} pages={chart.pages.length} />
        </Sheet>
      ))}
    </>
  );
}

function DescendantCard({ ctx, card, t }: { ctx: PaperCtx; card: Drawn; t: Translator }) {
  const { f, tree } = ctx;
  const p = f.byId.get(card.node.id)!;
  const style: CSSProperties = { left: `${card.x}mm`, top: `${card.y - card.h / 2}mm`, width: `${card.w}mm`, height: `${card.h}mm` };
  const span = lifespan(p, t.locale);
  // A narrow card names the partner; a wide one has room for their years too.
  const partners = card.node.partners.map((id) => f.byId.get(id)!).map((o) => `⚭ ${displayName(o, f)}${card.w >= 60 && lifespan(o, t.locale) ? ` ${lifespan(o, t.locale)}` : ''}`);
  return (
    <div className={`pr-box is-desc ${card.big ? 'is-lg' : 'is-md'}${card.node.repeat ? ' is-repeat' : ''}`} style={style}>
      <Face p={p} f={f} tree={tree} mm={card.big ? 9 : 5.8} badge={card.big ? 3.8 : 2.6} />
      <div className="pr-box-text">
        <span className="pr-box-name">{displayName(p, f)}{!card.big && span ? <span className="pr-box-span"> {span}</span> : null}</span>
        {card.big && span ? <span className="pr-box-line">{span}</span> : null}
        {card.node.repeat ? <span className="pr-box-line is-soft">{t('print.shown_above')}</span> : partners.length ? <span className="pr-box-line">{partners.join(' · ')}</span> : null}
      </div>
    </div>
  );
}
