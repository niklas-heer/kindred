// The operator console's Hosting tab (docs/hosting-many-families.md, "Hosting and sign-up"): how the server is used (one
// family or hosting), the readiness checklist, sign-up's limits, the landing page's paragraph, sign-up codes, and the latest
// sign-ups. Whether people may sign up at all is "Who may make a family" on the Settings tab.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, X } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { EmptyState, ErrorState, Skeleton } from '~/components/ui';
import { LinkBox } from '~/components/operator/OperatorConsole';
import { errorText } from '~/lib/errortext';
import { formatDate, useT, type Key } from '~/lib/i18n';
import {
  hostingConsoleQuery, makeSignupCode, revokeSignupCode, saveHostingSettings, type HostingConsole,
} from '~/lib/signup/signup.functions';
import {
  INSTANCE_MODES, LANDING_TEXT_MAX, PER_ACCOUNT_MAX, PER_DAY_MAX, READINESS, REQUIRED_FOR_SIGNUP, TOTAL_MAX, UNVERIFIED, type HostingSettings,
} from '~/lib/signup/shared';
import './signup.css';

function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string, hintId?: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id, hint ? `${id}-hint` : undefined)}
      {hint && <small className="families-hint" id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}

export function HostingTab({ signupOn }: { signupOn: boolean }) {
  const t = useT();
  const { data, isPending, isError, refetch } = useQuery(hostingConsoleQuery);
  if (isPending) return <div aria-busy="true" aria-label={t('operator.loading')}><Skeleton lines={6} /></div>;
  if (isError) return <ErrorState title={t('operator.err_load')} onRetry={() => { void refetch(); }} />;
  return (
    <div className="operator-panel">
      <HostingSettingsForm data={data} signupOn={signupOn} />
      <Checklist data={data} />
      <Codes data={data} />
      <Recent data={data} />
    </div>
  );
}

const num = (v: string, max: number) => Math.max(0, Math.min(max, Math.round(Number(v)) || 0));

function HostingSettingsForm({ data, signupOn }: { data: HostingConsole; signupOn: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const ids = useId();
  const s = data.settings;
  const [draft, setDraft] = useState<HostingSettings>(s);
  const [perAccount, setPerAccount] = useState(String(s.perAccount));
  const [perDay, setPerDay] = useState(String(s.perDay));
  const [total, setTotal] = useState(s.total === null ? '' : String(s.total));
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const next: HostingSettings = {
    ...draft, perAccount: num(perAccount, PER_ACCOUNT_MAX), perDay: num(perDay, PER_DAY_MAX), total: total.trim() === '' ? null : num(total, TOTAL_MAX),
  };
  const dirty = JSON.stringify(next) !== JSON.stringify(s);
  const save = useMutation({
    mutationFn: () => saveHostingSettings({ data: next }),
    onSuccess: async () => {
      setStatus({ ok: true, text: t('families.saved') });
      await Promise.all([qc.invalidateQueries({ queryKey: ['operator'] }), qc.invalidateQueries({ queryKey: ['instance'] })]);
    },
    onError: (e) => setStatus({ ok: false, text: errorText(e, t.locale) }),
  });
  const change = (patch: Partial<HostingSettings>) => { setStatus(null); setDraft({ ...draft, ...patch }); };
  return (
    <form className="families-form" onSubmit={(e) => { e.preventDefault(); if (dirty && !save.isPending) save.mutate(); }}>
      <fieldset className="operator-fieldset">
        <legend>{t('signup.mode_title')}</legend>
        {INSTANCE_MODES.map((m) => (
          <label key={m} className="operator-radio">
            <input type="radio" name={`${ids}-mode`} value={m} checked={draft.mode === m} onChange={() => change({ mode: m })} />
            <span><b>{t(`signup.mode_${m}` as Key)}</b><small>{t(`signup.mode_${m}_hint` as Key)}</small></span>
          </label>
        ))}
      </fieldset>
      <p className="families-hint">{t('signup.mode_safe')}</p>

      <h2 className="rule">{t('signup.limits_title')}</h2>
      <p className="families-hint">{signupOn ? t('signup.limits_on', { day: data.counts.day, total: data.counts.total }) : t('signup.limits_off')}</p>
      <div className="operator-grid">
        <Field label={t('signup.per_account')} hint={t('signup.per_account_hint')}>
          {(id, hint) => <input id={id} aria-describedby={hint} className="input" type="number" min={0} max={PER_ACCOUNT_MAX} step={1} inputMode="numeric" value={perAccount} onChange={(e) => { setStatus(null); setPerAccount(e.target.value); }} />}
        </Field>
        <Field label={t('signup.per_day')} hint={t('signup.per_day_hint')}>
          {(id, hint) => <input id={id} aria-describedby={hint} className="input" type="number" min={0} max={PER_DAY_MAX} step={1} inputMode="numeric" value={perDay} onChange={(e) => { setStatus(null); setPerDay(e.target.value); }} />}
        </Field>
        <Field label={t('signup.total')} hint={t('signup.total_hint')}>
          {(id, hint) => <input id={id} aria-describedby={hint} className="input" type="number" min={0} max={TOTAL_MAX} step={1} inputMode="numeric" value={total} placeholder={t('operator.no_limit')} onChange={(e) => { setStatus(null); setTotal(e.target.value); }} />}
        </Field>
      </div>
      <fieldset className="operator-fieldset">
        <legend>{t('signup.unverified_title')}</legend>
        {UNVERIFIED.map((u) => (
          <label key={u} className="operator-radio">
            <input type="radio" name={`${ids}-unverified`} value={u} checked={draft.unverified === u} onChange={() => change({ unverified: u })} />
            <span><b>{t(`signup.unverified_${u}` as Key)}</b><small>{t(`signup.unverified_${u}_hint` as Key)}</small></span>
          </label>
        ))}
      </fieldset>

      <h2 className="rule">{t('signup.landing_title')}</h2>
      <Field label={t('signup.landing_text')} hint={t('signup.landing_text_hint')}>
        {(id, hint) => <textarea id={id} aria-describedby={hint} className="input operator-text" rows={4} maxLength={LANDING_TEXT_MAX} value={draft.landingText} onChange={(e) => change({ landingText: e.target.value })} />}
      </Field>
      <Field label={t('signup.demo_url')} hint={t('signup.demo_url_hint')}>
        {(id, hint) => <input id={id} aria-describedby={hint} className="input" type="url" maxLength={300} value={draft.demoUrl} onChange={(e) => change({ demoUrl: e.target.value })} />}
      </Field>
      <label className="operator-check">
        <input type="checkbox" checked={draft.backups} onChange={(e) => change({ backups: e.target.checked })} />
        <span>{t('signup.backups_confirm')}</span>
      </label>
      <div className="families-row">
        <button type="submit" className="btn primary" disabled={!dirty || save.isPending}>{save.isPending ? t('families.saving') : t('families.save')}</button>
        {status && <span role={status.ok ? 'status' : 'alert'} className={status.ok ? 'muted' : 'families-error'}>{status.text}</span>}
      </div>
    </form>
  );
}

function Checklist({ data }: { data: HostingConsole }) {
  const t = useT();
  return (
    <section aria-labelledby="hosting-ready">
      <h2 id="hosting-ready" className="rule">{t('signup.ready_title')}</h2>
      <p className="families-hint">{t('signup.ready_hint')}</p>
      <ul className="hosting-checklist">
        {READINESS.map((k) => {
          const ok = data.readiness[k];
          return (
            <li key={k} className={ok ? 'ok' : 'missing'}>
              <span className="hosting-mark" aria-hidden>{ok ? <Check size={16} /> : <X size={16} />}</span>
              <span>
                <b>{t(`signup.ready_${k}` as Key)}</b>
                <span className="sr-only">{ok ? t('signup.ready_done') : t('signup.ready_missing')}</span>
                {REQUIRED_FOR_SIGNUP.includes(k) && <small className="hosting-required">{t('signup.ready_required')}</small>}
                {!ok && <small>{t(`signup.ready_${k}_how` as Key)}</small>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const DAY = 86_400_000;

function Codes({ data }: { data: HostingConsole }) {
  const t = useT();
  const qc = useQueryClient();
  const [label, setLabel] = useState('');
  const [uses, setUses] = useState('1');
  const [days, setDays] = useState('14');
  const [made, setMade] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['operator', 'hosting'] });
  const make = useMutation({
    mutationFn: () => makeSignupCode({ data: { label, usesMax: Math.max(1, Math.round(Number(uses)) || 1), expires: days.trim() === '' ? null : Date.now() + Math.max(1, Math.round(Number(days)) || 1) * DAY } }),
    onSuccess: async (r) => { setMade(r.code); setLabel(''); setError(null); await refresh(); },
    onError: (e) => setError(errorText(e, t.locale)),
  });
  const revoke = useMutation({ mutationFn: (id: string) => revokeSignupCode({ data: { id } }), onSuccess: refresh, onError: (e) => setError(errorText(e, t.locale)) });
  const now = Date.now();
  return (
    <section aria-labelledby="hosting-codes">
      <h2 id="hosting-codes" className="rule">{t('signup.codes_title')}</h2>
      <p className="families-hint">{t('signup.codes_hint')}</p>
      <form className="families-row hosting-code-form" onSubmit={(e) => { e.preventDefault(); if (!make.isPending) make.mutate(); }}>
        <label className="operator-inline"><span>{t('signup.code_label')}</span><input className="input" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} /></label>
        <label className="operator-inline"><span>{t('signup.code_uses')}</span><input className="input operator-narrow" type="number" min={1} max={10000} inputMode="numeric" value={uses} onChange={(e) => setUses(e.target.value)} /></label>
        <label className="operator-inline"><span>{t('signup.code_days')}</span><input className="input operator-narrow" type="number" min={1} max={3650} inputMode="numeric" value={days} placeholder={t('signup.code_no_end')} onChange={(e) => setDays(e.target.value)} /></label>
        <button type="submit" className="btn" disabled={make.isPending}><Plus size={15} aria-hidden /> {t('signup.code_make')}</button>
      </form>
      {made && <LinkBox url={`${window.location.origin}/signup?code=${made}`} label={t('signup.code_made', { code: made })}><small className="families-hint">{t('signup.code_once')}</small></LinkBox>}
      {error && <p role="alert" className="families-error">{error}</p>}
      {data.codes.length === 0 ? <p className="muted">{t('signup.codes_none')}</p> : (
        <ul className="families-list">
          {data.codes.map((c) => {
            const state = c.revoked ? t('signup.code_revoked') : c.uses >= c.usesMax ? t('signup.code_used_up') : c.expires !== null && c.expires <= now ? t('signup.code_expired') : null;
            return (
              <li key={c.id} className="ui-card families-card operator-row">
                <span>
                  <b>{c.label || t('signup.code_unnamed')}</b>
                  <span className="muted"> · {t('signup.code_count', { uses: c.uses, max: c.usesMax })}</span>
                  <span className="muted"> · {c.expires === null ? t('signup.code_no_end') : t('signup.code_until', { date: formatDate(c.expires, t.locale, { dateStyle: 'medium' }) })}</span>
                  {state && <span className="muted"> · {state}</span>}
                </span>
                {!state && <button type="button" className="btn" onClick={() => revoke.mutate(c.id)} disabled={revoke.isPending}>{t('signup.code_revoke')}</button>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Recent({ data }: { data: HostingConsole }) {
  const t = useT();
  return (
    <section aria-labelledby="hosting-recent">
      <h2 id="hosting-recent" className="rule">{t('signup.recent_title')}</h2>
      {data.recent.length === 0 ? <EmptyState title={t('signup.recent_none')} /> : (
        <div className="operator-table-wrap">
          <table className="operator-table">
            <thead><tr><th scope="col">{t('operator.audit_when')}</th><th scope="col">{t('signup.recent_who')}</th><th scope="col">{t('signup.recent_email')}</th><th scope="col">{t('operator.audit_family')}</th></tr></thead>
            <tbody>
              {data.recent.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.created, t.locale, { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td>{r.name}{r.code && <span className="muted"> · {t('signup.recent_code')}</span>}</td>
                  <td><a href={`mailto:${r.email}`}>{r.email}</a>{!r.verified && <span className="muted"> · {t('signup.recent_unverified')}</span>}</td>
                  <td>{r.family ? <span className="families-id">/{r.family}</span> : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
