import { formatDate, formatNumber, relativeTime, useT } from '~/lib/i18n';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, notFound, Outlet, redirect } from '@tanstack/react-router';
import { BarChart3, BookOpen, CalendarHeart, CircleHelp, Contact, FolderSearch, Images, Landmark, Map as MapIcon, MoreHorizontal, Network, ScrollText, Search, Sparkles, Users, Inbox, MessageSquarePlus } from 'lucide-react';
import { AccountMenu } from '~/components/AccountMenu';
import { AssistantButton, AssistantHost } from '~/components/assistant/AssistantDrawer';
import { useAiSetupNeeded } from '~/components/assistant/AiSetup';
import { openAiSetup, openAssistant, useAiStatus } from '~/components/assistant/store';
import { aiStatusQuery } from '~/lib/ai.functions';
import { LanguageChoices, LanguagePicker } from '~/components/LanguagePicker';
import { useEffect, useMemo, useState } from 'react';
import { FirstRun } from '~/components/FirstRun';
import { GuestChip } from '~/components/GuestChip';
import { FeedbackHost, openFeedback } from '~/components/feedback/FeedbackHost';
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
import { useCan, useSession } from '~/lib/session';
import { useFamily } from '~/lib/family';
import { useStatsBeacon } from '~/lib/stats/beacon';
import { setPref, THEMES, usePref } from '~/lib/prefs';
import { treeTitle } from '~/lib/title';

export const Route = createFileRoute('/$tree')({
  // Signed out: to /signin and back. Not a member: "You don't have access" (whether or not the family exists).
  beforeLoad: async ({ context, params, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (session.needsSetup) throw redirect({ to: '/setup' });
    if (!session.user && session.guest?.tree !== params.tree) {
      if (session.guestEnded) throw redirect({ to: '/share/$token', params: { token: 'left' } });
      throw redirect({ to: '/signin', search: { next: location.href } });
    }
    if (!session.memberships.some((m) => m.tree === params.tree)) throw notFound({ data: { access: false } });
    // A guest looks around; Access and the settings are not for them (the server refuses their data anyway).
    if (session.guest?.tree === params.tree && /^\/[^/]+\/(?:access|settings)(?:\/|$)/.test(location.pathname)) throw redirect({ to: '/$tree', params: { tree: params.tree } });
  },
  loader: async ({ context, params }) => {
    // An unknown family is a friendly "not found", never a server error with a developer hint.
    const trees = await context.queryClient.ensureQueryData(myFamiliesQuery);
    if (!trees.some((t) => t.id === params.tree)) throw notFound({ data: { family: false } });
    await context.queryClient.ensureQueryData(graphQuery(params.tree));
    // On the server too, so its first render shows the same AI controls as the browser's. Never fails the page.
    await context.queryClient.prefetchQuery(aiStatusQuery(params.tree));
  },
  head: (ctx) => ({ meta: [{ title: treeTitle(ctx) }] }),
  // Also catches an unknown address inside a family that exists: that is a missing page, not a missing family.
  notFoundComponent: ({ data }) => {
    const missing = data as { access?: boolean; family?: boolean } | undefined;
    if (missing?.access === false) return <NoAccessPage />;
    return missing?.family === false ? <NotFoundPage kind="family" id={Route.useParams().tree} /> : <NotFoundPage />;
  },
  component: TreeLayout,
});

function TreeLayout() {
  const t = useT();
  const { tree } = Route.useParams();
  const f = useFamily();
  const theme = usePref('theme');
  const palette = usePalette();
  const { data: families = [] } = useQuery(myFamiliesQuery);
  const multiple = families.length >= 2;
  const [more, setMore] = useState(false);
  // A guest has no "who are you" to save and no tour of adding people.
  const guest = useSession()?.guest?.tree === tree;
  useStatsBeacon(tree);

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
        <Link to={multiple ? "/" : "/$tree"} params={{ tree }} search={multiple ? { families: "all" } : {}} className="brand" style={{flexShrink: 1}} title={multiple ? t("shell.all_families") : t("shell.family_tree")}>
          {crest ? <Arms arms={crest.arms} size={28} /> : null}
          <b>{f.graph.tree.name}</b>
        </Link>
        <nav aria-label={t("shell.sections")} style={{flexShrink: 0}}>
          <Link to="/$tree" params={{ tree }} activeOptions={{ exact: true, includeSearch: false }} title={t("shell.tree")}>
            <Network size={16} /> <span className="nav-label">{t("shell.tree")}</span>
          </Link>
          <Link to="/$tree/almanac" params={{ tree }} title={t("shell.almanac")}>
            <CalendarHeart size={16} /> <span className="nav-label">{t("shell.almanac")}</span>
          </Link>
          <Link to="/$tree/atlas" params={{ tree }} title={t("shell.atlas")}>
            <MapIcon size={16} /> <span className="nav-label">{t("shell.atlas")}</span>
          </Link>
          <Link to="/$tree/contacts" params={{ tree }} title={t("shell.contacts")}>
            <Contact size={16} /> <span className="nav-label">{t("shell.contacts")}</span>
          </Link>
          <Link to="/$tree/people" params={{ tree }} title={t("shell.register")}>
            <BookOpen size={16} /> <span className="nav-label">{t("shell.register")}</span>
          </Link>
          <Link to="/$tree/houses" params={{ tree }} title={t("shell.houses")} activeOptions={{ exact: false }}>
            <Landmark size={16} /> <span className="nav-label">{t("shell.houses")}</span>
          </Link>
          <Link to="/$tree/needed" params={{ tree }} title={t("shell.information_needed")}>
            <CircleHelp size={16} /> <span className="nav-label">{t("shell.needed")}</span>
          </Link>
          <Link to="/$tree/chronicle" params={{ tree }} title={t("shell.chronicle")}>
            <ScrollText size={16} /> <span className="nav-label">{t("shell.chronicle")}</span>
          </Link>
          <Link to="/$tree/gallery" params={{ tree }} title={t("shell.gallery")}>
            <Images size={16} /> <span className="nav-label">{t("shell.gallery")}</span>
          </Link>
          <Link to="/$tree/research" params={{ tree }} title={t("research.title")} activeOptions={{ exact: false }}>
            <FolderSearch size={16} /> <span className="nav-label">{t("research.title")}</span>
          </Link>
        </nav>
        <span className="spacer" />
        <button className="btn search-trigger" onClick={() => palette.open()}>
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <Search size={15} /> {t("shell.find_anyone")} </span>
          <kbd>⌘K</kbd>
        </button>
        <span className="topbar-tools">
          <AssistantButton tree={tree} />
          <SoundSwitch />
          <ThemeSwitch />
          <LanguagePicker />
        </span>
        <AccountMenu familyName={f.graph.tree.name} />
        <GuestChip />
      </header>
      <Outlet />
      {/* Phones: the sections move to a bar along the bottom edge. */}
      <nav className="tabbar" aria-label={t("shell.sections")}>
        <Link to="/$tree" params={{ tree }} activeOptions={{ exact: true, includeSearch: false }}>
          <Network size={20} /> {t("shell.tree")} </Link>
        <Link to="/$tree/almanac" params={{ tree }}>
          <CalendarHeart size={20} /> {t("shell.almanac")} </Link>
        <Link to="/$tree/atlas" params={{ tree }}>
          <MapIcon size={20} /> {t("shell.atlas")} </Link>
        <Link to="/$tree/needed" params={{ tree }}>
          <CircleHelp size={20} /> {t("shell.needed")} </Link>
        <button type="button" onClick={() => setMore(true)} aria-expanded={more} aria-haspopup="dialog">
          <MoreHorizontal size={20} /> {t("shell.more")} </button>
      </nav>
      <MoreSheet open={more} onClose={() => setMore(false)} tree={tree} multiple={multiple} />
      <Palette />
      {/* The one assistant drawer for this family; it draws itself only when the button opened it. */}
      <AssistantHost tree={tree} />
      {!guest && <FirstRun />}
      <FeedbackHost tree={tree} />
      <Toasts />
    </div>
  );
}

/** Contacts, Register and Chronicle, plus theme and sound: what the phone's tab bar has no room for. */
function MoreSheet({ open, onClose, tree, multiple }: { open: boolean; onClose: () => void; tree: string; multiple: boolean }) {
  const t = useT();
  const theme = useTheme();
  const steward = useCan('manage-access');
  const editor = useCan('edit-person');
  const assistant = !!useAiStatus(tree)?.features.assistant;
  // The phone has no top bar, so a steward of a family without AI reaches "Set up AI" from here.
  const setupNeeded = useAiSetupNeeded(tree);
  const [sound, toggleSound] = useSound();
  return (
    <Dialog open={open} onClose={onClose} title={t("shell.more")} placement="sheet" width={560}>
      <ul className="more-list" onClick={(e) => (e.target as HTMLElement).closest('a') && onClose()}>
        <li><Link to="/$tree/contacts" params={{ tree }}><Contact size={19} /> {t("shell.contacts")} <small>{t("shell.addresses_phones")}</small></Link></li>
        <li><Link to="/$tree/people" params={{ tree }}><BookOpen size={19} /> {t("shell.register")} <small>{t("shell.everyone_as_a_table")}</small></Link></li>
        <li><Link to="/$tree/houses" params={{ tree }}><Landmark size={19} /> {t("shell.houses")} <small>{t("shell.arms_mottos_members")}</small></Link></li>
        <li><Link to="/$tree/chronicle" params={{ tree }}><ScrollText size={19} /> {t("shell.chronicle")} <small>{t("shell.stories_sayings")}</small></Link></li>
        <li><Link to="/$tree/gallery" params={{ tree }}><Images size={19} /> {t("shell.gallery")} <small>{t("shell.gallery_hint")}</small></Link></li>
        <li><Link to="/$tree/research" params={{ tree }}><FolderSearch size={19} /> {t("research.title")} <small>{t("research.nav_hint")}</small></Link></li>
        {assistant && <li><button type="button" onClick={() => { onClose(); openAssistant(); }}><Sparkles size={19} /> {t("ai.askCommand")}</button></li>}
        {editor && <li><Link to="/$tree/settings/import" params={{ tree }}><Images size={19} /> {t("shell.importExport")} <small>{t("shell.importExportHint")}</small></Link></li>}
        {steward && <li><Link to="/$tree/access" params={{ tree }}><Users size={19} /> {t("shell.access")} <small>{t("shell.members_invitations")}</small></Link></li>}
        {steward && <li><Link to="/$tree/statistics" params={{ tree }}><BarChart3 size={19} /> {t("stats.menu")} <small>{t("stats.menu_hint")}</small></Link></li>}
        {setupNeeded && <li><button type="button" onClick={() => { onClose(); openAiSetup(); }}><Sparkles size={19} /> {t("ai.setupButton")} <small>{t("shell.ai_settings_hint")}</small></button></li>}
        {steward && !setupNeeded && <li><Link to="/$tree/settings/ai" params={{ tree }}><Sparkles size={19} /> {t("shell.ai_settings")} <small>{t("shell.ai_settings_hint")}</small></Link></li>}
        {steward && <li><button type="button" onClick={() => { onClose(); openFeedback(); }}><MessageSquarePlus size={19} /> {t("feedback.menu")} <small>{t("feedback.command_hint")}</small></button></li>}
        {steward && <li><Link to="/$tree/settings/feedback" params={{ tree }}><Inbox size={19} /> {t("feedback.inbox")} <small>{t("feedback.inbox_hint")}</small></Link></li>}
        {multiple && <li><Link to="/" search={{ families: "all" }}><Network size={19} /> {t("shell.all_families")}</Link></li>}
      </ul>
      <div className="more-row"><LanguageChoices /></div>
      <div className="more-row">
        <span>{t("shell.theme")}</span>
        <div className="seg" role="group" aria-label={t("shell.theme")}>
          {THEMES.map((th) => {
            const Icon = THEME_ICONS[th.id];
            return (
              <button key={th.id} className="btn" aria-pressed={theme === th.id} onClick={() => setPref('theme', th.id)}>
                <Icon size={14} /> {t(THEME_LABEL[th.id])}
              </button>
            );
          })}
        </div>
      </div>
      <div className="more-row">
        <Switch checked={sound} onChange={toggleSound} labelFirst className="more-switch">{t("shell.sound_effects")}</Switch>
      </div>
    </Dialog>
  );
}
