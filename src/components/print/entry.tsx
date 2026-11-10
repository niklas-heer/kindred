// A person's entry in the family book, as the blocks the pages are laid out from: the head with the portrait and the vital
// dates, the family (parents, partners, children, each with the page they are on), the life as a timeline, the biography,
// the memories, the photographs and the sources. A block is never cut in two; an entry that fits a page is never split
// (src/lib/print.ts, Paginator). The same blocks are measured off-page and then set on the pages, so nothing in them may
// change height on its own: pictures have fixed frames, and a page number fills a place kept for it.
import { createContext, useContext, type ReactNode } from 'react';
import { eventTitle } from '~/components/life/records';
import { mediaUrl } from '~/components/photos/types';
import { AFTER_DEATH, type Source } from '~/lib/events';
import { age, children, displayName, fullName, lifespan, parents, sortedUnions, yearOf } from '~/lib/graph';
import { formatDate, type Translator } from '~/lib/i18n';
import { ageOn, widowedOn, type Age } from '~/lib/life';
import { renderMarkdown } from '~/lib/markdown';
import type { PrintCitation, PrintPerson } from '~/lib/print.server';
import type { GPerson, House } from '~/lib/types';
import { Face, houseOf, longDate, Shield, shortDate, type PaperCtx } from './parts';

/** One block of the book before it is measured. */
export interface Piece { key: string; node: ReactNode; keep?: boolean }

/** The page each person's entry starts on, once the book is laid out. Until then the places stay empty. */
export const PageRefs = createContext<ReadonlyMap<string, number> | null>(null);
function PageRef({ id }: { id: string }) {
  const n = useContext(PageRefs)?.get(id);
  return <span className="pr-pageref">{n ?? ''}</span>;
}

/** The book's numbering of sources: each gets the next number the first time an entry cites it. */
export interface SourceNumbers { of(source: string): number }

export interface EntryCtx extends PaperCtx {
  t: Translator;
  sources: ReadonlyMap<string, Source>;
  numbers: SourceNumbers;
}

/** A paragraph longer than this is set as several, so no single block can outgrow a page. */
const LONG_PARAGRAPH = 1800;

/**
 * Text as blocks that may stand on different pages: paragraphs, with the items of one list kept together. A very long
 * paragraph is cut between sentences: a block is never split on the page, so one taller than a page would lose its end.
 */
export function textBlocks(text: string): string[] {
  const out: string[] = [];
  const listy = (s: string) => /^\s*(?:\d+[.)]|[-*+])\s/.test(s);
  for (const block of text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)) {
    if (out.length && listy(block) && listy(out[out.length - 1])) { out[out.length - 1] += `\n\n${block}`; continue; }
    if (block.length <= LONG_PARAGRAPH || listy(block) || block.startsWith('```')) { out.push(block); continue; }
    let part = '';
    for (const sentence of block.split(/(?<=[.!?…])\s+/)) {
      if (part && part.length + sentence.length > LONG_PARAGRAPH * 0.8) { out.push(part); part = sentence; }
      else part = part ? `${part} ${sentence}` : sentence;
    }
    if (part) out.push(part);
  }
  return out;
}

const Md = ({ text, className = '' }: { text: string; className?: string }) => <div className={`pr-md ${className}`} dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />;

const Cites = ({ numbers }: { numbers: number[] }) => (numbers.length ? <sup className="pr-cite">{[...new Set(numbers)].sort((a, b) => a - b).join(', ')}</sup> : null);

/** `order` sorts moments of one year: birth 0, the life 1, death 2, what follows a death 3. */
interface Moment { key: string; year: number; order: number; date?: string; text: string; note?: string; age?: Age; cites: number[] }

/** The life as the timeline reads it: birth, the recorded events, partnerships and their ends, children's births, death. */
function moments(c: EntryCtx, p: GPerson, d: PrintPerson): Moment[] {
  const { f, t } = c;
  const cite = (match: (x: PrintCitation) => boolean) => d.citations.filter(match).map((x) => c.numbers.of(x.source));
  const out: Moment[] = [];
  if (Number.isFinite(yearOf(p.born))) {
    out.push({ key: 'born', year: yearOf(p.born), order: 0, date: p.born, text: p.bornPlace ? t('print.tl.born_in', { place: p.bornPlace }) : t('print.tl.born'), cites: cite((x) => x.fact === 'birth') });
  }
  for (const e of d.events) {
    if (p.living && AFTER_DEATH.has(e.type)) continue;
    const what = `${eventTitle(e, t)}${e.type !== 'custom' && e.label ? `: ${e.label}` : ''}`;
    const year = e.date ? yearOf(e.date) : Number.POSITIVE_INFINITY;
    const until = e.endDate && yearOf(e.endDate) !== year ? ` (${t('events.until', { year: String(yearOf(e.endDate)) })})` : '';
    out.push({
      key: `ev:${e.id}`, year, order: AFTER_DEATH.has(e.type) ? 3 : 1, date: e.date ?? undefined,
      text: `${e.place ? t('print.tl.event_in', { what, place: e.place }) : what}${until}`,
      note: e.note || undefined, age: e.date ? ageOn(p.born, e.date) : undefined, cites: cite((x) => x.event === e.id),
    });
  }
  for (const u of f.unionsOf.get(p.id) ?? []) {
    const o = f.byId.get(u.a === p.id ? u.b : u.a);
    if (!o) continue;
    const name = displayName(o, f);
    if (Number.isFinite(yearOf(u.start))) {
      const married = u.kind === 'marriage';
      const text = u.place
        ? t(married ? 'print.tl.married_in' : 'print.tl.partnered_in', { name, place: u.place })
        : t(married ? 'print.tl.married' : 'print.tl.partnered', { name });
      out.push({ key: `u${u.id}`, year: yearOf(u.start), order: 1, date: u.start, text, age: ageOn(p.born, u.start), cites: cite((x) => x.partnership === u.id) });
    }
    if (Number.isFinite(yearOf(u.end)) && u.endReason !== 'death') {
      out.push({ key: `e${u.id}`, year: yearOf(u.end), order: 1, date: u.end, text: t(u.endReason === 'divorce' ? 'print.tl.divorced' : 'print.tl.parted', { name }), age: ageOn(p.born, u.end), cites: [] });
    }
    const died = widowedOn(p, o, u);
    if (died && Number.isFinite(yearOf(died))) out.push({ key: `w${u.id}`, year: yearOf(died), order: 1, date: died, text: t('print.tl.widowed', { name }), age: ageOn(p.born, died), cites: [] });
  }
  for (const id of children(f, p.id)) {
    const kid = f.byId.get(id);
    if (!kid || !Number.isFinite(yearOf(kid.born))) continue;
    out.push({ key: `c${id}`, year: yearOf(kid.born), order: 1, date: kid.born, text: t('print.tl.child', { name: kid.given }), age: ageOn(p.born, kid.born), cites: [] });
  }
  if (!p.living && Number.isFinite(yearOf(p.died))) {
    out.push({ key: 'died', year: yearOf(p.died), order: 2, date: p.died, text: p.diedPlace ? t('print.tl.died_in', { place: p.diedPlace }) : t('print.tl.died'), age: ageOn(p.born, p.died), cites: cite((x) => x.fact === 'death') });
  }
  return out.sort((a, b) => (a.year === b.year ? 0 : a.year - b.year) || a.order - b.order || (a.date ?? '').localeCompare(b.date ?? ''));
}

function vital(t: Translator, kind: 'born' | 'died', date?: string, place?: string): string | undefined {
  const when = date ? longDate(date, t) : '';
  if (when && place) return t(`print.vital.${kind}_in`, { date: when, place });
  if (when) return t(`print.vital.${kind}`, { date: when });
  if (place) return t(`print.vital.${kind}_place`, { place });
  return undefined;
}

function Relative({ c, id, lead, note }: { c: EntryCtx; id: string; lead?: string; note?: string }) {
  const o = c.f.byId.get(id);
  if (!o) return null;
  const span = lifespan(o, c.t.locale);
  return (
    <li className="pr-rel">
      <span className="pr-rel-name">{lead ? <span className="pr-soft">{lead} </span> : null}{displayName(o, c.f)}{span ? <span className="pr-soft"> {span}</span> : null}{note ? <span className="pr-soft"> ({note})</span> : null}</span>
      <span className="pr-leader" aria-hidden />
      <PageRef id={id} />
    </li>
  );
}

const TIMELINE_CHUNK = 8;

/** The blocks of one person's entry. `detail` is absent for someone on paper by name only. */
export function entryPieces(c: EntryCtx, p: GPerson, d: PrintPerson | undefined, namesOnly: boolean): Piece[] {
  const { f, t, tree } = c;
  const house = houseOf(f, p);
  const k = (part: string) => `p:${p.id}:${part}`;
  const pieces: Piece[] = [];
  const born = namesOnly ? undefined : vital(t, 'born', p.born, p.bornPlace);
  const diedAge = age(p);
  const died = namesOnly || p.living ? undefined : vital(t, 'died', p.died, p.diedPlace);
  const cite = (fact: PrintCitation['fact']) => (d?.citations ?? []).filter((x) => x.fact === fact).map((x) => c.numbers.of(x.source));
  const role = [p.title, p.occupation].filter(Boolean).join(' · ');

  const ps = parents(f, p.id), us = sortedUnions(f, p.id).filter((u) => f.byId.has(u.a === p.id ? u.b : u.a)), cs = children(f, p.id);
  const hasFamily = ps.length + us.length + cs.length > 0;

  pieces.push({
    key: k('head'),
    keep: true,
    node: (
      <header className={`pr-entry-head${namesOnly ? ' is-brief' : ''}`}>
        <Face p={p} f={f} tree={tree} mm={namesOnly ? 13 : 25} />
        <div className="pr-entry-id">
          <h3>{fullName(p)}{p.epithet ? ` ${p.epithet}` : ''}<Cites numbers={cite('name')} /></h3>
          {p.nickname && !namesOnly ? <p className="pr-soft">“{p.nickname}”</p> : null}
          {role ? <p className="pr-role">{role}</p> : null}
          {namesOnly ? <p className="pr-soft">{t('print.book.living_note')}</p> : null}
          {born ? <p>{born}<Cites numbers={cite('birth')} /></p> : null}
          {died ? <p>{died}{diedAge !== undefined ? `, ${t('fact.agedN', { n: diedAge })}` : ''}<Cites numbers={cite('death')} /></p> : null}
        </div>
        {house ? <Shield house={house} mm={namesOnly ? 6.5 : 10} /> : null}
      </header>
    ),
  });

  if (hasFamily) {
    const kind = (parent: string) => f.linkKind.get(`${p.id}>${parent}`);
    const kindNote = (parent: string) => { const x = kind(parent); return x === 'adoptive' || x === 'step' || x === 'foster' ? t(`print.kind.${x}`) : undefined; };
    pieces.push({
      key: k('family'),
      keep: true,
      node: (
        <div className="pr-fam">
          <div>
            {ps.length ? <><h4>{t('print.book.parents')}</h4><ul>{ps.map((id) => <Relative key={id} c={c} id={id} note={kindNote(id)} />)}</ul></> : null}
            {us.length ? (
              <>
                <h4>{t('print.book.partners')}</h4>
                <ul>{us.map((u) => <Relative key={u.id} c={c} id={u.a === p.id ? u.b : u.a} lead={u.kind === 'marriage' ? `⚭${Number.isFinite(yearOf(u.start)) ? ` ${yearOf(u.start)}` : ''}` : undefined} />)}</ul>
              </>
            ) : null}
          </div>
          <div>
            {cs.length ? <><h4>{t('print.book.children')}</h4><ul>{cs.map((id) => <Relative key={id} c={c} id={id} />)}</ul></> : null}
          </div>
        </div>
      ),
    });
  }

  if (d && !namesOnly) {
    const life = moments(c, p, d);
    // A life that is only a birth and a death is already told in the head.
    if (life.some((m) => m.key !== 'born' && m.key !== 'died')) {
      for (let i = 0; i < life.length; i += TIMELINE_CHUNK) {
        const rows = life.slice(i, i + TIMELINE_CHUNK);
        pieces.push({
          key: k(`life${i}`),
          node: (
            <div className={`pr-part pr-life${i === 0 ? ' is-first' : ''}${i + TIMELINE_CHUNK >= life.length ? ' is-last' : ''}`}>
              {i === 0 ? <h4>{t('print.book.life')}</h4> : null}
              <ol className="pr-tl">
                {rows.map((m) => (
                  <li key={m.key}>
                    <span className="pr-tl-date">{m.date ? shortDate(m.date, t) : '–'}</span>
                    <span className="pr-tl-text">
                      {m.text}<Cites numbers={m.cites} />
                      {m.age && m.age.years > 0 && m.order < 2 ? <span className="pr-soft"> · {m.age.approx ? t('panel.aboutAge', { n: m.age.years }) : t('panel.ageAt', { n: m.age.years })}</span> : null}
                      {m.note ? <span className="pr-tl-note">{m.note}</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ),
        });
      }
    }

    textBlocks(d.bio ?? '').forEach((block, i) => pieces.push({
      key: k(`bio${i}`),
      node: <div className="pr-part">{i === 0 ? <h4>{t('print.book.biography')}</h4> : null}<Md text={block} /></div>,
    }));

    d.stories.forEach((s, si) => {
      const blocks = textBlocks(s.body);
      blocks.forEach((block, i) => pieces.push({
        key: k(`story${s.id}:${i}`),
        node: (
          <div className={`pr-part pr-story is-${s.kind}`}>
            {si === 0 && i === 0 ? <h4>{t('print.book.memories')}</h4> : null}
            {i === 0 && s.title ? <h5>{s.title}</h5> : null}
            <Md text={block} />
            {i === blocks.length - 1 ? <p className="pr-told">{t('print.book.told_by', { author: s.author, date: formatDate(s.at, t.locale) })}{s.context ? ` · ${s.context}` : ''}</p> : null}
          </div>
        ),
      }));
    });

    for (let i = 0; i < d.photos.length; i += 3) {
      pieces.push({
        key: k(`photos${i}`),
        node: (
          <div className="pr-part">
            {i === 0 ? <h4>{t('print.book.photos')}</h4> : null}
            <div className="pr-photos">
              {d.photos.slice(i, i + 3).map((ph) => (
                <figure key={ph.key}>
                  <span className="pr-photo"><img src={mediaUrl(tree, ph.key, 'thumb')} alt="" loading="eager" decoding="async" /></span>
                  <figcaption>{[ph.caption, ph.taken ? shortDate(ph.taken, t) : '', ph.place].filter(Boolean).join(' · ')}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        ),
      });
    }

    if (d.citations.length) {
      const partner = (id: string) => { const u = f.graph.unions.find((x) => x.id === id); const o = u && f.byId.get(u.a === p.id ? u.b : u.a); return o ? displayName(o, f) : ''; };
      const what = (x: PrintCitation): string => {
        const fact =
          x.fact === 'event' ? (() => { const e = d.events.find((ev) => ev.id === x.event); return e ? eventTitle(e, t) : ''; })()
          : x.fact === 'partnership' ? t('print.fact.partnership', { name: partner(x.partnership!) })
          : t(`print.fact.${x.fact}`);
        return x.page ? `${fact} (${x.page})` : fact;
      };
      const bySource = new Map<string, string[]>();
      for (const x of d.citations) { const list = bySource.get(x.source); if (list) list.push(what(x)); else bySource.set(x.source, [what(x)]); }
      const rows = [...bySource].map(([id, facts]) => ({ n: c.numbers.of(id), title: c.sources.get(id)?.title ?? '', facts: [...new Set(facts.filter(Boolean))] })).sort((a, b) => a.n - b.n);
      pieces.push({
        key: k('sources'),
        node: (
          <div className="pr-part pr-entry-sources">
            <h4>{t('print.book.sources')}</h4>
            <ul>{rows.map((r) => <li key={r.n}><span className="pr-source-n">{r.n}</span> <i>{r.title}</i>{r.facts.length ? `: ${r.facts.join(', ')}` : ''}</li>)}</ul>
          </div>
        ),
      });
    }
  }
  // A heading never stands alone at the foot of a page: the first block of each part carries it. The head and the family
  // are held to what follows them, so a name is never the last thing on a page.
  return pieces;
}

/** A house's opening: its arms, name and motto, and who of it is in this book. */
export function housePieces(c: EntryCtx, house: House | undefined, people: number, founder: GPerson | undefined, span: string): Piece[] {
  const { t, f } = c;
  return [{
    key: `h:${house?.id ?? ''}`,
    node: (
      <div className="pr-house">
        {house ? <Shield house={house} mm={30} full /> : null}
        <h2>{house ? house.name : t('print.book.other')}</h2>
        {house?.motto ? <p className="pr-motto">{house.motto}</p> : null}
        <p className="pr-soft">
          {[t('print.book.house_people', { count: people }), span, founder ? t('print.book.founder', { name: displayName(founder, f) }) : ''].filter(Boolean).join(' · ')}
        </p>
      </div>
    ),
  }];
}

/** The sources cited in the book, in the order of their numbers. */
export function sourcePieces(c: EntryCtx, numbered: readonly { n: number; id: string }[]): Piece[] {
  const { t } = c;
  return numbered.map(({ n, id }, i) => {
    const s = c.sources.get(id);
    const line = s ? [s.author, s.publication, s.date ? longDate(s.date, t) : '', s.reference].filter(Boolean).join('. ') : '';
    return {
      key: `s:${id}`,
      node: (
        <div className="pr-source">
          {i === 0 ? <h2 className="pr-section-title">{t('print.book.sources')}</h2> : null}
          <p><span className="pr-source-n">{n}</span> <i>{s?.title ?? ''}</i>{line ? `. ${line}.` : ''}</p>
        </div>
      ),
    };
  });
}
