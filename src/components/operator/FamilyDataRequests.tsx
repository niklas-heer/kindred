// On a family's Access page: the data requests that name this family (access to, correction or deletion of data about
// someone), sent through the server's operator (/privacy-request). Only those not done show, with the days left to answer;
// a steward who has answered marks one done. Nothing shows when there are none, as on a server run for one family.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Notice } from '~/components/ui';
import { errorText } from '~/lib/errortext';
import { useT } from '~/lib/i18n';
import { useSession } from '~/lib/session';
import { familyDataRequestsQuery, stewardDataRequestDone } from '~/lib/operator/operator.functions';
import { DataRequestCard } from './OperatorRequests';
import '~/components/families/families.css';
import './operator.css';

export function FamilyDataRequests({ tree }: { tree: string }) {
  const t = useT();
  const qc = useQueryClient();
  // A preview answers as the previewed reader, who may not read these: the steward's own view only.
  const previewing = !!useSession()?.viewAs;
  const { data } = useQuery({ ...familyDataRequestsQuery(tree), enabled: !previewing });
  const [error, setError] = useState<string | null>(null);
  const done = useMutation({
    mutationFn: (id: string) => stewardDataRequestDone({ data: { tree, id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['data-requests', tree] }),
    onError: (e) => setError(errorText(e, t.locale)),
  });
  const open = data?.filter((r) => r.status !== 'done') ?? [];
  if (!open.length) return null;
  return (
    <section aria-labelledby="acc-data-requests">
      <h2 id="acc-data-requests" className="rule">{t('operator.family_data_requests')} <small>{open.length}</small></h2>
      <p className="families-hint">{t('operator.family_data_hint')}</p>
      {error && <Notice onDismiss={() => setError(null)}>{error}</Notice>}
      <ul className="families-list">
        {open.map((r) => <DataRequestCard key={r.id} request={r} now={Date.now()} onDone={() => done.mutate(r.id)} />)}
      </ul>
    </section>
  );
}
