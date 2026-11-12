// The operator's word on this family's AI, at the top of the AI settings (stewards only): a feature the operator locked, with
// one sentence and their contact, and the choice to use the server's own AI when the operator offers it
// (docs/hosting-many-families.md, "Policies"; docs/ai.md, "Operator-funded AI").
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Server } from 'lucide-react';
import { PolicyLockNote } from '~/components/operator/PolicyLock';
import { Switch } from '~/components/ui';
import { errorText } from '~/lib/errortext';
import { useT } from '~/lib/i18n';
import { setAiFunding } from '~/lib/operator/policy.functions';
import type { FamilyPolicies } from '~/lib/operator/policy';

export function AiPolicy({ tree, policy }: { tree: string; policy: FamilyPolicies }) {
  const t = useT();
  const qc = useQueryClient();
  const usd = (micros: number) => new Intl.NumberFormat(t.locale, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(micros / 1_000_000);
  const funding = useMutation({
    mutationFn: (on: boolean) => setAiFunding({ data: { tree, operator: on } }),
    onSettled: () => Promise.all([['ai-settings', tree], ['ai-status', tree]].map((queryKey) => qc.invalidateQueries({ queryKey }))),
  });
  const assistant = policy.features['feature.assistant'];
  const portraits = policy.features['feature.portraits'];
  const ai = policy.ai;
  const offered = !ai.lock.locked && (ai.offered === 'operator' || ai.offered === 'either');
  if (!assistant.locked && !portraits.locked && !ai.lock.locked && !offered) return null;
  const on = funding.isPending ? !!funding.variables : ai.opted;
  return (
    <section className="ui-card ai-step ai-policy" aria-labelledby="ai-policy-h">
      <h2 id="ai-policy-h" className="rule ai-step-title"><Server size={16} aria-hidden /> {t('policy.funding_title')}</h2>
      {(assistant.locked || ai.lock.locked) && <PolicyLockNote reason={assistant.locked ? assistant.reason : ai.lock.reason} />}
      {!assistant.locked && !ai.lock.locked && portraits.locked && (
        <div><b>{t('policy.key_portraits')}</b><PolicyLockNote reason={portraits.reason} /></div>
      )}
      {offered && !assistant.locked && (
        <>
          <p>{t('policy.funding_offer', { budget: usd(ai.budgetMicros) })}</p>
          {ai.offered === 'operator' && !ai.opted && <p className="subtle">{t('policy.funding_required')}</p>}
          <Switch checked={on} onChange={(next) => funding.mutate(next)} disabled={funding.isPending}>{t('policy.funding_switch')}</Switch>
          {ai.source === 'operator' && (
            <>
              <p className="ai-card-state ok" role="status">{t('policy.funding_on', { spent: usd(ai.spentMicros), budget: usd(ai.budgetMicros) })}</p>
              <p className="subtle">{t('policy.funding_routes')}</p>
            </>
          )}
          {funding.isError && <p role="alert" className="ai-card-error">{errorText(funding.error, t.locale)}</p>}
        </>
      )}
    </section>
  );
}
