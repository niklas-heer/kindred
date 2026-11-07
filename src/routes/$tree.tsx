import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { BookOpen, CalendarHeart, Contact, Network, ScrollText, Search } from 'lucide-react';
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
          <Link to="/$tree" params={{ tree }} activeOptions={{ exact: true, includeSearch: false }}>
            <Network size={16} /> Tree
          </Link>
          <Link to="/$tree/almanac" params={{ tree }}>
            <CalendarHeart size={16} /> Almanac
          </Link>
          <Link to="/$tree/contacts" params={{ tree }}>
            <Contact size={16} /> Contacts
          </Link>
          <Link to="/$tree/people" params={{ tree }}>
            <BookOpen size={16} /> Register
          </Link>
          <Link to="/$tree/chronicle" params={{ tree }}>
            <ScrollText size={16} /> Chronicle
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
