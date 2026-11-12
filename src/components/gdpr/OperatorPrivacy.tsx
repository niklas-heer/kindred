// The operator console's Privacy tab (docs/gdpr.md): the record of processing activities to download (GDPR Art. 30), the
// subprocessors this server's configuration implies (also on /legal), the retention job (report first, deletion once the
// operator switches it on) and the breach register with its 72-hour clock and the notice for the affected families' stewards.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, FileDown, Plus, RefreshCw } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { EmptyState, ErrorState, Segmented, Skeleton } from '~/components/ui';
import { errorText } from '~/lib/errortext';
import { formatDate, useT, type Key } from '~/lib/i18n';
import { fetchProcessingRecord, operatorRetentionPreview, operatorSaveBreach, operatorSetRetention, privacyConsoleQuery, type PrivacyConsole } from '~/lib/gdpr/gdpr.functions';
import type { Breach, BreachInput, BreachRisk } from '~/lib/gdpr/breach.server';
import type { RetentionCounts } from '~/lib/gdpr/retention.server';
import type { OperatorFamily } from '~/lib/operator/shared';
import { downloadText } from './download';
import { SubprocessorList } from './Subprocessors';
import './gdpr.css';

export function PrivacyTab({ families }: { families: OperatorFamily[] }) {
  const t = useT();
  const { data, isPending, isError, refetch } = useQuery(privacyConsoleQuery);
  if (isPending) return <Skeleton lines={5} />;
  if (isError) return <ErrorState title={t('gdpr.err_load')} onRetry={() => { void refetch(); }} />;
  return (
    <div className="operator-panel">
      <p className="families-hint">{t('gdpr.privacy_hint')}</p>
      <RecordSection />
      <Subprocessors data={data} />
      <Retention data={data} />
      <Breaches data={data} families={families} />
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section aria-labelledby={id} className="gdpr-section"><h2 id={id} className="rule">{title}</h2>{children}</section>;
}

function RecordSection() {
  const t = useT();
  const ids = useId();
  const [error, setError] = useState<string | null>(null);
  const get = useMutation({
    mutationFn: (format: 'md' | 'json') => fetchProcessingRecord({ data: { format } }),
    onSuccess: (f) => downloadText(f.name, f.text, f.type),
    onError: (e) => setError(errorText(e, t.locale)),
  });
  return (
    <Section id={`${ids}-record`} title={t('gdpr.record_title')}>
      <p className="families-hint">{t('gdpr.record_hint')}</p>
      <div className="families-row">
        <button type="button" className="btn" onClick={() => get.mutate('md')} disabled={get.isPending}><FileDown size={15} aria-hidden /> {t('gdpr.record_md')}</button>
        <button type="button" className="btn" onClick={() => get.mutate('json')} disabled={get.isPending}><FileDown size={15} aria-hidden /> {t('gdpr.record_json')}</button>
      </div>
      {error && <p role="alert" className="families-error">{error}</p>}
    </Section>
  );
}

function Subprocessors({ data }: { data: PrivacyConsole }) {
  const t = useT();
  const ids = useId();
  return (
    <Section id={`${ids}-subs`} title={t('gdpr.subs_title')}>
      <p className="families-hint">{t('gdpr.subs_hint')}</p>
      <SubprocessorList list={data.subprocessors} />
    </Section>
  );
}

function Counts({ c }: { c: RetentionCounts }) {
  const t = useT();
  return (
    <ul className="operator-compact">
      <li>{t('gdpr.ret_accounts', { count: c.accounts })}</li>
      <li>{t('gdpr.ret_invites', { count: c.invites })}</li>
      <li>{t('gdpr.ret_family_requests', { count: c.familyRequests })}</li>
      <li>{t('gdpr.ret_data_requests', { count: c.dataRequests })}</li>
      <li>{t('gdpr.ret_terms', { count: c.termsRecords })}</li>
    </ul>
  );
}

function Retention({ data }: { data: PrivacyConsole }) {
  const t = useT();
  const ids = useId();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const preview = useMutation({ mutationFn: () => operatorRetentionPreview(), onError: (e) => setError(errorText(e, t.locale)) });
  const mode = useMutation({
    mutationFn: (m: 'report' | 'delete') => operatorSetRetention({ data: { mode: m } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['operator'] }),
    onError: (e) => setError(errorText(e, t.locale)),
  });
  const last = data.retention.report;
  return (
    <Section id={`${ids}-ret`} title={t('gdpr.retention_title')}>
      <p className="families-hint">{t('gdpr.retention_hint')}</p>
      <div className="families-row">
        <span id={`${ids}-mode`} className="muted">{t('gdpr.retention_mode')}</span>
        <Segmented aria-labelledby={`${ids}-mode`} value={data.retention.mode} onChange={(m) => { if (m !== data.retention.mode) mode.mutate(m); }}
          options={[{ value: 'report', label: t('gdpr.mode_report') }, { value: 'delete', label: t('gdpr.mode_delete') }]} />
      </div>
      {last ? (
        <div>
          <p>{t(last.deleted ? 'gdpr.last_deleted' : 'gdpr.last_report', { date: formatDate(last.at, t.locale) })}</p>
          <Counts c={last.counts} />
          {last.outcome && last.outcome.kept > 0 && <p className="families-hint">{t('gdpr.ret_kept', { count: last.outcome.kept })}</p>}
          {last.outcome && last.outcome.failed > 0 && <p className="families-error">{t('gdpr.ret_failed', { count: last.outcome.failed })}</p>}
        </div>
      ) : <p className="muted">{t('gdpr.no_report')}</p>}
      <div className="families-row">
        <button type="button" className="btn" onClick={() => preview.mutate()} disabled={preview.isPending}><RefreshCw size={15} aria-hidden /> {t('gdpr.check_now')}</button>
      </div>
      {preview.data && <div role="status"><p>{t('gdpr.would_delete_now')}</p><Counts c={preview.data.counts} /></div>}
      {error && <p role="alert" className="families-error">{error}</p>}
    </Section>
  );
}

function Breaches({ data, families }: { data: PrivacyConsole; families: OperatorFamily[] }) {
  const t = useT();
  const ids = useId();
  const [editing, setEditing] = useState<Breach | 'new' | null>(null);
  return (
    <Section id={`${ids}-breach`} title={t('gdpr.breach_title')}>
      <p className="families-hint">{t('gdpr.breach_hint')}</p>
      {editing === null && <div className="families-row"><button type="button" className="btn" onClick={() => setEditing('new')}><Plus size={15} aria-hidden /> {t('gdpr.breach_new')}</button></div>}
      {editing !== null && <BreachForm breach={editing === 'new' ? null : editing} families={families} now={data.now} onClose={() => setEditing(null)} />}
      {data.breaches.length === 0 ? <EmptyState title={t('gdpr.no_breaches')} /> : (
        <ul className="families-list">
          {data.breaches.map((b) => (
            <li key={b.id} className="ui-card families-card gdpr-breach">
              <h3>{b.title}{b.closedAt && <span className="chip">{t('gdpr.closed')}</span>}</h3>
              <p className="muted">{t('gdpr.aware_on', { date: formatDate(b.awareAt, t.locale) })} · {t(`gdpr.risk_${b.risk}` as Key)}</p>
              <Clock b={b} />
              {b.noticeReach && (
                <p className={b.noticeReach.reached < b.noticeReach.total ? 'operator-soon' : 'muted'}>
                  {t('gdpr.notice_reach', { reached: b.noticeReach.reached, total: b.noticeReach.total })}
                </p>
              )}
              <div className="families-row"><button type="button" className="btn" onClick={() => setEditing(b)}>{t('gdpr.breach_edit')}</button></div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Clock({ b }: { b: Breach }) {
  const t = useT();
  if (b.authorityAt) return <p>{t('gdpr.authority_told', { date: formatDate(b.authorityAt, t.locale) })}</p>;
  if (b.clock === 'none') return <p className="muted">{t('gdpr.no_notification')}</p>;
  return (
    <p className={b.clock === 'late' ? 'families-error' : 'operator-soon'}>
      <AlertTriangle size={14} aria-hidden /> {t(b.clock === 'late' ? 'gdpr.clock_late' : 'gdpr.clock_running', { date: formatDate(b.deadline, t.locale) })}
    </p>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
/** A time for a datetime-local field, in the browser's own zone. */
const toLocal = (ms: number | null) => {
  if (ms === null) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocal = (v: string) => (v ? new Date(v).getTime() : null);

const EMPTY = (now: number): BreachInput => ({
  title: '', awareAt: now, occurredAt: null, description: '', dataCategories: '', subjects: '', consequences: '', measures: '', risk: 'unknown',
  authorityAt: null, authorityRef: '', lateReason: '', subjectsAt: null, notice: '', noticeUntil: null, closedAt: null, families: [],
});

function BreachForm({ breach, families, now, onClose }: { breach: Breach | null; families: OperatorFamily[]; now: number; onClose: () => void }) {
  const t = useT();
  const ids = useId();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<BreachInput>(() => (breach ? { ...breach } : EMPTY(now)));
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => operatorSaveBreach({ data: { id: breach?.id, breach: draft } }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['operator'] }); onClose(); },
    onError: (e) => setError(errorText(e, t.locale)),
  });
  const set = <K extends keyof BreachInput>(k: K, v: BreachInput[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const text = (k: 'title' | 'description' | 'dataCategories' | 'subjects' | 'consequences' | 'measures' | 'authorityRef' | 'lateReason' | 'notice', label: Key, rows = 0) => (
    <div className="field">
      <label htmlFor={`${ids}-${k}`}>{t(label)}</label>
      {rows ? <textarea id={`${ids}-${k}`} className="input operator-text" rows={rows} value={draft[k]} onChange={(e) => set(k, e.target.value)} />
        : <input id={`${ids}-${k}`} className="input" value={draft[k]} onChange={(e) => set(k, e.target.value)} />}
    </div>
  );
  const time = (k: 'awareAt' | 'occurredAt' | 'authorityAt' | 'subjectsAt' | 'noticeUntil', label: Key) => (
    <div className="field">
      <label htmlFor={`${ids}-${k}`}>{t(label)}</label>
      <input id={`${ids}-${k}`} className="input" type="datetime-local" value={toLocal(draft[k])}
        onChange={(e) => set(k, (k === 'awareAt' ? fromLocal(e.target.value) ?? now : fromLocal(e.target.value)) as never)} />
    </div>
  );
  return (
    <form className="ui-card families-card families-form gdpr-breach-form" onSubmit={(e) => { e.preventDefault(); if (!save.isPending) save.mutate(); }}>
      <h3>{breach ? t('gdpr.breach_edit') : t('gdpr.breach_new')}</h3>
      {text('title', 'gdpr.b_title')}
      <div className="operator-grid">{time('awareAt', 'gdpr.b_aware')}{time('occurredAt', 'gdpr.b_occurred')}</div>
      {text('description', 'gdpr.b_description', 3)}
      <div className="operator-grid">{text('dataCategories', 'gdpr.b_data', 2)}{text('subjects', 'gdpr.b_subjects', 2)}</div>
      {text('consequences', 'gdpr.b_consequences', 2)}
      {text('measures', 'gdpr.b_measures', 2)}
      <div className="field">
        <label htmlFor={`${ids}-risk`}>{t('gdpr.b_risk')}</label>
        <select id={`${ids}-risk`} className="input" value={draft.risk} onChange={(e) => set('risk', e.target.value as BreachRisk)}>
          {(['unknown', 'none', 'risk', 'high'] as const).map((r) => <option key={r} value={r}>{t(`gdpr.risk_${r}`)}</option>)}
        </select>
      </div>
      <div className="operator-grid">{time('authorityAt', 'gdpr.b_authority')}{text('authorityRef', 'gdpr.b_authority_ref')}</div>
      {text('lateReason', 'gdpr.b_late', 2)}
      {time('subjectsAt', 'gdpr.b_subjects_told')}
      {text('notice', 'gdpr.b_notice', 2)}
      {time('noticeUntil', 'gdpr.b_notice_until')}
      <fieldset className="operator-fieldset">
        <legend>{t('gdpr.b_families')}</legend>
        <small className="families-hint">{t('gdpr.b_families_hint')}</small>
        <div className="gdpr-families">
          {families.map((f) => (
            <label key={f.id} className="operator-radio">
              <input type="checkbox" checked={draft.families.includes(f.id)}
                onChange={(e) => set('families', e.target.checked ? [...draft.families, f.id] : draft.families.filter((x) => x !== f.id))} />
              <span>{f.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="operator-radio">
        <input type="checkbox" checked={draft.closedAt !== null} onChange={(e) => set('closedAt', e.target.checked ? Date.now() : null)} />
        <span>{t('gdpr.b_closed')}</span>
      </label>
      {error && <p role="alert" className="families-error">{error}</p>}
      <div className="families-row">
        <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
        <button type="submit" className="btn primary" disabled={!draft.title.trim() || save.isPending}>{save.isPending ? t('families.saving') : t('families.save')}</button>
      </div>
    </form>
  );
}
