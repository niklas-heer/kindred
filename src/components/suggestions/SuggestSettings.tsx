// The family's switches for suggestions from share-link guests (docs/suggestions.md), on the Access page beside the share
// link, for stewards: "Guests may suggest" and "Guests may attach files", both on by default. Each change saves at once; a
// refusal puts back what the server has. The server checks the role again (`manage-access`).
//
//   {steward && <SuggestSettings tree={tree} />}
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Switch } from '~/components/ui';
import { opKeys } from '~/lib/api';
import { errorText } from '~/lib/errortext';
import { useT } from '~/lib/i18n';
import { setSuggestSettings, suggestionKeys, suggestSettingsQuery } from '~/lib/suggestions/suggestions.functions';
import './suggestions.css';

type Settings = { guests: boolean; guestFiles: boolean };

export function SuggestSettings({ tree }: { tree: string }) {
  const t = useT();
  const id = useId();
  const qc = useQueryClient();
  const [keys] = useState(opKeys);
  const q = useQuery(suggestSettingsQuery(tree));
  // The choice shows at once; a refusal puts back what the server has.
  const [chosen, setChosen] = useState<Settings | null>(null);
  const save = useMutation({
    mutationFn: (s: Settings) => setSuggestSettings({ data: { tree, ...s, opKey: keys.for('suggest-settings', s) } }),
    onSuccess: async (_, s) => {
      keys.clear();
      qc.setQueryData(suggestSettingsQuery(tree).queryKey, s);
      setChosen(null);
      await Promise.all(suggestionKeys(tree).map((queryKey) => qc.invalidateQueries({ queryKey })));
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
  return (
    <section className="ui-card sg-settings" aria-labelledby={`${id}-h`}>
      <h2 className="rule" id={`${id}-h`}>{t('suggest.settings.heading')}</h2>
      <p className="acc-hint">{t('suggest.settings.intro')}</p>
      <div className="sg-switch">
        <Switch checked={now.guests} disabled={save.isPending} onChange={(guests) => change({ guests })} aria-describedby={`${id}-g`}>{t('suggest.settings.guests')}</Switch>
        <p className="acc-hint" id={`${id}-g`}>{t('suggest.settings.guests_hint')}</p>
      </div>
      <div className="sg-switch">
        <Switch checked={now.guestFiles} disabled={save.isPending || !now.guests} onChange={(guestFiles) => change({ guestFiles })} aria-describedby={`${id}-f`}>{t('suggest.settings.guest_files')}</Switch>
        <p className="acc-hint" id={`${id}-f`}>{t('suggest.settings.guest_files_hint')}</p>
      </div>
      <span role="status" className="sg-saved">{save.isSuccess ? t('suggest.settings.saved') : ''}</span>
      {save.isError && <p role="alert" className="err">{errorText(save.error, t.locale)}</p>}
    </section>
  );
}
