// The small "New in Kindred 2.x" card after an upgrade (src/lib/releases/releases.server.ts): once per minor version, for
// accounts made before this server ran it. The server says whether to show it and refuses it in a demo and in "View as";
// the card also waits while a tour runs. Dismissing it, or following its link, keeps it away.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Sparkles, X } from 'lucide-react';
import { useTourRun } from '~/components/tour/store';
import { useT } from '~/lib/i18n';
import { minorOf } from '~/lib/releases';
import { dismissReleaseCard, releaseCardQuery } from '~/lib/releases/releases.functions';
import { useMember, useSession } from '~/lib/session';
import './releases.css';

export function ReleaseCard() {
  const t = useT();
  const qc = useQueryClient();
  const session = useSession();
  const member = useMember();
  const tour = useTourRun();
  const enabled = !!member && !session?.demo && !session?.viewAs;
  const { data } = useQuery({ ...releaseCardQuery, enabled });
  const dismiss = useMutation({
    mutationFn: (version: string) => dismissReleaseCard({ data: { version } }),
    onMutate: () => qc.setQueryData(releaseCardQuery.queryKey, null),
  });
  if (!enabled || !data || tour) return null;
  return (
    <aside className="release-card ui-card" aria-labelledby="release-card-h">
      <Sparkles size={18} aria-hidden className="release-card-icon" />
      <div>
        <p id="release-card-h" className="release-card-title">{t('ops.card_title', { version: minorOf(data.version) })}</p>
        <Link to="/whats-new" onClick={() => dismiss.mutate(data.version)}>{t('ops.card_link')}</Link>
      </div>
      <button type="button" className="btn ghost icon" aria-label={t('ops.card_dismiss')} title={t('ops.card_dismiss')} onClick={() => dismiss.mutate(data.version)}>
        <X size={16} aria-hidden />
      </button>
    </aside>
  );
}
