import { useHotkey } from '@tanstack/react-hotkeys';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ChevronsDownUp, ChevronsUpDown, Crown, Expand, GitFork, Keyboard, Minus, Network, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, type CanvasHandle, type Detail } from '~/components/Canvas';
import { Card, type AddRelation } from '~/components/Card';
import { PersonPanel } from '~/components/PersonPanel';
import { Portrait } from '~/components/Portrait';
import { QuickAdd } from '~/components/QuickAdd';
import { useFamily, useMe } from '~/lib/family';
import { ancestorDepths, ancestorDepths as anc, descendants, displayName, kinPath, kinship, parents, children } from '~/lib/graph';
import { layout as computeLayout, rootFor, type LNode, type View } from '~/lib/layout';
import { treeSearch } from '~/lib/search';
import '~/styles/tree.css';

export const Route = createFileRoute('/$tree/')({
  validateSearch: treeSearch,
  component: TreePage,
});

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];

function TreePage() {
  const { tree } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: '/$tree/' });
  const f = useFamily();
  const me = useMe();
  const codex = f.graph.tree.theme === 'codex';

  // `focus` anchors the layout (the hourglass centre, the dynasty's line); `sel` is who the panel
  // shows. Clicking selects without moving anything; double-click or Enter re-centres.
  const focus = search.focus && f.byId.has(search.focus) ? search.focus : me;
  const sel = search.sel && f.byId.has(search.sel) ? search.sel : focus;
  const view: View = search.view ?? (codex ? 'dynasty' : 'family');
  const line = search.line ?? (codex ? 'house' : 'all');
  const up = search.up ?? 3;
  const down = search.down ?? 2;
  const lens = search.lens ?? 'none';

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [panel, setPanel] = useState(true);
  const [adding, setAdding] = useState<{ anchor: string; relation: AddRelation } | null>(null);
  const [help, setHelp] = useState(false);
  const canvas = useRef<CanvasHandle>(null);
  const panTo = useRef<string | null>(null);

  const root = view === 'dynasty' ? (search.root && f.byId.has(search.root) ? search.root : rootFor(f, focus, line)) : undefined;
  const lay = useMemo(
    () => computeLayout(f, { view, focus, root, line, up, down, collapsed }),
    [f, view, focus, root, line, up, down, collapsed],
  );
  const inLayout = useCallback((id: string) => lay.nodes.some((n) => n.id === id && n.role !== 'dup'), [lay]);

  const go = useCallback(
    (patch: Partial<typeof search>, replace = false) => navigate({ search: (s) => ({ ...s, ...patch }), replace }),
    [navigate],
  );
  /** Make someone the centre of the tree. In a dynasty tree that already holds them, just go there. */
  const refocus = useCallback(
    (id: string) => {
      setPanel(true);
      panTo.current = id;
      if (view === 'dynasty' && inLayout(id)) go({ sel: id, focus: id, root: lay.root });
      else go({ focus: id, sel: undefined, root: undefined });
    },
    [go, view, inLayout, lay.root],
  );
  /** Show someone in the panel. Clicks stay put; keys and panel links bring them into view. */
  const select = useCallback(
    (id: string, how: 'click' | 'jump' = 'jump') => {
      setPanel(true);
      if (how === 'jump' && !inLayout(id)) return refocus(id);
      if (how === 'jump') panTo.current = id;
      go({ sel: id === focus ? undefined : id });
    },
    [go, inLayout, refocus, focus],
  );

  // The camera follows only when asked to (panTo), or when a new layout centres on someone else.
  const prevFocus = useRef(focus);
  useEffect(() => {
    const target = panTo.current ?? (prevFocus.current !== focus && view !== 'dynasty' ? focus : null);
    prevFocus.current = focus;
    panTo.current = null;
    if (target) requestAnimationFrame(() => canvas.current?.centerOn(target));
  }, [focus, sel, view, lay]);
  const prevView = useRef(view);
  useEffect(() => {
    if (prevView.current === view) return;
    prevView.current = view;
    requestAnimationFrame(() => canvas.current?.centerOn(sel, { k: 0.75 }));
  }, [view, sel]);

  // ---- trail: the last people you looked at ----
  const [trail, setTrail] = useState<string[]>([]);
  useEffect(() => setTrail((t) => [sel, ...t.filter((x) => x !== sel)].slice(0, 9)), [sel]);

  // ---- lenses ----
  const myAnc = useMemo(() => ancestorDepths(f, me), [f, me]);
  const dimmed = useMemo<Set<string> | null>(() => {
    if (lens === 'line') return new Set([sel, ...anc(f, sel).keys(), ...descendants(f, sel)]);
    if (lens === 'living') return new Set(f.graph.people.filter((p) => p.living).map((p) => p.id));
    if (lens === 'house') {
      const h = f.byId.get(sel)?.house;
      return new Set(f.graph.people.filter((p) => p.house === h).map((p) => p.id));
    }
    if (lens === 'path') {
      const path = kinPath(f, me, search.to ?? sel);
      return path.length ? new Set(path) : null;
    }
    return null;
  }, [lens, f, sel, me, search.to]);
  const lensCount = useMemo(() => {
    if (!dimmed) return '';
    const shown = new Set(lay.nodes.map((n) => n.id));
    const lit = [...dimmed].filter((id) => shown.has(id)).length;
    return `${lit.toLocaleString('en-GB')} of ${shown.size.toLocaleString('en-GB')} shown`;
  }, [dimmed, lay]);

  // ---- kinship labels, computed lazily for the cards on screen ----
  const kinCache = useMemo(() => new Map<string, string | undefined>(), [f, me]);
  const kinOf = useCallback(
    (id: string) => {
      if (!kinCache.has(id)) {
        const k = kinship(f, me, id, myAnc)?.label;
        kinCache.set(id, k && k !== 'you' ? k : undefined);
      }
      return kinCache.get(id);
    },
    [kinCache, f, me, myAnc],
  );

  const toggle = useCallback((id: string) => setCollapsed((c) => {
    const n = new Set(c);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  }), []);

  // Fold everything except the line from the root to the selected person.
  const foldToFocus = () => {
    const keep = new Set([sel, ...anc(f, sel).keys()]);
    const n = new Set<string>();
    for (const node of lay.nodes) if (!keep.has(node.id) && children(f, node.id).length) n.add(node.id);
    setCollapsed(n);
    panTo.current = sel;
  };

  const renderCard = useCallback(
    (n: LNode, detail: Detail) => (
      <Card
        node={n}
        detail={detail}
        family={f}
        tree={tree}
        kin={detail === 'near' ? kinOf(n.id) : undefined}
        selected={n.id === sel}
        isMe={n.id === me}
        showSpouses={view === 'dynasty'}
        onSelect={(id) => select(id, 'click')}
        onOpen={refocus}
        onToggle={view === 'dynasty' || (view === 'family' && n.row > 0) ? toggle : undefined}
        onAdd={(anchor, relation) => setAdding({ anchor, relation })}
      />
    ),
    [f, tree, kinOf, sel, me, view, select, refocus, toggle],
  );

  // ---- keyboard: walk the tree ----
  const spatial = (dir: 'left' | 'right') => {
    const cur = canvas.current?.nodeOf(sel);
    if (!cur) return;
    const row = lay.nodes.filter((n) => n.row === cur.row && n.role !== 'dup' && (dir === 'left' ? n.x < cur.x : n.x > cur.x));
    row.sort((a, b) => Math.abs(a.x - cur.x) - Math.abs(b.x - cur.x));
    if (row[0]) select(row[0].id);
  };
  const vertical = (dir: 'up' | 'down') => {
    const next = dir === 'up' ? parents(f, sel) : children(f, sel);
    if (next.length) select(next.find(inLayout) ?? next[0]);
  };
  const live = !adding;
  useHotkey('ArrowLeft', () => spatial('left'), { enabled: live });
  useHotkey('ArrowRight', () => spatial('right'), { enabled: live });
  useHotkey('ArrowUp', () => vertical('up'), { enabled: live });
  useHotkey('ArrowDown', () => vertical('down'), { enabled: live });
  useHotkey('Enter', () => refocus(sel), { enabled: live });
  useHotkey('F', () => canvas.current?.fit(), { enabled: live });
  useHotkey('C', () => canvas.current?.centerOn(sel), { enabled: live });
  useHotkey('H', () => refocus(me), { enabled: live });
  useHotkey('1', () => go({ view: 'family', focus: sel, sel: undefined }), { enabled: live });
  useHotkey('2', () => go({ view: 'dynasty', root: undefined, focus: sel, sel: undefined }), { enabled: live });
  useHotkey('3', () => go({ view: 'ancestors', focus: sel, sel: undefined }), { enabled: live });
  useHotkey('L', () => go({ lens: lens === 'line' ? 'none' : 'line' }), { enabled: live });
  useHotkey('=', () => canvas.current?.zoomBy(1.25), { enabled: live });
  useHotkey('-', () => canvas.current?.zoomBy(0.8), { enabled: live });
  useHotkey('?', () => setHelp((h) => !h), { enabled: live });
  useHotkey('Escape', () => {
    if (help) setHelp(false);
    else if (lens !== 'none') go({ lens: 'none', to: undefined });
    else setPanel(false);
  }, { enabled: live });

  const rowLabel = (row: number, year: number | undefined, i: number) => {
    const gen = view === 'dynasty' ? i + 1 : row;
    const g = view === 'dynasty' ? (codex ? `Gen. ${ROMAN[gen - 1] ?? gen}` : `Gen ${gen}`) : gen === 0 ? 'Focus' : gen < 0 ? `${-gen} up` : `${gen} down`;
    const era = year === undefined ? '' : codex ? ` · c. ${year}` : ` · ${Math.floor(year / 10) * 10}s`;
    return g + era;
  };

  const focusPerson = f.byId.get(sel)!;
  const houses = useMemo(() => {
    const n = new Map<string, number>();
    for (const p of f.graph.people) if (p.house) n.set(p.house, (n.get(p.house) ?? 0) + 1);
    return f.graph.houses.map((h) => [h, n.get(h.id) ?? 0] as const).filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]);
  }, [f]);
  const house = focusPerson.house ? f.house.get(focusPerson.house) : undefined;
  const rootPerson = root ? f.byId.get(root) : undefined;

  return (
    <div className="tree-page">
      <Canvas
        ref={canvas}
        family={f}
        layout={lay}
        focus={sel}
        dimmed={dimmed}
        renderCard={renderCard}
        rowLabel={rowLabel}
        inset={{ left: panel ? 430 : 0, top: view === 'dynasty' ? 150 : 110 }}
        onBackground={() => {}}
        overlay={
          <>
            <div className={`tree-toolbar panel no-pan${panel ? ' with-panel' : ''}`}>
              <div className="seg">
                <button className="btn" aria-pressed={view === 'family'} onClick={() => go({ view: 'family', focus: sel, sel: undefined })} title="Family around the focus (1)"><Network size={15} /> Family</button>
                <button className="btn" aria-pressed={view === 'dynasty'} onClick={() => go({ view: 'dynasty', root: undefined, focus: sel, sel: undefined })} title="Dynasty tree (2)"><Crown size={15} /> Dynasty</button>
                <button className="btn" aria-pressed={view === 'ancestors'} onClick={() => go({ view: 'ancestors', focus: sel, sel: undefined })} title="Ancestors (3)"><GitFork size={15} style={{ transform: 'rotate(180deg)' }} /> Ancestors</button>
              </div>
              <span className="tb-sep" />
              {view === 'family' && (
                <>
                  <Stepper label="Up" value={up} onChange={(v) => go({ up: v }, true)} />
                  <Stepper label="Down" value={down} onChange={(v) => go({ down: v }, true)} />
                </>
              )}
              {view === 'ancestors' && <Stepper label="Generations" value={Math.max(up, 6)} onChange={(v) => go({ up: v }, true)} />}
              {view === 'dynasty' && (
                <>
                  <select
                    className="input tb-house"
                    title="Jump to another house's dynasty tree"
                    value={line === 'house' ? (f.byId.get(lay.root)?.house ?? '') : ''}
                    onChange={(e) => {
                      const r = houseRoot(f, e.target.value);
                      if (r) { panTo.current = r; go({ line: 'house', root: r, focus: r, sel: undefined }); }
                    }}
                  >
                    {line !== 'house' && <option value="">All descendants</option>}
                    {houses.map(([h, n]) => <option key={h.id} value={h.id}>{h.name} · {n}</option>)}
                  </select>
                  <div className="seg">
                    <button className="btn" aria-pressed={line === 'house'} onClick={() => go({ line: 'house', root: undefined })} title="Only members of the house, like CK3">House line</button>
                    <button className="btn" aria-pressed={line === 'all'} onClick={() => go({ line: 'all', root: undefined })} title="Every descendant, through daughters too">All descendants</button>
                  </div>
                  <button className="btn" onClick={foldToFocus} title="Fold every branch except the line to the selected person"><ChevronsDownUp size={15} /> Fold others</button>
                  {collapsed.size > 0 && <button className="btn" onClick={() => setCollapsed(new Set())}><ChevronsUpDown size={15} /> Unfold all</button>}
                </>
              )}
              <span className="tb-sep" />
              <label className="tb-lens">
                <span className="faint">Lens</span>
                <select className="input" value={lens} onChange={(e) => go({ lens: e.target.value as any, to: undefined })}>
                  <option value="none">Everyone</option>
                  <option value="line">Direct line of {focusPerson.given}</option>
                  <option value="house">{house ? house.name : 'Same house'}</option>
                  <option value="living">Living people</option>
                  <option value="path">Path from me</option>
                </select>
              </label>
              <span className="tb-sep" />
              <button className="btn icon" onClick={() => canvas.current?.zoomBy(0.8)} title="Zoom out (−)"><Minus size={15} /></button>
              <button className="btn icon" onClick={() => canvas.current?.zoomBy(1.25)} title="Zoom in (=)"><Plus size={15} /></button>
              <button className="btn icon" onClick={() => canvas.current?.fit()} title="Fit everything (F)"><Expand size={15} /></button>
              <button className="btn icon" onClick={() => setHelp((h) => !h)} title="Keys (?)" aria-pressed={help}><Keyboard size={15} /></button>
            </div>

            {view === 'dynasty' && rootPerson && (
              <div className={`tree-caption no-pan${panel ? ' with-panel' : ''}`}>
                <span className="display">{line === 'house' && house ? `${f.house.get(rootPerson.house ?? '')?.name ?? 'Descendants'}` : `Descendants of ${displayName(rootPerson, f)}`}</span>
                <span className="faint"> · {new Set(lay.nodes.map((n) => n.id)).size.toLocaleString('en-GB')} members · from {displayName(rootPerson, f)}</span>
                {parents(f, rootPerson.id).length > 0 && (
                  <button className="btn ghost" onClick={() => go({ root: parents(f, rootPerson.id)[0] })} title="Start the tree one generation earlier">▲ Older</button>
                )}
              </div>
            )}

            {lens !== 'none' && (
              <div className={`lens-banner no-pan${panel ? ' with-panel' : ''}`}>
                {lens === 'path' ? (
                  <>Showing how <b>{displayName(f.byId.get(search.to ?? sel)!, f)}</b> is your <b>{kinship(f, me, search.to ?? sel)?.label ?? 'relative'}</b></>
                ) : lens === 'line' ? (
                  <>Direct line of <b>{focusPerson.given}</b>: ancestors and descendants</>
                ) : lens === 'living' ? (
                  <>Living people</>
                ) : (
                  <>{house?.name ?? 'House'} only</>
                )}
                <span className="lens-count">{lensCount}</span>
                <button className="btn icon ghost" onClick={() => go({ lens: 'none', to: undefined })}><X size={14} /></button>
              </div>
            )}

            {trail.length > 1 && (
              <div className={`trail no-pan panel${panel ? ' with-panel' : ''}`}>
                <span className="faint">Trail</span>
                {trail.slice(1).map((id) => {
                  const p = f.byId.get(id);
                  return p ? (
                    <button key={id} className="trail-item" onClick={() => select(id)} title={displayName(p, f)}>
                      <Portrait person={p} tree={tree} size={30} frame={false} />
                    </button>
                  ) : null;
                })}
              </div>
            )}

            {help && <HelpCard onClose={() => setHelp(false)} />}
          </>
        }
      />
      {panel && (
        <PersonPanel
          family={f}
          tree={tree}
          id={sel}
          me={me}
          onSelect={(id) => select(id)}
          onCenter={() => refocus(sel)}
          onPath={() => go({ lens: 'path', to: sel })}
          onDynasty={() => go({ view: 'dynasty', root: undefined, focus: sel, sel: undefined })}
          onAncestors={() => go({ view: 'ancestors', focus: sel, sel: undefined })}
          onClose={() => setPanel(false)}
        />
      )}
      {adding && (
        <QuickAdd
          family={f}
          tree={tree}
          anchor={adding.anchor}
          relation={adding.relation}
          onCancel={() => setAdding(null)}
          onDone={(id) => { setAdding(null); panTo.current = id; go({ sel: id }); }}
        />
      )}
    </div>
  );
}

/** Where a house's tree starts: its founder, or the member with the most descendants in the house. */
function houseRoot(f: ReturnType<typeof useFamily>, house: string): string | undefined {
  const h = f.house.get(house);
  if (h?.founder && f.byId.has(h.founder)) return h.founder;
  const members = f.graph.people.filter((p) => p.house === house);
  const tops = members.filter((p) => !parents(f, p.id).some((q) => f.byId.get(q)?.house === house));
  let best: string | undefined, size = -1;
  for (const t of tops) {
    const n = [...descendants(f, t.id)].filter((d) => f.byId.get(d)?.house === house).length;
    if (n > size) { best = t.id; size = n; }
  }
  return best;
}

function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <span className="stepper">
      <span className="faint">{label}</span>
      <button className="btn icon" onClick={() => onChange(Math.max(1, value - 1))} disabled={value <= 1}><Minus size={13} /></button>
      <b>{value}</b>
      <button className="btn icon" onClick={() => onChange(Math.min(12, value + 1))} disabled={value >= 12}><Plus size={13} /></button>
    </span>
  );
}

function HelpCard({ onClose }: { onClose: () => void }) {
  const keys: [string, string][] = [
    ['← →', 'neighbour in the same generation'],
    ['↑ ↓', 'parent / child'],
    ['⌘K or /', 'find anyone'],
    ['1 2 3', 'family / dynasty / ancestors'],
    ['L', 'lens: direct line'],
    ['C', 'centre on selected'],
    ['F', 'fit the whole tree'],
    ['H', 'go home to you'],
    ['= −', 'zoom'],
    ['Esc', 'clear lens, close panel'],
  ];
  return (
    <div className="help-card panel no-pan">
      <header className="display">Getting around <button className="btn icon ghost" onClick={onClose}><X size={14} /></button></header>
      {keys.map(([k, v]) => (
        <div key={k} className="help-row"><span>{k.split(' ').map((x) => <kbd key={x}>{x}</kbd>)}</span><span>{v}</span></div>
      ))}
      <p className="faint">Drag or scroll to pan · pinch or ⌘-scroll to zoom · click the minimap to jump</p>
    </div>
  );
}
