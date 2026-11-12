// A data request's deadline extended by two months (GDPR Art. 12(3)): allowed once, within the first month, and only after the
// operator has told the requester why. Kindred sends no email: the operator writes to them, then records it here.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus } from 'lucide-react';
import { useId, useState } from 'react';
import { errorText } from '~/lib/errortext';
import { useT } from '~/lib/i18n';
import { operatorExtendDataRequest } from '~/lib/operator/operator.functions';

export function ExtendRequest({ id }: { id: string }) {
  const t = useT();
  const ids = useId();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const extend = useMutation({
    mutationFn: () => operatorExtendDataRequest({ data: { id, reason } }),
    onSuccess: () => { setOpen(false); return qc.invalidateQueries({ queryKey: ['operator'] }); },
    onError: (e) => setError(errorText(e, t.locale)),
  });
  if (!open) return <div className="families-row"><button type="button" className="btn ghost" onClick={() => setOpen(true)}><CalendarPlus size={15} aria-hidden /> {t('gdpr.extend')}</button></div>;
  return (
    <form className="gdpr-confirm" onSubmit={(e) => { e.preventDefault(); if (reason.trim() && !extend.isPending) extend.mutate(); }}>
      <label htmlFor={`${ids}-why`}>{t('gdpr.extend_reason')}</label>
      <textarea id={`${ids}-why`} className="input operator-text" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
      <small className="families-hint">{t('gdpr.extend_hint')}</small>
      {error && <p role="alert" className="families-error">{error}</p>}
      <div className="families-row">
        <button type="button" className="btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
        <button type="submit" className="btn primary" disabled={!reason.trim() || extend.isPending}>{t('gdpr.extend_save')}</button>
      </div>
    </form>
  );
}
