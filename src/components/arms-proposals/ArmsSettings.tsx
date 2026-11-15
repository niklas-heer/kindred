// The family's setting for arms proposals (docs/arms-proposals.md), on the Houses page for stewards: how proposals are
// settled (a steward decides, always a vote, or a steward chooses each time) and whether guests may vote on arms. Each
// change saves at once, except a switch to "Always a vote" while proposals wait, which the steward confirms first (they
// would go to a vote); the server checks the role again.
//
//   {canEdit && <ArmsSettings tree={tree} />}
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { ConfirmDialog, Switch } from '~/components/ui';
import { opKeys } from '~/lib/api';
import { armsSettingsQuery, proposalCountsQuery, setArmsSettings } from '~/lib/arms-proposals/proposals.functions';
import type { ArmsMode } from '~/lib/arms-proposals/types';
import { errorText } from '~/lib/errortext';
import { useT, type Key } from '~/lib/i18n';
import './proposals.css';

const MODES: { mode: ArmsMode; label: Key; hint: Key }[] = [
  { mode: 'steward', label: 'arms.mode.steward', hint: 'arms.mode.steward_hint' },
  { mode: 'vote', label: 'arms.mode.vote', hint: 'arms.mode.vote_hint' },
  { mode: 'choose', label: 'arms.mode.choose', hint: 'arms.mode.choose_hint' },
];

type Settings = { mode: ArmsMode; guests: boolean };

export function ArmsSettings({ tree }: { tree: string }) {
  const t = useT();
  const id = useId();
  const qc = useQueryClient();
  const [keys] = useState(opKeys);
  const q = useQuery(armsSettingsQuery(tree));
  // How many proposals wait across the houses: switching to "Always a vote" would put them to votes, so it asks first.
  const waiting = Object.values(useQuery(proposalCountsQuery(tree)).data ?? {}).reduce((sum, n) => sum + n, 0);
  const [confirming, setConfirming] = useState(false);
  // The choice shows at once; a refusal puts back what the server has.
  const [chosen, setChosen] = useState<Settings | null>(null);
  const save = useMutation({
    mutationFn: (s: Settings) => setArmsSettings({ data: { tree, ...s, opKey: keys.for('arms-settings', s) } }),
    onSuccess: async (_, s) => {
      keys.clear();
      qc.setQueryData(armsSettingsQuery(tree).queryKey, s);
      // The server's answer shows from here on, so a later read (another steward's change) is not hidden behind it.
      setChosen(null);
      // What a steward may do with a waiting proposal follows the mode.
      await qc.invalidateQueries({ queryKey: ['arms-proposals', tree] });
    },
    onError: () => setChosen(null),
  });
  const now = chosen ?? q.data;
  if (!now) return null;
  const change = (s: Partial<Settings>) => {
    const next = { ...now, ...s };
    setChosen(next);
    save.mutate(next);
  };
  const choose = (mode: ArmsMode) => {
    if (mode === 'vote' && now.mode !== 'vote' && waiting > 0) setConfirming(true);
    else change({ mode });
  };

  return (
    <section className="hp-section ap-settings" aria-labelledby={`${id}-h`}>
      <h2 className="rule" id={`${id}-h`}>{t('arms.settings.heading')}</h2>
      <div className="ui-card ap-settings-card">
        <p className="ap-hint">{t('arms.settings.intro')}</p>
        <fieldset className="ap-modes" disabled={save.isPending}>
          <legend className="ap-label">{t('arms.settings.mode')}</legend>
          {MODES.map((m) => (
            <label key={m.mode} className="ap-mode" data-chosen={now.mode === m.mode || undefined}>
              <input type="radio" name={`${id}-mode`} value={m.mode} checked={now.mode === m.mode} onChange={() => choose(m.mode)} aria-describedby={`${id}-${m.mode}`} />
              <span>
                <b>{t(m.label)}</b>
                <small className="subtle" id={`${id}-${m.mode}`}>{t(m.hint)}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="ap-guests">
          <Switch checked={now.guests} disabled={save.isPending} onChange={(guests) => change({ guests })} aria-describedby={`${id}-g`}>{t('arms.settings.guests')}</Switch>
          <p className="subtle ap-hint" id={`${id}-g`}>{t('arms.settings.guests_hint')}</p>
        </div>
        <span role="status" className="ap-saved">{save.isSuccess ? t('arms.settings.saved') : ''}</span>
        {save.isError && <p role="alert" className="ap-error">{errorText(save.error, t.locale)}</p>}
      </div>
      <ConfirmDialog
        open={confirming} onClose={() => setConfirming(false)} onConfirm={() => { setConfirming(false); change({ mode: 'vote' }); }}
        title={t('arms.settings.vote_confirm_title')} confirmLabel={t('arms.mode.vote')}
      >
        <p>{t('arms.settings.vote_confirm_text', { count: waiting })}</p>
      </ConfirmDialog>
    </section>
  );
}
