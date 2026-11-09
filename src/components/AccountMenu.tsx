import { translateMessage, formatDate, relativeTime, useT, type Locale } from '~/lib/i18n';
// The signed-in reader's menu in the topbar: who they are, their role in this family, the way to their passkeys,
// the steward's Access page and AI assistant settings, the editor's import and export, and signing out. Also
// `Initials`, a name's monogram.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { graphQuery } from '~/lib/api';
import { Activity, ArrowLeftRight, BarChart3, Bell, Check, CircleHelp, Fingerprint, KeyRound, LayoutGrid, LogOut, Plus, ShieldCheck, Sparkles, Trash2, Users, Volume2, VolumeX, Inbox, MessageSquarePlus } from 'lucide-react';
import { aiAttentionQuery } from '~/lib/ai/background.functions';
import '~/components/assistant/ai-tasks.css';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { addPasskey, forgetLocalIdentity, passkeysSupported, signOutRequest } from '~/lib/auth/client';
import { appCommit, appVersion, releaseUrl } from '~/lib/version';
import { myPasskeysQuery, removeMyPasskey, renameMe, signOutElsewhere, type Passkey } from '~/lib/auth/functions';
import { fetchRemindersAvailable } from '~/lib/reminders.functions';
import { setPref, THEMES } from '~/lib/prefs';
import { ROLES, can } from '~/lib/roles';
import { openFeedback } from './feedback/FeedbackHost';
import { Portrait } from './Portrait';
import { THEME_ICONS, THEME_LABEL, useSound, useTheme } from './ThemeSwitch';
import { startTour } from './tour/store';
import { dropThisDevice, ReminderRefresh, RemindersDialog } from './Reminders';
import { useMembership, useSession } from '~/lib/session';
import { Dialog } from './ui/Dialog';
import { isTopOverlay, useOverlayLayer } from './ui/overlay';
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
  const linked = useMembership()?.person ?? null;
  const graph = useQuery({ ...graphQuery(tree ?? ''), enabled: !!tree && !!linked });
  const person = linked && tree ? graph.data?.people.find((p) => p.id === linked) : undefined;
  if (person && tree) return <Portrait person={person} tree={tree} size={size} frame={false} />;
  return <Initials name={name} size={size} />;
}

/**
 * Signs out everywhere this browser knows about, then reloads at /signin with nothing cached. First this device stops
 * the account's reminders (server and browser). That step is bounded and its failure is ignored: it never blocks sign-out.
 */
export async function signOut(accessLogout?: string) {
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
  const [open, setOpen] = useState(false);
  const [passkeys, setPasskeys] = useState(false);
  const [reminders, setReminders] = useState(false);
  // Reminders are offered only when this server has its VAPID keys (docs/self-host.md, "Reminders").
  const remindersOn = useQuery({ queryKey: ['reminders', 'available'], queryFn: () => fetchRemindersAvailable(), staleTime: 5 * 60_000 });
  // The quiet badge: what waits for a steward, on the Access page and in AI activity (zero for everyone else).
  const attention = useQuery({ ...aiAttentionQuery(tree ?? ''), enabled: !!tree && !!m && can(m.role, 'manage-access') });
  const layer = useOverlayLayer(open);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const theme = useTheme();
  const [sound, toggleSound] = useSound();

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

  const user = session?.user;
  if (!user) return null;
  const role = m ? roleOf(m.role) : undefined;
  const waiting = (attention.data?.access ?? 0) + (attention.data?.ai ?? 0);
  const steward = !!tree && !!m && can(m.role, 'manage-access');
  const editor = !!tree && !!m && can(m.role, 'edit-person');

  // Arrow keys move between the menu's items.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    // Rows hidden by CSS (the theme and sound rows on a wide screen) take no part.
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])].filter((el) => el.offsetParent !== null);
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    e.preventDefault();
  };

  return (
    <>
      <button
        ref={button}
        className="btn ghost acct-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title={t('account.trigger', {name:user.name})}
      >
        <Avatar name={user.name} size={30} />
        {waiting ? <span className="aitasks-dot" aria-label={t('aitasks.attention')}>{waiting}</span> : null}
        <span className="acct-trigger-name">{user.name}</span>
      </button>
      {open && (
        <div className="acct-menu panel" id={id} ref={menu} role="menu" aria-label={t("accountmenu.your_account")} onKeyDown={onKeyDown} style={pos ?? undefined}>
          <div className="acct-head">
            <Avatar name={user.name} size={44} />
            <div>
              <b className="acct-name">{user.name}</b>
              <span className="acct-sub">{user.via === 'access' ? t('account.signedIn', {email:user.email ?? ''}) : user.email ?? t("accountmenu.signed_in_with_a_passkey")}</span>
            </div>
          </div>
          {role && (
            <p className="acct-role">
              {t('account.role', {family:familyName ?? t('accountmenu.this_family'), role:t(`role.${role.id}`)})} <span>{t(`role.${role.id}Description`)}.</span>
            </p>
          )}
          <div className="acct-items">
            {/* Two groups, so ten rows are not one list: what belongs to this family, then what belongs to the reader. */}
            {tree && (steward || editor) && (
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
                  <Link role="menuitem" className="acct-item" to="/$tree/settings/feedback" params={{ tree }} onClick={() => setOpen(false)}>
                    <Inbox size={17} /> {t("feedback.inbox")} </Link>
                )}
              </div>
            )}
            <div className="acct-group" role="group" aria-labelledby={`${id}-you`}>
              {tree && (steward || editor) && <span className="acct-group-h" id={`${id}-you`}>{t('accountmenu.group_you')}</span>}
              <button role="menuitem" className="acct-item" onClick={() => { setOpen(false); setPasskeys(true); }}>
                <KeyRound size={17} /> {session?.auth === 'cloudflare-access' ? t('auth.your_name') : t("accountmenu.your_name_passkeys")} </button>
              {tree && m && remindersOn.data && (
                <button role="menuitem" className="acct-item" onClick={() => { setOpen(false); setReminders(true); }}>
                  <Bell size={17} /> {t('reminders.menu')} </button>
              )}
              {tree && m && (
                <button role="menuitem" className="acct-item" onClick={() => { setOpen(false); startTour(); }}>
                  <CircleHelp size={17} /> {t('tour.menu')} </button>
              )}
              {steward && (
                <button role="menuitem" className="acct-item" onClick={() => { setOpen(false); openFeedback(); }}>
                  <MessageSquarePlus size={17} /> {t("feedback.menu")} <kbd className="acct-kbd">⌘⇧F</kbd> </button>
              )}
              {tree && (
                <Link role="menuitem" className="acct-item" to="/" search={{ families: 'all' }} onClick={() => setOpen(false)}>
                  <LayoutGrid size={17} /> {t('accountmenu.all_families')} </Link>
              )}
              <button role="menuitem" className="acct-item" onClick={() => void signOut(session?.accessLogout)}>
                <LogOut size={17} /> {t("accountmenu.sign_out")} </button>
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
            </div>
            {appVersion() && (
              <a className="acct-version" role="menuitem" href={releaseUrl(appVersion()!)} target="_blank" rel="noopener noreferrer" title={t('accountmenu.releaseNotes')}>
                {t('accountmenu.version', { version: appVersion()! })}{appCommit() && <span> · {appCommit()}</span>}
              </a>
            )}
          </div>
        </div>
      )}
      <PasskeysDialog open={passkeys} onClose={() => setPasskeys(false)} />
      {tree && m && <ReminderRefresh tree={tree} />}
      {tree && m && <RemindersDialog tree={tree} open={reminders} onClose={() => setReminders(false)} />}
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
  const [name, setName] = useState(session?.user?.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Passkey | null>(null);
  useEffect(() => { if (open) { setName(session?.user?.name ?? ''); setError(null); } }, [open, session?.user?.name]);

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['session'] })]);
  const add = useMutation({ mutationFn: addPasskey, onSuccess: refresh, onError: (e) => setError(e.message) });
  const remove = useMutation({
    mutationFn: (id: string) => removeMyPasskey({ data: { id } }),
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
    mutationFn: () => signOutElsewhere(),
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
                  title={list.length <= 1 ? t("accountmenu.your_only_passkey_add_another_first") : t("accountmenu.remove")}
                  disabled={list.length <= 1}
                  onClick={() => setConfirm(k)}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {passkeysSupported() && (
          <button className="btn acct-add" onClick={() => { setError(null); add.mutate(); }} disabled={add.isPending}>
            <Plus size={16} /> {add.isPending ? t("accountmenu.waiting_for_your_device") : t("accountmenu.add_a_passkey_on_this_device")}
          </button>
        )}
        {add.isSuccess && <p className="acct-ok" role="status"><Check size={15} /> {t("accountmenu.passkey_added")}</p>}
        <h3 className="acct-h">{t("accountmenu.other_sign_ins")}</h3>
        <p className="acct-help">{t("accountmenu.sign_out_everywhere_else_help")}</p>
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
        description={<>{t("accountmenu.the_passkey_on")} <b>{confirm?.device ? translateMessage(confirm.device, t.locale) : t("accountmenu.that_device")}</b> {t("accountmenu.will_no_longer_sign_you_in_you_can_add_it_again_later")} {t("accountmenu.anything_signed_in_with_it_is_signed_out_too")}</>}
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
