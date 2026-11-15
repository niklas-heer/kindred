// A house's proposed arms on its page (docs/arms-proposals.md), for members only: the open proposals and the reader's own in
// any state, each with its shield, name, note, proposer, date and state, and for a steward the house's arms now beside it.
// The buttons are exactly what the server's `may` allows this reader; the server checks again. A guest never reaches this
// (the house page renders it for members, and the read refuses guests).
//
//   {member && <HouseProposals tree={tree} house={house} steward={canEdit} notice={vote} onNotice={setVote} />}
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Check, Undo2, Vote, X } from 'lucide-react';
import { useId, useState } from 'react';
import { Arms } from '~/components/Heraldry';
import { Portrait } from '~/components/Portrait';
import { When } from '~/components/votes/When';
import { ConfirmDialog, Dialog, ErrorState } from '~/components/ui';
import { opKeys } from '~/lib/api';
import {
  acceptProposalFn, armsKeys, declineProposalFn, houseProposalsQuery, putToVoteFn, withdrawProposalFn,
} from '~/lib/arms-proposals/proposals.functions';
import { MAX_DECLINE_REASON, type ProposalStatus, type ProposalView } from '~/lib/arms-proposals/types';
import { myFamiliesQuery } from '~/lib/auth/functions';
import { errorText } from '~/lib/errortext';
import { useFamily } from '~/lib/family';
import type { FeedAuthor } from '~/lib/feed/types';
import { displayName } from '~/lib/graph';
import { blazonV2 } from '~/lib/heraldry/blazon';
import { asV2 } from '~/lib/heraldry/convert';
import { useT, type Key } from '~/lib/i18n';
import { toast } from '~/lib/toast';
import type { House } from '~/lib/types';
import { useSettledRefresh } from './settled';
import './proposals.css';

const STATE: Record<ProposalStatus, Key> = {
  waiting: 'arms.state.waiting',
  voting: 'arms.state.voting',
  accepted: 'arms.state.accepted',
  declined: 'arms.state.declined',
  withdrawn: 'arms.state.withdrawn',
};

export function HouseProposals({ tree, house, steward, notice, onNotice }: {
  tree: string; house: House; steward: boolean;
  /** The arms vote a proposal of this reader's just went into (proposing, or a steward's Put to a vote). */
  notice: string | null;
  onNotice: (vote: string | null) => void;
}) {
  const t = useT();
  const id = useId();
  const q = useQuery(houseProposalsQuery(tree, house.id));
  // The read settled an arms vote (or started the next): the house's arms on this page, and the votes, are read again.
  useSettledRefresh(tree, q.data?.settled, q.dataUpdatedAt);
  const list = q.data?.proposals ?? [];
  // A read that failed says so, with a retry, rather than looking like a house with no proposals.
  if (q.isError && !q.data) {
    return (
      <section className="hp-section ap-section" aria-labelledby={`${id}-h`}>
        <h2 className="rule" id={`${id}-h`}>{t('arms.list.heading')}</h2>
        <ErrorState message={errorText(q.error, t.locale)} onRetry={() => void q.refetch()} />
      </section>
    );
  }
  if (!list.length) return null;
  return (
    <section className="hp-section ap-section" aria-labelledby={`${id}-h`}>
      <h2 className="rule" id={`${id}-h`}>{t('arms.list.heading')}</h2>
      {notice && (
        <p className="ap-notice" role="status">
          {t('arms.in_vote')} <Link className="hp-link" to="/$tree/votes/$vote" params={{ tree, vote: notice }}>{t('arms.open_vote')}</Link>
        </p>
      )}
      <ul className="ap-list">
        {list.map((p) => <Card key={p.id} tree={tree} house={house} steward={steward} p={p} onNotice={onNotice} />)}
      </ul>
    </section>
  );
}

function Card({ tree, house, steward, p, onNotice }: { tree: string; house: House; steward: boolean; p: ProposalView; onNotice: (vote: string | null) => void }) {
  const t = useT();
  const id = useId();
  const qc = useQueryClient();
  const [keys] = useState(opKeys);
  const [asking, setAsking] = useState<'withdraw' | 'accept' | 'decline' | null>(null);
  const [reason, setReason] = useState('');
  const refresh = () => Promise.all(armsKeys(tree).map((queryKey) => qc.invalidateQueries({ queryKey })));

  const withdraw = useMutation({
    mutationFn: () => withdrawProposalFn({ data: { tree, id: p.id, opKey: keys.for('withdraw', p.id) } }),
    onSuccess: async () => { setAsking(null); await refresh(); },
  });
  const accept = useMutation({
    // The house as this page shows it: an Accept over someone else's newer change is refused.
    mutationFn: () => acceptProposalFn({ data: { tree, id: p.id, opKey: keys.for('accept', p.id), before: { name: house.name, motto: house.motto ?? null, arms: house.arms } } }),
    onSuccess: async () => {
      setAsking(null);
      await Promise.all([refresh(), qc.invalidateQueries({ queryKey: myFamiliesQuery.queryKey })]);
      toast({ title: t('arms.state.accepted'), body: t('arms.accepted', { house: house.name }), icon: 'crown' });
    },
  });
  const decline = useMutation({
    mutationFn: () => {
      const data = { tree, id: p.id, reason: reason.trim() || undefined };
      return declineProposalFn({ data: { ...data, opKey: keys.for('decline', data) } });
    },
    onSuccess: async () => { setAsking(null); await refresh(); },
  });
  const vote = useMutation({
    mutationFn: () => putToVoteFn({ data: { tree, id: p.id, opKey: keys.for('vote', p.id) } }),
    onSuccess: async (r) => { onNotice(r.vote); await refresh(); },
  });
  const busy = withdraw.isPending || accept.isPending || decline.isPending || vote.isPending;
  const failed = vote.isError ? vote.error : null;
  const reasonText = p.reason === 'not_chosen' ? t('arms.reason.not_chosen')
    : p.reason === 'vote_removed' ? t('arms.reason.vote_removed')
      : p.reason ? t('arms.reason.text', { reason: p.reason }) : null;
  const shown = (p.status === 'waiting' || p.status === 'declined') && reasonText;

  return (
    <li className="ui-card ap-card" aria-labelledby={`${id}-n`}>
      <div className="ap-shields">
        <Arms arms={p.arms} size={88} title={t('arms.list.shield', { name: p.name, blazon: blazonV2(asV2(p.arms), t.locale) })} />
        {steward && (
          <span className="ap-now">
            <Arms arms={house.arms} size={44} title={t('arms.list.now_shield', { blazon: blazonV2(asV2(house.arms), t.locale) })} />
            <small aria-hidden>{t('arms.list.now')}</small>
          </span>
        )}
      </div>
      <div className="ap-main">
        <h3 className="ap-name" id={`${id}-n`}>{p.name}</h3>
        <p className="ap-meta subtle">
          <span className="chip ap-state" data-state={p.status}>{t(STATE[p.status])}</span>
          {p.author && <Proposer tree={tree} author={p.author} />}
          <When at={p.createdAt} />
        </p>
        {p.note && <p className="ap-note">{p.note}</p>}
        {shown && <p className="ap-reason">{reasonText}</p>}
        {(p.inVote || p.may.withdraw || p.may.accept || p.may.decline || p.may.putToVote) && (
          <div className="ap-actions">
            {p.inVote && <Link className="btn" to="/$tree/votes/$vote" params={{ tree, vote: p.inVote }}><Vote size={15} aria-hidden /> {t('arms.open_vote')}</Link>}
            {p.may.accept && <button type="button" className="btn primary" disabled={busy} aria-haspopup="dialog" onClick={() => { accept.reset(); setAsking('accept'); }}><Check size={15} aria-hidden /> {t('arms.accept')}</button>}
            {p.may.putToVote && <button type="button" className="btn" disabled={busy} onClick={() => vote.mutate()}><Vote size={15} aria-hidden /> {t('arms.put_to_vote')}</button>}
            {p.may.decline && <button type="button" className="btn ghost" disabled={busy} aria-haspopup="dialog" onClick={() => { decline.reset(); setAsking('decline'); }}><X size={15} aria-hidden /> {t('arms.decline')}</button>}
            {p.may.withdraw && <button type="button" className="btn ghost" disabled={busy} aria-haspopup="dialog" onClick={() => { withdraw.reset(); setAsking('withdraw'); }}><Undo2 size={15} aria-hidden /> {t('arms.withdraw')}</button>}
          </div>
        )}
        {failed && <p role="alert" className="ap-error">{errorText(failed, t.locale)}</p>}
      </div>
      {/* Accept changes the house's arms at once: the steward confirms it, as a Decline or a Withdraw. */}
      <ConfirmDialog
        open={asking === 'accept'} onClose={() => setAsking(null)} onConfirm={() => accept.mutate()} busy={accept.isPending}
        title={t('arms.accept_title', { name: p.name })} confirmLabel={t('arms.accept')}
        error={accept.isError ? errorText(accept.error, t.locale) : undefined}
      >
        <p>{t('arms.accept_text', { house: house.name })}</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={asking === 'withdraw'} onClose={() => setAsking(null)} onConfirm={() => withdraw.mutate()} busy={withdraw.isPending}
        title={t('arms.withdraw_title', { name: p.name })} confirmLabel={t('arms.withdraw')}
        error={withdraw.isError ? errorText(withdraw.error, t.locale) : undefined}
      >
        <p>{t('arms.withdraw_text')}</p>
      </ConfirmDialog>
      <Dialog
        open={asking === 'decline'} onClose={() => { if (!decline.isPending) setAsking(null); }} title={t('arms.decline_title', { name: p.name })}
        width="min(480px, 100vw - 24px)" dismissible={!decline.isPending} dirty={!!reason.trim()}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setAsking(null)} disabled={decline.isPending}>{t('common.cancel')}</button>
            <button type="submit" form={`${id}-decline`} className="btn danger" disabled={decline.isPending}>{t('arms.decline')}</button>
          </>
        }
      >
        <form id={`${id}-decline`} className="ap-decline" onSubmit={(e) => { e.preventDefault(); if (!decline.isPending) decline.mutate(); }}>
          <label className="ap-label" htmlFor={`${id}-r`}>{t('arms.decline_reason')}</label>
          <textarea id={`${id}-r`} className="input" rows={3} maxLength={MAX_DECLINE_REASON} value={reason} onChange={(e) => setReason(e.target.value)} aria-describedby={`${id}-rh`} />
          <p className="subtle ap-hint" id={`${id}-rh`}>{t('arms.decline_reason_hint')}</p>
          {decline.isError && <p role="alert" className="ap-error">{errorText(decline.error, t.locale)}</p>}
        </form>
      </Dialog>
    </li>
  );
}

/** Who proposed it: their face and name, as the feed shows a writer (a former member when the account is gone). */
function Proposer({ tree, author }: { tree: string; author: FeedAuthor }) {
  const t = useT();
  const f = useFamily();
  const person = author.person ? f.byId.get(author.person) : undefined;
  const name = author.name || (person ? displayName(person, f) : t('responses.former_member'));
  return (
    <span className="ap-by">
      {person ? <Portrait person={person} tree={tree} size={24} decorative /> : <span className="ap-initial" aria-hidden>{(name.trim()[0] ?? '·').toUpperCase()}</span>}
      {t('arms.list.by', { name })}
    </span>
  );
}
