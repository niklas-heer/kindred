// "Ask to join", the steward's side: a card on top of the Access page for each open request, with what the guest said, where and
// how they asked from, and how they used the link. Approve (a role, and who they are) or decline (the request, the waiting
// account and its passkey go). The server checks the steward's role on every call (src/lib/auth/join.functions.ts).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, TriangleAlert, UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { Initials } from '~/components/AccountMenu';
import { WhoPicker } from '~/components/FirstRun';
import { Portrait } from '~/components/Portrait';
import { Dialog, Select } from '~/components/ui';
import { approveJoinRequest, declineJoinRequest, joinRequestsQuery } from '~/lib/auth/join.functions';
import type { JoinRequestView } from '~/lib/auth/join.server';
import { errorText } from '~/lib/errortext';
import { BROWSING, useFamily, useMeChosen } from '~/lib/family';
import { displayName, kinship, lifespan } from '~/lib/graph';
import { formatDate, relativeTime, useT, yourKinship } from '~/lib/i18n';
import { ROLES, type Role } from '~/lib/roles';
import { toast } from '~/lib/toast';
import { Facts, UsageText } from './JoinInvite';
import './join.css';

export function JoinRequests({ tree }: { tree: string }) {
  const t = useT();
  const q = useQuery(joinRequestsQuery(tree));
  const [approving, setApproving] = useState<JoinRequestView | null>(null);
  const [declining, setDeclining] = useState<JoinRequestView | null>(null);
  const qc = useQueryClient();
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['session'] }), qc.invalidateQueries({ queryKey: ['ai-attention', tree] })]);
  const decline = useMutation({
    mutationFn: (id: string) => declineJoinRequest({ data: { tree, id } }),
    onSuccess: () => { setDeclining(null); toast({ title: t('join.declined_toast') }); return refresh(); },
    onError: (e) => { setDeclining(null); toast({ title: errorText(e, t.locale) }); return refresh(); },
  });
  const requests = q.data?.requests ?? [];
  if (!requests.length) return null;
  return (
    <section className="join-requests" aria-labelledby="join-requests-title">
      <h2 className="rule" id="join-requests-title">{t('join.requests_title')} <small>{requests.length}</small></h2>
      <p className="acc-hint">{t('join.requests_hint')}</p>
      <ul className="join-list">
        {requests.map((r) => (
          <li key={r.id}>
            <RequestCard tree={tree} r={r} onApprove={() => setApproving(r)} onDecline={() => setDeclining(r)} busy={decline.isPending} />
          </li>
        ))}
      </ul>
      {approving && <ApproveDialog tree={tree} r={approving} onClose={() => setApproving(null)} onDone={() => { setApproving(null); toast({ title: t('join.approved_toast', { name: approving.name }) }); return refresh(); }} />}
      <Dialog
        open={!!declining}
        onClose={() => setDeclining(null)}
        title={t('join.decline_title', { name: declining?.name ?? '' })}
        width={440}
        description={t('join.decline_text')}
        footer={
          <>
            <button className="btn" data-autofocus onClick={() => setDeclining(null)}>{t('common.cancel')}</button>
            <button className="btn primary acct-danger" disabled={decline.isPending} onClick={() => declining && decline.mutate(declining.id)}>{t('join.decline')}</button>
          </>
        }
      />
    </section>
  );
}

function RequestCard({ tree, r, onApprove, onDecline, busy }: { tree: string; r: JoinRequestView; onApprove: () => void; onDecline: () => void; busy: boolean }) {
  const t = useT();
  const f = useFamily();
  const me = useMeChosen();
  const p = r.person ? f.byId.get(r.person) : undefined;
  const kin = p && me && me !== BROWSING && f.byId.has(me) ? kinship(f, me, p.id) : undefined;
  const days = Math.max(1, Math.ceil((r.expires - Date.now()) / 86_400_000));
  const titleId = `join-req-${r.id}`;
  return (
    <article className="ui-card join-request" aria-labelledby={titleId}>
      <header className="join-request-head">
        <Initials name={r.name} size={40} />
        <div>
          <h3 id={titleId}>{t('join.request_from', { name: r.name })}</h3>
          <span className="subtle">{t('join.request_when', { when: relativeTime(r.created, t.locale), count: days })}</span>
        </div>
      </header>
      <div className="join-request-who">
        {p ? (
          <>
            <Portrait person={p} tree={tree} size={44} frame={false} />
            <div>
              <span>{t('join.says_is')}</span> <b>{displayName(p, f)}</b>
              <span className="subtle"> {lifespan(p, t.locale)}</span>
              {kin && <span className="join-kin">{kin.label === 'you' ? t('join.kin_you') : t('join.kin_of_you', { kin: yourKinship(kin, t.locale) })}</span>}
            </div>
          </>
        ) : <span>{r.person ? t('join.person_gone') : t('join.says_not_in_tree')}</span>}
      </div>
      {r.claimedBy.length > 0 && (
        <p className="join-warn" role="note"><TriangleAlert size={15} aria-hidden /> {t('join.claimed_warning', { names: r.claimedBy.map((c) => c.name).join(', ') })}</p>
      )}
      {r.message && <blockquote className="join-message">{r.message}</blockquote>}
      <dl className="join-facts">
        <Facts t={t} place={r.place} timeZone={r.timeZone} language={r.language} device={r.device} />
        <dt>{t('join.fact_usage')}</dt>
        <dd><UsageText t={t} usage={r.usage} names={(id) => { const x = f.byId.get(id); return x ? displayName(x, f) : null; }} /></dd>
      </dl>
      <div className="join-card-actions">
        <button className="btn primary" onClick={onApprove} disabled={busy}><Check size={15} /> {t('join.approve')}</button>
        <button className="btn ghost" onClick={onDecline} disabled={busy}><X size={15} /> {t('join.decline')}</button>
      </div>
      <p className="acc-hint">{formatDate(r.created, t.locale)}</p>
    </article>
  );
}

function ApproveDialog({ tree, r, onClose, onDone }: { tree: string; r: JoinRequestView; onClose: () => void; onDone: () => unknown }) {
  const t = useT();
  const f = useFamily();
  const [role, setRole] = useState<Role>('contributor');
  const [person, setPerson] = useState<string | null>(r.person && f.byId.has(r.person) ? r.person : null);
  const [changing, setChanging] = useState(false);
  const approve = useMutation({
    mutationFn: () => approveJoinRequest({ data: { tree, id: r.id, role, person } }),
    onSuccess: () => onDone(),
  });
  const p = person && person !== BROWSING ? f.byId.get(person) : undefined;
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('join.approve_title', { name: r.name })}
      width={520}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn primary" disabled={approve.isPending || changing} onClick={() => approve.mutate()}><UserPlus size={15} /> {t('join.approve_confirm')}</button>
        </>
      }
    >
      <div className="acc-form">
        <label className="field">
          <span>{t('acc.theirRole')}</span>
          <Select<Role> value={role} onChange={setRole} aria-label={t('acc.theirRole')} options={ROLES.map((x) => ({ value: x.id, label: t(x.label), hint: t(x.description) }))} menuWidth={420} />
        </label>
        <fieldset className="join-who">
          <legend>{t('join.approve_who')}</legend>
          {changing ? (
            <WhoPicker f={f} tree={tree} onChoose={(id) => { setPerson(id); setChanging(false); }} initialQuery={r.name} />
          ) : (
            <div className="join-chosen">
              {p ? <><Portrait person={p} tree={tree} size={36} frame={false} /> <b>{displayName(p, f)}</b></> : <span>{t('join.approve_nobody')}</span>}
              <button type="button" className="btn ghost" onClick={() => setChanging(true)}>{t('join.change')}</button>
              {person && <button type="button" className="btn ghost" onClick={() => setPerson(null)}>{t('join.clear')}</button>}
            </div>
          )}
        </fieldset>
        {approve.isError && <p className="acc-error" role="alert">{errorText(approve.error, t.locale)}</p>}
      </div>
    </Dialog>
  );
}
