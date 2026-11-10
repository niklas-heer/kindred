// The opt-in push to an author, in the Reminders dialog: "tell me when someone reacts to or comments on what I wrote or
// shared". It is the member's choice for this family (all their devices with reminders on), saved at once, off by default.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId } from 'react';
import { Switch } from '~/components/ui/Switch';
import { useT } from '~/lib/i18n';
import { responsePushQuery, setResponsePush } from '~/lib/responses.functions';

export function ResponsePushSwitch({ tree, disabled }: { tree: string; disabled?: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const help = useId();
  const q = useQuery(responsePushQuery(tree));
  const save = useMutation({
    mutationFn: (on: boolean) => setResponsePush({ data: { tree, on } }),
    onSuccess: (r) => qc.setQueryData(responsePushQuery(tree).queryKey, r),
  });
  const on = save.isPending ? !!save.variables : !!q.data?.on;
  return (
    <fieldset className="reminders-choices">
      <legend>{t('responses.push.legend')}</legend>
      <Switch checked={on} onChange={(v) => save.mutate(v)} disabled={disabled || !q.data || save.isPending} aria-describedby={help}>
        {t('responses.push.switch')}
      </Switch>
      <p id={help} className="acct-help subtle">{t('responses.push.help')}</p>
      {save.isError ? <p className="acct-error" role="alert">{t('responses.push.failed')}</p> : null}
    </fieldset>
  );
}
