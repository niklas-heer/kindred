// What a member may do to a vote besides voting, as the server's `may` says (docs/votes.md): add an option where the vote
// allows it; change the closing time of their own open vote; close it early (the creator, or an editor); remove it. A
// retried request never does any of it twice.
//
//   <VoteActions tree={tree} view={vote} onRemoved={back} />
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Lock, Plus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { ConfirmDialog } from '~/components/ui';
import { opKeys } from '~/lib/api';
import { armsKeys } from '~/lib/arms-proposals/proposals.functions';
import { errorText } from '~/lib/errortext';
import { useT } from '~/lib/i18n';
import { MAX_CLOSE_DAYS, MAX_OPTION, MIN_CLOSE_MS, type VoteView } from '~/lib/votes/types';
import { addVoteOption, changeVote, deleteVote, endVote } from '~/lib/votes/votes.functions';
import { fromLocalInput, toLocalInput } from './VoteComposer';

const DAY = 86_400_000;

export function VoteActions({ tree, view, onRemoved }: { tree: string; view: VoteView; onRemoved: () => void }) {
  const t = useT();
  const id = useId();
  const qc = useQueryClient();
  const [keys] = useState(opKeys);
  const [label, setLabel] = useState('');
  const [closing, setClosing] = useState<string | null>(null);
  const [asking, setAsking] = useState<'close' | 'remove' | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['votes', tree] });

  const add = useMutation({
    mutationFn: () => {
      const data = { tree, id: view.id, label: label.trim() };
      return addVoteOption({ data: { ...data, opKey: keys.for('add', data) } });
    },
    onSuccess: async () => { keys.clear('add'); setLabel(''); await refresh(); },
  });
  const reschedule = useMutation({
    mutationFn: (closesAt: string) => {
      const data = { tree, id: view.id, vote: { closesAt } };
      return changeVote({ data: { ...data, opKey: keys.for('closing', data) } });
    },
    onSuccess: async () => { keys.clear('closing'); setClosing(null); await refresh(); },
  });
  const close = useMutation({
    mutationFn: () => endVote({ data: { tree, id: view.id, opKey: keys.for('close', view.id) } }),
    onSuccess: async () => {
      setAsking(null);
      // Closing a house's arms vote settles it: the house may bear new arms, and its proposals move on.
      await Promise.all(view.options.some((o) => o.arms) ? armsKeys(tree).map((queryKey) => qc.invalidateQueries({ queryKey })) : [refresh()]);
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteVote({ data: { tree, id: view.id, opKey: keys.for('remove', view.id) } }),
    onSuccess: async () => {
      setAsking(null);
      qc.removeQueries({ queryKey: ['votes', tree, view.id] });
      await qc.invalidateQueries({ queryKey: ['votes', tree], exact: true });
      // A house's arms vote that goes sends its proposals back to wait.
      if (view.options.some((o) => o.arms)) void qc.invalidateQueries({ queryKey: ['arms-proposals', tree] });
      onRemoved();
    },
  });

  const { may } = view;
  if (!may.addOption && !may.edit && !may.close && !may.remove) return null;
  const created = Date.parse(view.createdAt);
  const at = closing === null ? NaN : fromLocalInput(closing);

  return (
    <div className="vt-manage">
      {may.addOption && (
        <form className="vt-inline" onSubmit={(e) => { e.preventDefault(); if (label.trim() && !add.isPending) add.mutate(); }}>
          <input className="input" type="text" maxLength={MAX_OPTION} value={label} onChange={(e) => setLabel(e.target.value)} aria-label={t('votes.add_option_label')} placeholder={t('votes.add_option_label')} />
          <button type="submit" className="btn" disabled={!label.trim() || add.isPending}><Plus size={15} aria-hidden /> {t('votes.add')}</button>
          {add.isError && <p role="alert" className="vt-note vt-error">{errorText(add.error, t.locale)}</p>}
        </form>
      )}
      {may.edit && closing !== null && (
        <form className="vt-inline" onSubmit={(e) => { e.preventDefault(); if (Number.isFinite(at) && !reschedule.isPending) reschedule.mutate(new Date(at).toISOString()); }}>
          <label className="vt-label" htmlFor={`${id}-c`}>{t('votes.compose.closes')}</label>
          <input
            id={`${id}-c`} className="input vt-when" type="datetime-local" required value={closing} onChange={(e) => setClosing(e.target.value)}
            min={toLocalInput(Date.now() + MIN_CLOSE_MS)} max={toLocalInput(created + MAX_CLOSE_DAYS * DAY)}
          />
          <button type="submit" className="btn primary" disabled={!Number.isFinite(at) || reschedule.isPending}>{t('votes.save')}</button>
          <button type="button" className="btn ghost" onClick={() => setClosing(null)}>{t('common.cancel')}</button>
          {reschedule.isError && <p role="alert" className="vt-note vt-error">{errorText(reschedule.error, t.locale)}</p>}
        </form>
      )}
      <div className="vt-actions">
        {may.edit && closing === null && (
          <button type="button" className="btn" onClick={() => setClosing(toLocalInput(Date.parse(view.closesAt)))}><CalendarClock size={15} aria-hidden /> {t('votes.change_closing')}</button>
        )}
        {may.close && <button type="button" className="btn" onClick={() => setAsking('close')}><Lock size={15} aria-hidden /> {t('votes.close_now')}</button>}
        {may.remove && <button type="button" className="btn ghost" onClick={() => setAsking('remove')}><Trash2 size={15} aria-hidden /> {t('votes.remove')}</button>}
      </div>
      <ConfirmDialog
        open={asking === 'close'} onClose={() => setAsking(null)} onConfirm={() => close.mutate()} busy={close.isPending}
        title={t('votes.close_title')} confirmLabel={t('votes.close_now')} error={close.isError ? errorText(close.error, t.locale) : undefined}
      >
        <p>{t('votes.close_text')}</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={asking === 'remove'} onClose={() => setAsking(null)} onConfirm={() => remove.mutate()} busy={remove.isPending}
        title={t('votes.remove_title')} confirmLabel={t('votes.remove')} error={remove.isError ? errorText(remove.error, t.locale) : undefined}
      >
        <p>{t('votes.remove_text')}</p>
      </ConfirmDialog>
    </div>
  );
}
