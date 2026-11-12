// The lasting notice after an operator's reset link was used on the reader's account (src/lib/auth/password.server.ts,
// resetNoticeOf): shown at the foot of every page until a session another way in started (a passkey, a provider) dismisses
// it, so whoever used the link with the new password cannot hide it from the account's holder. A password session sees it
// without the dismiss button, for 30 days.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert, X } from 'lucide-react';
import { dismissResetNotice, resetNoticeQuery } from '~/lib/auth/signin.functions';
import { formatDate, useT } from '~/lib/i18n';
import { useSession } from '~/lib/session';
import '~/components/operator/operator.css';

export function ResetNotice() {
  const t = useT();
  const qc = useQueryClient();
  const session = useSession();
  const on = !!session?.user && !session.demo;
  const { data } = useQuery({ ...resetNoticeQuery, enabled: on });
  const dismiss = useMutation({ mutationFn: () => dismissResetNotice(), onSuccess: () => qc.setQueryData(resetNoticeQuery.queryKey, null) });
  if (!on || !data) return null;
  return (
    <div className="announcements" role="region" aria-label={t('pw.reset_notice_label')}>
      <div className="announcement" role="alert">
        <ShieldAlert size={16} aria-hidden />
        <div><p>{t('pw.reset_notice', { date: formatDate(data.at, t.locale) })}</p></div>
        {data.dismissible && (
          <button type="button" className="btn icon ghost" onClick={() => dismiss.mutate()} disabled={dismiss.isPending} aria-label={t('ui.dismiss')}><X size={14} /></button>
        )}
      </div>
    </div>
  );
}
