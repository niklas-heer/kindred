// The operator console's Health tab (docs/hosting-many-families.md, "Health"): the daily jobs' last runs, families whose
// migration failed or that have not caught up, the automatic backups (each family's last good one, the key, the drills), the running version and the update check's last
// answer (src/lib/operator/health.server.ts). Read only, but for acknowledging an operator-funded AI overage, which resumes
// that family's and model's calls.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { ErrorState, Notice, Skeleton } from '~/components/ui';
import { formatDate, useT } from '~/lib/i18n';
import type { BackupHealth } from '~/lib/backup/shared';
import type { FamilySchema } from '~/lib/operator/health-shared';
import { formatBytes } from '~/lib/operator/shared';
import { healthQuery, operatorAcknowledgeOverage } from '~/lib/operator/self-update.functions';
import { DEFAULT_UPDATE_REPO } from '~/lib/operator/updates-shared';
import { EmailHealth } from '~/components/email/OperatorEmail';
import './operator.css';
import './ops.css';

export function HealthTab({ onWorkers }: { onWorkers: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const { data, isPending, isError, refetch } = useQuery(healthQuery);
  const acknowledge = useMutation({
    mutationFn: (p: { family: string; model: string }) => operatorAcknowledgeOverage({ data: p }),
    onSuccess: () => qc.invalidateQueries({ queryKey: healthQuery.queryKey }),
  });
  if (isPending) return <div aria-busy="true" aria-label={t('operator.loading')}><Skeleton lines={6} /></div>;
  if (isError) return <ErrorState title={t('operator.err_load')} onRetry={() => { void refetch(); }} />;
  const when = (ms: number) => formatDate(ms, t.locale, { dateStyle: 'long', timeStyle: 'short' });
  const f = data.families;
  const usd = (micros: number) => new Intl.NumberFormat(t.locale, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(micros / 1_000_000);
  const backupDocs = `https://github.com/${DEFAULT_UPDATE_REPO}/blob/main/docs/${onWorkers ? 'deploy-cloudflare.md#backups' : 'self-host.md#backups'}`;
  return (
    <div className="operator-panel">
      <p className="families-hint">{t('update.health_hint')}</p>

      <section aria-labelledby="health-running" className="ops-section">
        <h2 id="health-running" className="rule">{t('update.health_running')}</h2>
        <dl className="operator-facts">
          <div className="operator-fact"><dt>{t('ops.version')}</dt><dd>{data.version ?? t('ops.unknown')}</dd></div>
          <div className="operator-fact"><dt>{t('ops.commit')}</dt><dd><code>{data.commit ?? t('ops.unknown')}</code></dd></div>
        </dl>
      </section>

      <section aria-labelledby="health-jobs" className="ops-section">
        <h2 id="health-jobs" className="rule">{t('update.health_jobs')}</h2>
        <p role="status">{data.lastDailyRun ? t('update.health_last_run', { date: when(data.lastDailyRun) }) : t('update.health_never')}</p>
        {data.jobs.length > 0 && (
          <ul className="ops-list">
            {data.jobs.map((j) => (
              <li key={j.job}>
                <code>{j.job}</code>{' '}
                {j.ok ? <span>{t('update.health_job_ok', { date: when(j.finishedAt) })}</span> : (
                  <>
                    <span className="families-error"><AlertTriangle size={13} aria-hidden /> {t('update.health_job_failed', { date: when(j.finishedAt) })}</span>
                    {(j.code || j.error) && <> <span className="muted">({j.code && <code>{j.code}</code>}{j.code && j.error && ': '}{j.error})</span></>}{' '}
                    <span className="muted">{j.lastOkAt ? t('update.health_job_last_ok', { date: when(j.lastOkAt) }) : t('update.health_job_never_ok')}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.aiOverage && (
        <section aria-labelledby="health-ai" className="ops-section">
          <h2 id="health-ai" className="rule">{t('update.health_ai')}</h2>
          {data.aiOverage.calls > 0 && (
            <Notice icon={<AlertTriangle size={15} aria-hidden />}>
              {t('update.health_ai_overage', { count: data.aiOverage.calls, amount: usd(data.aiOverage.micros) })}
            </Notice>
          )}
          {data.aiOverage.paused.length > 0 && (
            <ul className="ops-list">
              {data.aiOverage.paused.map((p) => (
                <li key={`${p.family} ${p.model}`}>
                  <span className="families-error"><AlertTriangle size={13} aria-hidden /> {t('update.health_ai_paused', { count: p.calls, family: p.family, model: p.model, amount: usd(p.micros), date: when(p.since) })}</span>{' '}
                  <button type="button" className="btn" disabled={acknowledge.isPending} onClick={() => acknowledge.mutate({ family: p.family, model: p.model })}>
                    {t('update.health_ai_acknowledge')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section aria-labelledby="health-families" className="ops-section">
        <h2 id="health-families" className="rule">{t('update.health_families')}</h2>
        {f.newest && <p className="families-hint">{t('update.health_newest', { migration: f.newest })}</p>}
        {f.failed.count > 0 && (
          <>
            <Notice icon={<AlertTriangle size={15} aria-hidden />}>{t('update.health_failed', { count: f.failed.count })}</Notice>
            <Families list={f.failed.list} showError />
          </>
        )}
        {f.behind.count > 0 && (
          <>
            <p>{t('update.health_behind', { count: f.behind.count })}</p>
            <Families list={f.behind.list} />
          </>
        )}
        {f.failed.count === 0 && f.behind.count === 0 && f.total - f.unreported > 0 && <p>{t('update.health_families_ok', { count: f.total - f.unreported })}</p>}
        {f.unreported > 0 && <p className="families-hint">{t('update.health_unreported', { count: f.unreported })}</p>}
      </section>

      <section aria-labelledby="health-backup" className="ops-section">
        <h2 id="health-backup" className="rule">{t('update.health_backup')}</h2>
        <BackupHealthView b={data.backups} when={when} />
        {data.backup.configured && (data.backup.failing ? <p className="families-error">{t('update.health_backup_failing')}</p>
          : <p>{data.backup.lastOkAt ? t('update.health_backup_age', { date: when(data.backup.lastOkAt) }) : t('update.health_backup_never')}</p>)}
        {data.backup.configured && data.backup.failing && data.backup.lastOkAt && <p className="muted">{t('update.health_backup_age', { date: when(data.backup.lastOkAt) })}</p>}
        <p><a href={backupDocs} target="_blank" rel="noopener noreferrer">{t('update.health_backup_docs')} <ExternalLink size={13} aria-hidden /></a></p>
      </section>

      <section aria-labelledby="health-check" className="ops-section">
        <h2 id="health-check" className="rule">{t('update.health_check')}</h2>
        <p>
          {!data.check.enabled ? t('update.health_check_off')
            : !data.check.checkedAt ? t('update.health_check_never')
            : data.check.error ? t('update.health_check_failed', { date: when(data.check.checkedAt), error: data.check.error })
            : data.check.latest ? t('update.health_check_ok', { date: when(data.check.checkedAt), latest: data.check.latest })
            : t('update.health_check_none', { date: when(data.check.checkedAt) })}
        </p>
        {data.check.updateAvailable && <p>{t('update.health_update')}</p>}
      </section>
      <EmailHealth />
    </div>
  );
}

/** The automatic backups (src/lib/backup/): the key, the totals, each family's last good backup, the drills, recovery points. */
function BackupHealthView({ b, when }: { b: BackupHealth; when: (ms: number) => string }) {
  const t = useT();
  const name = (scope: string) => (scope === '_accounts' ? t('backup.accounts') : scope);
  return (
    <>
      {b.key.source === 'none' ? <Notice icon={<AlertTriangle size={15} aria-hidden />}>{t('backup.key_none')}</Notice>
        : <p>{t(b.key.source === 'own' ? 'backup.key_own' : 'backup.key_secret')}</p>}
      {b.key.besideBackups && <p className="operator-warning" role="note">{t('backup.key_beside')}</p>}
      {b.key.other > 0 && <p className="operator-warning" role="note">{t('backup.key_other', { count: b.key.other })}</p>}
      <p>{t('backup.health_total', { count: b.total.count, size: formatBytes(b.total.bytes, t.locale) })}</p>
      {b.covered > 0 && (b.stale > 0 ? (
        <>
          <Notice icon={<AlertTriangle size={15} aria-hidden />}>{t('backup.health_stale', { count: b.stale })}</Notice>
          <ul className="ops-list">
            {b.families.filter((f) => f.stale).map((f) => (
              <li key={f.scope}>
                <code>{name(f.scope)}</code>{' '}
                <span className="muted">{f.lastOkAt ? t('backup.last_ok', { date: when(f.lastOkAt) }) : t('backup.never')}</span>
                {f.error && <> <span className="families-error">({f.error})</span></>}
              </li>
            ))}
          </ul>
        </>
      ) : <p>{t('backup.health_ok', { count: b.covered })}</p>)}
      {b.d1.length > 0 && <p className="families-hint">{t('backup.health_d1', { list: b.d1.map(name).join(', ') })}</p>}
      {b.drills.length ? (
        <ul className="ops-list">
          {b.drills.map((d) => (
            <li key={d.scope}>
              <code>{name(d.scope)}</code>{' '}
              <span className={d.ok ? 'muted' : 'families-error'}>{d.ok ? t('backup.drill_ok', { date: when(d.at) }) : t('backup.drill_failed', { date: when(d.at), problem: d.problem ?? '' })}</span>
            </li>
          ))}
        </ul>
      ) : b.covered > 0 && <p className="families-hint">{t('backup.health_no_drill')}</p>}
      {b.recovery > 0 && <p className="families-hint">{t('backup.health_recovery', { count: b.recovery })}</p>}
      {b.gone > 0 && <p className="families-hint">{t('backup.health_gone', { count: b.gone })}</p>}
    </>
  );
}

function Families({ list, showError = false }: { list: FamilySchema[]; showError?: boolean }) {
  return (
    <ul className="ops-list">
      {list.map((s) => (
        <li key={s.tree}>
          <code>{s.tree}</code>{s.migration && <> <span className="muted">{s.migration}</span></>}
          {showError && s.error && <> <span className="muted">({s.error})</span></>}
        </li>
      ))}
    </ul>
  );
}
