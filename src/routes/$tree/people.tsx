import { PageSkeleton, PageHeader, ErrorState, EmptyState, Select } from '~/components/ui';
import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createSortedRowModel,
  globalFilteringFeature,
  rowSortingFeature,
  sortFn_basic,
  tableFeatures,
  useTable,
  type FilterFn,
  type SortFn,
} from '@tanstack/react-table';
import { useDebouncedValue } from '@tanstack/react-pacer';
import { useRouter, createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ArrowUpDown, ScrollText, Search, Users, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { GameIcon } from '~/components/GameIcon';
import { Arms } from '~/components/Heraldry';
import { Portrait } from '~/components/Portrait';
import { PortraitZoom } from '~/components/photos/PortraitZoom';
import { useFamily, useMeChosen, useTreeId } from '~/lib/family';
import { useCan } from '~/lib/session';
import { compareText, formatNumber, kinshipLabel, yourKinship, locales, translate, useT, type Locale, type Translator } from '~/lib/i18n';
import { occupationSearchText, occupationText } from '~/lib/occupations';
import { TRAITS } from '~/lib/traits';
import { useToday } from '~/lib/clock';
import { age as ageOf, ancestorDepths, displayName, fullName, kinship, partnersOf, type Family, type Kinship } from '~/lib/graph';
import type { GPerson, House } from '~/lib/types';
import '~/styles/people.css';
import { useDealt } from '~/lib/dealt';
import { sectionHead } from '~/lib/title';

export const Route = createFileRoute('/$tree/people')({
  pendingComponent: PageSkeleton,
  errorComponent: function PageError() { const router = useRouter(); const t = useT(); return <div className="page"><PageHeader title={t('shell.register')} /><ErrorState message={t('needed.loadFailed')} onRetry={() => { void router.invalidate(); }} /></div>; },
  head: sectionHead('Register'),
  component: RegisterPage,
});

// ---------- rows ----------

interface R {
  id: string;
  tree: string;
  p: GPerson;
  house?: House;
  /** Name without the epithet, which gets its own muted run. */
  base: string;
  sortName: string;
  search: string;
  bornKey?: number;
  diedKey?: number;
  age?: number;
  gen: number;
  role: string;
  rel?: string;
  kin?: Kinship;
  relRank?: number;
}

const PARTIAL = /^(~?)(\d{3,4})(?:-(\d\d)(?:-(\d\d))?)?$/;
const dateKey = (d?: string) => {
  const m = d && PARTIAL.exec(d);
  return m ? +m[2] * 10_000 + (m[3] ? +m[3] : 0) * 100 + (m[4] ? +m[4] : 0) : undefined;
};
function short(d: string | undefined, locale: Locale = 'en'): string {
  const m = d && PARTIAL.exec(d);
  if (!m) return '';
  const c = m[1] ? translate(locale, 'life.circa') : '';
  if (m[4]) return c + new Date(Date.UTC(+m[2], +m[3] - 1, +m[4])).toLocaleDateString(locales[locale], { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  if (m[3]) return c + new Date(Date.UTC(+m[2], +m[3] - 1, 1)).toLocaleDateString(locales[locale], { month: 'short', year: 'numeric', timeZone: 'UTC' });
  return c + m[2];
}

/**
 * kinship() recurses forever for someone with no tie to you when you have a partner (graph.ts), so only ask
 * when some tie exists, and treat a stack overflow as "no relation".
 */
function relatedTo(f: Family, anc: Map<string, number>, id: string) {
  for (const a of ancestorDepths(f, id).keys()) if (anc.has(a)) return true;
  return false;
}
function safeKinship(f: Family, me: string, id: string, myAnc: Map<string, number>): Kinship | undefined {
  const tied =
    relatedTo(f, myAnc, id) ||
    partnersOf(f, me).some((s) => relatedTo(f, ancestorDepths(f, s), id)) ||
    partnersOf(f, id).some((s) => relatedTo(f, myAnc, s));
  if (!tied) return undefined;
  try {
    return kinship(f, me, id, myAnc);
  } catch {
    return undefined;
  }
}

function buildRows(f: Family & { gen: Map<string, number> }, tree: string, me: string | null, locale: Locale, today: Date | undefined): R[] {
  const myAnc = me ? ancestorDepths(f, me) : new Map<string, number>();
  const myPartners = new Set(me ? partnersOf(f, me) : []);
  return f.graph.people.map((p) => {
    const dn = displayName(p, f);
    const base = p.epithet && dn.endsWith(p.epithet) ? dn.slice(0, -p.epithet.length).trim() : dn;
    const house = p.house ? f.house.get(p.house) : undefined;
    const kin = me ? safeKinship(f, me, p.id, myAnc) : undefined;
    const label = kin?.label;
    let relRank: number | undefined;
    if (label) {
      if (p.id === me) relRank = 0;
      else {
        const theirs = ancestorDepths(f, p.id);
        for (const [anc, a] of myAnc) {
          const b = theirs.get(anc);
          if (b !== undefined) relRank = Math.min(relRank ?? 99, a + b);
        }
        relRank ??= myPartners.has(p.id) ? 1 : 100;
      }
    }
    return {
      id: p.id,
      tree,
      p,
      house,
      base,
      sortName: `${p.surname ?? ''} ${p.given} ${p.born ?? ''}`.toLowerCase(),
      search: [dn, fullName(p), p.given, ...(p.furtherGiven ?? []), p.surname, p.nickname, p.title, p.occupation, occupationSearchText(p.occupationCode), house?.name, label, short(p.born, locale), short(p.died, locale)].filter(Boolean).join(' ').toLowerCase(),
      bornKey: dateKey(p.born),
      diedKey: dateKey(p.died),
      age: ageOf(p, today),
      gen: f.gen.get(p.id) ?? 0,
      role: [p.title, occupationText(p, locale)].filter(Boolean).join(' · '),
      rel: label,
      kin,
      relRank,
    };
  });
}

// ---------- table ----------

const features = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  sortFns: { basic: sortFn_basic },
});

/** Every word typed has to appear somewhere in the person's searchable text. */
const searchFn: FilterFn<typeof features, R> = (row, _col, value: string) => {
  const hay = row.original.search;
  return String(value)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => hay.includes(t));
};

const h = createColumnHelper<typeof features, R>();
function buildColumns(t: Translator) {
  const locale = t.locale;
  // Text columns sort as the reader's language does, so "Öberg" stands with the Os.
  const cmp = compareText(locale);
  const text: SortFn<typeof features, R> = (a, b, id) => cmp(String(a.getValue(id) ?? ''), String(b.getValue(id) ?? ''));
  return h.columns([
  h.display({ id: 'portrait', header: '', enableSorting: false, cell: ({ row }) => <PortraitZoom person={row.original.p} tree={row.original.tree} size={34} /> }),
  h.accessor((r) => r.sortName, {
    id: 'name',
    header: t('people.col.name'),
    sortFn: text,
    cell: ({ row }) => {
      const r = row.original;
      return (
        <span className="reg-name">
          {r.p.living ? <span className="reg-dot" title={t('panel.living')} role="img" aria-label={t('panel.living')} /> : <span className="reg-dot" data-off aria-hidden />}
          <Link to="/$tree/person/$id" params={{ tree: r.tree, id: r.id }} onClick={(e) => e.stopPropagation()} tabIndex={-1}>
            {r.base}
          </Link>
          {r.p.epithet && <i>{r.p.epithet}</i>}
          {r.p.nickname && <small>“{r.p.nickname}”</small>}
        </span>
      );
    },
  }),
  h.display({
    id: 'traits',
    header: t('people.col.traits'),
    enableSorting: false,
    cell: ({ row }) => {
      const traits = (row.original.p.traits ?? []).filter((x) => TRAITS[x]);
      return traits.length ? (
        <span className="reg-traits">
          {traits.map((x) => (
            <span key={x} className="reg-trait" data-kind={TRAITS[x].kind}>
              <GameIcon name={TRAITS[x].icon} size={14} title={t(TRAITS[x].label)} />
            </span>
          ))}
        </span>
      ) : null;
    },
  }),
  h.accessor((r) => r.house?.name, {
    id: 'house',
    header: t('people.col.house'),
    sortFn: text,
    sortUndefined: 'last',
    cell: ({ row }) =>
      row.original.house ? (
        <Link className="reg-house" to="/$tree/house/$house" params={{ tree: row.original.tree, house: row.original.house.id }} onClick={(e) => e.stopPropagation()} tabIndex={-1} title={t('panel.openHouse', { name: row.original.house.name })}>
          <Arms arms={row.original.house.arms} size={18} />
          <span>{row.original.house.name}</span>
        </Link>
      ) : null,
  }),
  h.accessor((r) => r.bornKey, { id: 'born', sortDescFirst: false, header: t('fact.born'), sortFn: 'basic', sortUndefined: 'last', cell: ({ row }) => short(row.original.p.born, locale) || <span className="faint">—</span> }),
  h.accessor((r) => r.diedKey, {
    id: 'died', sortDescFirst: false,
    header: t('fact.died'),
    sortFn: 'basic',
    sortUndefined: 'last',
    cell: ({ row }) => (row.original.p.living ? <span className="reg-alive">{t('people.livingLower')}</span> : short(row.original.p.died, locale) || <span className="faint">?</span>),
  }),
  h.accessor((r) => r.age, { id: 'age', sortDescFirst: false, header: t('panel.age'), sortFn: 'basic', sortUndefined: 'last', cell: ({ row }) => row.original.age ?? <span className="faint">—</span> }),
  h.accessor((r) => r.gen, { id: 'gen', sortDescFirst: false, header: t('people.col.gen'), sortFn: 'basic', cell: ({ row }) => row.original.gen + 1 }),
  h.accessor((r) => r.role, { id: 'role', header: t('people.col.work'), sortFn: text, sortUndefined: 'last', cell: ({ row }) => row.original.role || <span className="faint">—</span> }),
  h.accessor((r) => r.relRank, {
    id: 'rel', sortDescFirst: false,
    header: t('people.col.toYou'),
    sortFn: 'basic',
    sortUndefined: 'last',
    cell: ({ row }) => (row.original.rel === 'you' ? <b className="reg-you">{t('common.you')}</b> : row.original.kin ? <span title={kinshipLabel(row.original.kin, locale)}>{kinshipLabel(row.original.kin, locale)}</span> : <span className="faint">—</span>),
  }),
  h.accessor((r) => r.p.stories, {
    id: 'stories',
    header: t('panel.tab.stories'),
    sortFn: 'basic',
    sortDescFirst: true,
    cell: ({ row }) =>
      row.original.p.stories ? (
        <span className="reg-stories">
          <ScrollText size={13} />
          {row.original.p.stories}
        </span>
      ) : (
        <span className="faint">—</span>
      ),
  }),
]);
}

/** Each column's track in the shared grid, and the least width it needs. */
const TRACKS: Record<string, [string, number]> = {
  portrait: ['38px', 38],
  name: ['minmax(240px, 2.4fr)', 240],
  traits: ['minmax(100px, 0.9fr)', 100],
  house: ['minmax(150px, 1.3fr)', 150],
  born: ['118px', 118],
  died: ['118px', 118],
  age: ['52px', 52],
  gen: ['48px', 48],
  role: ['minmax(150px, 1.5fr)', 150],
  // Kinship runs long ("2× great-grandmother"): room for it, and the full label on hover.
  rel: ['minmax(190px, 1.2fr)', 190],
  stories: ['70px', 70],
};
/** Columns that only show when someone in the tree has something for them. */
const OPTIONAL: Record<string, (r: R) => boolean> = {
  traits: (r) => (r.p.traits ?? []).some((x) => TRAITS[x]),
  house: (r) => !!r.house,
  role: (r) => !!r.role,
  rel: (r) => !!r.rel,
  stories: (r) => r.p.stories > 0,
};

const ROW = 46;
const HEAD = 40;
/** The phone list's rows whose drawings the server sends: about one screenful. */
const MOBILE_EAGER = 12;

// ---------- page ----------

type Scope = 'all' | 'living' | 'deceased';

function RegisterPage() {
  const f = useFamily();
  const canAdd = useCan('add-person');
  // Kinship only once the reader has said who they are.
  const me = useMeChosen();
  const tree = useTreeId();
  usePageTrail('people', tree);
  const navigate = useNavigate();

  const [q, setQ] = useRememberedState(`people:${tree}:q`, '');
  const [dq] = useDebouncedValue(q, { wait: 150 });
  const [scope, setScope] = useRememberedState<Scope>(`people:${tree}:scope`, 'all');
  const [withStories, setWithStories] = useRememberedState(`people:${tree}:withStories`, false);
  const [house, setHouse] = useRememberedState(`people:${tree}:house`, '');
  const [sel, setSel] = useState(0);
  const [mobileLimit, setMobileLimit] = useRememberedState(`people:${tree}:limit`, 100);
  const dealt = useDealt();

  const t = useT();
  const { locale } = t;
  // The age of someone living needs the reader's day, so it fills in after hydration.
  const today = useToday();
  const all = useMemo(() => buildRows(f, tree, me, locale, today), [f, tree, me, locale, today]);
  const columns = useMemo(() => buildColumns(t), [t.locale]);
  // Hide a column nobody in the tree has anything for (no traits recorded, nobody chosen as "you").
  // Judged on everyone, not the filtered rows, so columns don't come and go while typing.
  const shown = useMemo(() => {
    const ids = Object.keys(TRACKS).filter((id) => !OPTIONAL[id] || all.some(OPTIONAL[id]));
    return { has: new Set(ids), grid: ids.map((id) => TRACKS[id][0]).join(' '), min: ids.reduce((s, id) => s + TRACKS[id][1], 0) + (ids.length - 1) * 12 + 32 };
  }, [all]);
  const houses = useMemo(() => {
    const n = new Map<string, number>();
    for (const r of all) if (r.house) n.set(r.house.id, (n.get(r.house.id) ?? 0) + 1);
    return f.graph.houses.filter((x) => n.has(x.id)).map((x) => ({ ...x, n: n.get(x.id)! })).sort((a, b) => b.n - a.n || compareText(locale)(a.name, b.name));
  }, [all, f, locale]);
  const data = useMemo(
    () =>
      all.filter(
        (r) =>
          (scope === 'all' || (scope === 'living') === r.p.living) &&
          (!withStories || r.p.stories > 0) &&
          (!house || r.house?.id === house),
      ),
    [all, scope, withStories, house],
  );

  const table = useTable({
    features,
    columns,
    data,
    getRowId: (r) => r.id,
    globalFilterFn: searchFn,
    getColumnCanGlobalFilter: (c) => c.id === 'name',
    state: { globalFilter: dq },
    initialState: { sorting: [{ id: 'name', desc: false }] },
  });
  const rows = table.getRowModel().rows;
  const sorting = table.state.sorting;

  useEffect(() => setSel(0), [dq, scope, withStories, house, sorting]);
  const cur = Math.min(sel, Math.max(rows.length - 1, 0));

  const scroller = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW,
    getItemKey: (i) => rows[i].id,
    overscan: 14,
    scrollMargin: HEAD,
    scrollPaddingStart: HEAD,
  });

  const open = (id: string) => navigate({ to: '/$tree/person/$id', params: { tree, id } });
  const move = (to: number) => {
    const i = Math.max(0, Math.min(rows.length - 1, to));
    setSel(i);
    virt.scrollToIndex(i, { align: 'auto' });
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return;
    const page = Math.max(1, Math.floor((scroller.current?.clientHeight ?? 400) / ROW) - 2);
    const typing = t.tagName === 'INPUT';
    switch (e.key) {
      case 'ArrowDown': move(cur + 1); break;
      case 'ArrowUp': move(cur - 1); break;
      case 'PageDown': move(cur + page); break;
      case 'PageUp': move(cur - page); break;
      case 'Home': if (typing) return; move(0); break;
      case 'End': if (typing) return; move(rows.length - 1); break;
      case 'Enter':
        if (t.tagName === 'A' || t.tagName === 'BUTTON' || !rows[cur]) return;
        open(rows[cur].id);
        break;
      default: return;
    }
    e.preventDefault();
  };

  const filtered = scope !== 'all' || withStories || !!house || dq.trim() !== '';
  // Nobody in the family at all is not the same as nobody matching the filters.
  const none = all.length === 0;
  const reset = () => {
    setQ('');
    setScope('all');
    setWithStories(false);
    setHouse('');
  };
  const n = (x: number) => formatNumber(x, locale);

  return (
    <div className="page reg-page">
      <div className="page-inner reg" onKeyDown={onKeyDown}>
        <PageHeader title={t('shell.register')} subtitle={<>
              {t('common.people', { count: all.length })} · {t('people.houses', { count: f.graph.houses.length })}
              {filtered && <> · {t('people.showing', { count: rows.length })}</>}
            </>} actions={<><p className="reg-keys muted">
            <kbd>↑</kbd> <kbd>↓</kbd> {t('people.keysMove')} <kbd>Enter</kbd> {t('people.keysOpen')}
          </p></>} />

        <div className="reg-tools" role="search">
          <label className="reg-search">
            <Search size={16} />
            <input
              className="input"
              type="search"
              placeholder={t('people.searchPlaceholder')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label={t('people.searchAria')}
            />
          </label>
          {/* On a phone the filters are one row that scrolls sideways under the search. */}
          <div className="reg-filters">
          <div className="reg-seg" role="group" aria-label={t('people.livingOrDeceased')}>
            {(['all', 'living', 'deceased'] as const).map((s) => (
              <button key={s} className="btn" aria-pressed={scope === s} onClick={() => setScope(s)}>
                {s === 'all' ? t('people.everyone') : s === 'living' ? t('panel.living') : t('people.deceased')}
              </button>
            ))}
          </div>
          <button className="btn" aria-pressed={withStories} onClick={() => setWithStories(!withStories)}>
            <ScrollText size={14} /> {t('people.hasStories')}
          </button>
          {houses.length > 1 && (
            <Select value={house} onChange={setHouse} aria-label={t('people.filterHouse')} options={[{ value: '', label: t('people.allHouses') }, ...houses.map((x) => ({ value: x.id, label: `${x.name} (${n(x.n)})` }))]} />
          )}
          {filtered && (
            <button className="btn ghost" onClick={reset}>
              <X size={14} /> {t('people.clear')}
            </button>
          )}
          </div>
        </div>

        <div className={`reg-mobile ${dealt}`}>
          {rows.length === 0 && (none ? <NoPeopleYet tree={tree} canAdd={canAdd} /> : <EmptyState title={t('con.noMatchTitle')} text={t('people.tryFewer')} action={<button className="btn" onClick={reset}>{t('con.clearFilters')}</button>} />)}
          {/* Only the first screenful's drawings are in the server's HTML; the rest arrive after hydration (Portrait's defer). */}
          {rows.slice(0, mobileLimit).map(({ original: r }, i) => <details className="reg-mobile-person ui-card" key={r.id}>
            <summary><Portrait person={r.p} tree={tree} size={42} defer={i >= MOBILE_EAGER} /><span><b>{r.base}</b>{r.p.epithet && <i>{r.p.epithet}</i>}<small>{short(r.p.born, locale) || t('people.birthUnknown')} · {r.p.living ? t('panel.living') : short(r.p.died, locale) || t('people.deathUnknown')}</small>{r.rel && <small>{r.rel === 'you' ? t('people.youCap') : r.kin && yourKinship(r.kin, locale, { capital: true })}</small>}</span></summary>
            <div className="reg-mobile-detail">{r.house && <Link className="reg-house" to="/$tree/house/$house" params={{ tree, house: r.house.id }}><Arms arms={r.house.arms} size={18} /><span>{r.house.name}</span></Link>}{r.role && <p>{r.role}</p>}<Link className="btn" to="/$tree" params={{ tree }} search={{ focus: r.id }}>{t('people.openPerson')}</Link></div>
          </details>)}
          {rows.length > mobileLimit && <button className="btn" onClick={() => setMobileLimit((n) => n + 100)}>{t('people.showMorePeople', { count: Math.min(100, rows.length - mobileLimit) })}</button>}
        </div>
        <div className="reg-table ui-card">
          <div
            ref={scroller}
            className="reg-scroll"
            role="grid"
            aria-rowcount={rows.length}
            aria-label={t('people.tableAria')}
            tabIndex={0}
            aria-activedescendant={rows[cur] ? `reg-${rows[cur].id}` : undefined}
          >
            <div className="reg-inner" style={{ '--reg-cols': shown.grid, minWidth: shown.min } as CSSProperties}>
              <div className="reg-row reg-header" role="row">
                {table.getHeaderGroups()[0]?.headers.filter((hd) => shown.has.has(hd.column.id)).map((hd) => {
                  const dir = hd.column.getIsSorted();
                  const can = hd.column.getCanSort();
                  return (
                    <div
                      key={hd.id}
                      role="columnheader"
                      className={`reg-cell reg-c-${hd.column.id}`}
                      aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}
                    >
                      {can ? (
                        <button onClick={hd.column.getToggleSortingHandler()} data-active={dir || undefined}>
                          {hd.isPlaceholder ? null : <table.FlexRender header={hd} />}
                          {dir === 'asc' ? <ArrowUp size={13} /> : dir === 'desc' ? <ArrowDown size={13} /> : <ArrowUpDown size={13} className="reg-idle" />}
                        </button>
                      ) : hd.column.id === 'traits' ? (
                        <span className="reg-plain">{t('people.col.traits')}</span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              {rows.length === 0 ? (
                none ? <NoPeopleYet tree={tree} canAdd={canAdd} /> : (
                  <div className="reg-none">
                    <Search size={24} />
                    <h2 className="display">{t('con.noMatchTitle')}</h2>
                    <p className="muted">{t('people.tryFewer')}</p>
                    <button className="btn" onClick={reset}>
                      {t('con.clearFilters')}
                    </button>
                  </div>
                )
              ) : (
                <div className="reg-body" style={{ height: virt.getTotalSize() - HEAD }}>
                  {virt.getVirtualItems().map((v) => {
                    const row = rows[v.index];
                    const r = row.original;
                    return (
                      <div
                        key={row.id}
                        id={`reg-${row.id}`}
                        role="row"
                        aria-selected={v.index === cur}
                        aria-rowindex={v.index + 1}
                        className="reg-row reg-data"
                        data-selected={v.index === cur || undefined}
                        data-dead={!r.p.living || undefined}
                        style={{ height: v.size, transform: `translateY(${v.start - HEAD}px)` }}
                        onClick={() => open(r.id)}
                      >
                        {row.getAllCells().filter((cell) => shown.has.has(cell.column.id)).map((cell) => (
                          <div key={cell.id} role="gridcell" className={`reg-cell reg-c-${cell.column.id}`}>
                            <table.FlexRender cell={cell} />
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Restore after hydration, so stored preferences never change server-rendered markup.
function useRememberedState<T>(key: string, fallback: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(fallback);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(key);
      if (stored !== null) setValue(JSON.parse(stored) as T);
      const param = key.split(':').at(-1)!;
      const raw = new URLSearchParams(location.search).get(param);
      if (raw !== null) setValue((typeof fallback === 'boolean' ? raw === 'true' : typeof fallback === 'number' ? Math.max(100, Number(raw) || fallback) : raw) as T);
    } catch { /* Private browsing can disable storage. */ }
    setReady(true);
  }, [key]);
  useEffect(() => {
    if (!ready) return;
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
      const url = new URL(location.href);
      const param = key.split(':').at(-1)!;
      if (value === fallback) url.searchParams.delete(param);
      else url.searchParams.set(param, String(value));
      history.replaceState(history.state, '', url);
    } catch { /* Keeping filters in memory still works. */ }
  }, [key, value, ready]);
  return [value, setValue];
}
function usePageTrail(page: string, tree: string) {
  useEffect(() => {
    const key = `kindred:scroll:${tree}:${page}`;
    const restore = () => {
      try {
        const saved = JSON.parse(sessionStorage.getItem(key) ?? '{}') as Record<string, number>;
        for (const selector of [':root', '.page', '.reg-scroll']) {
          const el = document.querySelector(selector);
          if (el) el.scrollTop = saved[selector] ?? 0;
        }
      } catch {}
    };
    const timer = window.setTimeout(() => { restore(); document.addEventListener('scroll', scroll, true); }, 450);
    const scroll = () => {
      try { sessionStorage.setItem(key, JSON.stringify(Object.fromEntries([':root', '.page', '.reg-scroll'].map((selector) => [selector, document.querySelector(selector)?.scrollTop ?? 0])))); } catch {}
    };
    const click = (event: MouseEvent) => {
      const link = (event.target as Element).closest('a');
      if (!link) return;
      const url = new URL(link.href);
      const person = url.searchParams.get('focus');
      if (person && url.pathname === `/${tree}`) {
        try { localStorage.setItem('kindred:last-visit', JSON.stringify({ tree, person, name: link.textContent?.trim() || 'your family' })); } catch {}
      }
    };
    document.addEventListener('click', click, true);
    return () => { clearTimeout(timer); document.removeEventListener('scroll', scroll, true); document.removeEventListener('click', click, true); };
  }, [page, tree]);
}

/** The family has nobody in it yet: editors are shown how to start the tree, everyone else that nobody has been added. */
function NoPeopleYet({ tree, canAdd }: { tree: string; canAdd: boolean }) {
  const t = useT();
  return canAdd ? (
    <EmptyState icon={<Users size={28} />} title={t('needed.noPeople')} text={t('people.addFirst')} action={<Link className="btn" to="/$tree" params={{ tree }}>{t('tree.start.open')}</Link>} />
  ) : (
    <EmptyState icon={<Users size={28} />} title={t('tree.nobodyYet')} text={t('tree.nobodyYetText')} />
  );
}
