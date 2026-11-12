// The operator console's Updates tab (docs/hosting-many-families.md, "Updates"): the running version and commit, and whether
// a newer release exists, from a check the operator agrees to first (src/lib/operator/updates.server.ts). The notes of the
// releases in between come from GitHub and are untrusted: they go through the one safe Markdown renderer, images as text.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, ShieldAlert, Wrench } from 'lucide-react';
import { useState } from 'react';
import { ErrorState, Notice, Skeleton } from '~/components/ui';
import { errorText } from '~/lib/errortext';
import { formatDate, useT } from '~/lib/i18n';
import { renderMarkdown } from '~/lib/markdown';
import { operatorSetUpdateCheck, updateStatusQuery } from '~/lib/operator/insight.functions';
import type { ReleaseInfo, UpdateStatus } from '~/lib/operator/updates-shared';
import { releaseFlags, stripFlagMarkers } from '~/lib/operator/self-update-shared';
import { SelfUpdateSection } from './OperatorSelfUpdate';
import './operator.css';
import './ops.css';

export function UpdatesTab() {
  const t = useT();
  const { data, isPending, isError, refetch } = useQuery(updateStatusQuery);
  if (isPending) return <div aria-busy="true" aria-label={t('operator.loading')}><Skeleton lines={5} /></div>;
  if (isError) return <ErrorState title={t('operator.err_load')} onRetry={() => { void refetch(); }} />;
  return (
    <div className="operator-panel">
      <section aria-labelledby="ops-running" className="ops-section">
        <h2 id="ops-running" className="rule">{t('ops.running')}</h2>
        <dl className="operator-facts">
          <div className="operator-fact"><dt>{t('ops.version')}</dt><dd>{data.version ?? t('ops.unknown')}</dd></div>
          <div className="operator-fact"><dt>{t('ops.commit')}</dt><dd><code>{data.commit ?? t('ops.unknown')}</code></dd></div>
          <div className="operator-fact"><dt>{t('ops.repo')}</dt><dd><code>{data.repo}</code></dd></div>
        </dl>
        <p className="operator-inline">
          <a href={`https://github.com/${data.repo}/blob/main/CHANGELOG.md`} target="_blank" rel="noopener noreferrer">{t('ops.full_changelog')} <ExternalLink size={13} aria-hidden /></a>
          <a href={`https://github.com/${data.repo}/tree/main/migrations`} target="_blank" rel="noopener noreferrer">{t('ops.migrations')} <ExternalLink size={13} aria-hidden /></a>
        </p>
      </section>
      <section aria-labelledby="ops-check" className="ops-section">
        <h2 id="ops-check" className="rule">{t('ops.check')}</h2>
        <Check data={data} />
      </section>
      <SelfUpdateSection status={data} />
    </div>
  );
}

function Check({ data }: { data: UpdateStatus }) {
  const t = useT();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const set = useMutation({
    mutationFn: (on: boolean) => operatorSetUpdateCheck({ data: { on } }),
    onSuccess: async () => { setError(null); await qc.invalidateQueries({ queryKey: ['operator'] }); },
    onError: (e) => setError(errorText(e, t.locale)),
  });
  const err = error && <p role="alert" className="families-error">{error}</p>;
  if (data.envOff) return <p className="muted">{t('ops.check_env_off')}</p>;
  if (!data.enabled) {
    return (
      <div className="ui-card families-card ops-consent">
        <p>{t('ops.consent', { repo: data.repo })}</p>
        <p className="families-hint">{t(data.asked ? 'ops.consent_off' : 'ops.consent_hint')}</p>
        <div className="families-row">
          <button type="button" className="btn primary" disabled={set.isPending} onClick={() => set.mutate(true)}>{t('ops.consent_yes')}</button>
          {!data.asked && <button type="button" className="btn" disabled={set.isPending} onClick={() => set.mutate(false)}>{t('ops.consent_no')}</button>}
        </div>
        {err}
      </div>
    );
  }
  const when = data.checkedAt ? formatDate(data.checkedAt, t.locale, { dateStyle: 'long', timeStyle: 'short' }) : null;
  return (
    <div className="ops-check">
      {data.updateAvailable ? (
        <Notice icon={<ExternalLink size={15} aria-hidden />}>{t('ops.update_available', { latest: data.latest ?? '', version: data.version ?? '' })}</Notice>
      ) : data.error ? (
        <p role="status">{when ? t('ops.last_checked_failed', { date: when }) : t('ops.check_failed')} <span className="muted">({data.error})</span></p>
      ) : when ? (
        <p role="status">{data.version ? t('ops.up_to_date', { date: when }) : t('ops.last_checked', { date: when })}</p>
      ) : <p role="status" className="muted">{t('ops.not_checked')}</p>}
      {data.error && data.updateAvailable && when && <p className="families-hint">{t('ops.last_checked_failed', { date: when })}</p>}
      {data.newer.length > 0 && (
        <ol className="ops-releases">{data.newer.map((r) => <ReleaseNotes key={r.version} release={r} />)}</ol>
      )}
      <p className="families-hint">{t('ops.check_hint')}</p>
      <div className="families-row">
        <button type="button" className="btn ghost" disabled={set.isPending} onClick={() => set.mutate(false)}>{t('ops.check_turn_off')}</button>
      </div>
      {err}
    </div>
  );
}

function ReleaseNotes({ release: r }: { release: ReleaseInfo }) {
  const t = useT();
  // Kindred's own word on a release it knows, or the release notes' markers: a security fix, or a step by hand.
  const known = releaseFlags(r);
  const notes = stripFlagMarkers(r.notes);
  return (
    <li className="ui-card families-card ops-release">
      <h3>
        <a href={r.url} target="_blank" rel="noopener noreferrer nofollow">{r.name}</a>{' '}
        {r.date && <span className="muted">{formatDate(Date.parse(r.date), t.locale, { dateStyle: 'long' })}</span>}
      </h3>
      {(known.security || known.manual) && (
        <p className="operator-inline">
          {known.security && <span className="chip operator-chip"><ShieldAlert size={13} aria-hidden /> {t('ops.flag_security')}</span>}
          {known.manual && <span className="chip"><Wrench size={13} aria-hidden /> {t('ops.flag_manual')}</span>}
        </p>
      )}
      {notes.trim() && (
        <details>
          <summary>{t('ops.release_notes')}</summary>
          {/* GitHub's text is untrusted: renderMarkdown shows raw HTML as text, allows only http(s) and mailto links, loads no image. */}
          <div className="ops-notes" dangerouslySetInnerHTML={{ __html: renderMarkdown(notes, { images: 'text' }) }} />
        </details>
      )}
    </li>
  );
}
