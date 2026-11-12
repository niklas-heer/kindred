// The console's Lifecycle section, in the Families tab (docs/hosting-many-families.md, "Lifecycle"): the settings, what the daily
// run would do now (a dry run, also while it is off, so the operator sees it before turning it on), the last run, and the
// families in the lifecycle by stage with their dates. A family due for deletion is deleted here, with its id typed and a passkey,
// unless the operator chose automatic deletion.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Dialog, Notice, Segmented, Skeleton } from '~/components/ui';
import { Switch } from '~/components/ui/Switch';
import { withFreshProof } from '~/lib/auth/client';
import { errorText } from '~/lib/errortext';
import { formatDate, relativeTime, useT, type Key } from '~/lib/i18n';
import { lifecycleConsoleQuery, operatorDeleteDue, operatorSaveLifecycle, type LifecycleConsole } from '~/lib/lifecycle/lifecycle.functions';
import { LIFECYCLE_MONTHS_MAX, validSettings, type LifecycleFamily, type LifecycleReport, type LifecycleSettings, type LifecycleStep } from '~/lib/lifecycle/shared';
import './lifecycle.css';

const STEP_KEY: Record<LifecycleStep, Key> = {
  warn: 'lifecycle.step_warn', clear: 'lifecycle.step_clear', readonly: 'lifecycle.step_readonly', due: 'lifecycle.step_due',
  'final-notice': 'lifecycle.step_final_notice', delete: 'lifecycle.step_delete',
};

export function LifecycleSection() {
  const t = useT();
  const { data, isPending, isError, error } = useQuery(lifecycleConsoleQuery);
  return (
    <section aria-labelledby="operator-lifecycle">
      <h2 id="operator-lifecycle" className="rule">
        {t('lifecycle.title')} {data && <span className="chip operator-chip">{t(data.settings.on ? 'lifecycle.state_on' : 'lifecycle.state_off')}</span>}
      </h2>
      <p className="families-hint">{t('lifecycle.intro')}</p>
      {isPending ? <Skeleton lines={3} /> : isError ? <p role="alert" className="families-error">{errorText(error, t.locale)}</p> : (
        <>
          <div className="ui-card families-card"><Settings settings={data.settings} /></div>
          <div className="ui-card families-card"><Report title={t('lifecycle.dry_title')} hint={t('lifecycle.dry_hint')} report={data.dryRun} /></div>
          {data.last && <div className="ui-card families-card"><Report title={t('lifecycle.last_run', { date: formatDate(data.last.at, t.locale) })} report={data.last} /></div>}
          <Families data={data} />
        </>
      )}
    </section>
  );
}

function Settings({ settings }: { settings: LifecycleSettings }) {
  const t = useT();
  const qc = useQueryClient();
  const ids = useId();
  const [s, setS] = useState(settings);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => operatorSaveLifecycle({ data: s }),
    onSuccess: async () => { setError(null); setSaved(true); await qc.invalidateQueries({ queryKey: ['operator'] }); },
    onError: (e) => setError(errorText(e, t.locale)),
  });
  const changed = JSON.stringify(s) !== JSON.stringify(settings);
  const set = (patch: Partial<LifecycleSettings>) => { setSaved(false); setS({ ...s, ...patch }); };
  const month = (key: 'warnMonths' | 'readOnlyMonths' | 'deleteMonths', label: Key) => (
    <label className="field">
      <span>{t(label)}</span>
      <input className="input operator-narrow" type="number" min={1} max={LIFECYCLE_MONTHS_MAX} step={1} inputMode="numeric" required value={s[key]}
        onChange={(e) => set({ [key]: Math.trunc(Number(e.target.value)) })} />
    </label>
  );
  return (
    <form className="families-form" onSubmit={(e) => { e.preventDefault(); if (changed && validSettings(s) && !save.isPending) save.mutate(); }}>
      <Switch checked={s.on} onChange={(on) => set({ on })}>{t('lifecycle.on')}</Switch>
      <div className="lifecycle-periods">
        {month('warnMonths', 'lifecycle.warn_months')}
        {month('readOnlyMonths', 'lifecycle.readonly_months')}
        {month('deleteMonths', 'lifecycle.delete_months')}
      </div>
      <p className="families-hint">{t('lifecycle.stages_note')}</p>
      <div className="field">
        <span id={`${ids}-deletion`}>{t('lifecycle.deletion')}</span>
        <Segmented aria-labelledby={`${ids}-deletion`} value={s.autoDelete ? 'auto' : 'confirm'} onChange={(v) => set({ autoDelete: v === 'auto' })}
          options={[{ value: 'confirm', label: t('lifecycle.deletion_confirm') }, { value: 'auto', label: t('lifecycle.deletion_auto') }]} />
      </div>
      <p className="families-hint">{t('lifecycle.backup_note')}</p>
      {settings.on && <p className="families-hint">{t('lifecycle.off_note')}</p>}
      {!validSettings(s) && <p role="alert" className="families-error">{t('lifecycle.err.periods')}</p>}
      {error && <p role="alert" className="families-error">{error}</p>}
      <div className="families-row">
        <button type="submit" className="btn primary" disabled={!changed || !validSettings(s) || save.isPending}>{t('lifecycle.save')}</button>
        {saved && !changed && <span role="status" className="muted">{t('lifecycle.saved')}</span>}
      </div>
    </form>
  );
}

function Report({ title, hint, report }: { title: string; hint?: string; report: LifecycleReport }) {
  const t = useT();
  return (
    <div>
      <b>{title}</b>
      {hint && <p className="families-hint">{hint}</p>}
      {report.families.length === 0 ? <p className="muted">{t('lifecycle.dry_none')}</p> : (
        <ul className="lifecycle-steps">
          {report.families.map((f) => (
            <li key={`${f.id}-${f.step}`}>
              <b>{f.name}</b> <span className="families-id muted">/{f.id}</span>: {t(STEP_KEY[f.step])}
              {f.outcome === 'kept' && <span className="muted"> ({t('lifecycle.outcome_kept')})</span>}
              {f.outcome === 'failed' && <span className="families-error"> ({t('lifecycle.outcome_failed')})</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="operator-fact"><dt>{label}</dt><dd>{children}</dd></div>;
}

function Families({ data }: { data: LifecycleConsole }) {
  const t = useT();
  const [deleting, setDeleting] = useState<LifecycleFamily | null>(null);
  const stage = { warned: 'lifecycle.stage_warned', readonly: 'lifecycle.stage_readonly', due: 'lifecycle.stage_due' } as const;
  return (
    <>
      <h3>{t('lifecycle.families_title')}</h3>
      {data.families.length === 0 ? <p className="muted">{t('lifecycle.none')}</p> : (
        <ul className="families-list">
          {data.families.map((f) => (
            <li key={f.id} className="ui-card families-card operator-family">
              <h3>{f.name} <span className="families-id muted">/{f.id}</span> <span className="chip operator-chip">{t(stage[f.stage])}</span></h3>
              <dl className="operator-facts">
                <Fact label={t('lifecycle.last_activity')}>{f.lastActivity ? relativeTime(f.lastActivity, t.locale, data.now) : '–'}</Fact>
                <Fact label={t('lifecycle.warned_at')}>{formatDate(f.warnedAt, t.locale)}</Fact>
                {f.readOnlyAt !== null && <Fact label={t('lifecycle.readonly_at')}>{formatDate(f.readOnlyAt, t.locale)}</Fact>}
                {f.dueAt !== null && <Fact label={t('lifecycle.due_at')}>{formatDate(f.dueAt, t.locale)}</Fact>}
                {f.deleteAt !== null && <Fact label={t('lifecycle.delete_at')}>{formatDate(f.deleteAt, t.locale)}</Fact>}
              </dl>
              {f.undelivered && <p className="muted">{t('lifecycle.undelivered')}</p>}
              {f.stage === 'due' && f.deleteAt === null && (
                <div className="families-row">
                  <button type="button" className="btn danger" onClick={() => setDeleting(f)}><Trash2 size={15} aria-hidden /> {t('lifecycle.delete')}</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {deleting && <DeleteDue family={deleting} onClose={() => setDeleting(null)} />}
    </>
  );
}

/** The operator's confirmation: the family's id typed and a fresh passkey proof, as any deletion of a family. */
function DeleteDue({ family: f, onClose }: { family: LifecycleFamily; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const ids = useId();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: () => withFreshProof(() => operatorDeleteDue({ data: { tree: f.id, confirm: typed } })),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['operator'] }); onClose(); },
    onError: (e) => setError(errorText(e, t.locale)),
  });
  const ready = typed.trim() === f.id;
  return (
    <Dialog
      open onClose={onClose} title={t('families.delete_title', { name: f.name })} width="min(520px, 100vw - 24px)" dismissible={!remove.isPending}
      footer={<>
        <button type="button" className="btn" onClick={onClose} disabled={remove.isPending}>{t('families.cancel')}</button>
        <button type="submit" form={`${ids}-form`} className="btn danger" disabled={!ready || remove.isPending}><Trash2 size={16} aria-hidden /> {remove.isPending ? t('families.deleting') : t('families.delete_confirm')}</button>
      </>}
    >
      <div className="families-form">
        <Notice icon={<Trash2 size={15} aria-hidden />}>{t('operator.delete_warning')}</Notice>
        <p className="families-p">{t('lifecycle.backup_note')}</p>
        <form id={`${ids}-form`} className="families-form" onSubmit={(e) => { e.preventDefault(); if (ready && !remove.isPending) remove.mutate(); }}>
          <label className="families-confirm">
            <span>{t('families.delete_type', { id: f.id })}</span>
            <input className="input families-id" value={typed} autoComplete="off" spellCheck={false} autoCapitalize="none" onChange={(e) => setTyped(e.target.value)} aria-describedby={error ? `${ids}-error` : undefined} />
          </label>
          {error && <p role="alert" id={`${ids}-error`} className="families-error">{error}</p>}
        </form>
      </div>
    </Dialog>
  );
}
