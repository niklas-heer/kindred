// "Your data" (the account menu): download everything about your account as JSON (GDPR Art. 15 and 20), and delete your
// account (Art. 17). docs/gdpr.md says what each covers. Deleting needs your name or email typed and, under Kindred's own
// sign-in, your passkey once more; the server refuses while you are a family's last steward or the server's last operator.
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { Dialog } from '~/components/ui';
import { forgetLocalIdentity, withFreshProof } from '~/lib/auth/client';
import { errorText } from '~/lib/errortext';
import { useT } from '~/lib/i18n';
import { deleteMyAccount, deletionCheckQuery, fetchMyData } from '~/lib/gdpr/gdpr.functions';
import { useSession } from '~/lib/session';
import { downloadText, fileSafe } from './download';
import './gdpr.css';

export function YourDataDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const ids = useId();
  const session = useSession();
  const check = useQuery({ ...deletionCheckQuery, enabled: open });
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const download = useMutation({
    mutationFn: () => fetchMyData(),
    onSuccess: (data) => downloadText(`kindred-account-${fileSafe(session?.user?.name ?? 'me')}-${data.day}.json`, data.text),
    onError: (e) => setError(errorText(e, t.locale)),
  });
  const remove = useMutation({
    mutationFn: () => withFreshProof(() => deleteMyAccount({ data: { confirm: typed } })),
    onSuccess: () => { forgetLocalIdentity(); window.location.assign('/signin'); },
    onError: (e) => setError(errorText(e, t.locale)),
  });
  const blocked = check.data?.blocked ?? null;
  return (
    <Dialog open={open} onClose={onClose} title={t('gdpr.your_data')} width={520} bodyClassName="gdpr-dialog">
      <h3 className="acct-h">{t('gdpr.download_title')}</h3>
      <p className="acct-help">{t('gdpr.download_help')}</p>
      <button type="button" className="btn" onClick={() => { setError(null); download.mutate(); }} disabled={download.isPending}>
        <Download size={16} aria-hidden /> {download.isPending ? t('gdpr.preparing') : t('gdpr.download')}
      </button>
      <h3 className="acct-h">{t('gdpr.delete_title')}</h3>
      <p className="acct-help">{t('gdpr.delete_help')}</p>
      {blocked ? <p className="gdpr-blocked" role="note">{errorText(new Error(blocked), t.locale)}</p> : !confirming ? (
        <button type="button" className="btn danger" onClick={() => { setError(null); setConfirming(true); }} disabled={check.isPending}>
          <Trash2 size={16} aria-hidden /> {t('gdpr.delete')}
        </button>
      ) : (
        <form className="gdpr-confirm" onSubmit={(e) => { e.preventDefault(); if (typed.trim() && !remove.isPending) remove.mutate(); }}>
          <label htmlFor={`${ids}-confirm`}>{t('gdpr.delete_confirm', { name: session?.user?.name ?? '' })}</label>
          <input id={`${ids}-confirm`} className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" maxLength={400} />
          <div className="families-row">
            <button type="button" className="btn" onClick={() => { setConfirming(false); setTyped(''); }}>{t('common.cancel')}</button>
            <button type="submit" className="btn primary acct-danger" disabled={!typed.trim() || remove.isPending}>
              {remove.isPending ? t('gdpr.deleting') : t('gdpr.delete_for_good')}
            </button>
          </div>
        </form>
      )}
      {error && <p className="acct-error" role="alert">{error}</p>}
    </Dialog>
  );
}
