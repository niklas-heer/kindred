import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createSortedRowModel,
  globalFilteringFeature,
  rowSortingFeature,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
  type FilterFn,
} from '@tanstack/react-table';
import { useDebouncedValue } from '@tanstack/react-pacer';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ArrowUpDown, ScrollText, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Arms } from '~/components/Heraldry';
import { Portrait } from '~/components/Portrait';
import { useFamily, useMe, useTreeId } from '~/lib/family';
import { age as ageOf, ancestorDepths, displayName, kinship, partnersOf, type Family } from '~/lib/graph';
import type { GPerson, House } from '~/lib/types';
import '~/styles/people.css';

export const Route = createFileRoute('/$tree/people')({
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
  relRank?: number;
}

const PARTIAL = /^(~?)(\d{3,4})(?:-(\d\d)(?:-(\d\d))?)?$/;
const dateKey = (d?: string) => {
  const m = d && PARTIAL.exec(d);
  return m ? +m[2] * 10_000 + (m[3] ? +m[3] : 0) * 100 + (m[4] ? +m[4] : 0) : undefined;
};
function short(d?: string): string {
  const m = d && PARTIAL.exec(d);
  if (!m) return '';
  const c = m[1] ? 'c. ' : '';
  if (m[4]) return c + new Date(Date.UTC(+m[2], +m[3] - 1, +m[4])).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  if (m[3]) return c + new Date(Date.UTC(+m[2], +m[3] - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
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
function safeKinship(f: Family, me: string, id: string, myAnc: Map<string, number>): string | undefined {
  const tied =
    relatedTo(f, myAnc, id) ||
    partnersOf(f, me).some((s) => relatedTo(f, ancestorDepths(f, s), id)) ||
    partnersOf(f, id).some((s) => relatedTo(f, myAnc, s));
  if (!tied) return undefined;
  try {
    return kinship(f, me, id, myAnc)?.label;
  } catch {
    return undefined;
  }
}

function buildRows(f: Family & { gen: Map<string, number> }, tree: string, me: string): R[] {
  const myAnc = ancestorDepths(f, me);
  const myPartners = new Set(partnersOf(f, me));
  return f.graph.people.map((p) => {
    const dn = displayName(p, f);
    const base = p.epithet && dn.endsWith(p.epithet) ? dn.slice(0, -p.epithet.length).trim() : dn;
    const house = p.house ? f.house.get(p.house) : undefined;
    const label = safeKinship(f, me, p.id, myAnc);
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
      search: [dn, p.given, p.surname, p.nickname, p.title, p.occupation, house?.name, label, short(p.born), short(p.died)].filter(Boolean).join(' ').toLowerCase(),
      bornKey: dateKey(p.born),
      diedKey: dateKey(p.died),
      age: ageOf(p),
      gen: f.gen.get(p.id) ?? 0,
      role: [p.title, p.occupation].filter(Boolean).join(' · '),
      rel: label,
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
  sortFns: { basic: sortFn_basic, text: sortFn_text },
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
const columns = h.columns([
  h.display({ id: 'portrait', header: '', enableSorting: false, cell: ({ row }) => <Portrait person={row.original.p} tree={row.original.tree} size={30} frame={false} /> }),
  h.accessor((r) => r.sortName, {
    id: 'name',
    header: 'Name',
    sortFn: 'text',
    cell: ({ row }) => {
      const r = row.original;
      return (
        <span className="reg-name">
          <Link to="/$tree" params={{ tree: r.tree }} search={{ focus: r.id }} onClick={(e) => e.stopPropagation()} tabIndex={-1}>
            {r.base}
          </Link>
          {r.p.epithet && <i>{r.p.epithet}</i>}
          {r.p.nickname && <small>“{r.p.nickname}”</small>}
        </span>
      );
    },
  }),
  h.accessor((r) => r.house?.name, {
    id: 'house',
    header: 'House',
    sortFn: 'text',
    sortUndefined: 'last',
    cell: ({ row }) =>
      row.original.house ? (
        <span className="reg-house">
          <Arms arms={row.original.house.arms} size={18} />
          <span>{row.original.house.name}</span>
        </span>
      ) : null,
  }),
  h.accessor((r) => r.bornKey, { id: 'born', sortDescFirst: false, header: 'Born', sortFn: 'basic', sortUndefined: 'last', cell: ({ row }) => short(row.original.p.born) || <span className="faint">—</span> }),
  h.accessor((r) => r.diedKey, {
    id: 'died', sortDescFirst: false,
    header: 'Died',
    sortFn: 'basic',
    sortUndefined: 'last',
    cell: ({ row }) => (row.original.p.living ? <span className="reg-alive">living</span> : short(row.original.p.died) || <span className="faint">?</span>),
  }),
  h.accessor((r) => r.age, { id: 'age', sortDescFirst: false, header: 'Age', sortFn: 'basic', sortUndefined: 'last', cell: ({ row }) => row.original.age ?? <span className="faint">—</span> }),
  h.accessor((r) => r.gen, { id: 'gen', sortDescFirst: false, header: 'Gen', sortFn: 'basic', cell: ({ row }) => row.original.gen + 1 }),
  h.accessor((r) => r.role, { id: 'role', header: 'Title or work', sortFn: 'text', sortUndefined: 'last', cell: ({ row }) => row.original.role || <span className="faint">—</span> }),
  h.accessor((r) => r.relRank, {
    id: 'rel', sortDescFirst: false,
    header: 'To you',
    sortFn: 'basic',
    sortUndefined: 'last',
    cell: ({ row }) => (row.original.rel === 'you' ? <b className="reg-you">you</b> : (row.original.rel ?? <span className="faint">—</span>)),
  }),
  h.accessor((r) => r.p.stories, {
    id: 'stories',
    header: 'Stories',
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

const ROW = 46;
const HEAD = 40;

// ---------- page ----------

type Scope = 'all' | 'living' | 'deceased';

function RegisterPage() {
  const f = useFamily();
  const me = useMe();
  const tree = useTreeId();
  const navigate = useNavigate();

  const [q, setQ] = useState('');
  const [dq] = useDebouncedValue(q, { wait: 150 });
  const [scope, setScope] = useState<Scope>('all');
  const [withStories, setWithStories] = useState(false);
  const [house, setHouse] = useState('');
  const [sel, setSel] = useState(0);

  const all = useMemo(() => buildRows(f, tree, me), [f, tree, me]);
  const houses = useMemo(() => {
    const n = new Map<string, number>();
    for (const r of all) if (r.house) n.set(r.house.id, (n.get(r.house.id) ?? 0) + 1);
    return f.graph.houses.filter((x) => n.has(x.id)).map((x) => ({ ...x, n: n.get(x.id)! })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  }, [all, f]);
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

  const open = (id: string) => navigate({ to: '/$tree', params: { tree }, search: { focus: id } });
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
  const reset = () => {
    setQ('');
    setScope('all');
    setWithStories(false);
    setHouse('');
  };
  const n = (x: number) => x.toLocaleString('en-GB');

  return (
    <div className="page reg-page">
      <div className="page-inner reg" onKeyDown={onKeyDown}>
        <header className="reg-head">
          <div>
            <h1>Register</h1>
            <p className="muted">
              {n(all.length)} people · {n(f.graph.houses.length)} {f.graph.houses.length === 1 ? 'house' : 'houses'}
              {filtered && <> · showing {n(rows.length)}</>}
            </p>
          </div>
          <p className="reg-keys muted">
            <kbd>↑</kbd> <kbd>↓</kbd> move <kbd>Enter</kbd> open
          </p>
        </header>

        <div className="reg-tools" role="search">
          <label className="reg-search">
            <Search size={16} />
            <input
              className="input"
              type="search"
              placeholder="Search by name, house, title, year…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search the register"
            />
          </label>
          <div className="reg-seg" role="group" aria-label="Living or deceased">
            {(['all', 'living', 'deceased'] as const).map((s) => (
              <button key={s} className="btn" aria-pressed={scope === s} onClick={() => setScope(s)}>
                {s === 'all' ? 'Everyone' : s === 'living' ? 'Living' : 'Deceased'}
              </button>
            ))}
          </div>
          <button className="btn" aria-pressed={withStories} onClick={() => setWithStories(!withStories)}>
            <ScrollText size={14} /> Has stories
          </button>
          {houses.length > 1 && (
            <select className="input reg-house-pick" value={house} onChange={(e) => setHouse(e.target.value)} aria-label="Filter by house">
              <option value="">All houses</option>
              {houses.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} ({n(x.n)})
                </option>
              ))}
            </select>
          )}
          {filtered && (
            <button className="btn ghost" onClick={reset}>
              <X size={14} /> Clear
            </button>
          )}
        </div>

        <div className="reg-table panel">
          <div
            ref={scroller}
            className="reg-scroll"
            role="grid"
            aria-rowcount={rows.length}
            aria-label="Everyone in the family"
            tabIndex={0}
            aria-activedescendant={rows[cur] ? `reg-${rows[cur].id}` : undefined}
          >
            <div className="reg-inner">
              <div className="reg-row reg-header" role="row">
                {table.getHeaderGroups()[0]?.headers.map((hd) => {
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
                      ) : null}
                    </div>
                  );
                })}
              </div>
              {rows.length === 0 ? (
                <div className="reg-none">
                  <Search size={24} />
                  <h2 className="display">No one matches</h2>
                  <p className="muted">Try fewer words, or clear the filters.</p>
                  <button className="btn" onClick={reset}>
                    Clear filters
                  </button>
                </div>
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
                        {row.getAllCells().map((cell) => (
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
