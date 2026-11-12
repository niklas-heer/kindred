// "Tell this device about new requests": an operator's switch for Web Push on this browser (src/lib/operator/operator-push.server.ts).
// A push says only that a request waits, at most once in ten minutes. It uses the same browser subscription as a family's
// reminders, so turning it off keeps the subscription while reminders still use it. Offered only when the server has its VAPID
// keys; a browser that cannot receive push is told why.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Switch } from '~/components/ui/Switch';
import { activeRegistration, currentSubscription, keyBytes, supportOf } from '~/components/Reminders';
import { errorText } from '~/lib/errortext';
import { useT } from '~/lib/i18n';
import { fetchOperatorPush, setOperatorPush } from '~/lib/operator/operator.functions';

export function OperatorPushSwitch({ pushKey }: { pushKey: string | null }) {
  const t = useT();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const support = typeof window === 'undefined' ? 'unsupported' : supportOf();
  const state = useQuery({
    queryKey: ['operator', 'push'],
    enabled: !!pushKey && support === 'ok',
    queryFn: async () => {
      const subscription = await currentSubscription().catch(() => null);
      return subscription ? (await fetchOperatorPush({ data: { endpoint: subscription.endpoint } })).on : false;
    },
  });
  const toggle = useMutation({
    mutationFn: async (on: boolean) => {
      if (!on) {
        const subscription = await currentSubscription();
        if (!subscription) return;
        const { remaining } = await setOperatorPush({ data: { on: false, endpoint: subscription.endpoint } });
        if (remaining === 0) await subscription.unsubscribe();
        return;
      }
      if (Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') throw new Error('reminders.denied');
      const registration = await activeRegistration();
      const subscription = (await registration.pushManager.getSubscription())
        ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(pushKey!) }));
      const keys = subscription.toJSON().keys ?? {};
      await setOperatorPush({ data: { on: true, endpoint: subscription.endpoint, keys: { p256dh: keys.p256dh ?? '', auth: keys.auth ?? '' }, locale: t.locale } });
    },
    onSuccess: () => { setError(null); return qc.invalidateQueries({ queryKey: ['operator', 'push'] }); },
    onError: (e) => setError(errorText(e, t.locale)),
  });
  if (!pushKey) return <p className="families-hint">{t('operator.push_unavailable')}</p>;
  if (support !== 'ok') return <p className="families-hint">{t(support === 'ios-install' ? 'operator.push_ios' : 'operator.push_unsupported')}</p>;
  return (
    <div className="operator-push">
      <Switch checked={!!state.data} disabled={state.isPending || toggle.isPending} onChange={(on) => toggle.mutate(on)} aria-describedby="operator-push-hint">
        {t('operator.push_label')}
      </Switch>
      <small className="families-hint" id="operator-push-hint">{t('operator.push_hint')}</small>
      {error && <p role="alert" className="families-error">{error}</p>}
    </div>
  );
}
