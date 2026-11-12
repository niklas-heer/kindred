// What a family's members see of the lifecycle of quiet families (src/lib/lifecycle/, docs/hosting-many-families.md "Lifecycle").
//   LifecycleWarning  its stewards, once the family has been quiet for the warning's months: a notice fixed to the bottom of the
//                     page (as the breach notice, so it takes no row of the layout), which a steward may hide for 30 days.
//   LifecycleBar      every member, while the lifecycle has made the family read-only: why and since when, inside the
//                     suspended bar (SuspendedBar.tsx), with one button for a steward to turn it back on and the downloads.
// Never for a guest, a preview or a demo: the server answers null for a guest, and a preview or a demo writes nothing.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Hourglass, Power, X } from 'lucide-react';
import { useState } from 'react';
import { errorText } from '~/lib/errortext';
import { formatDate, useT } from '~/lib/i18n';
import { dismissLifecycleWarning, familyLifecycleQuery, reactivateFamily } from '~/lib/lifecycle/lifecycle.functions';
import type { FamilyLifecycle } from '~/lib/lifecycle/shared';
import { useMember, useSession } from '~/lib/session';
import './lifecycle.css';

/** The downloads a steward takes before a deletion: the archive, GEDCOM and the backup. */
function Copies({ tree }: { tree: string }) {
  const t = useT();
  return (
    <span className="lifecycle-copies">
      <span>{t('lifecycle.copy_link')}:</span>
      <a href={`/api/export/${tree}?format=markdown`} download><Download size={13} aria-hidden /> {t('families.export_markdown')}</a>
      <a href={`/api/export/${tree}?format=gedcom`} download><Download size={13} aria-hidden /> {t('families.export_gedcom')}</a>
      <a href={`/api/backup/${tree}`} download><Download size={13} aria-hidden /> {t('lifecycle.backup')}</a>
    </span>
  );
}

export function LifecycleWarning({ tree }: { tree: string }) {
  const t = useT();
  const qc = useQueryClient();
  const m = useMember(tree);
  const session = useSession();
  const enabled = m?.role === 'steward' && !session?.viewAs && !session?.demo;
  const { data } = useQuery({ ...familyLifecycleQuery(tree), enabled });
  const [hidden, setHidden] = useState(false);
  const dismiss = useMutation({
    mutationFn: () => dismissLifecycleWarning({ data: { tree } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: familyLifecycleQuery(tree).queryKey }),
  });
  if (!enabled || !data || data.stage !== 'warned' || hidden || (data.dismissedUntil && data.dismissedUntil > Date.now())) return null;
  return (
    <div className="lifecycle-notice" role="region" aria-label={t('lifecycle.warning_label')}>
      <Hourglass size={18} aria-hidden />
      <div>
        <b>{t('lifecycle.warning_title', { count: data.months.warn })}</b>
        <p>{t('lifecycle.warning_text', { readOnlyAt: formatDate(data.readOnlyAt, t.locale), deleteAt: formatDate(data.deleteAt, t.locale) })}</p>
        <Copies tree={tree} />
      </div>
      <button type="button" className="btn ghost icon" title={t('lifecycle.dismiss')} aria-label={t('lifecycle.dismiss')}
        onClick={() => { setHidden(true); dismiss.mutate(); }}><X size={16} /></button>
    </div>
  );
}

/** Inside the suspended bar, in place of the operator's wording, while the suspension is the lifecycle's. */
export function LifecycleBar({ tree, data }: { tree: string; data: FamilyLifecycle }) {
  const t = useT();
  const qc = useQueryClient();
  const session = useSession();
  const [error, setError] = useState<string | null>(null);
  const reactivate = useMutation({
    mutationFn: () => reactivateFamily({ data: { tree } }),
    // The session says the family is suspended (the bar, read-only), so it is read again, as are the family's own queries.
    onSuccess: () => qc.invalidateQueries(),
    onError: (e) => setError(errorText(e, t.locale)),
  });
  const steward = data.steward && !session?.viewAs && !session?.demo;
  return (
    <div className="lifecycle-bar">
      <p>
        {t('lifecycle.readonly_text', { date: formatDate(data.readOnlyAt, t.locale), count: data.months.readOnly })}
        {data.stage === 'due' && <> {t(data.autoDelete ? 'lifecycle.due_auto_text' : 'lifecycle.due_text', { date: formatDate(data.deleteAt, t.locale) })}</>}
      </p>
      {steward && (
        <div className="lifecycle-actions">
          <button type="button" className="btn" onClick={() => reactivate.mutate()} disabled={reactivate.isPending}>
            <Power size={14} aria-hidden /> {reactivate.isPending ? t('lifecycle.reactivating') : t('lifecycle.reactivate')}
          </button>
          <Copies tree={tree} />
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

/** The lifecycle's read-only state of `tree` for the suspended bar, or undefined (an operator's suspension, or a guest). */
export function useLifecycleReadOnly(tree: string | undefined): FamilyLifecycle | undefined {
  const m = useMember(tree);
  const { data } = useQuery({ ...familyLifecycleQuery(tree ?? ''), enabled: !!tree && !!m });
  return data?.readOnly ? data : undefined;
}
