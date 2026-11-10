// Print: an ancestor chart, a descendant chart or a family book, drawn in the browser and printed by it (no PDF is made
// on the server; "Save as PDF" in the print dialog keeps a file). The preview shows the sheets at the paper's own size,
// scaled to the window, and what prints is those same sheets (src/components/print/print.css).
//
// For members only: a share-link guest is told so, and the one read the book makes refuses them (print.server.ts). By
// default the living are on paper by name and place in the family only; the reader may ask for them in full, and the
// colophon on the paper says which it was. Every choice is in the address, so a link from a person's page opens on them.
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { BookOpen, GitFork, Printer } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { z } from 'zod';
import { PersonPicker } from '~/components/photos/PersonPicker';
import { Portrait } from '~/components/Portrait';
import { AncestorChart } from '~/components/print/AncestorChart';
import { Book, type BookState } from '~/components/print/Book';
import { DescendantChart, useDescendantChart } from '~/components/print/DescendantChart';
import type { PaperCtx } from '~/components/print/parts';
import { EmptyState, PageHeader, Segmented, Select, Switch, useIsClient } from '~/components/ui';
import { useFamily, useMeChosen, useTreeId } from '~/lib/family';
import { buildFamily, displayName, type Family } from '~/lib/graph';
import { compareText, formatNumber, translate, useT, type Locale } from '~/lib/i18n';
import {
  bookSections, clampGenerations, estimatePages, forPaper, GENERATIONS, ORIENTATIONS, PAPERS, PRODUCTS, PX_PER_MM, roundEstimate, scopePeople, SCOPES, sheetSize,
  type Orientation, type Paper, type Product, type Scope,
} from '~/lib/print';
import { useMember } from '~/lib/session';
import { treeTitle } from '~/lib/title';
import '~/components/print/print.css';

const search = z.object({
  product: z.enum(PRODUCTS).optional(),
  person: z.string().min(1).max(120).optional(),
  house: z.string().min(1).max(120).optional(),
  scope: z.enum(SCOPES).optional(),
  gens: z.number().int().min(2).max(6).optional(),
  paper: z.enum(PAPERS).optional(),
  orient: z.enum(ORIENTATIONS).optional(),
  living: z.boolean().optional(),
  photos: z.boolean().optional(),
});
type Search = z.infer<typeof search>;

export const Route = createFileRoute('/$tree/print')({
  validateSearch: (s: Record<string, unknown>): Search => { const r = search.safeParse(s); return r.success ? r.data : {}; },
  head: (ctx) => ({ meta: [{ title: treeTitle(ctx, translate((ctx.match.context as { locale?: Locale }).locale ?? 'en', 'print.title')) }] }),
  component: PrintPage,
});

/** A book of at most this many people is laid out as soon as it is chosen; a larger one waits to be asked for. */
const AUTO_BUILD = 150;

/** Who is in the book, section by section, how many they are, and about how many pages that comes to. */
function useBookPlan(f: Family, scope: Scope | undefined, person: string | undefined, house: string | undefined, living: boolean, photos: boolean) {
  return useMemo(() => {
    const sections = scope ? bookSections(f, scopePeople(f, scope, { person, house })) : [];
    return { sections, people: sections.reduce((n, x) => n + x.people.length, 0), estimate: roundEstimate(estimatePages(f, sections, { living, photos })) };
  }, [f, scope, person, house, living, photos]);
}

function PrintPage() {
  const t = useT();
  const tree = useTreeId();
  const f = useFamily();
  const member = !!useMember(tree);
  const s = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const me = useMeChosen();
  const client = useIsClient();
  const uid = useId();
  const set = (patch: Search) => void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true, resetScroll: false });

  const product: Product = s.product ?? 'ancestors';
  const fallback = [me, f.graph.tree.focus].find((id) => id && f.byId.has(id)) ?? undefined;
  const personId = s.person && f.byId.has(s.person) ? s.person : fallback;
  const person = personId ? f.byId.get(personId) : undefined;
  const paper: Paper = s.paper ?? 'a4';
  // A book is upright; a pedigree is wider than tall, a line of descendants taller than wide.
  const orient: Orientation = product === 'book' ? 'portrait' : s.orient ?? (product === 'ancestors' ? 'landscape' : 'portrait');
  const living = s.living ?? false;
  const photos = s.photos ?? true;
  const gens = product === 'book' ? 0 : clampGenerations(product, s.gens);
  const scope: Scope = s.scope ?? (s.person && person ? 'person' : person?.house || f.graph.houses.length ? 'house' : 'everyone');
  const houseId = s.house && f.house.has(s.house) ? s.house : person?.house && f.house.has(person.house) ? person.house : f.graph.houses[0]?.id;
  const size = useMemo(() => sheetSize(paper, orient), [paper, orient]);

  const paperFamily = useMemo(() => buildFamily(forPaper(f.graph, { living, photos })), [f.graph, living, photos]);
  const today = useMemo(() => new Date(), []);
  const ctx: PaperCtx = useMemo(() => ({ f: paperFamily, tree, size, living, today }), [paperFamily, tree, size, living, today]);

  // The preview is as wide as its column: the sheets are scaled to fit it, never above their real size.
  const preview = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    const el = preview.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, Math.max(0.2, (el.clientWidth - 24) / (size.w * PX_PER_MM))));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [size.w, member, client]);

  const { sections, people: bookPeople, estimate } = useBookPlan(paperFamily, product === 'book' ? scope : undefined, personId, houseId, living, photos);
  const [again, setAgain] = useState(0);
  const bookKey = JSON.stringify([tree, scope, scope === 'house' ? houseId : scope === 'everyone' ? '' : personId, paper, living, photos, t.locale, again]);
  const [asked, setAsked] = useState<string | null>(null);
  const [book, setBook] = useState<{ key: string; state: BookState } | null>(null);
  const building = product === 'book' && bookPeople > 0 && (bookPeople <= AUTO_BUILD || asked === bookKey);
  const bookState = building && book?.key === bookKey ? book.state : undefined;

  const chart = useDescendantChart(ctx, personId ?? '', product === 'descendants' ? gens : 1);
  const pages = product === 'ancestors' ? (person ? 1 : 0) : product === 'descendants' ? (person ? chart?.pages.length ?? 0 : 0) : bookState?.status === 'done' ? bookState.pages : 0;
  const ready = pages > 0;

  const doc = useRef<HTMLDivElement>(null);
  const [printing, setPrinting] = useState(false);
  const print = async () => {
    setPrinting(true);
    // A photo that has not arrived yet would print as an empty frame: wait for the pictures, but not for ever.
    const images = [...(doc.current?.querySelectorAll('img') ?? [])].filter((img) => !img.complete);
    await Promise.race([Promise.all(images.map((img) => img.decode().catch(() => undefined))), new Promise((r) => setTimeout(r, 15_000))]);
    setPrinting(false);
    window.print();
  };

  const needsPerson = product !== 'book' || scope === 'person' || scope === 'ancestors' || scope === 'descendants';
  const [picking, setPicking] = useState(false);
  const houses = useMemo(() => [...f.graph.houses].sort((a, b) => compareText(t.locale)(a.name, b.name)), [f.graph.houses, t.locale]);
  const name = person ? displayName(person, f) : '';
  const subtitle =
    scope === 'house' ? paperFamily.house.get(houseId ?? '')?.name ?? ''
    : scope === 'ancestors' ? t('print.anc.title', { name })
    : scope === 'descendants' ? t('print.desc.title', { name })
    : scope === 'person' ? name : '';

  const printButton = (
    <button type="button" className="btn primary" onClick={() => void print()} disabled={!ready || printing} data-keep-label>
      <Printer size={16} aria-hidden /> {ready ? t('print.print_pages', { count: pages }) : t('print.print')}
    </button>
  );

  return (
    <div className="page pr-page">
      <div className="page-inner pr-inner">
        <PageHeader title={t('print.title')} subtitle={t('print.subtitle')} icon={<Printer size={26} />} />
        {!member ? (
          <EmptyState icon={<Printer size={28} />} title={t('print.members_only_title')} text={t('print.members_only')} />
        ) : (
          <div className="pr-layout">
            <form className="pr-options ui-card" aria-label={t('print.options')} onSubmit={(e) => e.preventDefault()}>
              <div className="pr-field">
                <span className="pr-label" id={`${uid}-product`}>{t('print.product')}</span>
                <Select
                  aria-labelledby={`${uid}-product`}
                  value={product}
                  onChange={(v) => set({ product: v })}
                  options={[
                    { value: 'ancestors', label: t('print.product.ancestors'), icon: <GitFork size={15} style={{ transform: 'rotate(180deg)' }} /> },
                    { value: 'descendants', label: t('print.product.descendants'), icon: <GitFork size={15} /> },
                    { value: 'book', label: t('print.product.book'), icon: <BookOpen size={15} /> },
                  ]}
                />
                <p className="pr-hint">{t(`print.product.${product}_hint`)}</p>
              </div>

              {product === 'book' ? (
                <div className="pr-field">
                  <span className="pr-label" id={`${uid}-scope`}>{t('print.scope')}</span>
                  <Select
                    aria-labelledby={`${uid}-scope`}
                    value={scope}
                    onChange={(v) => set({ scope: v })}
                    options={[
                      { value: 'person', label: t('print.scope.person') },
                      ...(houses.length ? [{ value: 'house' as const, label: t('print.scope.house') }] : []),
                      { value: 'ancestors', label: t('print.scope.ancestors') },
                      { value: 'descendants', label: t('print.scope.descendants') },
                      { value: 'everyone', label: `${t('print.scope.everyone')} (${formatNumber(f.graph.people.length, t.locale)})` },
                    ]}
                  />
                </div>
              ) : null}

              {product === 'book' && scope === 'house' && houses.length ? (
                <div className="pr-field">
                  <span className="pr-label" id={`${uid}-house`}>{t('print.house')}</span>
                  <Select aria-labelledby={`${uid}-house`} value={houseId ?? ''} onChange={(v) => set({ house: v })} options={houses.map((h) => ({ value: h.id, label: h.name }))} />
                </div>
              ) : null}

              {needsPerson ? (
                <div className="pr-field">
                  <span className="pr-label">{t('print.person')}</span>
                  {person ? (
                    <div className="pr-who">
                      <Portrait person={person} tree={tree} size={36} decorative />
                      <span className="pr-who-name">{name}</span>
                      <button type="button" className="btn" aria-expanded={picking} onClick={() => setPicking((v) => !v)}>{t('print.person_change')}</button>
                    </div>
                  ) : <p className="pr-hint">{t('print.person_none')}</p>}
                  {picking || !person ? (
                    <PersonPicker label={t('print.person_pick')} portraits={tree} suggested={fallback ? [fallback] : undefined} onPick={(p) => { set({ person: p.id }); setPicking(false); }} />
                  ) : null}
                </div>
              ) : null}

              {product !== 'book' ? (
                <div className="pr-field">
                  <span className="pr-label" id={`${uid}-gens`}>{t('print.generations')}</span>
                  <Segmented
                    aria-labelledby={`${uid}-gens`}
                    size="sm"
                    block
                    value={String(gens)}
                    onChange={(v) => set({ gens: Number(v) })}
                    options={Array.from({ length: GENERATIONS[product].max - GENERATIONS[product].min + 1 }, (_, i) => ({ value: String(GENERATIONS[product].min + i), label: String(GENERATIONS[product].min + i) }))}
                  />
                </div>
              ) : null}

              <div className="pr-row">
                <div className="pr-field">
                  <span className="pr-label" id={`${uid}-paper`}>{t('print.paper')}</span>
                  <Segmented aria-labelledby={`${uid}-paper`} size="sm" block value={paper} onChange={(v) => set({ paper: v })} options={PAPERS.map((p) => ({ value: p, label: t(`print.paper.${p}`) }))} />
                </div>
                {product !== 'book' ? (
                  <div className="pr-field">
                    <span className="pr-label" id={`${uid}-orient`}>{t('print.orientation')}</span>
                    <Segmented aria-labelledby={`${uid}-orient`} size="sm" block value={orient} onChange={(v) => set({ orient: v })} options={ORIENTATIONS.map((o) => ({ value: o, label: t(`print.orientation.${o}`) }))} />
                  </div>
                ) : null}
              </div>

              <div className="pr-field">
                <Switch checked={living} onChange={(v) => set({ living: v })} aria-describedby={`${uid}-living`}>{t('print.living')}</Switch>
                <p className="pr-hint" id={`${uid}-living`}>{t('print.living_hint')}</p>
              </div>
              <div className="pr-field">
                <Switch checked={photos} onChange={(v) => set({ photos: v })} aria-describedby={`${uid}-photos`}>{t('print.photos')}</Switch>
                <p className="pr-hint" id={`${uid}-photos`}>{t('print.photos_hint')}</p>
              </div>

              <div className="pr-status">
                <div role="status" aria-live="polite">
                  {product !== 'book' ? (
                    !person ? <p className="pr-hint">{t('print.chart_none')}</p>
                    : pages > 1 ? <p className="pr-hint">{t('print.chart_pages_hint', { count: pages })}</p> : null
                  ) : bookPeople === 0 ? <p className="pr-hint">{t('print.book.empty')}</p>
                  : !building ? (
                    <>
                      <p>{t('print.book.estimate', { count: bookPeople, pages: formatNumber(estimate, t.locale) })}</p>
                      {estimate >= 300 ? <p className="pr-hint">{t('print.book.big_hint')}</p> : null}
                    </>
                  ) : bookState?.status === 'done' ? <p>{t('print.book.done', { count: bookState.total, pages: formatNumber(bookState.pages, t.locale) })}</p>
                  : bookState?.status === 'failed' ? <p>{t('print.book.failed')}</p>
                  : bookState?.status === 'finishing' ? <p>{t('print.book.finishing')}</p>
                  : <p>{t('print.book.building', { done: formatNumber(bookState?.done ?? 0, t.locale), total: formatNumber(bookPeople, t.locale), pages: formatNumber(bookState?.pages ?? 0, t.locale) })}</p>}
                </div>
                {product === 'book' && bookPeople > 0 && !building ? (
                  <button type="button" className="btn" onClick={() => setAsked(bookKey)}><BookOpen size={15} aria-hidden /> {t('print.book.build')}</button>
                ) : null}
                {building && bookState && (bookState.status === 'building' || bookState.status === 'finishing') ? (
                  <>
                    <progress max={bookState.total} value={bookState.done} aria-label={t('print.book.build')} />
                    {bookPeople > AUTO_BUILD ? <button type="button" className="btn" onClick={() => setAsked(null)}>{t('print.book.stop')}</button> : null}
                  </>
                ) : null}
                {building && bookState?.status === 'failed' ? <button type="button" className="btn" onClick={() => { setAgain((n) => n + 1); setAsked(null); }}>{t('print.book.again')}</button> : null}
                {printButton}
                <p className="pr-hint">{t('print.save_pdf')}</p>
              </div>
            </form>

            <section className="pr-preview" aria-label={t('print.preview_label')} ref={preview}>
              <p className="pr-preview-title"><span>{t('print.preview')}</span>{pages ? <span>{t('print.pages', { count: pages })}</span> : null}</p>
              <style dangerouslySetInnerHTML={{ __html: `@page { size: ${size.w}mm ${size.h}mm; margin: 0; }` }} />
              <div className="pr-doc" ref={doc} style={{ '--pr-scale': scale } as CSSProperties} data-product={product} data-ready={ready || undefined}>
                {!client ? null
                : product === 'ancestors' ? (personId ? <AncestorChart ctx={ctx} root={personId} gens={gens} /> : <p className="pr-doc-empty">{t('print.chart_none')}</p>)
                : product === 'descendants' ? (chart ? <DescendantChart ctx={ctx} chart={chart} gens={gens} /> : <p className="pr-doc-empty">{t('print.chart_none')}</p>)
                : building ? <Book key={bookKey} ctx={ctx} sections={sections} photos={photos} subtitle={subtitle} onState={(state) => setBook({ key: bookKey, state })} />
                : <p className="pr-doc-empty">{bookPeople ? t('print.book.estimate', { count: bookPeople, pages: formatNumber(estimate, t.locale) }) : t('print.book.empty')}</p>}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
