// Web Push reminders for this device and one family: turn them on (asks the browser's permission), choose the days and
// kinds, send a test to this device, or turn them off. The account menu opens the dialog; opening the app refreshes
// the device's last-seen time (ReminderRefresh). Browsers without push, and iPhones and iPads outside the Home Screen,
// are told why instead of being offered a button that cannot work.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { translateMessage, useT, type Locale } from '~/lib/i18n';
import { forgetThisDevice, reminderStatus, removeReminders, saveReminders, sendTestReminder, touchReminders } from '~/lib/reminders.functions';
import { Dialog } from './ui/Dialog';
import { Switch } from './ui/Switch';
import { ResponsePushSwitch } from './responses/PushSwitch';
import './reminders.css';

/** What this browser can do: push works, or the reason it does not. */
export type Support = 'ok' | 'unsupported' | 'ios-install';

export function supportOf(): Support {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unsupported';
  // iPhones and iPads deliver push only to a site added to the Home Screen.
  const ios = /iPad|iPhone|iPod/u.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const installed = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (ios && !installed) return 'ios-install';
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  return supported ? 'ok' : 'unsupported';
}

/** This browser's push subscription for the app, if it has one. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration('/');
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/**
 * Signing out on this browser: the account's reminders for this device are removed on the server, and the browser's
 * own subscription goes too, so no account's reminders reach it afterwards. Does nothing when the browser has none.
 */
export async function dropThisDevice(): Promise<void> {
  const subscription = await currentSubscription().catch(() => null);
  if (!subscription) return;
  try {
    await forgetThisDevice({ data: { endpoint: subscription.endpoint } });
  } finally {
    await subscription.unsubscribe();
  }
}

/** The app's service worker, registered and active. */
export async function activeRegistration(): Promise<ServiceWorkerRegistration> {
  if (!(await navigator.serviceWorker.getRegistration('/'))) await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  return navigator.serviceWorker.ready;
}

/** A base64url string as the bytes the browser needs for its application server key. */
export function keyBytes(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (text.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

const DEFAULT_OFFSETS = [1, 7];
const DEFAULT_KINDS = ['birthday', 'wedding'];
const DAYS = [
  { value: 0, label: 'reminders.onTheDay' },
  { value: 1, label: 'reminders.dayBefore' },
  { value: 7, label: 'reminders.weekBefore' },
] as const;
const KINDS = [
  { value: 'birthday', label: 'reminders.birthdays' },
  { value: 'wedding', label: 'reminders.weddings' },
  { value: 'memorial', label: 'reminders.memorials' },
] as const;

interface Notice { tone: 'ok' | 'error'; text: string }

/** A server message is an English key the app knows; translate it to the reader's language. */
const messageOf = (e: unknown, locale: Locale, fallback: string): string => (e instanceof Error && e.message ? translateMessage(e.message, locale) : fallback);

export function RemindersDialog({ tree, open, onClose }: { tree: string; open: boolean; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [support, setSupport] = useState<Support | null>(null);
  // What the reader has changed and not yet saved. Null leaves the choices stored for this device as they are, so a
  // refetch never overwrites an edit in progress.
  const [offsetsDraft, setOffsetsDraft] = useState<number[] | null>(null);
  const [kindsDraft, setKindsDraft] = useState<string[] | null>(null);
  const [weeklyDraft, setWeeklyDraft] = useState<boolean | null>(null);
  const [postsDraft, setPostsDraft] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  useEffect(() => {
    if (open) {
      setSupport(supportOf());
      setNotice(null);
      setOffsetsDraft(null);
      setKindsDraft(null);
      setWeeklyDraft(null);
      setPostsDraft(null);
    }
  }, [open]);

  // This device's endpoint, then the choices stored for it in this family.
  const device = useQuery({
    queryKey: ['reminders', 'device'],
    queryFn: async () => (await currentSubscription())?.endpoint ?? null,
    enabled: open && support === 'ok',
    staleTime: 0,
  });
  const endpoint = device.data ?? null;
  const status = useQuery({
    queryKey: ['reminders', 'status', tree, endpoint],
    queryFn: () => reminderStatus({ data: { tree, endpoint: endpoint ?? undefined } }),
    enabled: open && support === 'ok' && device.isSuccess,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['reminders'] });
  const storedOffsets = status.data?.subscribed ? status.data.offsets : DEFAULT_OFFSETS;
  const storedKinds = status.data?.subscribed ? status.data.kinds : DEFAULT_KINDS;
  const offsets = offsetsDraft ?? storedOffsets;
  const kinds = kindsDraft ?? storedKinds;
  // "This week in the family" is off until asked for (history-push.server.ts).
  const weekly = weeklyDraft ?? (status.data?.subscribed ? status.data.weekly : false);
  // A new message in the family's feed: off until asked for, and gentle (feed/post-push.server.ts).
  const posts = postsDraft ?? (status.data?.subscribed ? status.data.posts : false);
  const setOffsets = (change: (list: number[]) => number[]) => setOffsetsDraft((draft) => change(draft ?? storedOffsets));
  const setKinds = (change: (list: string[]) => string[]) => setKindsDraft((draft) => change(draft ?? storedKinds));
  // Once the stored choices are read again after a save or turning off, they are the truth and the draft is dropped.
  const settle = async () => {
    await refresh();
    setOffsetsDraft(null);
    setKindsDraft(null);
    setWeeklyDraft(null);
    setPostsDraft(null);
  };

  const subscribed = status.data?.subscribed ?? false;
  const available = status.data?.available ?? false;

  // Turn on, or save changed choices: ask for permission, subscribe the browser, store the choices for this family.
  const save = useMutation({
    mutationFn: async (): Promise<Notice> => {
      const publicKey = status.data?.publicKey;
      if (!publicKey) return { tone: 'error', text: t('reminders.err.unavailable') };
      if (!offsets.length || !kinds.length) return { tone: 'error', text: t('reminders.chooseSomething') };
      if (Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') {
        return { tone: 'error', text: t('reminders.denied') };
      }
      const registration = await activeRegistration();
      const subscription =
        (await registration.pushManager.getSubscription()) ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
      const keys = subscription.toJSON().keys ?? {};
      await saveReminders({
        data: {
          tree,
          subscription: { endpoint: subscription.endpoint, keys: { p256dh: keys.p256dh ?? '', auth: keys.auth ?? '' } },
          offsets,
          kinds,
          weekly,
          posts,
          locale: t.locale,
        },
      });
      return { tone: 'ok', text: t('reminders.saved') };
    },
    onSuccess: async (result) => {
      setNotice(result);
      await settle();
    },
    onError: async (e) => {
      setNotice({ tone: 'error', text: messageOf(e, t.locale, t('reminders.failed')) });
      await refresh();
    },
  });

  // One test push to this device. The server sends it to this device's endpoint and no other.
  const test = useMutation({
    mutationFn: async (): Promise<Notice> => {
      if (!endpoint) return { tone: 'error', text: t('reminders.testNeedsOn') };
      const result = await sendTestReminder({ data: { tree, endpoint } });
      if (result.status === 'sent') return { tone: 'ok', text: t('reminders.testSent') };
      if (result.status === 'expired') return { tone: 'error', text: t('reminders.expired') };
      return { tone: 'error', text: t('reminders.testFailed', { status: result.code }) };
    },
    onSuccess: async (result) => {
      setNotice(result);
      await refresh();
    },
    onError: (e) => setNotice({ tone: 'error', text: messageOf(e, t.locale, t('reminders.failed')) }),
  });

  // Turn off on this device for this family. The browser's own subscription goes only when no family still uses it.
  const disable = useMutation({
    mutationFn: async (): Promise<Notice> => {
      if (endpoint) {
        const { remaining } = await removeReminders({ data: { tree, endpoint } });
        if (remaining === 0) await (await currentSubscription())?.unsubscribe();
      }
      return { tone: 'ok', text: t('reminders.removed') };
    },
    onSuccess: async (result) => {
      setNotice(result);
      await settle();
    },
    onError: (e) => setNotice({ tone: 'error', text: messageOf(e, t.locale, t('reminders.failed')) }),
  });

  const busy = save.isPending || test.isPending || disable.isPending;
  const toggle = <T extends number | string>(list: T[], value: T, on: boolean) => (on ? [...new Set([...list, value])] : list.filter((item) => item !== value));

  return (
    <Dialog open={open} onClose={onClose} title={t('reminders.title')} width={520} bodyClassName="acct-dialog">
      <p className="acct-help">{t('reminders.intro')}</p>
      <p className="acct-help subtle">{t('reminders.perFamily')}</p>

      {support === 'ios-install' && <p className="acct-error" role="status">{t('reminders.iosInstall')}</p>}
      {support === 'unsupported' && <p className="acct-error" role="status">{t('reminders.unsupported')}</p>}

      {support === 'ok' && device.isPending && <p className="subtle">{t('reminders.working')}</p>}
      {support === 'ok' && status.isError && (
        <p className="acct-error" role="alert">
          {t('reminders.failed')} <button className="btn ghost" onClick={() => void status.refetch()}>{t('accountmenu.retry')}</button>
        </p>
      )}
      {support === 'ok' && status.data && !available && <p className="acct-error" role="status">{t('reminders.err.unavailable')}</p>}

      {support === 'ok' && status.data && available && (
        <>
          <p className="acct-help" role="status">{subscribed ? t('reminders.active') : t('reminders.off')}</p>
          <fieldset className="reminders-choices">
            <legend>{t('reminders.when')}</legend>
            {DAYS.map((day) => (
              <Switch key={day.value} checked={offsets.includes(day.value)} onChange={(on) => setOffsets((list) => toggle(list, day.value, on))} disabled={busy}>
                {t(day.label)}
              </Switch>
            ))}
          </fieldset>
          <fieldset className="reminders-choices">
            <legend>{t('reminders.what')}</legend>
            {KINDS.map((kind) => (
              <Switch key={kind.value} checked={kinds.includes(kind.value)} onChange={(on) => setKinds((list) => toggle(list, kind.value, on))} disabled={busy}>
                {t(kind.label)}
              </Switch>
            ))}
            <Switch checked={weekly} onChange={(on) => setWeeklyDraft(on)} disabled={busy}>
              {t('history.push.toggle')}
            </Switch>
            <p className="acct-help subtle">{t('history.push.toggle_hint')}</p>
            <Switch checked={posts} onChange={(on) => setPostsDraft(on)} disabled={busy}>
              {t('feed.push.toggle')}
            </Switch>
            <p className="acct-help subtle">{t('feed.push.toggle_hint')}</p>
          </fieldset>
          <ResponsePushSwitch tree={tree} disabled={busy} />
          <div className="reminders-actions">
            <button className="btn primary" onClick={() => save.mutate()} disabled={busy}>
              {subscribed ? t('reminders.save') : t('reminders.enable')}
            </button>
            {subscribed && <button className="btn" onClick={() => test.mutate()} disabled={busy}>{t('reminders.test')}</button>}
            {subscribed && <button className="btn ghost" onClick={() => disable.mutate()} disabled={busy}>{t('reminders.disable')}</button>}
          </div>
        </>
      )}

      {support === 'ok' && <p className="acct-help subtle">{t('reminders.privacy')}</p>}
      {notice && (
        <p className={notice.tone === 'ok' ? 'acct-ok' : 'acct-error'} role={notice.tone === 'ok' ? 'status' : 'alert'}>
          {notice.text}
        </p>
      )}
    </Dialog>
  );
}

/** Opening the app on a device with reminders refreshes its last-seen time, so the server keeps sending to it. */
export function ReminderRefresh({ tree }: { tree: string }) {
  useEffect(() => {
    if (supportOf() !== 'ok' || Notification.permission !== 'granted') return;
    let cancelled = false;
    void currentSubscription()
      .then((subscription) => (subscription && !cancelled ? touchReminders({ data: { tree, endpoint: subscription.endpoint } }) : undefined))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tree]);
  return null;
}
