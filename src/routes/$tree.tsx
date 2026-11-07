import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { BookOpen, CalendarHeart, CircleHelp, Contact, Map as MapIcon, Network, ScrollText, Search } from 'lucide-react';
import { useEffect } from 'react';
import { Arms } from '~/components/Heraldry';
import { Palette, usePalette } from '~/components/Palette';
import { SoundSwitch, ThemeSwitch } from '~/components/ThemeSwitch';
import { Toasts } from '~/components/Toasts';
import { graphQuery, treesQuery } from '~/lib/api';
import { useFamily } from '~/lib/family';
import { usePref } from '~/lib/prefs';

export const Route = createFileRoute('/$tree')({
  loader: ({ context, params }) =>
    Promise.all([context.queryClient.ensureQueryData(graphQuery(params.tree)), context.queryClient.ensureQueryData(treesQuery)]),
  component: TreeLayout,
});

function TreeLayout() {
  const { tree } = Route.useParams();
  const f = useFamily();
  const theme = usePref('theme');
  const palette = usePalette();

  // Each tree opens in its own theme unless the reader picked one.
  useEffect(() => {
    // Read storage directly: during hydration the pref hook still reports the server's null.
    let saved: string | null = null;
    try { saved = localStorage.getItem('kindred:theme'); } catch {}
    document.documentElement.dataset.theme = theme ?? saved ?? f.graph.tree.theme;
  }, [theme, f.graph.tree.theme]);

  const focusHouse = f.house.get(f.byId.get(f.graph.tree.focus)?.house ?? '');
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand" title="All trees">
          {focusHouse ? <Arms arms={focusHouse.arms} size={28} /> : null}
          <b>{f.graph.tree.name}</b>
        </Link>
        <nav>
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
          <Link to="/$tree/needed" params={{ tree }} title="Information needed">
            <CircleHelp size={16} /> <span className="nav-label">Needed</span>
          </Link>
          <Link to="/$tree/chronicle" params={{ tree }} title="Chronicle">
            <ScrollText size={16} /> <span className="nav-label">Chronicle</span>
          </Link>
        </nav>
        <span className="spacer" />
        <button className="btn search-trigger" onClick={() => palette.open()}>
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <Search size={15} /> Find anyone…
          </span>
          <kbd>⌘K</kbd>
        </button>
        <SoundSwitch />
        <ThemeSwitch />
      </header>
      <Outlet />
      <Palette />
      <Toasts />
    </div>
  );
}
