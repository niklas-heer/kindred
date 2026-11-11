import { useT } from '~/lib/i18n';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, notFound, Outlet, redirect, useLocation, useNavigate } from '@tanstack/react-router';
import { ArrowLeftRight, BarChart3, BookOpen, CalendarHeart, ChevronDown, CircleHelp, Contact, Flame, LayoutGrid, FolderSearch, Images, Landmark, Map as MapIcon, MoreHorizontal, Network, ScrollText, Search, SlidersHorizontal, Sparkles, Swords, Users, Inbox, MessageSquarePlus, Gamepad2 } from 'lucide-react';
import { AccountMenu } from '~/components/AccountMenu';
import { AssistantButton, AssistantHost } from '~/components/assistant/Launcher';
import { useAiSetupNeeded } from '~/components/assistant/AiSetup';
import { openAiSetup, openAssistant, useAiStatus } from '~/components/assistant/store';
import { aiStatusQuery } from '~/lib/ai.functions';
import { campaignStatusQuery } from '~/lib/campaign/campaign.functions';
import { newsCountQuery } from '~/lib/history.functions';
import { LanguageChoices, LanguagePicker } from '~/components/LanguagePicker';
import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FirstRun } from '~/components/FirstRun';
import { GuestChip } from '~/components/GuestChip';
import { ViewAsBar, ViewAsHost } from '~/components/viewas/ViewAs';
import { JoinInvite } from '~/components/join/JoinInvite';
import { aiAttentionQuery } from '~/lib/ai/background.functions';
import { FeedbackHost, openFeedback } from '~/components/feedback/FeedbackHost';
import { Arms } from '~/components/Heraldry';
import { NotFoundPage } from '~/components/NotFoundPage';
import { Palette, usePalette } from '~/components/Palette';
import { SoundSwitch, THEME_ICONS, THEME_LABEL, ThemeSwitch, useSound, useTheme } from '~/components/ThemeSwitch';
import { Toasts } from '~/components/Toasts';
import { Dialog } from '~/components/ui/Dialog';
import { Switch } from '~/components/ui/Switch';
import { MainContext } from '~/components/ui/Main';
import { graphQuery } from '~/lib/api';
import { myFamiliesQuery, sessionQuery } from '~/lib/auth/functions';
import { NoAccessPage } from '~/components/NoAccess';
import { useCan, useSession } from '~/lib/session';
import { useFamily } from '~/lib/family';
import { useStatsBeacon } from '~/lib/stats/beacon';
import { PresenceHost } from '~/components/presence/PresenceHost';
import { HereNow, PageFaces } from '~/components/presence/Faces';
import { setPref, THEMES, usePref } from '~/lib/prefs';
import { treeTitle } from '~/lib/title';
import { arrivedIn, leftFamily, opensOnToday } from '~/lib/today/opening';

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
    // A guest looks around; Access, the settings, Contacts, the Campaign, Today (with the family's feed) and "Who is this?" are not for them (the server refuses or empties their data anyway).
    if (session.guest?.tree === params.tree && /^\/[^/]+\/(?:access|settings|contacts|campaign|today|who-is-this)(?:\/|$)/i.test(location.pathname)) throw redirect({ to: '/$tree', params: { tree: params.tree } });
  },
  loader: async ({ context, params }) => {
    // An unknown family is a friendly "not found", never a server error with a developer hint.
    const trees = await context.queryClient.ensureQueryData(myFamiliesQuery);
    if (!trees.some((t) => t.id === params.tree)) throw notFound({ data: { family: false } });
    await context.queryClient.ensureQueryData(graphQuery(params.tree));
    // What the bar draws from (the AI controls, the Campaign's section, the dot for news) is read here, on the server
    // too, so its first render is the browser's. Otherwise an answer that arrives while a slow device is still hydrating
    // changes the bar under React, which then fails hydration and draws the page again. Never fails the page; a guest
    // is not asked for what only members get.
    const guest = context.queryClient.getQueryData(sessionQuery.queryKey)?.guest?.tree === params.tree;
    await Promise.all([
      context.queryClient.prefetchQuery(aiStatusQuery(params.tree)),
      ...(guest ? [] : [context.queryClient.prefetchQuery(campaignStatusQuery(params.tree)), context.queryClient.prefetchQuery(newsCountQuery(params.tree))]),
    ]);
  },
  head: (ctx) => ({ meta: [{ title: treeTitle(ctx) }] }),
  // Also catches an unknown address inside a family that exists: that is a missing page, not a missing family.
  notFoundComponent: ({ data }) => {
    const missing = data as { access?: boolean; family?: boolean } | undefined;
    if (missing?.access === false) return <NoAccessPage />;
    // This function is rendered as a component by the router, so calling the route's hook here is allowed.
    // oxlint-disable-next-line react-hooks/rules-of-hooks
    return missing?.family === false ? <NotFoundPage kind="family" id={Route.useParams().tree} /> : <NotFoundPage />;
  },
  component: TreeLayout,
});

/**
 * The bar shows the sections a family opens most (Today with the family's feed, the tree, the Chronicle, the Gallery,
 * Contacts, the Campaign while it is on) and keeps the rest under "More" (`NavMore`: the Almanac, the Atlas, the
 * Register and the others, in groups), so that every section shown has room for its name on a tablet as well as on a
 * desktop. A share-link guest has no Today and no Contacts: their bar is the tree, the Chronicle, the Gallery and the
 * Almanac. The sections have three states. Labels beside the icons when they fit next to the family's whole name; else icon over
 * label (`topbar-stacked`), so every section keeps its name on a laptop; else icons alone (`topbar-compact`). Which fits
 * depends on the language, the reader's sections and the name itself, so it is measured. Starts stacked (the server can't
 * measure, and most screens end there); the classes are only ever set here, so React's renders leave them alone.
 */
function useTopbarFit() {
  const bar = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = bar.current;
    const nav = el?.querySelector('nav');
    if (!el || !nav) return;
    const fit = () => {
      el.classList.remove('topbar-compact', 'topbar-stacked');
      if (nav.scrollWidth <= nav.clientWidth + 1) return;
      // Stacked, the nav no longer shrinks: the bar itself overflows when even that is too wide.
      el.classList.add('topbar-stacked');
      if (el.scrollWidth <= el.clientWidth + 1) return;
      el.classList.replace('topbar-stacked', 'topbar-compact');
    };
    fit();
    const size = new ResizeObserver(fit);
    size.observe(el);
    // Language changes, the Ask button arriving, the account menu loading: none of them resize the bar itself.
    const content = new MutationObserver(fit);
    content.observe(el, { subtree: true, childList: true, characterData: true });
    // Each theme sets its own fonts, so the same words take a different width.
    content.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'lang'] });
    void document.fonts?.ready.then(fit);
    // A theme's face may arrive only after the theme is chosen; the words change width when it does.
    document.fonts?.addEventListener?.('loadingdone', fit);
    return () => { size.disconnect(); content.disconnect(); document.fonts?.removeEventListener?.('loadingdone', fit); };
  }, []);
  return bar;
}

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
  const session = useSession();
  const guest = session?.guest?.tree === tree;
  // A steward's "View as" preview: its bar stays on every page, of this family and of any other they open meanwhile.
  const viewAs = session?.viewAs;
  const previewed = viewAs ? families.find((x) => x.id === viewAs.tree)?.name : undefined;
  useStatsBeacon(tree, guest);
  const topbar = useTopbarFit();
  // The Campaign has its section only while a steward has it switched on. Members only: a guest is never asked.
  const campaign = !!useQuery({ ...campaignStatusQuery(tree), enabled: !guest }).data?.enabled;

  // A reader who chose Today as the opening page (src/lib/today/opening.ts) and arrives at the family's own address
  // goes there. Only on arrival: from then on the Tree section is the tree. A client navigation is turned in the
  // tree route's beforeLoad; this covers the page the server rendered, where the choice (kept in this browser) is unknown.
  const navigate = useNavigate();
  useEffect(() => {
    if (!guest && location.pathname.replace(/\/$/, '') === `/${tree}` && !location.search && opensOnToday(tree)) void navigate({ to: '/$tree/today', params: { tree }, replace: true });
    arrivedIn(tree);
    return () => leftFamily(tree);
  }, [tree, guest, navigate]);

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
    <PresenceHost tree={tree}>
    <div className={viewAs ? 'shell shell-viewas' : 'shell'}>
      <a href="#main" className="skip-link" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>{t('shell.skip')}</a>
      <ViewAsBar tree={tree} familyName={previewed} />
      <header className="topbar topbar-stacked" ref={topbar}>
        <Link to={multiple ? "/" : "/$tree"} params={{ tree }} search={multiple ? { families: "all" } : {}} className="brand" title={multiple ? t("shell.all_families") : t("shell.family_tree")}>
          {crest ? <Arms arms={crest.arms} size={28} /> : null}
          <b>{f.graph.tree.name}</b>
        </Link>
        <nav aria-label={t("shell.sections")}>
          {!guest && (
            <Link to="/$tree/today" params={{ tree }} title={t("today.title")} aria-label={t("today.title")}>
              <Flame size={16} /><span className="nav-label">{t("today.title")}</span>
            </Link>
          )}
          <Link to="/$tree" params={{ tree }} activeOptions={{ exact: true, includeSearch: false }} title={t("shell.tree")} aria-label={t("shell.tree")}>
            <Network size={16} /><span className="nav-label">{t("shell.tree")}</span>
          </Link>
          <Link to="/$tree/chronicle" params={{ tree }} title={t("shell.chronicle")} aria-label={t("shell.chronicle")}>
            <ScrollText size={16} /><span className="nav-label">{t("shell.chronicle")}</span>
          </Link>
          <Link to="/$tree/gallery" params={{ tree }} title={t("shell.gallery")} aria-label={t("shell.gallery")}>
            <Images size={16} /><span className="nav-label">{t("shell.gallery")}</span>
          </Link>
          {guest ? (
            // A guest has no Contacts: the Almanac keeps its place in their bar.
            <Link to="/$tree/almanac" params={{ tree }} title={t("shell.almanac")} aria-label={t("shell.almanac")}>
              <CalendarHeart size={16} /><span className="nav-label">{t("shell.almanac")}</span>
            </Link>
          ) : (
            <Link to="/$tree/contacts" params={{ tree }} title={t("shell.contacts")} aria-label={t("shell.contacts")}>
              <Contact size={16} /><span className="nav-label">{t("shell.contacts")}</span>
            </Link>
          )}
          {campaign && (
            <Link to="/$tree/campaign" params={{ tree }} title={t("campaign.title")} aria-label={t("campaign.title")}>
              <Swords size={16} /><span className="nav-label">{t("campaign.nav")}</span>
            </Link>
          )}
          <NavMore tree={tree} guest={guest} campaign={campaign} />
        </nav>
        <span className="spacer" />
        <button className="btn search-trigger" onClick={() => palette.open()}>
          <span><Search size={16} /> {t("shell.find_anyone")}</span>
          <kbd>⌘K</kbd>
        </button>
        <span className="topbar-tools">
          {/* On a phone only Ask stays in the bar (as an icon); sound, theme and language are in More. */}
          <AssistantButton tree={tree} className="topbar-ask" />
          <span className="topbar-prefs">
            <SoundSwitch />
            <ThemeSwitch />
          </span>
          <LanguagePicker />
        </span>
        <HereNow />
        <AccountMenu familyName={f.graph.tree.name} />
        <GuestChip />
      </header>
      <MainContext.Provider value>
        <main id="main" className="shell-main" tabIndex={-1}><Outlet /></main>
      </MainContext.Provider>
      <PageFaces />
      {/* Phones: the sections move to a bar along the bottom edge. */}
      <nav className="tabbar" aria-label={t("shell.sections")}>
        {/* Five places. A member: Today (the family's feed), the tree, the Gallery, Contacts, and More, where the Chronicle
            comes first. A guest has no Today and no Contacts: the Chronicle and the Almanac take those places. */}
        {!guest && (
          <Link to="/$tree/today" params={{ tree }}>
            <Flame size={21} /><span>{t("today.title")}</span></Link>
        )}
        <Link to="/$tree" params={{ tree }} activeOptions={{ exact: true, includeSearch: false }}>
          <Network size={21} /><span>{t("shell.tree_tab")}</span></Link>
        {guest && (
          <Link to="/$tree/chronicle" params={{ tree }}>
            <ScrollText size={21} /><span>{t("shell.chronicle")}</span></Link>
        )}
        <Link to="/$tree/gallery" params={{ tree }}>
          <Images size={21} /><span>{t("shell.gallery")}</span></Link>
        {guest ? (
          <Link to="/$tree/almanac" params={{ tree }}>
            <CalendarHeart size={21} /><span>{t("shell.almanac")}</span></Link>
        ) : (
          <Link to="/$tree/contacts" params={{ tree }}>
            <Contact size={21} /><span>{t("shell.contacts")}</span></Link>
        )}
        <button type="button" onClick={() => setMore(true)} aria-expanded={more} aria-haspopup="dialog">
          <MoreHorizontal size={21} /><span>{t("shell.more")}</span></button>
      </nav>
      <MoreSheet open={more} onClose={() => setMore(false)} tree={tree} multiple={multiple} campaign={campaign} />
      <Palette />
      {/* The one assistant drawer for this family; it draws itself only when the button opened it. */}
      <AssistantHost tree={tree} />
      {/* "Who are you?" and the tour are a reader's own first steps: a steward's preview leaves them out. */}
      {!guest && !viewAs && <FirstRun />}
      {guest && <JoinInvite tree={tree} />}
      <FeedbackHost tree={tree} />
      <ViewAsHost tree={tree} />
      <Toasts />
    </div>
    </PresenceHost>
  );
}

/**
 * The sections the top bar does not show by name, under one "More" button, in groups: looking around (the Almanac, the
 * Atlas, the Register, the Houses), finding out (Needed, Research) and playing (the Campaign while it is off, so that
 * it can be found: "resting"). Inside one of them, the button carries that section's icon and name, so the bar still
 * says where the reader is. A plain disclosure: a button and a list of links, closed by Escape, a press outside or a choice.
 */
function NavMore({ tree, guest, campaign }: { tree: string; guest: boolean; campaign: boolean }) {
  const t = useT();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const path = useLocation({ select: (l) => l.pathname });
  type Section = { seg: string; to: '/$tree/almanac' | '/$tree/atlas' | '/$tree/people' | '/$tree/houses' | '/$tree/needed' | '/$tree/research' | '/$tree/campaign'; icon: (size: number) => ReactNode; label: string; hint: string; also?: string };
  const groups: { name: string; sections: Section[] }[] = [
    { name: t('shell.group.explore'), sections: [
      // A guest has the Almanac in the bar.
      ...(guest ? [] : [{ seg: 'almanac', to: '/$tree/almanac' as const, icon: (n: number) => <CalendarHeart size={n} />, label: t('shell.almanac'), hint: t('shell.cmd.almanacHint') }]),
      { seg: 'atlas', to: '/$tree/atlas', icon: (n) => <MapIcon size={n} />, label: t('shell.atlas'), hint: t('shell.cmd.atlasHint') },
      { seg: 'people', to: '/$tree/people', icon: (n) => <BookOpen size={n} />, label: t('shell.register'), hint: t('shell.everyone_as_a_table') },
      { seg: 'houses', to: '/$tree/houses', icon: (n) => <Landmark size={n} />, label: t('shell.houses'), hint: t('shell.arms_mottos_members'), also: 'house' },
    ] },
    { name: t('shell.group.find_out'), sections: [
      { seg: 'needed', to: '/$tree/needed', icon: (n) => <CircleHelp size={n} />, label: t('shell.needed'), hint: t('shell.information_needed') },
      { seg: 'research', to: '/$tree/research', icon: (n) => <FolderSearch size={n} />, label: t('research.title'), hint: t('research.nav_hint') },
    ] },
    // The Campaign is in the bar while it is on. While it is off it is listed here for members, so it can be found.
    ...(guest || campaign ? [] : [{ name: t('shell.group.play'), sections: [
      { seg: 'campaign', to: '/$tree/campaign' as const, icon: (n: number) => <Swords size={n} />, label: t('campaign.nav'), hint: t('campaign.nav_resting') },
    ] }]),
  ];
  const sections = groups.flatMap((g) => g.sections);
  const inside = (seg: string) => path === `/${tree}/${seg}` || path.startsWith(`/${tree}/${seg}/`);
  const current = sections.find((s) => inside(s.seg) || (s.also && inside(s.also)));

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const press = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    const close = () => setOpen(false);
    document.addEventListener('pointerdown', press);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', close);
    return () => { document.removeEventListener('pointerdown', press); document.removeEventListener('keydown', key); window.removeEventListener('resize', close); };
  }, [open]);

  const toggle = () => {
    // Placed against the window, under the button, and kept inside the screen: the list is not part of the bar's own
    // width, which useTopbarFit measures.
    const r = button.current!.getBoundingClientRect();
    setAt({ top: Math.round(r.bottom + 6), left: Math.round(Math.max(8, Math.min(r.left, window.innerWidth - 328))) });
    setOpen((o) => !o);
  };

  return (
    <div className="nav-more" ref={wrap}>
      <button
        type="button" ref={button} className="nav-more-btn" onClick={toggle}
        aria-expanded={open} aria-controls={open ? id : undefined} data-status={current ? 'active' : undefined}
        aria-label={current ? `${t('shell.more')}: ${current.label}` : undefined}
        title={current ? current.label : t('today.more_sections')}
      >
        {current ? current.icon(16) : <LayoutGrid size={16} />}
        <span className="nav-label">{current ? current.label : t('shell.more')} <ChevronDown size={11} className="nav-more-caret" aria-hidden /></span>
      </button>
      {open && (
        <ul className="nav-more-pop" id={id} aria-label={t('today.more_sections')} style={{ top: at.top, left: at.left }}>
          {groups.map((g) => (
            <Fragment key={g.name}>
              <li className="nav-more-group"><span>{g.name}</span></li>
              {g.sections.map((s) => (
                <li key={s.seg}>
                  <Link to={s.to} params={{ tree }} activeOptions={{ exact: false }} onClick={() => setOpen(false)}>
                    {s.icon(18)} <span>{s.label}</span> <small>{s.hint}</small>
                  </Link>
                </li>
              ))}
            </Fragment>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * What the phone's tab bar has no room for, in the same groups as the bar's "More": the Chronicle first (one tap from the
 * feed), then looking around, finding out, playing, and for those who run the family, looking after it. Then language,
 * theme and sound.
 */
function MoreSheet({ open, onClose, tree, multiple, campaign }: { open: boolean; onClose: () => void; tree: string; multiple: boolean; campaign: boolean }) {
  const guest = useSession()?.guest?.tree === tree;
  const t = useT();
  const theme = useTheme();
  const steward = useCan('manage-access');
  const editor = useCan('edit-person');
  const assistant = !!useAiStatus(tree)?.features.assistant;
  // The phone has no top bar, so a steward of a family without AI reaches "Set up AI" from here.
  const setupNeeded = useAiSetupNeeded(tree);
  const [sound, toggleSound] = useSound();
  // What waits for a steward on the Access page: requests to join and "this is me" links (the account menu shows the same).
  const waiting = useQuery({ ...aiAttentionQuery(tree), enabled: steward }).data?.access ?? 0;
  const group = (name: string) => <li className="more-group"><span>{name}</span></li>;
  return (
    <Dialog open={open} onClose={onClose} title={t("shell.more")} placement="sheet" width={560}>
      <ul className="more-list" onClick={(e) => (e.target as HTMLElement).closest('a') && onClose()}>
        {/* A guest has the Chronicle and the Almanac in the tab bar. */}
        {!guest && <li><Link to="/$tree/chronicle" params={{ tree }}><ScrollText size={19} /> {t("shell.chronicle")} <small>{t("shell.cmd.chronicleHint")}</small></Link></li>}
        {group(t("shell.group.explore"))}
        {!guest && <li><Link to="/$tree/almanac" params={{ tree }}><CalendarHeart size={19} /> {t("shell.almanac")} <small>{t("shell.cmd.almanacHint")}</small></Link></li>}
        <li><Link to="/$tree/atlas" params={{ tree }}><MapIcon size={19} /> {t("shell.atlas")} <small>{t("shell.cmd.atlasHint")}</small></Link></li>
        <li><Link to="/$tree/people" params={{ tree }}><BookOpen size={19} /> {t("shell.register")} <small>{t("shell.everyone_as_a_table")}</small></Link></li>
        <li><Link to="/$tree/houses" params={{ tree }}><Landmark size={19} /> {t("shell.houses")} <small>{t("shell.arms_mottos_members")}</small></Link></li>
        {group(t("shell.group.find_out"))}
        <li><Link to="/$tree/needed" params={{ tree }}><CircleHelp size={19} /> {t("shell.needed")} <small>{t("shell.information_needed")}</small></Link></li>
        <li><Link to="/$tree/research" params={{ tree }}><FolderSearch size={19} /> {t("research.title")} <small>{t("research.nav_hint")}</small></Link></li>
        {assistant && <li><button type="button" onClick={() => { onClose(); openAssistant(); }}><Sparkles size={19} /> {t("ai.askCommand")}</button></li>}
        {/* Always there for a member, so the game can be found: "resting" while a steward has not turned it on. */}
        {!guest && group(t("shell.group.play"))}
        {!guest && <li><Link to="/$tree/campaign" params={{ tree }}><Swords size={19} /> {t("campaign.nav")} <small>{campaign ? t("campaign.nav_hint") : t("campaign.nav_resting")}</small></Link></li>}
        {(editor || steward || setupNeeded) && group(t("shell.group.manage"))}
        {editor && <li><Link to="/$tree/settings/import" params={{ tree }}><ArrowLeftRight size={19} /> {t("shell.importExport")} <small>{t("shell.importExportHint")}</small></Link></li>}
        {steward && <li><Link to="/$tree/access" params={{ tree }}><Users size={19} /> {t("shell.access")} {waiting ? <span className="aitasks-count">{waiting}</span> : null} <small>{t("shell.members_invitations")}</small></Link></li>}
        {steward && <li><Link to="/$tree/statistics" params={{ tree }}><BarChart3 size={19} /> {t("stats.menu")} <small>{t("stats.menu_hint")}</small></Link></li>}
        {setupNeeded && <li><button type="button" onClick={() => { onClose(); openAiSetup(); }}><Sparkles size={19} /> {t("ai.setupButton")} <small>{t("shell.ai_settings_hint")}</small></button></li>}
        {steward && !setupNeeded && <li><Link to="/$tree/settings/ai" params={{ tree }}><SlidersHorizontal size={19} /> {t("shell.ai_settings")} <small>{t("shell.ai_settings_hint")}</small></Link></li>}
        {steward && <li><Link to="/$tree/settings/games" params={{ tree }}><Gamepad2 size={19} /> {t("campaign.games.title")} <small>{t("campaign.games.nav_hint")}</small></Link></li>}
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
