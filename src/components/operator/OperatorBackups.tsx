// The operator console's Backups tab (docs/hosting-many-families.md, "Backups"; src/lib/backup/): how long backups are kept, the
// key that seals them, each family's backups with their time, size, schema and row counts (never what they hold), and the
// restore: into a new family (the default) or over the family, the latter with its id typed and a fresh proof. On Workers, a
// family's recovery points from before an update, and rolling back to one.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArchiveRestore, DatabaseBackup, ExternalLink, History, KeyRound, ShieldCheck } from 'lucide-react';
import { useId, useState } from 'react';
import { Dialog, ErrorState, Notice, Skeleton } from '~/components/ui';
import { withFreshProof } from '~/lib/auth/client';
import { errorText } from '~/lib/errortext';
import { formatDate, useT } from '~/lib/i18n';
import {
  backupsQuery, operatorBackUpNow, operatorBackupSettings, operatorCopyMedia, operatorDrillNow, operatorRestoreBackup, operatorRollback,
} from '~/lib/backup/backup.functions';
import { GRACE_MAX_DAYS, KEEP_MAX } from '~/lib/backup/retention';
import type { BackupFamily, BackupOverview, BackupRow, RestoreResult } from '~/lib/backup/shared';
import { formatBytes } from '~/lib/operator/shared';
import { DEFAULT_UPDATE_REPO } from '~/lib/operator/updates-shared';
import './operator.css';
import './ops.css';

const ACCOUNTS = '_accounts';

export function BackupsTab() {
  const t = useT();
  const { data, isPending, isError, error, refetch } = useQuery(backupsQuery);
  const [open, setOpen] = useState<string | null>(null);
  if (isPending) return <div aria-busy="true" aria-label={t('operator.loading')}><Skeleton lines={6} /></div>;
  if (isError) return <ErrorState title={t('operator.err_load')} error={error} onRetry={() => { void refetch(); }} />;
  const docs = `https://github.com/${DEFAULT_UPDATE_REPO}/blob/main/docs/hosting-many-families.md#backups`;
  return (
    <div className="operator-panel">
      <p className="families-hint">{t('backup.hint')}</p>
      <section aria-labelledby="backup-key" className="ops-section">
        <h2 id="backup-key" className="rule">{t('backup.key_title')}</h2>
        <p>{t(data.where === 'r2' ? 'backup.where_r2' : 'backup.where_files')}</p>
        <KeyLine data={data} />
        <p><a href={docs} target="_blank" rel="noopener noreferrer">{t('backup.docs')} <ExternalLink size={13} aria-hidden /></a></p>
      </section>
      <Settings data={data} />
      <section aria-labelledby="backup-families" className="ops-section">
        <h2 id="backup-families" className="rule">{t('backup.families')}</h2>
        <ul className="ops-list backup-list">
          {[data.accounts, ...data.families].map((f) => (
            <FamilyBackups key={f.scope} family={f} data={data} open={open === f.scope} onToggle={() => setOpen(open === f.scope ? null : f.scope)} />
          ))}
        </ul>
      </section>
      {data.gone.length > 0 && (
        <section aria-labelledby="backup-gone" className="ops-section">
          <h2 id="backup-gone" className="rule">{t('backup.gone_title')}</h2>
          <p className="families-hint">{t('backup.gone_hint', { days: data.settings.graceDays })}</p>
          <ul className="ops-list backup-list">
            {data.gone.map((f) => (
              <FamilyBackups key={f.scope} family={f} data={data} open={open === `gone:${f.scope}`} onToggle={() => setOpen(open === `gone:${f.scope}` ? null : `gone:${f.scope}`)} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function KeyLine({ data }: { data: BackupOverview }) {
  const t = useT();
  const k = data.key;
  return (
    <>
      {k.source === 'none'
        ? <Notice icon={<AlertTriangle size={15} aria-hidden />}>{t('backup.key_none')}</Notice>
        : <p><KeyRound size={14} aria-hidden /> {t(k.source === 'own' ? 'backup.key_own' : 'backup.key_secret')} {t('backup.key_lose')}</p>}
      {k.besideBackups && <p className="operator-warning" role="note">{t('backup.key_beside')}</p>}
      {k.other > 0 && <p className="operator-warning" role="note">{t('backup.key_other', { count: k.other })}</p>}
    </>
  );
}

function Settings({ data }: { data: BackupOverview }) {
  const t = useT();
  const qc = useQueryClient();
  const ids = useId();
  const s = data.settings;
  const [keep, setKeep] = useState({ daily: String(s.keep.daily), weekly: String(s.keep.weekly), monthly: String(s.keep.monthly) });
  const [grace, setGrace] = useState(String(s.graceDays));
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const next = { keep: { daily: Number(keep.daily), weekly: Number(keep.weekly), monthly: Number(keep.monthly) }, graceDays: Number(grace) };
  const dirty = JSON.stringify(next) !== JSON.stringify(s);
  const save = useMutation({
    mutationFn: () => operatorBackupSettings({ data: next }),
    onSuccess: async () => { setStatus({ ok: true, text: t('families.saved') }); await qc.invalidateQueries({ queryKey: backupsQuery.queryKey }); },
    onError: (e) => setStatus({ ok: false, text: errorText(e, t.locale) }),
  });
  const number = (key: 'daily' | 'weekly' | 'monthly', label: string) => (
    <div className="field">
      <label htmlFor={`${ids}-${key}`}>{label}</label>
      <input id={`${ids}-${key}`} className="input operator-narrow" type="number" min={1} max={KEEP_MAX[key]} step={1} inputMode="numeric" value={keep[key]}
        onChange={(e) => { setStatus(null); setKeep({ ...keep, [key]: e.target.value }); }} />
    </div>
  );
  return (
    <form aria-labelledby={`${ids}-title`} className="ops-section families-form" onSubmit={(e) => { e.preventDefault(); if (dirty && !save.isPending) save.mutate(); }}>
      <h2 id={`${ids}-title`} className="rule">{t('backup.settings')}</h2>
      <p className="families-hint">{t('backup.settings_hint')}</p>
      <div className="operator-grid">
        {number('daily', t('backup.keep_daily'))}
        {number('weekly', t('backup.keep_weekly'))}
        {number('monthly', t('backup.keep_monthly'))}
        <div className="field">
          <label htmlFor={`${ids}-grace`}>{t('backup.grace')}</label>
          <input id={`${ids}-grace`} className="input operator-narrow" type="number" min={0} max={GRACE_MAX_DAYS} step={1} inputMode="numeric" value={grace} aria-describedby={`${ids}-grace-hint`}
            onChange={(e) => { setStatus(null); setGrace(e.target.value); }} />
          <small className="families-hint" id={`${ids}-grace-hint`}>{t('backup.grace_hint')}</small>
        </div>
      </div>
      <div className="families-row">
        <button type="submit" className="btn primary" disabled={!dirty || save.isPending}>{save.isPending ? t('families.saving') : t('families.save')}</button>
        {status && <span role={status.ok ? 'status' : 'alert'} className={status.ok ? 'muted' : 'families-error'}>{status.text}</span>}
      </div>
    </form>
  );
}

function FamilyBackups({ family: f, data, open, onToggle }: { family: BackupFamily; data: BackupOverview; open: boolean; onToggle: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [restoring, setRestoring] = useState<BackupRow | null>(null);
  const [rolling, setRolling] = useState<BackupFamily['recovery'][number] | null>(null);
  const when = (ms: number) => formatDate(ms, t.locale, { dateStyle: 'long', timeStyle: 'short' });
  const refresh = () => qc.invalidateQueries({ queryKey: ['operator'] });
  const now = useMutation({
    mutationFn: () => operatorBackUpNow({ data: { scope: f.scope } }),
    onSuccess: async () => { setMessage({ ok: true, text: t('backup.made') }); await refresh(); },
    onError: (e) => setMessage({ ok: false, text: errorText(e, t.locale) }),
  });
  const drill = useMutation({
    mutationFn: () => operatorDrillNow({ data: { scope: f.scope } }),
    onSuccess: async (r) => { setMessage(r.ok ? { ok: true, text: t('backup.drill_passed') } : { ok: false, text: t('backup.drill_failed_now', { problem: r.problem ?? '' }) }); await refresh(); },
    onError: (e) => setMessage({ ok: false, text: errorText(e, t.locale) }),
  });
  const title = f.scope === ACCOUNTS ? t('backup.accounts') : f.name ?? f.scope;
  const gone = f.goneAt !== null;
  return (
    <li className="backup-family">
      <div className="families-row">
        <span><b>{title}</b>{f.scope !== ACCOUNTS && <> <code>{f.scope}</code></>}</span>
        <span className="muted">
          {gone ? t('backup.gone_line', { date: when(f.goneAt!), deleteAt: when(f.deleteAt!) })
            : f.covers === 'd1' ? t('backup.d1')
            : f.covers === 'none' ? t('backup.none')
            : f.lastOkAt ? t('backup.last_ok', { date: when(f.lastOkAt) }) : t('backup.never')}
        </span>
        {f.backups.length > 0 && (
          <button type="button" className="btn ghost" aria-expanded={open} onClick={onToggle}>{t('backup.show', { count: f.backups.length })}</button>
        )}
      </div>
      {!gone && f.error && <p className="families-error"><AlertTriangle size={13} aria-hidden /> {t('backup.failed', { error: f.error })}</p>}
      {!gone && f.drill && (
        <p className={f.drill.ok ? 'muted' : 'families-error'}>
          {f.drill.ok ? <><ShieldCheck size={13} aria-hidden /> {t('backup.drill_ok', { date: when(f.drill.at) })}</> : t('backup.drill_failed', { date: when(f.drill.at), problem: f.drill.problem ?? '' })}
        </p>
      )}
      {!gone && f.covers === 'backup' && (
        <div className="families-row">
          <button type="button" className="btn" disabled={now.isPending} onClick={() => { setMessage(null); now.mutate(); }}><DatabaseBackup size={15} aria-hidden /> {now.isPending ? t('backup.making') : t('backup.now')}</button>
          {f.backups.length > 0 && <button type="button" className="btn" disabled={drill.isPending} onClick={() => { setMessage(null); drill.mutate(); }}><ShieldCheck size={15} aria-hidden /> {t('backup.drill_now')}</button>}
        </div>
      )}
      {message && <p role={message.ok ? 'status' : 'alert'} className={message.ok ? 'muted' : 'families-error'}>{message.text}</p>}
      {open && (
        <>
          {f.scope === ACCOUNTS && <p className="families-hint">{t('backup.accounts_by_hand')}</p>}
          <ul className="ops-list">
            {f.backups.map((b) => (
              <li key={b.name}>
                {when(b.created)} <span className="muted">{t('backup.row_meta', { size: formatBytes(b.bytes, t.locale), rows: b.rows, schema: b.schema ?? '—' })}</span>
                {b.drill && <> <span className={b.drill === 'ok' ? 'muted' : 'families-error'}>{t(b.drill === 'ok' ? 'backup.row_drill_ok' : 'backup.row_drill_failed')}</span></>}{' '}
                {f.scope !== ACCOUNTS && (f.covers === 'backup' || gone) && (
                  <button type="button" className="btn ghost" onClick={() => setRestoring(b)}><ArchiveRestore size={15} aria-hidden /> {t('backup.restore')}</button>
                )}
              </li>
            ))}
          </ul>
          {data.pitr && f.recovery.length > 0 && !gone && (
            <>
              <h3><History size={14} aria-hidden /> {t('backup.recovery')}</h3>
              <p className="families-hint">{t('backup.recovery_hint')}</p>
              <ul className="ops-list">
                {f.recovery.map((p) => (
                  <li key={p.id}>
                    {p.reason === 'rollback' ? t('backup.recovery_undo', { date: when(p.at) }) : t('backup.recovery_line', { date: when(p.at), migration: p.before ?? '—' })}{' '}
                    <button type="button" className="btn ghost" onClick={() => setRolling(p)}>{t('backup.rollback')}</button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {restoring && <RestoreDialog family={f} backup={restoring} onClose={() => setRestoring(null)} />}
      {rolling && <RollbackDialog family={f} point={rolling} onClose={() => setRolling(null)} />}
    </li>
  );
}

/** Restoring one backup: into a new family (the default), or over the family with its id typed and a fresh proof. */
function RestoreDialog({ family: f, backup: b, onClose }: { family: BackupFamily; backup: BackupRow; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const ids = useId();
  const gone = f.goneAt !== null;
  const [mode, setMode] = useState<'new' | 'over'>('new');
  const [into, setInto] = useState(`${f.scope}-restored`.slice(0, 64));
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<RestoreResult | null>(null);
  const when = formatDate(b.created, t.locale, { dateStyle: 'long', timeStyle: 'short' });
  const restore = useMutation({
    mutationFn: () => {
      const data = mode === 'new' ? { scope: f.scope, name: b.name, mode, into: into.trim() } : { scope: f.scope, name: b.name, mode, confirm: typed };
      return mode === 'over' ? withFreshProof(() => operatorRestoreBackup({ data })) : operatorRestoreBackup({ data });
    },
    onSuccess: async (r) => { setDone(r); await qc.invalidateQueries({ queryKey: ['operator'] }); },
    onError: (e) => setError(errorText(e, t.locale)),
  });
  const more = useMutation({
    mutationFn: () => operatorCopyMedia({ data: { into: done!.into } }),
    onSuccess: (m) => setDone({ ...done!, media: m }),
    onError: (e) => setError(errorText(e, t.locale)),
  });
  const ready = mode === 'new' ? /^[a-z0-9-]{1,64}$/.test(into.trim()) : typed.trim() === f.scope;
  return (
    <Dialog
      open onClose={onClose} title={t('backup.restore_title', { date: when })} width="min(560px, 100vw - 24px)" dismissible={!restore.isPending}
      footer={done ? <button type="button" className="btn primary" onClick={onClose}>{t('backup.close')}</button> : <>
        <button type="button" className="btn" onClick={onClose} disabled={restore.isPending}>{t('families.cancel')}</button>
        <button type="submit" form={`${ids}-form`} className={mode === 'over' ? 'btn danger' : 'btn primary'} disabled={!ready || restore.isPending}>
          <ArchiveRestore size={16} aria-hidden /> {restore.isPending ? t('backup.restoring') : t('backup.restore_go')}
        </button>
      </>}
    >
      {done ? (
        <div className="families-form">
          <p role="status">{done.fresh ? t('backup.restored_over', { name: done.fresh }) : t('backup.restored_new', { id: done.into })}</p>
          {done.stewards !== null && <p>{t('backup.restored_stewards')}</p>}
          {done.media && done.media.left > 0 && (
            <div className="families-row">
              <span>{t('backup.media_left', { copied: done.media.copied, left: done.media.left })}</span>
              <button type="button" className="btn" disabled={more.isPending} onClick={() => more.mutate()}>{t('backup.media_more')}</button>
            </div>
          )}
          {error && <p role="alert" className="families-error">{error}</p>}
        </div>
      ) : (
        <form id={`${ids}-form`} className="families-form" onSubmit={(e) => { e.preventDefault(); if (ready && !restore.isPending) restore.mutate(); }}>
          <fieldset className="operator-fieldset">
            <legend>{t('backup.restore_how')}</legend>
            <label className="operator-radio">
              <input type="radio" name={`${ids}-mode`} checked={mode === 'new'} onChange={() => { setError(null); setMode('new'); }} />
              <span><b>{t('backup.restore_new')}</b><small>{t('backup.restore_new_hint')}</small></span>
            </label>
            {!gone && (
              <label className="operator-radio">
                <input type="radio" name={`${ids}-mode`} checked={mode === 'over'} onChange={() => { setError(null); setMode('over'); }} />
                <span><b>{t('backup.restore_over')}</b><small>{t('backup.restore_over_hint')}</small></span>
              </label>
            )}
          </fieldset>
          {mode === 'new' ? (
            <div className="field">
              <label htmlFor={`${ids}-into`}>{t('backup.restore_into')}</label>
              <input id={`${ids}-into`} className="input families-id" value={into} autoComplete="off" spellCheck={false} autoCapitalize="none" maxLength={64} onChange={(e) => { setError(null); setInto(e.target.value.toLowerCase()); }} />
            </div>
          ) : (
            <label className="families-confirm">
              <span>{t('backup.restore_type', { id: f.scope })}</span>
              <input className="input families-id" value={typed} autoComplete="off" spellCheck={false} autoCapitalize="none" onChange={(e) => { setError(null); setTyped(e.target.value); }} />
            </label>
          )}
          <p className="families-hint">{t('backup.restore_pictures')}</p>
          {error && <p role="alert" className="families-error">{error}</p>}
        </form>
      )}
    </Dialog>
  );
}

/** Rolling a family's Durable Object back to a recovery point: its id typed, a fresh proof, a fresh backup first. */
function RollbackDialog({ family: f, point, onClose }: { family: BackupFamily; point: BackupFamily['recovery'][number]; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const ids = useId();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const when = formatDate(point.at, t.locale, { dateStyle: 'long', timeStyle: 'short' });
  const roll = useMutation({
    mutationFn: () => withFreshProof(() => operatorRollback({ data: { tree: f.scope, point: point.id, confirm: typed } })),
    onSuccess: async () => { setDone(true); await qc.invalidateQueries({ queryKey: ['operator'] }); },
    onError: (e) => setError(errorText(e, t.locale)),
  });
  const ready = typed.trim() === f.scope;
  return (
    <Dialog
      open onClose={onClose} title={t('backup.rollback_title', { id: f.scope, date: when })} width="min(520px, 100vw - 24px)" dismissible={!roll.isPending}
      footer={done ? <button type="button" className="btn primary" onClick={onClose}>{t('backup.close')}</button> : <>
        <button type="button" className="btn" onClick={onClose} disabled={roll.isPending}>{t('families.cancel')}</button>
        <button type="submit" form={`${ids}-form`} className="btn danger" disabled={!ready || roll.isPending}><History size={16} aria-hidden /> {t('backup.rollback_go')}</button>
      </>}
    >
      {done ? <p role="status">{t('backup.rolled_back')}</p> : (
        <form id={`${ids}-form`} className="families-form" onSubmit={(e) => { e.preventDefault(); if (ready && !roll.isPending) roll.mutate(); }}>
          <Notice icon={<AlertTriangle size={15} aria-hidden />}>{t('backup.rollback_warning')}</Notice>
          <label className="families-confirm">
            <span>{t('backup.restore_type', { id: f.scope })}</span>
            <input className="input families-id" value={typed} autoComplete="off" spellCheck={false} autoCapitalize="none" onChange={(e) => { setError(null); setTyped(e.target.value); }} />
          </label>
          {error && <p role="alert" className="families-error">{error}</p>}
        </form>
      )}
    </Dialog>
  );
}
