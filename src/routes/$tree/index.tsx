import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import {
  ArrowDownToLine, ArrowLeft, ArrowUpToLine, ChevronUp, ChevronsDownUp, ChevronsUpDown, Crown, FileQuestion, GitFork, Glasses,
  HeartPulse, Keyboard, Landmark, Minus, Network, Plus, Route as RouteIcon, Shield, Users, Waypoints, X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { Canvas, type CanvasHandle, type Detail, type Inset } from '~/components/Canvas';
import { Card, type AddRelation } from '~/components/Card';
import { PersonPanel } from '~/components/PersonPanel';
import { Portrait } from '~/components/Portrait';
import { QuickAdd } from '~/components/QuickAdd';
import { useFamily, useMe, useMeChosen } from '~/lib/family';
import { Select, usePageHotkey, type SelectOption } from '~/components/ui';
import { ancestorDepths, ancestorDepths as anc, descendants, displayName, kinPath, kinship, parents, children } from '~/lib/graph';
import { layout as computeLayout, rootFor, type LNode, type View } from '~/lib/layout';
import { treeSearch } from '~/lib/search';
import { gapsOf, useRequired } from '~/lib/gaps';
import { removePerson } from '~/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { play } from '~/lib/sfx';
import { toast } from '~/lib/toast';
import { Arms } from '~/components/Heraldry';
import { personName, treeTitle } from '~/lib/title';
import { useCan } from '~/lib/session';
import '~/styles/tree.css';

export const Route = createFileRoute('/$tree/')({
  validateSearch: treeSearch,
  // "Ada Lindqvist · The Lindqvist–Ashworth family · Kindred" when someone is selected or centred.
  head: (ctx) => ({ meta: [{ title: treeTitle(ctx, personName(ctx, ctx.match.search.sel ?? ctx.match.search.focus)) }] }),
  component: TreePage,
});

/** Phones and narrow tablets: the panel becomes a bottom sheet and the toolbar compacts. */
const PHONE = '(max-width: 900px)';
type Snap = 'peek' | 'half' | 'full';
/** Peek height of the bottom sheet: its grip, the name and the kinship line. */
const PEEK_H = 150; // matches .panel-sheet[data-snap='peek'] in tree.css

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];

function TreePage() {
  const { tree } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: '/$tree/' });
  const f = useFamily();
  const me = useMe();
  // Who the reader said they are; kinship labels wait for this.
  const who = useMeChosen();
  const qc = useQueryClient();
  const codex = f.graph.tree.theme === 'codex';
  // Adding from the tree (the + marks, empty parent slots) and its Undo need these roles; the server checks too.
  const canAdd = useCan('add-person');
  const canRemove = useCan('remove-person');

  // `focus` anchors the layout (the hourglass centre, the dynasty's line); `sel` is who the panel
  // shows. Clicking selects without moving anything; double-click or Enter re-centres.
  const focus = search.focus && f.byId.has(search.focus) ? search.focus : me;
  const sel = search.sel && f.byId.has(search.sel) ? search.sel : focus;

  // Someone in the URL who isn't in this tree (a stale link, a typo): say so once and tidy the URL.
  // People who were here a moment ago (removed with Undo) are dropped quietly.
  const known = useRef(new Set<string>());
  for (const p of f.graph.people) known.current.add(p.id);
  const told = useRef('');
  useEffect(() => {
    const stale = (['focus', 'sel', 'root', 'to'] as const).filter((k) => search[k] && !f.byId.has(search[k]!));
    if (!stale.length) return;
    const unseen = stale.some((k) => !known.current.has(search[k]!));
    navigate({ search: (s) => ({ ...s, ...Object.fromEntries(stale.map((k) => [k, undefined])) }), replace: true });
    // Once per stale link, even if the effect runs again before the URL is tidied.
    const key = stale.map((k) => search[k]).join('|');
    if (told.current === key) return;
    told.current = key;
    if (unseen) toast({ title: 'That person isn’t in this tree', body: 'The link may be old. Showing the family from the start instead.', ms: 6000 });
  }, [search.focus, search.sel, search.root, search.to, f]); // eslint-disable-line react-hooks/exhaustive-deps
  const view: View = search.view ?? (codex ? 'dynasty' : 'family');
  const line = search.line ?? (codex ? 'house' : 'all');
  const up = search.up ?? 3;
  const down = search.down ?? 2;
  const lens = search.lens ?? 'none';

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [panel, setPanel] = useState(true);
  const [adding, setAdding] = useState<{ anchor: string; relation: AddRelation; sex?: 'm' | 'f' } | null>(null);
  const [help, setHelp] = useState(false);
  const canvas = useRef<CanvasHandle>(null);
  const panTo = useRef<string | null>(null);
  const panQuiet = useRef(false);
  const [flash, setFlash] = useState<{ id: string; at: number } | null>(null);
  const phone = useMedia(PHONE);
  // The docked panel's width (matches --panel-w in tree.css).
  const [panelW, setPanelW] = useState(400);
  useEffect(() => {
    const on = () => setPanelW(Math.min(400, window.innerWidth - 120));
    on();
    addEventListener('resize', on);
    return () => removeEventListener('resize', on);
  }, []);

  // ---- phone: the panel is a bottom sheet (peek, half, full) over the tree ----
  const [snap, setSnap] = useState<Snap>('peek');
  const page = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const [pageH, setPageH] = useState(700);
  useEffect(() => {
    const el = page.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPageH(el.getBoundingClientRect().height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const snapH = (s: Snap) => (s === 'peek' ? PEEK_H : s === 'half' ? Math.round(pageH * 0.55) : pageH);
  const sheetH = phone && panel ? snapH(snap) : 0;
  // A closed sheet opens at peek again, so the tree stays in view.
  useEffect(() => { if (!panel) setSnap('peek'); }, [panel]);
  // Crossing into or out of phone layout (also right after hydration) moves the free area: frame again.
  const wasPhone = useRef(phone);
  useEffect(() => {
    if (wasPhone.current === phone) return;
    wasPhone.current = phone;
    requestAnimationFrame(() => canvas.current?.frame(sel, { animate: false }));
  }, [phone]); // eslint-disable-line react-hooks/exhaustive-deps
  // The toolbar wraps on narrow windows: measure the HUD so centring and notices clear it.
  const hud = useRef<HTMLDivElement>(null);
  const [hudH, setHudH] = useState(100);
  useEffect(() => {
    const el = hud.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const h = el.getBoundingClientRect().height;
      setHudH(h);
      document.documentElement.style.setProperty('--hud-bottom', `${Math.round(h + 64)}px`);
    });
    ro.observe(el);
    return () => { ro.disconnect(); document.documentElement.style.removeProperty('--hud-bottom'); };
  }, []);

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
    (id: string, how: 'click' | 'jump' | 'key' = 'jump') => {
      setPanel(true);
      if (how !== 'click' && !inLayout(id)) return refocus(id);
      if (how !== 'click') panTo.current = id;
      panQuiet.current = how === 'key';
      if (how !== 'jump') play('tick', { pitch: how === 'key' ? 0.96 + Math.random() * 0.08 : 1 });
      go({ sel: id === focus ? undefined : id });
    },
    [go, inLayout, refocus, focus],
  );

  // The camera follows only when asked to (panTo), or when a new layout centres on someone else.
  const prevFocus = useRef(focus);
  useEffect(() => {
    const changed = prevFocus.current !== focus;
    const target = panTo.current ?? (changed && view !== 'dynasty' ? focus : null);
    const quiet = panQuiet.current;
    prevFocus.current = focus;
    panTo.current = null;
    panQuiet.current = false;
    if (!target) return;
    let t1 = 0, t2 = 0;
    const raf = requestAnimationFrame(() => {
      const moved = canvas.current?.centerOn(target) ?? false;
      // A journey only when the camera really travels: a whoosh, then rings and a little tune on arrival.
      if (quiet || !moved) return;
      play('whoosh');
      t1 = window.setTimeout(() => { setFlash({ id: target, at: Date.now() }); play('found'); }, 380);
      t2 = window.setTimeout(() => setFlash(null), 1400);
    });
    return () => { cancelAnimationFrame(raf); clearTimeout(t1); clearTimeout(t2); };
  }, [focus, sel, view, lay]);
  const prevView = useRef(view);
  useEffect(() => {
    if (prevView.current === view) return;
    prevView.current = view;
    // A new view opens framed like the first one: as much of it as fits, readable.
    requestAnimationFrame(() => canvas.current?.frame(sel));
  }, [view, sel]);

  // ---- trail: the last people you looked at ----
  const [trail, setTrail] = useState<string[]>([]);
  useEffect(() => setTrail((t) => [sel, ...t.filter((x) => x !== sel)].slice(0, 9)), [sel]);

  // ---- lenses ----
  const myAnc = useMemo(() => (who ? ancestorDepths(f, who) : new Map<string, number>()), [f, who]);
  const [required] = useRequired(tree);
  const dimmed = useMemo<Set<string> | null>(() => {
    if (lens === 'line') return new Set([sel, ...anc(f, sel).keys(), ...descendants(f, sel)]);
    if (lens === 'living') return new Set(f.graph.people.filter((p) => p.living).map((p) => p.id));
    if (lens === 'gaps') return new Set(f.graph.people.filter((p) => gapsOf(f, p, required).length).map((p) => p.id));
    if (lens === 'house') {
      const h = f.byId.get(sel)?.house;
      return new Set(f.graph.people.filter((p) => p.house === h).map((p) => p.id));
    }
    if (lens === 'path') {
      const path = kinPath(f, who ?? me, search.to ?? sel);
      return path.length ? new Set(path) : null;
    }
    return null;
  }, [lens, f, sel, me, who, search.to, required]);
  const lensCount = useMemo(() => {
    if (!dimmed) return '';
    const shown = new Set(lay.nodes.map((n) => n.id));
    const lit = [...dimmed].filter((id) => shown.has(id)).length;
    return `${lit.toLocaleString('en-GB')} of ${shown.size.toLocaleString('en-GB')} shown`;
  }, [dimmed, lay]);

  // ---- kinship labels, computed lazily for the cards on screen ----
  const kinCache = useMemo(() => new Map<string, string | undefined>(), [f, who]);
  const kinOf = useCallback(
    (id: string) => {
      if (!who) return undefined;
      if (!kinCache.has(id)) {
        const k = kinship(f, who, id, myAnc)?.label;
        kinCache.set(id, k && k !== 'you' ? k : undefined);
      }
      return kinCache.get(id);
    },
    [kinCache, f, who, myAnc],
  );

  const toggle = useCallback((id: string) => (play('page'), setCollapsed((c) => {
    const n = new Set(c);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  })), []);

  // Fold everything except the line from the root to the selected person.
  const foldToFocus = () => {
    const keep = new Set([sel, ...anc(f, sel).keys()]);
    const n = new Set<string>();
    for (const node of lay.nodes) if (!keep.has(node.id) && children(f, node.id).length) n.add(node.id);
    play('page');
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
        isMe={n.id === who}
        showSpouses={view === 'dynasty'}
        onSelect={(id) => select(id, 'click')}
        onOpen={refocus}
        onToggle={view === 'dynasty' || (view === 'family' && n.row > 0 && n.role === 'main') ? toggle : undefined}
        onAdd={canAdd ? (anchor, relation, sex) => setAdding({ anchor, relation, sex }) : undefined}
      />
    ),
    [f, tree, kinOf, sel, who, view, select, refocus, toggle, canAdd],
  );

  // ---- keyboard: walk the tree ----
  const spatial = (dir: 'left' | 'right') => {
    const cur = canvas.current?.nodeOf(sel);
    if (!cur) return;
    const row = lay.nodes.filter((n) => n.row === cur.row && n.role !== 'dup' && n.role !== 'ghost' && (dir === 'left' ? n.x < cur.x : n.x > cur.x));
    row.sort((a, b) => Math.abs(a.x - cur.x) - Math.abs(b.x - cur.x));
    if (row[0]) select(row[0].id, 'key');
  };
  const vertical = (dir: 'up' | 'down') => {
    const next = dir === 'up' ? parents(f, sel) : children(f, sel);
    if (next.length) select(next.find(inLayout) ?? next[0], 'key');
  };
  const live = !adding;
  usePageHotkey('ArrowLeft', () => spatial('left'), { enabled: live });
  usePageHotkey('ArrowRight', () => spatial('right'), { enabled: live });
  usePageHotkey('ArrowUp', () => vertical('up'), { enabled: live });
  usePageHotkey('ArrowDown', () => vertical('down'), { enabled: live });
  usePageHotkey('Enter', () => refocus(sel), { enabled: live });
  usePageHotkey('F', () => canvas.current?.fit(), { enabled: live });
  usePageHotkey('C', () => canvas.current?.centerOn(sel), { enabled: live });
  usePageHotkey('H', () => refocus(me), { enabled: live });
  usePageHotkey('1', () => go({ view: 'family', focus: sel, sel: undefined }), { enabled: live });
  usePageHotkey('2', () => go({ view: 'dynasty', root: undefined, focus: sel, sel: undefined }), { enabled: live });
  usePageHotkey('3', () => go({ view: 'ancestors', focus: sel, sel: undefined }), { enabled: live });
  usePageHotkey('L', () => go({ lens: lens === 'line' ? 'none' : 'line' }), { enabled: live });
  usePageHotkey('=', () => canvas.current?.zoomBy(1.25), { enabled: live });
  usePageHotkey('-', () => canvas.current?.zoomBy(0.8), { enabled: live });
  usePageHotkey('?', () => setHelp((h) => !h), { enabled: live });
  usePageHotkey('Escape', () => {
    if (help) setHelp(false);
    else if (phone && panel && snap !== 'peek') setSnap('peek');
    else if (lens !== 'none') go({ lens: 'none', to: undefined });
    else setPanel(false);
  }, { enabled: live });

  const rowLabel = (row: number, year: number | undefined, i: number): [string, string?] => {
    const mark = view === 'dynasty' ? (codex ? ROMAN[i] ?? String(i + 1) : String(i + 1)) : row === 0 ? '●' : row < 0 ? `↑${-row}` : `↓${row}`;
    const era = year === undefined ? undefined : codex ? `c. ${year}` : `${Math.floor(year / 10) * 10}s`;
    return [mark, era];
  };


  const focusPerson = f.byId.get(sel)!;
  const rootPerson = root ? f.byId.get(root) : undefined;
  const rootHouse = rootPerson?.house ? f.house.get(rootPerson.house) : undefined;
  const members = useMemo(() => new Set(lay.nodes.filter((n) => n.role !== 'ghost').map((n) => n.id)).size, [lay]);
  const prevRoot = useRef(lay.root);
  useEffect(() => {
    if (view !== 'dynasty' || prevRoot.current === lay.root) return;
    prevRoot.current = lay.root;
    play('seal');
    requestAnimationFrame(() => canvas.current?.frame(sel));
  }, [lay.root, view]);

  /** A CK3-style notice once someone joins: "A daughter for House Valcourt". */
  const announce = (id: string, person: { given: string; sex?: string }, anchor: string, relation: AddRelation) => {
    const a = f.byId.get(anchor);
    const h = a?.house ? f.house.get(a.house) : undefined;
    const fam = h ? (h.name.startsWith('House') ? h.name : `the ${h.name} family`) : 'the family';
    const word = (m: string, w: string, x: string) => (person.sex === 'm' ? m : person.sex === 'f' ? w : x);
    const title =
      relation === 'child' ? `A ${word('son', 'daughter', 'child')} for ${fam}` :
      relation === 'partner' ? `${person.given} joins ${fam}` :
      relation === 'sibling' ? `A ${word('brother', 'sister', 'sibling')} for ${a?.given ?? 'them'}` :
      `${a?.given ?? 'Their'}'s ${word('father', 'mother', 'parent')} is found`;
    play('chime');
    toast({
      title,
      body: `${person.given} has a place in the tree now. Add a birthday or a memory whenever you like.`,
      person: id,
      ms: 9000,
      // Added by mistake? One click takes them out again.
      action: !canRemove ? undefined : {
        label: 'Undo',
        run: async () => {
          try {
            await removePerson({ data: { tree, id } });
            await qc.invalidateQueries({ queryKey: ['graph', tree] });
            go({ sel: anchor === focus ? undefined : anchor });
            play('page');
          } catch (e) {
            toast({ title: 'Could not undo', body: e instanceof Error ? e.message : 'Remove them from their Edit tab instead.' });
          }
        },
      },
    });
  };

  // Once a day per tree: whose birthday is today.
  useEffect(() => {
    const today = new Date();
    const md = `-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const key = `kindred:bday:${tree}:${today.toDateString()}`;
    try { if (localStorage.getItem(key)) return; } catch { return; }
    const who = f.graph.people.filter((p) => p.living && p.born && /^\d{4}-\d\d-\d\d$/.test(p.born) && p.born.endsWith(md));
    if (!who.length) return;
    let t = 0;
    // Shown only to someone looking: the timer starts over whenever the tab is hidden and shown again.
    const arm = () => {
      clearTimeout(t);
      if (!document.hidden) t = window.setTimeout(show, 1200);
    };
    const disarm = () => {
      clearTimeout(t);
      document.removeEventListener('visibilitychange', arm);
    };
    const show = () => {
      if (document.hidden) return;
      disarm();
      // Marked only once shown: a cancelled effect (StrictMode runs effects twice) must not eat it.
      try { localStorage.setItem(key, '1'); } catch {}
      play('fanfare');
      for (const p of who.slice(0, 2)) {
        toast({
          title: `${displayName(p, f)} turns ${today.getFullYear() - parseInt(p.born!, 10)} today`,
          body: kinOf(p.id) ? `Your ${kinOf(p.id)}. A call would make their day.` : 'A good day to get in touch.',
          person: p.id,
          icon: 'cake-slice',
          ms: 9000,
          action: { label: 'Open', run: () => select(p.id) },
        });
      }
    };
    document.addEventListener('visibilitychange', arm);
    arm();
    return disarm;
  }, [tree]); // eslint-disable-line react-hooks/exhaustive-deps

  // The house banner introduces the dynasty, then folds into a pill after a moment or once the
  // reader pans, so it never sits over the top generation for long.
  const bannerKey = view === 'dynasty' ? `${lay.root}|${line}` : '';
  const [bannerBig, setBannerBig] = useState(true);
  useEffect(() => {
    if (!bannerKey) return;
    setBannerBig(true);
    const t = window.setTimeout(() => setBannerBig(false), 2500);
    return () => clearTimeout(t);
  }, [bannerKey]);
  const onUserMove = useCallback(() => setBannerBig(false), []);

  const houses = useMemo(() => {
    const n = new Map<string, number>();
    for (const p of f.graph.people) if (p.house) n.set(p.house, (n.get(p.house) ?? 0) + 1);
    return f.graph.houses.map((h) => [h, n.get(h.id) ?? 0] as const).filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]);
  }, [f]);
  const house = focusPerson.house ? f.house.get(focusPerson.house) : undefined;

  const setView = (v: View) => go(v === 'dynasty' ? { view: v, root: undefined, focus: sel, sel: undefined } : { view: v, focus: sel, sel: undefined });
  const viewOptions: (SelectOption<View> & { title: string })[] = [
    { value: 'family', label: 'Family', icon: <Network size={15} />, title: 'Family around the focus (1)' },
    { value: 'dynasty', label: 'Dynasty', icon: <Crown size={15} />, title: 'Dynasty tree (2)' },
    { value: 'ancestors', label: 'Ancestors', icon: <GitFork size={15} style={{ transform: 'rotate(180deg)' }} />, title: 'Ancestors (3)' },
  ];
  const ALL = '*all';
  const PAGE = '*page';
  const lineHouse = view === 'dynasty' && line === 'house' ? f.house.get(f.byId.get(lay.root)?.house ?? '') : undefined;
  const houseOptions: SelectOption[] = [
    ...houses.map(([h, n]) => ({ value: h.id, label: h.name, icon: <Arms arms={h.arms} size={18} />, hint: n.toLocaleString('en-GB'), group: 'House line' })),
    { value: ALL, label: 'All descendants', icon: <Users size={16} />, hint: 'through daughters too', group: 'Every descendant' },
    ...(lineHouse ? [{ value: PAGE, label: 'Open house page', icon: <Landmark size={16} />, hint: lineHouse.name, group: 'This house' }] : []),
  ];
  const lensOptions: SelectOption<NonNullable<typeof search.lens>>[] = [
    { value: 'none', label: 'Everyone', icon: <Glasses size={16} /> },
    { value: 'line', label: `Direct line of ${focusPerson.given}`, icon: <Waypoints size={16} />, hint: 'L' },
    { value: 'house', label: house ? house.name : 'Same house', icon: house ? <Arms arms={house.arms} size={16} /> : <Shield size={16} /> },
    { value: 'living', label: 'Living people', icon: <HeartPulse size={16} /> },
    { value: 'gaps', label: 'Information needed', icon: <FileQuestion size={16} /> },
    { value: 'path', label: who ? 'Path from me' : 'Path from the start', icon: <RouteIcon size={16} /> },
  ];
  const lensLabel = lensOptions.find((o) => o.value === lens)?.label ?? 'Everyone';
  const older = rootPerson ? parents(f, rootPerson.id)[0] : undefined;

  // What covers the canvas, measured when the camera frames something: the HUD (toolbar, banner, lens
  // chip) on top, the docked panel on the left, the sheet below. The canvas measures its map controls.
  const inset = useCallback((): Inset => {
    const h = hud.current;
    const top = (h ? h.offsetTop + h.offsetHeight : hudH + 12) + (phone ? 8 : 12);
    return phone
      ? { left: 40, top, bottom: snap === 'full' ? 0 : sheetH }
      : { left: panel ? panelW + 56 : 56, top };
  }, [phone, snap, sheetH, panel, panelW, hudH]);
  // When the panel opens or the sheet grows, keep the selected card in the part of the tree still showing.
  useEffect(() => {
    if (!panel || (phone && snap === 'full')) return;
    const r = requestAnimationFrame(() => canvas.current?.reveal(sel));
    return () => cancelAnimationFrame(r);
  }, [panel, phone, snap]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bottom sheet: drag the grip (or the peek) to resize; it settles on the nearest height.
  const drag = useRef<{ y: number; h: number; t: number; v: number; moved: boolean } | null>(null);
  const justDragged = useRef(false);
  const sheetDown = (e: React.PointerEvent) => {
    if (!phone || !(e.target as HTMLElement).closest('.sheet-bar, .sheet-peek-hit')) return;
    if ((e.target as HTMLElement).closest('.sheet-back')) return;
    drag.current = { y: e.clientY, h: sheet.current!.getBoundingClientRect().height, t: performance.now(), v: 0, moved: false };
  };
  const sheetMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = sheet.current;
    if (!d || !el) return;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dy) < 6) return;
    if (!d.moved) try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    d.moved = true;
    const h = Math.max(PEEK_H * 0.6, Math.min(pageH, d.h - dy));
    const now = performance.now();
    d.v = (d.h - dy - (parseFloat(el.style.height) || d.h)) / Math.max(1, now - d.t);
    d.t = now;
    el.style.transition = 'none';
    el.style.height = `${h}px`;
    page.current?.style.setProperty('--sheet-h', `${h}px`);
  };
  const sheetUp = () => {
    const d = drag.current;
    const el = sheet.current;
    drag.current = null;
    if (!d?.moved || !el) return;
    justDragged.current = true;
    setTimeout(() => (justDragged.current = false), 0);
    // Where it would come to rest, given the flick.
    const h = el.getBoundingClientRect().height + d.v * 180;
    const order: Snap[] = ['peek', 'half', 'full'];
    const best = order.reduce((a, b) => (Math.abs(snapH(b) - h) < Math.abs(snapH(a) - h) ? b : a));
    el.style.transition = '';
    el.style.height = '';
    page.current?.style.removeProperty('--sheet-h');
    if (h < PEEK_H * 0.55) setPanel(false);
    else setSnap(best);
  };
  const cycle = () => {
    if (justDragged.current) return;
    setSnap((s) => (s === 'peek' ? 'half' : s === 'half' ? 'full' : 'peek'));
  };

  return (
    <div
      ref={page}
      className={`tree-page${panel ? ' has-panel' : ''}`}
      data-sheet={phone && panel ? snap : undefined}
      style={{ '--sheet-h': `${phone && panel && snap !== 'full' ? sheetH : 0}px` } as CSSProperties}
    >
      <Canvas
        ref={canvas}
        family={f}
        layout={lay}
        focus={sel}
        dimmed={dimmed}
        renderCard={renderCard}
        rowLabel={rowLabel}
        flash={flash}
        inset={inset}
        onBackground={() => {}}
        onUserMove={onUserMove}
        controls={
          <button className="btn icon ghost map-keys" onClick={() => setHelp((h) => !h)} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" aria-pressed={help}><Keyboard size={16} /></button>
        }
        overlay={
          <>
            <div ref={hud} className={`hud${panel ? ' with-panel' : ''}`}>
            <div className="tree-toolbar panel no-pan" role="toolbar" aria-label="Tree view">
              <div className="seg tb-views" role="group" aria-label="View">
                {viewOptions.map((o) => (
                  <button key={o.value} className="btn" aria-pressed={view === o.value} onClick={() => setView(o.value)} title={o.title} aria-label={o.label}>
                    {o.icon}<span className="tb-label">{o.label}</span>
                  </button>
                ))}
              </div>
              <Select className="tb-view-select" size="sm" value={view} onChange={setView} options={viewOptions} aria-label="View" menuWidth={170} />
              <span className="tb-sep" />
              {view === 'family' && (
                <>
                  <Stepper label="Up" long="Generations up" icon={<ArrowUpToLine size={15} />} value={up} onChange={(v) => go({ up: v }, true)} />
                  <Stepper label="Down" long="Generations down" icon={<ArrowDownToLine size={15} />} value={down} onChange={(v) => go({ down: v }, true)} />
                </>
              )}
              {view === 'ancestors' && <Stepper label="Generations" long="Generations" icon={<ArrowUpToLine size={15} />} value={Math.max(up, 6)} onChange={(v) => go({ up: v }, true)} />}
              {view === 'dynasty' && (
                <>
                  <Select
                    className="tb-house"
                    size="sm"
                    aria-label="House"
                    title="Whose dynasty tree: a house's own line, or every descendant"
                    placeholder="Choose a house"
                    menuWidth={260}
                    value={line === 'house' ? (f.byId.get(lay.root)?.house ?? '') : ALL}
                    options={houseOptions}
                    onChange={(v) => {
                      if (v === PAGE) return lineHouse && navigate({ to: '/$tree/house/$house', params: { tree, house: lineHouse.id } });
                      if (v === ALL) return go({ line: 'all', root: undefined });
                      const r = houseRoot(f, v);
                      if (r) { panTo.current = r; go({ line: 'house', root: r, focus: r, sel: undefined }); }
                    }}
                  />
                  <button className="btn tb-fold" onClick={foldToFocus} title="Fold every branch except the line to the selected person" aria-label="Fold others"><ChevronsDownUp size={15} /><span className="tb-label">Fold others</span></button>
                  {collapsed.size > 0 && <button className="btn tb-fold" onClick={() => setCollapsed(new Set())} title="Unfold every branch" aria-label="Unfold all"><ChevronsUpDown size={15} /><span className="tb-label">Unfold all</span></button>}
                </>
              )}
              <span className="tb-sep" />
              <Select
                className={`tb-lens${lens !== 'none' ? ' on' : ''}`}
                size="sm"
                aria-label={`Lens: ${lensLabel}`}
                title={`Lens: ${lensLabel}`}
                menuWidth={250}
                value={lens}
                options={lensOptions}
                onChange={(v) => go({ lens: v, to: undefined })}
              />
            </div>

            {view === 'dynasty' && rootPerson && (
              <div key={lay.root + line} className={`house-banner no-pan${bannerBig ? '' : ' compact'}`}>
                <button
                  className="banner-id"
                  onClick={() => setBannerBig((b) => !b)}
                  aria-expanded={bannerBig}
                  title={bannerBig ? 'Fold the banner' : 'Show the house’s details'}
                >
                  {line === 'house' && rootHouse ? <Arms arms={rootHouse.arms} size={bannerBig ? 30 : 20} /> : <Users size={bannerBig ? 22 : 16} />}
                  <span className="banner-text">
                    <b className="display">{line === 'house' && rootHouse ? rootHouse.name : `Descendants of ${displayName(rootPerson, f)}`}</b>
                    {bannerBig ? (
                      <span className="faint">
                        {members.toLocaleString('en-GB')} {line === 'house' ? (members === 1 ? 'member' : 'members') : members === 1 ? 'descendant' : 'descendants'} · from {displayName(rootPerson, f)}
                        {rootHouse?.motto && line === 'house' ? <> · <i>“{rootHouse.motto}”</i></> : null}
                      </span>
                    ) : (
                      <span className="faint banner-count">{members.toLocaleString('en-GB')}</span>
                    )}
                  </span>
                </button>
                {line === 'house' && rootHouse && (
                  <Link className={`btn ${bannerBig ? 'ghost' : 'icon ghost'} banner-page`} to="/$tree/house/$house" params={{ tree, house: rootHouse.id }} title={`Open the page of ${rootHouse.name}`} aria-label={`Open the page of ${rootHouse.name}`}>
                    <Landmark size={15} />{bannerBig && <> House page</>}
                  </Link>
                )}
                {older && (
                  bannerBig
                    ? <button className="btn ghost" onClick={() => go({ root: older })} title="Start the tree one generation earlier"><ChevronUp size={15} /> Older</button>
                    : <button className="btn icon ghost" onClick={() => go({ root: older })} title="Start the tree one generation earlier" aria-label="Start one generation earlier"><ChevronUp size={15} /></button>
                )}
              </div>
            )}

            {lens !== 'none' && (
              <div className="lens-banner no-pan" role="status">
                <span className="lens-text">
                {lens === 'path' ? (
                  who
                    ? <>Showing how <b>{displayName(f.byId.get(search.to ?? sel)!, f)}</b> is your <b>{kinship(f, who, search.to ?? sel)?.label ?? 'relative'}</b></>
                    : <>Showing how <b>{displayName(f.byId.get(search.to ?? sel)!, f)}</b> is related to <b>{displayName(f.byId.get(me)!, f)}</b></>
                ) : lens === 'line' ? (
                  <>Direct line of <b>{focusPerson.given}</b>: ancestors and descendants</>
                ) : lens === 'living' ? (
                  <>Living people</>
                ) : lens === 'gaps' ? (
                  <>People with information still needed</>
                ) : (
                  <>{house?.name ?? 'House'} only</>
                )}
                </span>
                <span className="lens-count">{lensCount}</span>
                <button className="btn icon ghost" onClick={() => go({ lens: 'none', to: undefined })} aria-label="Clear the lens" title="Clear the lens (Esc)"><X size={14} /></button>
              </div>
            )}

            </div>

            {trail.length > 1 && (
              <nav className={`trail no-pan panel${panel ? ' with-panel' : ''}`} aria-label="Recently viewed">
                <span className="faint">Trail</span>
                {trail.slice(1).map((id) => {
                  const p = f.byId.get(id);
                  return p ? (
                    <button key={id} className="trail-item" onClick={() => select(id)} title={displayName(p, f)} aria-label={displayName(p, f)}>
                      <Portrait person={p} tree={tree} size={30} frame={false} />
                    </button>
                  ) : null;
                })}
              </nav>
            )}

            {help && <HelpCard onClose={() => setHelp(false)} />}
          </>
        }
      />
      {panel && (
        <div
          ref={sheet}
          className="panel-sheet"
          data-snap={snap}
          onPointerDown={sheetDown}
          onPointerMove={sheetMove}
          onPointerUp={sheetUp}
          onPointerCancel={sheetUp}
        >
          <div className="sheet-bar">
            {snap === 'full' && (
              <button className="btn ghost sheet-back" onClick={() => setSnap('peek')}><ArrowLeft size={16} /> Back to tree</button>
            )}
            <button
              className="sheet-grip"
              onClick={cycle}
              aria-label={snap === 'peek' ? 'Show more' : snap === 'half' ? 'Show everything' : 'Show less'}
              title={snap === 'full' ? 'Show less' : 'Show more'}
            >
              <span />
            </button>
          </div>
          <PersonPanel
            family={f}
            tree={tree}
            id={sel}
            me={who}
            onSelect={(id) => select(id)}
            onCenter={() => { if (phone) setSnap('peek'); refocus(sel); }}
            onPath={() => { if (phone) setSnap('peek'); go({ lens: 'path', to: sel }); }}
            onDynasty={() => { if (phone) setSnap('peek'); go({ view: 'dynasty', root: undefined, focus: sel, sel: undefined }); }}
            onAncestors={() => { if (phone) setSnap('peek'); go({ view: 'ancestors', focus: sel, sel: undefined }); }}
            onClose={() => setPanel(false)}
          />
          {snap === 'peek' && (
            <button className="sheet-peek-hit" onClick={() => !justDragged.current && setSnap('half')} aria-label={`More about ${displayName(focusPerson, f)}`} />
          )}
        </div>
      )}
      {adding && canAdd && (
        <QuickAdd
          family={f}
          tree={tree}
          anchor={adding.anchor}
          relation={adding.relation}
          sex={adding.sex}
          onCancel={() => setAdding(null)}
          // Linking someone who already exists: select and pan to them quietly, without re-centring the tree.
          onLinked={(id) => { setAdding(null); panTo.current = id; panQuiet.current = true; go({ sel: id }); }}
          onDone={(id, person) => { setAdding(null); panTo.current = id; panQuiet.current = true; go({ sel: id }); announce(id, person, adding.anchor, adding.relation); }}
        />
      )}
    </div>
  );
}

/** A media query, live. False on the server and during hydration. */
function useMedia(q: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = matchMedia(q);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => matchMedia(q).matches,
    () => false,
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

function Stepper({ label, long, icon, value, onChange }: { label: string; long: string; icon: ReactNode; value: number; onChange: (v: number) => void }) {
  return (
    <span className="stepper" role="group" aria-label={long} title={long}>
      <span className="faint tb-label">{label}</span>
      <span className="tb-icon faint" aria-hidden>{icon}</span>
      <button className="btn icon" onClick={() => onChange(Math.max(1, value - 1))} disabled={value <= 1} aria-label={`Fewer: ${long}`}><Minus size={13} /></button>
      <b aria-live="polite">{value}</b>
      <button className="btn icon" onClick={() => onChange(Math.min(12, value + 1))} disabled={value >= 12} aria-label={`More: ${long}`}><Plus size={13} /></button>
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
    <div className="help-card panel no-pan" role="dialog" aria-label="Keyboard shortcuts">
      <header className="display">Getting around <button className="btn icon ghost" onClick={onClose} aria-label="Close"><X size={14} /></button></header>
      {keys.map(([k, v]) => (
        <div key={k} className="help-row"><span>{k.split(' ').map((x) => <kbd key={x}>{x}</kbd>)}</span><span>{v}</span></div>
      ))}
      <p className="faint">Drag or scroll to pan · pinch or ⌘-scroll to zoom · click the minimap to jump</p>
    </div>
  );
}
