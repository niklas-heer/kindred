import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, notFound, Outlet, redirect } from '@tanstack/react-router';
import { BookOpen, CalendarHeart, CircleHelp, Contact, Landmark, Map as MapIcon, MoreHorizontal, Network, ScrollText, Search, Users } from 'lucide-react';
import { AccountMenu } from '~/components/AccountMenu';
import { useEffect, useMemo, useState } from 'react';
import { FirstRun } from '~/components/FirstRun';
import { Arms } from '~/components/Heraldry';
import { NotFoundPage } from '~/components/NotFoundPage';
import { Palette, usePalette } from '~/components/Palette';
import { SoundSwitch, THEME_ICONS, THEME_LABEL, ThemeSwitch, useSound, useTheme } from '~/components/ThemeSwitch';
import { Toasts } from '~/components/Toasts';
import { Dialog } from '~/components/ui/Dialog';
import { Switch } from '~/components/ui/Switch';
import { graphQuery } from '~/lib/api';
import { myFamiliesQuery, sessionQuery } from '~/lib/auth/functions';
import { NoAccessPage } from '~/components/NoAccess';
import { useCan } from '~/lib/session';
import { useFamily } from '~/lib/family';
import { setPref, THEMES, usePref } from '~/lib/prefs';
import { treeTitle } from '~/lib/title';

export const Route = createFileRoute('/$tree')({
  // Signed out: to /signin and back. Not a member: "You don't have access" (whether or not the family exists).
  beforeLoad: async ({ context, params, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (session.needsSetup) throw redirect({ to: '/setup' });
    if (!session.user) throw redirect({ to: '/signin', search: { next: location.href } });
    if (!session.memberships.some((m) => m.tree === params.tree)) throw notFound({ data: { access: false } });
  },
  loader: async ({ context, params }) => {
    // An unknown family is a friendly "not found", never a server error with a developer hint.
    const trees = await context.queryClient.ensureQueryData(myFamiliesQuery);
    if (!trees.some((t) => t.id === params.tree)) throw notFound();
    await context.queryClient.ensureQueryData(graphQuery(params.tree));
  },
  head: (ctx) => ({ meta: [{ title: treeTitle(ctx) }] }),
  notFoundComponent: ({ data }) =>
    (data as { access?: boolean } | undefined)?.access === false ? <NoAccessPage /> : <NotFoundPage kind="family" id={Route.useParams().tree} />,
  component: TreeLayout,
});

function TreeLayout() {
  const { tree } = Route.useParams();
  const f = useFamily();
  const theme = usePref('theme');
  const palette = usePalette();
  const { data: families = [] } = useQuery(myFamiliesQuery);
  const multiple = families.length >= 2;
  const [more, setMore] = useState(false);

  // Each tree opens in its own theme unless the reader picked one.
  useEffect(() => {
    // Read storage directly: during hydration the pref hook still reports the server's null.
    let saved: string | null = null;
    try { saved = localStorage.getItem('kindred:theme'); } catch {}
    document.documentElement.dataset.theme = theme ?? saved ?? f.graph.tree.theme;
  }, [theme, f.graph.tree.theme]);

  // The crest: the focus person's house, else the family's largest house.
  const crest = useMemo(() => {
    const own = f.house.get(f.byId.get(f.graph.tree.focus)?.house ?? '');
    if (own) return own;
    const n = new Map<string, number>();
    for (const p of f.graph.people) if (p.house) n.set(p.house, (n.get(p.house) ?? 0) + 1);
    const top = [...n].sort((a, b) => b[1] - a[1])[0]?.[0];
    return top ? f.house.get(top) : undefined;
  }, [f]);

  return (
    <div className="shell">
      <header className="topbar">
        <Link to={multiple ? "/" : "/$tree"} params={{ tree }} search={multiple ? { families: "all" } : {}} className="brand" title={multiple ? "All families" : "Family tree"}>
          {crest ? <Arms arms={crest.arms} size={28} /> : null}
          <b>{f.graph.tree.name}</b>
        </Link>
        <nav aria-label="Sections">
          <Link to="/$tree" params={{ tree }} activeOptions={{ exact: true, includeSearch: false }} title="Tree">
            <Network size={16} /> <span className="nav-label">Tree</span>
          </Link>
          <Link to="/$tree/almanac" params={{ tree }} title="Almanac">
            <CalendarHeart size={16} /> <span className="nav-label">Almanac</span>
          </Link>
          <Link to="/$tree/atlas" params={{ tree }} title="Atlas">
            <MapIcon size={16} /> <span className="nav-label">Atlas</span>
          </Link>
          <Link to="/$tree/contacts" params={{ tree }} title="Contacts">
            <Contact size={16} /> <span className="nav-label">Contacts</span>
          </Link>
          <Link to="/$tree/people" params={{ tree }} title="Register">
            <BookOpen size={16} /> <span className="nav-label">Register</span>
          </Link>
          <Link to="/$tree/houses" params={{ tree }} title="Houses" activeOptions={{ exact: false }}>
            <Landmark size={16} /> <span className="nav-label">Houses</span>
          </Link>
          <Link to="/$tree/needed" params={{ tree }} title="Information needed">
            <CircleHelp size={16} /> <span className="nav-label">Needed</span>
          </Link>
          <Link to="/$tree/chronicle" params={{ tree }} title="Chronicle">
            <ScrollText size={16} /> <span className="nav-label">Chronicle</span>
          </Link>
        </nav>
        <span className="spacer" />
        <button className="btn search-trigger" onClick={() => palette.open()} aria-label="Find anyone (⌘K)">
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <Search size={15} /> Find anyone…
          </span>
          <kbd>⌘K</kbd>
        </button>
        <span className="topbar-tools">
          <SoundSwitch />
          <ThemeSwitch />
        </span>
        <AccountMenu familyName={f.graph.tree.name} />
      </header>
      <Outlet />
      {/* Phones: the sections move to a bar along the bottom edge. */}
      <nav className="tabbar" aria-label="Sections">
        <Link to="/$tree" params={{ tree }} activeOptions={{ exact: true, includeSearch: false }}>
          <Network size={20} /> Tree
        </Link>
        <Link to="/$tree/almanac" params={{ tree }}>
          <CalendarHeart size={20} /> Almanac
        </Link>
        <Link to="/$tree/atlas" params={{ tree }}>
          <MapIcon size={20} /> Atlas
        </Link>
        <Link to="/$tree/needed" params={{ tree }}>
          <CircleHelp size={20} /> Needed
        </Link>
        <button type="button" onClick={() => setMore(true)} aria-expanded={more} aria-haspopup="dialog">
          <MoreHorizontal size={20} /> More
        </button>
      </nav>
      <MoreSheet open={more} onClose={() => setMore(false)} tree={tree} multiple={multiple} />
      <Palette />
      <FirstRun />
      <Toasts />
    </div>
  );
}

/** Contacts, Register and Chronicle, plus theme and sound: what the phone's tab bar has no room for. */
function MoreSheet({ open, onClose, tree, multiple }: { open: boolean; onClose: () => void; tree: string; multiple: boolean }) {
  const theme = useTheme();
  const steward = useCan('manage-access');
  const [sound, toggleSound] = useSound();
  return (
    <Dialog open={open} onClose={onClose} title="More" placement="sheet" width={560}>
      <ul className="more-list" onClick={(e) => (e.target as HTMLElement).closest('a') && onClose()}>
        <li><Link to="/$tree/contacts" params={{ tree }}><Contact size={19} /> Contacts <small>addresses &amp; phones</small></Link></li>
        <li><Link to="/$tree/people" params={{ tree }}><BookOpen size={19} /> Register <small>everyone, as a table</small></Link></li>
        <li><Link to="/$tree/houses" params={{ tree }}><Landmark size={19} /> Houses <small>arms, mottos &amp; members</small></Link></li>
        <li><Link to="/$tree/chronicle" params={{ tree }}><ScrollText size={19} /> Chronicle <small>stories &amp; sayings</small></Link></li>
        {steward && <li><Link to="/$tree/access" params={{ tree }}><Users size={19} /> Access <small>members &amp; invitations</small></Link></li>}
        {multiple && <li><Link to="/" search={{ families: "all" }}><Network size={19} /> All families</Link></li>}
      </ul>
      <div className="more-row">
        <span>Theme</span>
        <div className="seg" role="group" aria-label="Theme">
          {THEMES.map((t) => {
            const Icon = THEME_ICONS[t.id];
            return (
              <button key={t.id} className="btn" aria-pressed={theme === t.id} onClick={() => setPref('theme', t.id)}>
                <Icon size={14} /> {THEME_LABEL[t.id]}
              </button>
            );
          })}
        </div>
      </div>
      <div className="more-row">
        <Switch checked={sound} onChange={toggleSound} labelFirst className="more-switch">Sound effects</Switch>
      </div>
    </Dialog>
  );
}
