// The operator console's waiting list (requests for a family) and data requests (access, correction, deletion). Kindred sends no
// email: an approval shows the invitation link and the address to send it to.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Mail, X } from 'lucide-react';
import { useId, useState } from 'react';
import { ConfirmDialog, Dialog, EmptyState, Segmented } from '~/components/ui';
import { errorText } from '~/lib/errortext';
import { formatDate, useT } from '~/lib/i18n';
import { operatorApproveRequest, operatorDataRequestStatus, operatorDeclineRequest, type OperatorConsole } from '~/lib/operator/operator.functions';
import { daysLeft, type DataRequest, type DataRequestStatus, type FamilyRequest } from '~/lib/operator/shared';
import { inviteUrl, LinkBox, suggestId, ThemePick } from './OperatorConsole';

export function FamilyRequestsTab({ data }: { data: OperatorConsole }) {
  const t = useT();
  const open = data.familyRequests.filter((r) => r.status === 'open');
  const decided = data.familyRequests.filter((r) => r.status !== 'open');
  // Kept here, not in the card: once approved, the request leaves the open list while the dialog still shows its link.
  const [approving, setApproving] = useState<FamilyRequest | null>(null);
  return (
    <div className="operator-panel">
      {data.settings.familyCreation !== 'requests' && <p className="families-hint">{t('operator.requests_closed_hint')}</p>}
      <section aria-labelledby="operator-waiting">
        <h2 id="operator-waiting" className="rule">{t('operator.waiting', { count: open.length })}</h2>
        {open.length === 0 ? <EmptyState title={t('operator.no_requests')} /> : (
          <ul className="families-list">{open.map((r) => <RequestCard key={r.id} request={r} onApprove={() => setApproving(r)} />)}</ul>
        )}
      </section>
      {decided.length > 0 && (
        <section aria-labelledby="operator-decided">
          <h2 id="operator-decided" className="rule">{t('operator.decided')}</h2>
          <ul className="operator-compact">
            {decided.map((r) => (
              <li key={r.id}>
                <b>{r.familyName}</b> · {r.name} · {t(r.status === 'approved' ? 'operator.approved_on' : 'operator.declined_on', { date: formatDate(r.decidedAt ?? r.created, t.locale) })}
                {r.family && <span className="families-id muted"> /{r.family}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {approving && <ApproveDialog request={approving} onClose={() => setApproving(null)} />}
    </div>
  );
}

function RequestCard({ request: r, onApprove }: { request: FamilyRequest; onApprove: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const ids = useId();
  const [declining, setDeclining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decline = useMutation({
    mutationFn: () => operatorDeclineRequest({ data: { id: r.id } }),
    onSuccess: async () => { setDeclining(false); await qc.invalidateQueries({ queryKey: ['operator'] }); },
    onError: (e) => setError(errorText(e, t.locale)),
  });
  return (
    <li className="ui-card families-card" aria-labelledby={`${ids}-h`}>
      <h3 id={`${ids}-h`}>{r.familyName}</h3>
      <p>{r.name} · <a href={`mailto:${r.email}`}>{r.email}</a></p>
      <p className="muted">{t('operator.asked_on', { date: formatDate(r.created, t.locale) })}</p>
      {r.message && <blockquote className="operator-message">{r.message}</blockquote>}
      <div className="families-row">
        <button type="button" className="btn primary" onClick={onApprove}><Check size={15} aria-hidden /> {t('operator.approve')}</button>
        <button type="button" className="btn" onClick={() => setDeclining(true)}><X size={15} aria-hidden /> {t('operator.decline')}</button>
      </div>
      {error && !declining && <p role="alert" className="families-error">{error}</p>}
      <ConfirmDialog
        open={declining} onClose={() => setDeclining(false)} onConfirm={() => decline.mutate()} busy={decline.isPending}
        title={t('operator.decline_title', { name: r.name })} confirmLabel={t('operator.decline')} error={declining ? error : undefined}
      >
        <p>{t('operator.decline_text', { email: r.email })}</p>
      </ConfirmDialog>
    </li>
  );
}

function ApproveDialog({ request: r, onClose }: { request: FamilyRequest; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const ids = useId();
  const [name, setName] = useState(r.familyName);
  const [id, setId] = useState(suggestId(r.familyName));
  const [theme, setTheme] = useState<'codex' | 'modern'>('codex');
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ url: string; expires: number } | null>(null);
  const approve = useMutation({
    mutationFn: () => operatorApproveRequest({ data: { id: r.id, familyId: id, familyName: name, theme } }),
    onSuccess: async (m) => { setError(null); setMade({ url: inviteUrl(m.token), expires: m.expires }); await qc.invalidateQueries({ queryKey: ['operator'] }); },
    onError: (e) => setError(errorText(e, t.locale)),
  });
  return (
    <Dialog
      open onClose={onClose} title={t('operator.approve_title', { name: r.familyName })} width="min(560px, 100vw - 24px)" dismissible={!approve.isPending}
      footer={made ? <button type="button" className="btn primary" onClick={onClose}>{t('operator.done')}</button> : <>
        <button type="button" className="btn" onClick={onClose} disabled={approve.isPending}>{t('families.cancel')}</button>
        <button type="submit" form={`${ids}-form`} className="btn primary" disabled={!name.trim() || !id || approve.isPending}><Check size={16} aria-hidden /> {t('operator.create_and_invite')}</button>
      </>}
    >
      {made ? (
        <div className="families-form" role="status">
          <LinkBox url={made.url} label={t('operator.invite_link_for', { name: r.name })}>
            <p className="families-hint">{t('operator.invite_link_hint', { date: formatDate(made.expires, t.locale) })}</p>
          </LinkBox>
          <p><a className="btn" href={`mailto:${r.email}?body=${encodeURIComponent(made.url)}`}><Mail size={15} aria-hidden /> {t('operator.write_to', { email: r.email })}</a></p>
        </div>
      ) : (
        <form id={`${ids}-form`} className="families-form" onSubmit={(e) => { e.preventDefault(); if (name.trim() && id && !approve.isPending) approve.mutate(); }}>
          <label className="field">
            <span>{t('families.name')}</span>
            <input className="input" value={name} maxLength={80} required autoComplete="off" onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>{t('families.id')}</span>
            <input className="input families-id" value={id} maxLength={40} required pattern="[a-z][a-z0-9]*(-[a-z0-9]+)*" autoComplete="off" spellCheck={false} onChange={(e) => setId(e.target.value.toLowerCase())} />
          </label>
          <ThemePick value={theme} onChange={setTheme} />
          <p className="families-hint">{t('operator.approve_hint', { name: r.name })}</p>
          {error && <p role="alert" className="families-error">{error}</p>}
        </form>
      )}
    </Dialog>
  );
}

export function DataRequestsTab({ data }: { data: OperatorConsole }) {
  const t = useT();
  const names = new Map(data.families.map((f) => [f.id, f.name]));
  const open = data.dataRequests.filter((r) => r.status !== 'done');
  const done = data.dataRequests.filter((r) => r.status === 'done');
  return (
    <div className="operator-panel">
      <p className="families-hint">{t('operator.data_hint')}</p>
      <section aria-labelledby="operator-data-open">
        <h2 id="operator-data-open" className="rule">{t('operator.data_open', { count: open.length })}</h2>
        {open.length === 0 ? <EmptyState title={t('operator.no_data_requests')} /> : (
          <ul className="families-list">{open.map((r) => <DataRequestCard key={r.id} request={r} familyName={r.family ? names.get(r.family) : undefined} now={data.now} operator />)}</ul>
        )}
      </section>
      {done.length > 0 && (
        <section aria-labelledby="operator-data-done">
          <h2 id="operator-data-done" className="rule">{t('operator.data_done')}</h2>
          <ul className="families-list">{done.map((r) => <DataRequestCard key={r.id} request={r} familyName={r.family ? names.get(r.family) : undefined} now={data.now} operator />)}</ul>
        </section>
      )}
    </div>
  );
}

/** One data request: who asked, about which family, what, and the days left to answer. The operator moves it on; a steward marks it done. */
export function DataRequestCard({ request: r, familyName, now, operator, onDone }: { request: DataRequest; familyName?: string; now: number; operator?: boolean; onDone?: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const ids = useId();
  const [error, setError] = useState<string | null>(null);
  const move = useMutation({
    mutationFn: (status: DataRequestStatus) => operatorDataRequestStatus({ data: { id: r.id, status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['operator'] }),
    onError: (e) => setError(errorText(e, t.locale)),
  });
  const left = daysLeft(r.created, now);
  return (
    <li className="ui-card families-card operator-data" aria-labelledby={`${ids}-h`}>
      <h3 id={`${ids}-h`}>{t(`operator.kind_${r.kind}`)} · {r.name}</h3>
      <p><a href={`mailto:${r.email}`}>{r.email}</a> · {t('operator.asked_on', { date: formatDate(r.created, t.locale) })}</p>
      <p>
        {r.family ? t('operator.about_family', { name: familyName ?? r.family }) : t('operator.about_unknown')}
        {r.familyText && <span className="muted"> · {t('operator.as_written', { text: r.familyText })}</span>}
      </p>
      <blockquote className="operator-message">{r.message}</blockquote>
      {r.status !== 'done' && (
        <p className={left < 0 ? 'families-error' : left <= 7 ? 'operator-soon' : 'muted'}>
          {left < 0 ? t('operator.overdue', { count: -left }) : t('operator.days_left', { count: left })}
        </p>
      )}
      {operator ? (
        <div className="families-row">
          <span id={`${ids}-status`} className="muted">{t('operator.status')}</span>
          <Segmented aria-labelledby={`${ids}-status`} value={r.status} onChange={(s) => { if (s !== r.status) move.mutate(s); }}
            options={[{ value: 'open', label: t('operator.status_open') }, { value: 'forwarded', label: t('operator.status_forwarded') }, { value: 'done', label: t('operator.status_done') }]} />
        </div>
      ) : r.status !== 'done' && onDone ? (
        <div className="families-row"><button type="button" className="btn" onClick={onDone}><Check size={15} aria-hidden /> {t('operator.mark_done')}</button></div>
      ) : r.status === 'done' ? <p className="muted">{t('operator.status_done')}</p> : null}
      {error && <p role="alert" className="families-error">{error}</p>}
    </li>
  );
}
