// Suspending or closing a family restricts its use of the service, so its stewards get a statement of reasons (EU DSA Art. 17):
// what happened, what it rests on, and what they may do. The operator writes it here before the change; the family's members
// read it on the suspended bar or the closed page (StatementOfReasons below).
import { useMutation, useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Dialog } from '~/components/ui';
import { errorText } from '~/lib/errortext';
import { formatDate, useT } from '~/lib/i18n';
import { familyStatementQuery, operatorSetStatus } from '~/lib/operator/operator.functions';
import { STATUS_GROUNDS, STATUS_REASON_MAX, type StatusGround } from '~/lib/operator/shared';
import './gdpr.css';

export function StatusReasonDialog({ tree, name, status, onClose, onDone }: { tree: string; name: string; status: 'suspended' | 'closed'; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const ids = useId();
  const [reason, setReason] = useState('');
  const [ground, setGround] = useState<StatusGround>('terms');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => operatorSetStatus({ data: { tree, status, reason, ground } }),
    onSuccess: onDone,
    onError: (e) => setError(errorText(e, t.locale)),
  });
  return (
    <Dialog open onClose={onClose} width={500} title={t(status === 'closed' ? 'gdpr.close_title' : 'gdpr.suspend_title', { name })} dismissible={!save.isPending}>
      <form className="gdpr-confirm" onSubmit={(e) => { e.preventDefault(); if (reason.trim() && !save.isPending) save.mutate(); }}>
        <p className="families-hint">{t('gdpr.reason_hint')}</p>
        <fieldset className="operator-fieldset">
          <legend>{t('gdpr.ground')}</legend>
          {STATUS_GROUNDS.map((g) => (
            <label key={g} className="operator-radio">
              <input type="radio" name={`${ids}-ground`} checked={ground === g} onChange={() => setGround(g)} />
              <span>{t(`gdpr.ground_${g}`)}</span>
            </label>
          ))}
        </fieldset>
        <label htmlFor={`${ids}-reason`}>{t('gdpr.reason')}</label>
        <textarea id={`${ids}-reason`} className="input operator-text" rows={5} maxLength={STATUS_REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} required />
        {error && <p role="alert" className="families-error">{error}</p>}
        <div className="families-row">
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className="btn primary" disabled={!reason.trim() || save.isPending}>{t(status === 'closed' ? 'operator.level_closed' : 'operator.level_suspended')}</button>
        </div>
      </form>
    </Dialog>
  );
}

/** The statement of reasons, for the family's members: under the suspended bar, and on the closed page. */
export function StatementOfReasons({ tree }: { tree: string }) {
  const t = useT();
  const { data } = useQuery(familyStatementQuery(tree));
  if (!data) return null;
  return (
    <div className="gdpr-statement">
      <b>{t('gdpr.statement_title', { date: data.at ? formatDate(data.at, t.locale) : '' })}</b>
      <span className="muted"> {t(`gdpr.ground_${data.ground}`)}</span>
      <p>{data.reason}</p>
    </div>
  );
}
