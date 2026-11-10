// The family book: a cover with the family's arms, the contents, a section for each house with its people, the sources the
// facts rest on, and a register of names with the page of every person.
//
// The browser cannot be asked on which page something landed, so the book lays its own pages: each block is set once off
// the page at the paper's width and measured, and the Paginator (src/lib/print.ts) puts whole blocks on sheets of the
// paper's height. Every sheet is then exactly one printed page, which is what makes the page numbers, the contents and the
// register true. It is built a batch of people at a time (one request and one measurement each), so a book of 1,600 people
// shows its first pages at once, says how far it is, and never holds the browser for long.
import { useQueryClient } from '@tanstack/react-query';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Arms } from '~/components/Heraldry';
import type { Source } from '~/lib/events';
import { displayName, lifespan, yearOf } from '~/lib/graph';
import { compareText, formatDate, useT } from '~/lib/i18n';
import { familyCrest, isNamesOnly, Paginator, PX_PER_MM, registerLines, registerPages, type BookPage, type BookSection, type RegisterLine } from '~/lib/print';
import { getPrintPeople } from '~/lib/print.functions';
import { sourcesQuery } from '~/lib/sources.functions';
import { entryPieces, housePieces, PageRefs, sourcePieces, type EntryCtx, type Piece } from './entry';
import { colophon, Sheet, type PaperCtx, type SheetSize } from './parts';

/** The book's page, in millimetres: the margins, the running head, and the room kept for the page number. */
const SIDE = 20, TOP = 15, HEAD = 6, GAP = 5, BOTTOM = 18;
const bodyOf = (size: SheetSize) => ({ w: size.w - 2 * SIDE, h: size.h - TOP - HEAD - GAP - BOTTOM });
const TOC_TITLE = 22, TOC_ROW = 7;
const REG_TITLE = 18, REG_ROW = 4.3, REG_COLUMNS = 3, REG_FOOT = 9;
const BATCH = 40;

export interface BookState { status: 'building' | 'finishing' | 'done' | 'failed'; done: number; total: number; pages: number }

interface Job { pieces: Piece[]; done: (heights: number[]) => void }

/** Sets blocks off the page at the paper's width, and reports how tall each came out. */
function Measurer({ job, width }: { job: Job | null; width: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!job || !ref.current) return;
    job.done([...ref.current.children].map((el) => el.getBoundingClientRect().height));
  }, [job]);
  return (
    <div className="pr-measure" aria-hidden>
      <div ref={ref} className="pr-flow" style={{ width: `${width}mm` }}>
        {job?.pieces.map((p) => <div className="pr-piece" key={p.key}>{p.node}</div>)}
      </div>
    </div>
  );
}

const FlowSheet = memo(function FlowSheet({ size, n, family, section, keys, nodes, label }: {
  size: SheetSize; n: number; family: string; section: string; keys: readonly string[]; len: number; nodes: ReadonlyMap<string, ReactNode>; label: string;
}) {
  return (
    <Sheet size={size} label={label} className="pr-book">
      <div className="pr-head"><span>{family}</span><span>{section}</span></div>
      <div className="pr-body pr-flow">{keys.map((k) => <div className="pr-piece" key={k}>{nodes.get(k)}</div>)}</div>
      <div className="pr-foot">{n}</div>
    </Sheet>
  );
}, (a, b) => a.len === b.len && a.n === b.n && a.section === b.section && a.size === b.size && a.label === b.label);

interface Tail { register: RegisterLine[][][]; firstRegisterPage: number; sourcesPage?: number }

export function Book({ ctx, sections, photos, subtitle, onState }: {
  ctx: PaperCtx;
  sections: readonly BookSection[];
  photos: boolean;
  /** What the book is of, under the family's name on the cover: a house, someone's ancestors. Empty for everyone. */
  subtitle: string;
  onState: (s: BookState) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const { f, tree, size, living, today } = ctx;
  const body = bodyOf(size);
  const total = useMemo(() => sections.reduce((n, s) => n + s.people.length, 0), [sections]);
  const tocRows = Math.max(1, Math.floor((body.h - TOC_TITLE) / TOC_ROW));
  const tocPages = Math.ceil((sections.length + 2) / tocRows);
  const front = 1 + tocPages;

  const nodes = useRef(new Map<string, ReactNode>());
  const [pages, setPages] = useState<BookPage[]>([]);
  const [starts, setStarts] = useState<ReadonlyMap<string, number>>(new Map());
  const [refs, setRefs] = useState<ReadonlyMap<string, number> | null>(null);
  const [tail, setTail] = useState<Tail | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const report = useRef(onState);
  report.current = onState;

  // One build per mount: the page gives the book a new key when anything it is made from changes.
  useEffect(() => {
    let live = true;
    const numbers = new Map<string, number>();
    const numbersOf = { of: (id: string) => numbers.get(id) ?? (numbers.set(id, numbers.size + 1), numbers.size) };
    const paginator = new Paginator(body.h * PX_PER_MM - 2);
    const pageOf = new Map<string, number>();
    const sectionStart = new Map<string, number>();
    const measure = (pieces: Piece[]) => new Promise<number[]>((done) => setJob({ pieces, done }));
    const add = async (groups: { person?: string; pieces: Piece[] }[]) => {
      const flat = groups.flatMap((g) => g.pieces);
      for (const p of flat) nodes.current.set(p.key, p.node);
      const heights = await measure(flat);
      let i = 0;
      for (const g of groups) {
        const page = paginator.add(g.pieces.map((p) => ({ key: p.key, h: heights[i++], keep: p.keep })));
        if (g.person) pageOf.set(g.person, front + page + 1);
      }
    };
    const pause = () => new Promise<void>((r) => setTimeout(r, 0));
    const run = async () => {
      report.current({ status: 'building', done: 0, total, pages: front });
      // The faces the book is set in must be there before anything is measured: a late font would move every line.
      const sample = 'AÄñłő';
      await Promise.all(['10pt "Kindred Paper"', 'italic 10pt "Kindred Paper"', '600 10pt "Kindred Paper"', '600 10pt "Cinzel Variable"'].map((font) => document.fonts.load(font, sample).catch(() => undefined)));
      await document.fonts.ready;
      const sources = new Map<string, Source>((await qc.fetchQuery(sourcesQuery(tree))).map((s) => [s.id, s]));
      if (!live) return;
      const c: EntryCtx = { ...ctx, t, sources, numbers: numbersOf };
      let done = 0;
      for (const s of sections) {
        const house = s.house ? f.house.get(s.house) : undefined;
        const members = s.people.map((id) => f.byId.get(id)!);
        const years = members.flatMap((p) => [yearOf(p.born), yearOf(p.died)]).filter(Number.isFinite);
        const founder = house?.founder && s.people.includes(house.founder) ? f.byId.get(house.founder) : undefined;
        paginator.startSection(house ? house.name : t('print.book.other'));
        sectionStart.set(s.house, front + paginator.pages.length);
        await add([{ pieces: housePieces(c, house, s.people.length, founder, years.length ? `${Math.min(...years)}–${Math.max(...years)}` : '') }]);
        for (let i = 0; i < s.people.length; i += BATCH) {
          const ids = s.people.slice(i, i + BATCH);
          const details = new Map((await getPrintPeople({ data: { tree, ids, living, photos } })).map((d) => [d.id, d]));
          if (!live) return;
          await add(ids.map((id) => {
            const p = f.byId.get(id)!;
            return { person: id, pieces: entryPieces(c, p, details.get(id), isNamesOnly(p, living)) };
          }));
          if (!live) return;
          done += ids.length;
          setPages([...paginator.pages]);
          setStarts(new Map(sectionStart));
          report.current({ status: 'building', done, total, pages: front + paginator.pages.length });
          await pause();
        }
      }
      report.current({ status: 'finishing', done, total, pages: front + paginator.pages.length });
      let sourcesPage: number | undefined;
      if (numbers.size) {
        paginator.startSection(t('print.book.sources'));
        sourcesPage = front + paginator.pages.length;
        await add(sourcePieces(c, [...numbers].map(([id, n]) => ({ id, n })).sort((a, b) => a.n - b.n)).map((p) => ({ pieces: [p] })));
        if (!live) return;
      }
      const perColumn = Math.floor((body.h - REG_FOOT) / REG_ROW);
      const lines = registerLines(f, sections.flatMap((s) => s.people), compareText(t.locale));
      const register = registerPages(lines, perColumn, REG_COLUMNS, Math.floor((body.h - REG_FOOT - REG_TITLE) / REG_ROW));
      const firstRegisterPage = front + paginator.pages.length + 1;
      setPages([...paginator.pages]);
      setStarts(new Map(sectionStart));
      setRefs(pageOf);
      setTail({ register, firstRegisterPage, sourcesPage });
      setJob(null);
      report.current({ status: 'done', done, total, pages: front + paginator.pages.length + register.length });
    };
    run().catch((e) => {
      console.error('[kindred] the book could not be laid out', e);
      if (live) report.current({ status: 'failed', done: 0, total, pages: 0 });
    });
    return () => { live = false; };
    // The page remounts the book (a new key) when its inputs change, so this runs once for each book.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const family = f.graph.tree.name;
  // A book of one house wears that house's arms; any other the family's.
  const crest = (sections.length === 1 && sections[0].house ? f.house.get(sections[0].house) : undefined)?.arms ?? familyCrest(f)?.arms;
  const page = (n: number) => t('print.page_n', { n });
  const toc: { key: string; text: string; page?: number }[] = [
    ...sections.map((s) => ({ key: `h:${s.house}`, text: s.house ? f.house.get(s.house)?.name ?? '' : t('print.book.other'), page: starts.get(s.house) })),
    ...(tail?.sourcesPage ? [{ key: 'sources', text: t('print.book.sources'), page: tail.sourcesPage }] : []),
    { key: 'register', text: t('print.book.register'), page: tail?.firstRegisterPage },
  ];

  return (
    <PageRefs.Provider value={refs}>
      <Sheet size={size} label={page(1)} className="pr-book pr-cover">
        <div className="pr-cover-frame">
          {crest ? <span className="pr-shield" aria-hidden><Arms arms={crest} size={58 * PX_PER_MM} full /></span> : <span className="pr-cover-mark" aria-hidden>❦</span>}
          <p className="pr-cover-title">{family}</p>
          {f.graph.tree.tagline ? <p className="pr-cover-tagline">{f.graph.tree.tagline}</p> : null}
          {subtitle ? <p className="pr-cover-scope">{subtitle}</p> : null}
          <p className="pr-cover-date">{formatDate(today, t.locale)}</p>
          <p className="pr-cover-colophon">{colophon(t, { today, living, people: total })}</p>
        </div>
      </Sheet>
      {Array.from({ length: tocPages }, (_, i) => (
        <Sheet key={`toc${i}`} size={size} label={page(2 + i)} className="pr-book">
          <div className="pr-head"><span>{family}</span><span>{t('print.book.contents')}</span></div>
          <div className="pr-body">
            {i === 0 ? <h2 className="pr-section-title pr-toc-title">{t('print.book.contents')}</h2> : null}
            <ol className="pr-toc">
              {toc.slice(i * tocRows, (i + 1) * tocRows).map((row) => (
                <li key={row.key}><span>{row.text}</span><span className="pr-leader" aria-hidden /><span className="pr-pageref">{row.page ?? ''}</span></li>
              ))}
            </ol>
          </div>
          <div className="pr-foot">{2 + i}</div>
        </Sheet>
      ))}
      {pages.map((p, i) => (
        <FlowSheet key={i} size={size} n={front + i + 1} family={family} section={p.section} keys={p.keys} len={p.keys.length} nodes={nodes.current} label={page(front + i + 1)} />
      ))}
      {tail?.register.map((columns, i) => {
        const n = tail.firstRegisterPage + i;
        return (
          <Sheet key={`reg${i}`} size={size} label={page(n)} className="pr-book">
            <div className="pr-head"><span>{family}</span><span>{t('print.book.register')}</span></div>
            <div className="pr-body">
              {i === 0 ? <h2 className="pr-section-title pr-reg-title">{t('print.book.register')}</h2> : null}
              <div className="pr-register">
                {columns.map((column, ci) => (
                  <ul key={ci}>
                    {column.map((line, li) => line.kind === 'letter' ? <li key={li} className="pr-reg-letter">{line.text}</li> : <RegisterRow key={li} ctx={ctx} line={line} page={refs?.get(line.id!)} locale={t.locale} />)}
                  </ul>
                ))}
              </div>
              {i === tail.register.length - 1 ? <p className="pr-colophon">{colophon(t, { today, living, people: total })}</p> : null}
            </div>
            <div className="pr-foot">{n}</div>
          </Sheet>
        );
      })}
      <Measurer job={job} width={body.w} />
    </PageRefs.Provider>
  );
}

function RegisterRow({ ctx, line, page, locale }: { ctx: PaperCtx; line: RegisterLine; page?: number; locale: Parameters<typeof lifespan>[1] }) {
  const p = ctx.f.byId.get(line.id!);
  const span = p ? lifespan(p, locale) : '';
  return (
    <li className="pr-rel" title={p ? displayName(p, ctx.f) : undefined}>
      <span className="pr-rel-name">{line.text}{span ? <span className="pr-soft"> {span}</span> : null}</span>
      <span className="pr-leader" aria-hidden />
      <span className="pr-pageref">{page ?? ''}</span>
    </li>
  );
}
