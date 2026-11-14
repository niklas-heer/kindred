import { translateMessage, formatDate, relativeTime, richText, useT, type Locale } from '~/lib/i18n';
// The signed-in reader's menu in the topbar: who they are, their role in this family, the way to their passkeys,
// the steward's Access page and AI assistant settings, the editor's import and export, and signing out. Also
// `Initials`, a name's monogram.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { graphQuery } from '~/lib/api';
import { Activity, ArrowLeftRight, BarChart3, Bell, Check, Compass, Eye, Fingerprint, Info, KeyRound, LayoutGrid, LogOut, Plus, ShieldCheck, Sparkles, Trash2, Users, Volume2, VolumeX, Inbox, Mail, MessageSquarePlus, Gamepad2, Landmark, History, Printer, Scale, ServerCog, FileDown } from 'lucide-react';
import { aiAttentionQuery } from '~/lib/ai/background.functions';
import { publicInstanceQuery } from '~/lib/operator/operator.functions';
import { updateDotQuery } from '~/lib/operator/insight.functions';
import { anyLegal } from '~/lib/operator/shared';
import '~/components/assistant/ai-tasks.css';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { addPasskey, forgetLocalIdentity, passkeysSupported, signOutRequest, withFreshProof } from '~/lib/auth/client';
import { appCommit, appVersion, releaseUrl } from '~/lib/version';
import { myPasskeysQuery, removeMyPasskey, renameMe, signOutElsewhere, type Passkey } from '~/lib/auth/functions';
import { mySignInQuery } from '~/lib/auth/signin.functions';
import { MySignIn } from './signin/MySignIn';
import { MySingleSignOn } from './signin/SingleSignOn';
import { fetchRemindersAvailable } from '~/lib/reminders.functions';
import { newsCountQuery } from '~/lib/history.functions';
import '~/components/history/history.css';
import { setPref, THEMES } from '~/lib/prefs';
import { ROLES, can } from '~/lib/roles';
import { openFeedback } from './feedback/FeedbackHost';
import { Portrait } from './Portrait';
import { THEME_ICONS, THEME_LABEL, useSound, useTheme } from './ThemeSwitch';
import { openTours } from './tour/store';
import { dropThisDevice, ReminderRefresh, RemindersDialog } from './Reminders';
import { useMember, useMembership, useSession } from '~/lib/session';
import { AboutDialog } from './AboutDialog';
import { YourDataDialog } from './gdpr/YourData';
import { YourEmailDialog } from './email/YourEmail';
import { mailOnQuery } from '~/lib/email/email.functions';
import { openViewAs, stopPreview } from './viewas/ViewAs';
import { Dialog } from './ui/Dialog';
import { isTopOverlay, useOverlayLayer } from './ui/overlay';
import { SHADOWS_PREF, useSharesShadows } from './presence/PresenceHost';
import './account.css';

/** A name's initials in a small medallion: "Anna Lindqvist" → "AL". */
export function Initials({ name, size = 32 }: { name: string; size?: number }) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = (words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase();
  return (
    <span className="acct-initials" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }} aria-hidden>
      {letters}
    </span>
  );
}

const roleOf = (id: string) => ROLES.find((r) => r.id === id);

/**
 * The account's picture: the portrait of the person the account is linked to in this family, when there is
 * one (and the family's graph is loaded); the initials otherwise.
 */
function Avatar({ name, size }: { name: string; size: number }) {
  const tree = useParams({ strict: false }).tree as string | undefined;
  // During a preview the membership is the previewed reader's: the account keeps its own initials.
  const previewing = !!useSession()?.viewAs;
  const own = useMembership()?.person ?? null;
  const linked = previewing ? null : own;
  const graph = useQuery({ ...graphQuery(tree ?? ''), enabled: !!tree && !!linked });
  const person = linked && tree ? graph.data?.people.find((p) => p.id === linked) : undefined;
  if (person && tree) return <Portrait person={person} tree={tree} size={size} frame={false} />;
  return <Initials name={name} size={size} />;
}

/**
 * Signs out everywhere this browser knows about, then reloads at /signin with nothing cached. First this device stops
 * the account's reminders (server and browser). That step is bounded and its failure is ignored: it never blocks sign-out.
 */
export async function signOut(accessLogout?: string, previewing = false) {
  // A preview is read-only, and this device's reminders are the steward's own: end the preview first (sign-out ends it anyway).
  if (previewing) await Promise.race([stopPreview().catch(() => {}), new Promise<void>((resolve) => setTimeout(resolve, 3000))]);
  const boundedDrop = Promise.race([dropThisDevice().catch(() => {}), new Promise<void>((resolve) => setTimeout(resolve, 3000))]);
  await boundedDrop;
  try { await signOutRequest(); } catch {}
  forgetLocalIdentity();
  window.location.assign(accessLogout ?? '/signin');
}

export function AccountMenu({ familyName }: { familyName?: string }) {
  const t = useT();
  const session = useSession();
  const tree = useParams({ strict: false }).tree as string | undefined;
  const m = useMembership();
  const member = useMember();
  const [open, setOpen] = useState(false);
  const [passkeys, setPasskeys] = useState(false);
  const [about, setAbout] = useState(false);
  const [yourData, setYourData] = useState(false);
  const [reminders, setReminders] = useState(false);
  const [yourEmail, setYourEmail] = useState(false);
  // "Your email" is offered only while the server sends email (src/lib/email/).
  const mailOn = useQuery({ ...mailOnQuery, enabled: open && !session?.demo });
  // Reminders are offered only when this server has its VAPID keys (docs/self-host.md, "Reminders").
  const remindersOn = useQuery({ queryKey: ['reminders', 'available'], queryFn: () => fetchRemindersAvailable(), staleTime: 5 * 60_000 });
  // The server's legal texts, when its operator wrote any: a link to them (src/routes/legal.tsx).
  const instance = useQuery({ ...publicInstanceQuery, enabled: open });
  // A newer Kindred release, as the operator's daily check found it (src/lib/operator/updates.server.ts): a dot on the console's link.
  const update = useQuery({ ...updateDotQuery, enabled: open && !!session?.user?.operator && !session?.demo });
  // The quiet badge: what waits for a steward, on the Access page and in AI activity (zero for everyone else).
  const attention = useQuery({ ...aiAttentionQuery(tree ?? ''), enabled: !!tree && !!m && can(m.role, 'manage-access') });
  // Changes in the family this member has not been shown yet: a dot beside History (history.functions.ts).
  const news = useQuery({ ...newsCountQuery(tree ?? ''), enabled: !!tree && !!member });
  const unseen = news.data ?? 0;
  const layer = useOverlayLayer(open);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const theme = useTheme();
  const [sound, toggleSound] = useSound();
  const shadows = useSharesShadows();

  // Close on Escape (only when this is the top layer) or a press outside; focus moves into the menu.
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isTopOverlay(layer)) { e.preventDefault(); setOpen(false); button.current?.focus(); }
    };
    const press = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', key);
    window.addEventListener('pointerdown', press);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('pointerdown', press); };
  }, [open, layer]);
  // Hang the menu under its button, kept on screen.
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const r = button.current?.getBoundingClientRect();
    if (r) setPos({ top: Math.round(r.bottom + 6), right: Math.max(10, Math.round(window.innerWidth - r.right)) });
    menu.current?.querySelector<HTMLElement>('a, button')?.focus();
  }, [open]);

  const signedIn = session?.user;
  if (!signedIn) return null;
  // A demo's visitor has no account: no name to change, no passkeys, no reminders and nothing to sign out of.
  const demo = !!session?.demo;
  const user = demo ? { ...signedIn, name: t('demo.visitor') } : signedIn;
  const role = m ? roleOf(m.role) : undefined;
  // What waits for the operators (open requests): on the console's link, and in the trigger's count.
  const operatorWaiting = !demo && signedIn.operator ? session?.operatorWaiting ?? 0 : 0;
  const waiting = (attention.data?.access ?? 0) + (attention.data?.ai ?? 0) + operatorWaiting;
  const steward = !!tree && !!m && can(m.role, 'manage-access');
  const editor = !!tree && !!m && can(m.role, 'edit-person');
  // "View as" is the real steward's, whatever role they are previewing: the server checks their own membership.
  const preview = session?.viewAs;
  const viewAs = !!tree && !demo && (preview?.tree === tree || (steward && !preview));
  const familyGroup = !!tree && (steward || editor || viewAs);

  // Arrow keys move between the menu's items.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    // Rows hidden by CSS (the theme and sound rows on a wide screen) take no part.
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])].filter((el) => el.offsetParent !== null);
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
    e.preventDefault();
  };

  return (
    <>
      <button
        ref={button}
        className="btn ghost acct-trigger"
        data-tour="account-menu"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title={t('account.trigger', {name:user.name})}
      >
        <Avatar name={user.name} size={30} />
        {waiting ? <span className="aitasks-dot" aria-label={t('aitasks.attention')}>{waiting}</span> : unseen ? <span className="hist-dot" role="img" aria-label={t('history.menu_new', { count: unseen })} /> : null}
        <span className="acct-trigger-name">{user.name}</span>
      </button>
      {open && (
        <div className="acct-menu panel" id={id} ref={menu} onKeyDown={onKeyDown} style={pos ?? undefined}>
          <div className="acct-head">
            <Avatar name={user.name} size={44} />
            <div>
              <b className="acct-name">{user.name}</b>
              <span className="acct-sub">{demo ? t('demo.visitor_sub') : user.via === 'access' ? t('account.signedIn', {email:user.email ?? ''}) : user.email ?? t("accountmenu.signed_in_with_a_passkey")}</span>
            </div>
          </div>
          {role && (
            <p className="acct-role">
              {t('account.role', {family:familyName ?? t('accountmenu.this_family'), role:t(`role.${role.id}`)})} <span>{t(`role.${role.id}Description`)}.</span>
            </p>
          )}
          {/* The identity above is not a menu item, so the role starts here: a menu may only hold items. */}
          <div className="acct-items" role="menu" aria-label={t("accountmenu.your_account")}>
            {/* Two groups, so ten rows are not one list: what belongs to this family, then what belongs to the reader. */}
            {familyGroup && (
              <div className="acct-group" role="group" aria-labelledby={`${id}-family`}>
                <span className="acct-group-h" id={`${id}-family`}>{t('accountmenu.group_family')}</span>
                {steward && (
                  <Link role="menuitem" className="acct-item" to="/$tree/access" params={{ tree }} onClick={() => setOpen(false)}>
                    <Users size={17} /> {t("accountmenu.manage_access")} {attention.data?.access ? <span className="aitasks-count">{attention.data.access}</span> : null} </Link>
                )}
                {m && can(m.role, 'view-statistics') && (
                  <Link role="menuitem" className="acct-item" to="/$tree/statistics" params={{ tree }} onClick={() => setOpen(false)}>
                    <BarChart3 size={17} /> {t("stats.menu")} </Link>
                )}
                {editor && (
                  <Link role="menuitem" className="acct-item" to="/$tree/settings/import" params={{ tree }} onClick={() => setOpen(false)}>
                    <ArrowLeftRight size={17} /> {t("shell.importExport")} </Link>
                )}
                {steward && (
                  <Link role="menuitem" className="acct-item" to="/$tree/settings/ai" params={{ tree }} onClick={() => setOpen(false)}>
                    <Sparkles size={17} /> {t("shell.ai_settings")} </Link>
                )}
                {steward && (
                  <Link role="menuitem" className="acct-item" to="/$tree/settings/activity" params={{ tree }} onClick={() => setOpen(false)}>
                    <Activity size={17} /> {t("aitasks.menu")} {attention.data?.ai ? <span className="aitasks-count">{attention.data.ai}</span> : null} </Link>
                )}
                {steward && (
                  <Link role="menuitem" className="acct-item" to="/$tree/settings/games" params={{ tree }} onClick={() => setOpen(false)}>
                    <Gamepad2 size={17} /> {t("campaign.games.title")} </Link>
                )}
                {steward && (
                  <Link role="menuitem" className="acct-item" to="/$tree/settings/feedback" params={{ tree }} onClick={() => setOpen(false)}>
                    <Inbox size={17} /> {t("feedback.inbox")} </Link>
                )}
                {viewAs && (
                  <button role="menuitem" className="acct-item" onClick={() => { setOpen(false); openViewAs(); }}>
                    <Eye size={17} /> {t('viewas.menu')} </button>
                )}
              </div>
            )}
            <div className="acct-group" role="group" aria-labelledby={familyGroup ? `${id}-you` : undefined}>
              {familyGroup && <span className="acct-group-h" id={`${id}-you`}>{t('accountmenu.group_you')}</span>}
              {!demo && (
              <button role="menuitem" className="acct-item" onClick={() => { setOpen(false); setPasskeys(true); }}>
                <KeyRound size={17} /> {session?.auth === 'cloudflare-access' ? t('auth.your_name') : t("accountmenu.your_name_passkeys")} </button>
              )}
              {/* Confirming the account's email address, while the server sends email (src/lib/email/). Never in a preview. */}
              {!demo && !preview && mailOn.data && session?.auth !== 'cloudflare-access' && (
              <button role="menuitem" className="acct-item" onClick={() => { setOpen(false); setYourEmail(true); }}>
                <Mail size={17} /> {t('email.menu')} </button>
              )}
              {/* Download or delete the account (docs/gdpr.md): the reader's own, never during a preview. */}
              {!demo && !preview && (
              <button role="menuitem" className="acct-item" onClick={() => { setOpen(false); setYourData(true); }}>
                <FileDown size={17} /> {t('gdpr.your_data')} </button>
              )}
              {tree && m && (
                <Link role="menuitem" className="acct-item" to="/$tree/history" params={{ tree }} onClick={() => setOpen(false)} aria-label={unseen ? t('history.menu_new', { count: unseen }) : undefined}>
                  <History size={17} /> {t('history.menu')} {unseen ? <span className="hist-dot" aria-hidden /> : null} </Link>
              )}
              {tree && member && (
                <Link role="menuitem" className="acct-item" to="/$tree/print" params={{ tree }} onClick={() => setOpen(false)}>
                  <Printer size={17} /> {t('print.link')} </Link>
              )}
              {!demo && !preview && tree && m && remindersOn.data && (
                <button role="menuitem" className="acct-item" onClick={() => { setOpen(false); setReminders(true); }}>
                  <Bell size={17} /> {t('reminders.menu')} </button>
              )}
              {tree && m && (
                <button role="menuitem" className="acct-item" onClick={() => { setOpen(false); openTours(); }}>
                  <Compass size={17} /> {t('tour.menu')} </button>
              )}
              {steward && (
                <button role="menuitem" className="acct-item" onClick={() => { setOpen(false); openFeedback(); }}>
                  <MessageSquarePlus size={17} /> {t("feedback.menu")} <kbd className="acct-kbd">⌘⇧F</kbd> </button>
              )}
              {tree && (
                <Link role="menuitem" className="acct-item" to="/" search={{ families: 'all' }} onClick={() => setOpen(false)}>
                  <LayoutGrid size={17} /> {t('accountmenu.all_families')} </Link>
              )}
              {!demo && (!!preview || !!signedIn.operator || session?.memberships.some((x) => x.role === 'steward')) && (
                <Link role="menuitem" className="acct-item" to="/families" onClick={() => setOpen(false)}>
                  <Landmark size={17} /> {t('families.menu')} </Link>
              )}
              {/* The operator console: an instance role, never a family's (docs/hosting-many-families.md). */}
              {!demo && signedIn.operator && (
                <Link role="menuitem" className="acct-item" to="/operator" onClick={() => setOpen(false)}>
                  <ServerCog size={17} /> {t('operator.menu')}{' '}
                  {operatorWaiting ? <span className="aitasks-count"><span aria-hidden>{operatorWaiting}</span><span className="sr-only">{t('operator.menu_waiting', { count: operatorWaiting })}</span></span> : null}
                  {update.data ? <span className="hist-dot" role="img" aria-label={t('ops.update_dot')} /> : null} </Link>
              )}
              {!demo && (
              <button role="menuitem" className="acct-item" onClick={() => void signOut(session?.accessLogout, !!preview)}>
                <LogOut size={17} /> {t("accountmenu.sign_out")} </button>
              )}
            </div>
            {/* Below 1680px the top bar has no room for the theme and sound buttons: they live here (app.css hides them there). */}
            <div className="acct-prefs">
              <div className="acct-pref" role="group" aria-label={t('shell.theme')}>
                <span id={`${id}-theme`}>{t('shell.theme')}</span>
                <div className="acct-themes">
                  {THEMES.map((th) => {
                    const Icon = THEME_ICONS[th.id];
                    return (
                      <button key={th.id} role="menuitemradio" aria-checked={theme === th.id} className="btn" onClick={() => setPref('theme', th.id)}>
                        <Icon size={14} aria-hidden /> {t(THEME_LABEL[th.id])}
                      </button>
                    );
                  })}
                </div>
              </div>
              <button role="menuitemcheckbox" aria-checked={sound} className="acct-item" onClick={toggleSound}>
                {sound ? <Volume2 size={17} /> : <VolumeX size={17} />} {t('shell.sound_effects')}
                <span className="acct-check" aria-hidden>{sound ? <Check size={16} /> : null}</span>
              </button>
              {/* Live presence (src/lib/presence/): whether others see whom this member has selected. Members only. */}
              {tree && member && !demo && !preview && (
                <button role="menuitemcheckbox" aria-checked={shadows} aria-describedby={`${id}-shadows`} className="acct-item acct-shadows" onClick={() => setPref(SHADOWS_PREF, shadows ? 'off' : null)}>
                  <Users size={17} aria-hidden />
                  <span><span>{t('presence.share')}</span><small id={`${id}-shadows`}>{t('presence.share_hint')}</small></span>
                  <span className="acct-check" aria-hidden>{shadows ? <Check size={16} /> : null}</span>
                </button>
              )}
            </div>
            <button role="menuitem" className="acct-item acct-about" onClick={() => { setOpen(false); setAbout(true); }}>
              <Info size={17} /> {t('accountmenu.about')} </button>
            {/* "New in Kindred": the highlights of each release (src/lib/releases/), not the family's own "What's new". */}
            <Link role="menuitem" className="acct-item" to="/whats-new" onClick={() => setOpen(false)}>
              <Sparkles size={17} /> {t('ops.new_in_kindred')} </Link>
            {instance.data && anyLegal(instance.data.legal) && (
              <Link role="menuitem" className="acct-item" to="/legal" onClick={() => setOpen(false)}>
                <Scale size={17} /> {t('legal.title')} </Link>
            )}
            {appVersion() && (
              <a className="acct-version" role="menuitem" href={releaseUrl(appVersion()!)} target="_blank" rel="noopener noreferrer" title={t('accountmenu.releaseNotes')}>
                {t('accountmenu.version', { version: appVersion()! })}{appCommit() && <span> · {appCommit()}</span>}
              </a>
            )}
          </div>
        </div>
      )}
      <AboutDialog open={about} onClose={() => setAbout(false)} />
      {!demo && <YourDataDialog open={yourData} onClose={() => setYourData(false)} />}
      {!demo && <YourEmailDialog open={yourEmail} onClose={() => setYourEmail(false)} />}
      <PasskeysDialog open={passkeys} onClose={() => setPasskeys(false)} />
      {/* Reminders are the steward's own devices: a preview neither refreshes nor shows them. */}
      {!demo && !preview && tree && m && <ReminderRefresh tree={tree} />}
      {!preview && tree && m && <RemindersDialog tree={tree} open={reminders} onClose={() => setReminders(false)} />}
    </>
  );
}

export const ago = (ms: number | null, locale: Locale = 'en') => relativeTime(ms, locale);

/** "Your name & passkeys": rename yourself, add a passkey on this device, remove an old one. */
export function PasskeysDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const session = useSession();
  const qc = useQueryClient();
  // Passkeys exist only under Kindred's own sign-in. Behind Cloudflare Access this dialog is just the name.
  const passkeysOn = session?.auth !== 'cloudflare-access';
  const keys = useQuery({ ...myPasskeysQuery, enabled: open && passkeysOn });
  // The other ways in (a password): the last passkey may go while a password the server accepts remains.
  const ways = useQuery({ ...mySignInQuery, enabled: open && passkeysOn });
  const passwordWay = !!ways.data?.password && !!ways.data.methods.includes('password');
  const passkeysOffered = ways.data ? ways.data.methods.includes('passkey') : true;
  const [name, setName] = useState(session?.user?.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Passkey | null>(null);
  useEffect(() => { if (open) { setName(session?.user?.name ?? ''); setError(null); } }, [open, session?.user?.name]);

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['session'] })]);
  const add = useMutation({ mutationFn: addPasskey, onSuccess: refresh, onError: (e) => setError(e.message) });
  const remove = useMutation({
    mutationFn: (id: string) => withFreshProof(() => removeMyPasskey({ data: { id } })),
    onSuccess: ({ signedOut }) => {
      setConfirm(null);
      // The passkey this browser signed in with: its session ended with it, so this browser goes to the sign-in page.
      if (signedOut) { forgetLocalIdentity(); window.location.assign('/signin'); return; }
      return refresh();
    },
    onError: (e) => { setConfirm(null); setError(e.message); },
  });
  const [confirmElsewhere, setConfirmElsewhere] = useState(false);
  const elsewhere = useMutation({
    mutationFn: () => withFreshProof(() => signOutElsewhere()),
    onSuccess: () => setConfirmElsewhere(false),
    onError: (e) => { setConfirmElsewhere(false); setError(e.message); },
  });
  useEffect(() => { if (open) elsewhere.reset(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const rename = useMutation({ mutationFn: () => renameMe({ data: { name } }), onSuccess: refresh, onError: (e) => setError(e.message) });
  const list = keys.data ?? [];

  return (
    <>
      <Dialog open={open} onClose={onClose} title={passkeysOn ? t("accountmenu.your_name_passkeys") : t('auth.your_name')} width={520} bodyClassName="acct-dialog">
        <form className="acct-rename" onSubmit={(e) => { e.preventDefault(); setError(null); rename.mutate(); }}>
          <label className="field">
            <span>{t("accountmenu.your_name_as_the_family_sees_it")}</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="name" />
          </label>
          <button className="btn" disabled={rename.isPending || !name.trim() || name.trim() === session?.user?.name}>
            {rename.isSuccess && name.trim() === session?.user?.name ? <><Check size={15} /> {t("accountmenu.saved")}</> : t("accountmenu.save")}
          </button>
        </form>

        {error && <p className="acct-error" role="alert">{translateMessage(error,t.locale)}</p>}
        {passkeysOn && <>
        <h3 className="acct-h">{t("accountmenu.passkeys")}</h3>
        <p className="acct-help"> {t("accountmenu.a_passkey_lets_this_device_sign_you_in_with_your_face_fingerprint_or_screen_lock_nothing_to_remember_add_one_on_each_phone_or_computer_you_use")}.
        </p>
        {keys.isPending ? (
          <p className="subtle">{t("accountmenu.loading_your_passkeys")}</p>
        ) : keys.isError ? (
          <p className="acct-error" role="alert">{t("accountmenu.your_passkeys_couldn_t_be_loaded")} <button className="btn ghost" onClick={() => void keys.refetch()}>{t("accountmenu.retry")}</button></p>
        ) : list.length === 0 ? (
          <p className="subtle">{t("accountmenu.no_passkeys_yet")}</p>
        ) : (
          <ul className="acct-keys">
            {list.map((k) => (
              <li key={k.id}>
                <span className="acct-key-icon" aria-hidden><Fingerprint size={20} /></span>
                <div>
                  <b>{k.device ? translateMessage(k.device, t.locale) : t("accountmenu.passkey")}</b>
                  <span> {t("accountmenu.added")} {formatDate(k.created, t.locale)} {t("accountmenu.used")} {ago(k.lastUsed, t.locale)}
                    {k.synced && <> · <ShieldCheck size={13} aria-hidden /> {t("accountmenu.synced")}</>}
                  </span>
                </div>
                <button
                  className="btn ghost icon acct-key-remove"
                  aria-label={t('account.removeKey', {device:k.device ?? t('accountmenu.this_device')})}
                  title={list.length <= 1 && !passwordWay ? t("accountmenu.your_only_passkey_add_another_first") : t("accountmenu.remove")}
                  disabled={list.length <= 1 && !passwordWay}
                  onClick={() => setConfirm(k)}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {/* Signed in with a code from email (someone who lost their devices, say): a passkey here makes the next time one tap. */}
        {ways.data?.current === 'email-code' && passkeysOffered && passkeysSupported() && !add.isSuccess && (
          <p className="acct-help" role="note"><b>{t('email.code_add_passkey')}</b></p>
        )}
        {passkeysSupported() && passkeysOffered && (
          <button className="btn acct-add" onClick={() => { setError(null); add.mutate(); }} disabled={add.isPending}>
            <Plus size={16} /> {add.isPending ? t("accountmenu.waiting_for_your_device") : t("accountmenu.add_a_passkey_on_this_device")}
          </button>
        )}
        {add.isSuccess && <p className="acct-ok" role="status"><Check size={15} /> {t("accountmenu.passkey_added")}</p>}
        <MySignIn open={open} />
        <MySingleSignOn open={open} />
        <h3 className="acct-h">{t("accountmenu.other_sign_ins")}</h3>
        <p className="acct-help">{t("accountmenu.sign_out_everywhere_else_help")}</p>
        <p className="acct-help">{t("proof.hint")}</p>
        <button className="btn acct-add" onClick={() => { setError(null); elsewhere.reset(); setConfirmElsewhere(true); }} disabled={elsewhere.isPending}>
          <LogOut size={16} /> {t("accountmenu.sign_out_everywhere_else")}
        </button>
        {elsewhere.isSuccess && (
          <p className="acct-ok" role="status">
            <Check size={15} /> {elsewhere.data.ended ? t("accountmenu.signed_out_elsewhere", { count: elsewhere.data.ended }) : t("accountmenu.no_other_sign_ins")}
          </p>
        )}
        </>}
      </Dialog>
      <Dialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={t("accountmenu.remove_this_passkey")}
        width={420}
        description={<>{confirm?.device ? richText(t, "accountmenu.remove_passkey_on", { device: <b>{translateMessage(confirm.device, t.locale)}</b> }) : t("accountmenu.remove_passkey_other")} {t("accountmenu.anything_signed_in_with_it_is_signed_out_too")}</>}
        footer={
          <>
            <button className="btn" data-autofocus onClick={() => setConfirm(null)}>{t("accountmenu.keep_it")}</button>
            <button className="btn primary acct-danger" onClick={() => confirm && remove.mutate(confirm.id)} disabled={remove.isPending}>{t("accountmenu.remove")}</button>
          </>
        }
      />
      <Dialog
        open={confirmElsewhere}
        onClose={() => setConfirmElsewhere(false)}
        title={t("accountmenu.sign_out_everywhere_else_q")}
        width={420}
        description={t("accountmenu.sign_out_everywhere_else_desc")}
        footer={
          <>
            <button className="btn" data-autofocus onClick={() => setConfirmElsewhere(false)}>{t("common.cancel")}</button>
            <button className="btn primary acct-danger" onClick={() => elsewhere.mutate()} disabled={elsewhere.isPending}>{t("accountmenu.sign_out_everywhere_else")}</button>
          </>
        }
      />
    </>
  );
}
