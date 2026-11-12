// The operator console's instance tabs: the server's settings (who may make a family, its name, the legal texts, the default
// storage cap), its operators, and the audit log of what operators did.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { UserPlus } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { ConfirmDialog, EmptyState, ErrorState, Skeleton } from '~/components/ui';
import { errorText } from '~/lib/errortext';
import { formatDate, useT, type Key } from '~/lib/i18n';
import { auditQuery, operatorAdd, operatorRemove, operatorSaveSettings } from '~/lib/operator/operator.functions';
import { bytesToMb, FAMILIES_PER_ACCOUNT_MAX, FAMILY_CREATION, mbToBytes, OPEN_REQUESTS_MAX, SETTING_MAX, type InstanceSettings, type OperatorAccount, type OperatorFamily } from '~/lib/operator/shared';
import { LanguagesFieldset } from './OperatorLanguages';
import { OperatorPushSwitch } from './OperatorPush';

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

/**
 * `turnstile`: Cloudflare Turnstile guards the public forms; without it, opening the request form shows a warning (not a
 * refusal: a small private server may not want Turnstile). `pushKey`: the server's Web Push key, for "tell this device".
 */
export function SettingsTab({ settings, turnstile, pushKey }: { settings: InstanceSettings; turnstile: boolean; pushKey: string | null }) {
  const t = useT();
  const qc = useQueryClient();
  const ids = useId();
  const [draft, setDraft] = useState(settings);
  const [cap, setCap] = useState(settings.defaultCapBytes === null ? '' : String(bytesToMb(settings.defaultCapBytes)));
  const [perAccount, setPerAccount] = useState(settings.familiesPerAccount === null ? '' : String(settings.familiesPerAccount));
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const perAccountValue = perAccount.trim() === '' ? null : Math.max(0, Math.min(FAMILIES_PER_ACCOUNT_MAX, Math.round(Number(perAccount)) || 0));
  const next = { ...draft, defaultCapBytes: mbToBytes(cap.trim() === '' ? null : Number(cap)), familiesPerAccount: perAccountValue };
  const dirty = JSON.stringify(next) !== JSON.stringify(settings);
  const save = useMutation({
    mutationFn: () => operatorSaveSettings({ data: next }),
    onSuccess: async () => {
      setStatus({ ok: true, text: t('families.saved') });
      await Promise.all([qc.invalidateQueries({ queryKey: ['operator'] }), qc.invalidateQueries({ queryKey: ['instance'] })]);
    },
    onError: (e) => setStatus({ ok: false, text: errorText(e, t.locale) }),
  });
  const text = (k: keyof typeof SETTING_MAX) => ({
    value: draft[k], maxLength: SETTING_MAX[k],
    onChange: (e: { target: { value: string } }) => { setStatus(null); setDraft({ ...draft, [k]: e.target.value }); },
  });
  return (
    <form className="operator-panel families-form" onSubmit={(e) => { e.preventDefault(); if (dirty && !save.isPending) save.mutate(); }}>
      <fieldset className="operator-fieldset">
        <legend>{t('operator.creation_title')}</legend>
        {FAMILY_CREATION.map((mode) => (
          <label key={mode} className="operator-radio">
            <input type="radio" name={`${ids}-creation`} value={mode} checked={draft.familyCreation === mode} onChange={() => { setStatus(null); setDraft({ ...draft, familyCreation: mode }); }} />
            <span><b>{t(mode === 'signup' ? 'signup.creation' : `operator.creation_${mode}` as Key)}</b><small>{t(mode === 'signup' ? 'signup.creation_hint' : `operator.creation_${mode}_hint` as Key)}</small></span>
          </label>
        ))}
      </fieldset>
      {draft.familyCreation === 'signup' && settings.familyCreation !== 'signup' && <p className="families-hint" role="note">{t('signup.creation_ready')}</p>}
      {draft.familyCreation === 'requests' && !turnstile && <p className="operator-warning" role="note">{t('operator.turnstile_warning', { max: OPEN_REQUESTS_MAX })}</p>}
      <Field label={t('operator.families_per_account')} hint={t('operator.families_per_account_hint')}>
        {(id, hint) => <input id={id} aria-describedby={hint} className="input operator-narrow" type="number" min={0} max={FAMILIES_PER_ACCOUNT_MAX} step={1} inputMode="numeric" value={perAccount} placeholder={t('operator.no_limit')} onChange={(e) => { setStatus(null); setPerAccount(e.target.value); }} />}
      </Field>
      <h2 className="rule">{t('operator.instance_title')}</h2>
      <div className="operator-grid">
        <Field label={t('operator.instance_name')}>{(id) => <input id={id} className="input" {...text('instanceName')} />}</Field>
        <Field label={t('operator.contact_email')}>{(id) => <input id={id} className="input" type="email" {...text('contactEmail')} />}</Field>
        <Field label={t('operator.default_cap')} hint={t('operator.default_cap_hint')}>
          {(id, hint) => <input id={id} aria-describedby={hint} className="input" type="number" min={0} step={1} inputMode="numeric" value={cap} placeholder={t('operator.cap_none')} onChange={(e) => { setStatus(null); setCap(e.target.value); }} />}
        </Field>
      </div>
      <LanguagesFieldset value={draft.languages} onChange={(languages) => { setStatus(null); setDraft({ ...draft, languages }); }} />
      <h2 className="rule">{t('operator.legal_title')}</h2>
      <p className="families-hint">{t('operator.legal_hint')}</p>
      <Field label={t('legal.impressum')}>{(id) => <textarea id={id} className="input operator-text" rows={6} {...text('impressum')} />}</Field>
      <Field label={t('legal.privacy')} hint={t('operator.text_or_url')}>{(id, hint) => <textarea id={id} aria-describedby={hint} className="input operator-text" rows={6} {...text('privacy')} />}</Field>
      <Field label={t('legal.terms')} hint={t('operator.text_or_url')}>{(id, hint) => <textarea id={id} aria-describedby={hint} className="input operator-text" rows={4} {...text('terms')} />}</Field>
      <Field label={t('legal.report')} hint={t('operator.report_hint')}>{(id, hint) => <input id={id} aria-describedby={hint} className="input" {...text('reportContact')} />}</Field>
      <Field label={t('gdpr.processing_agreement')} hint={t('gdpr.processing_agreement_hint')}>{(id, hint) => <textarea id={id} aria-describedby={hint} className="input operator-text" rows={4} {...text('processingAgreement')} />}</Field>
      <p className="families-hint"><a href="/processing-agreement" target="_blank" rel="noopener">{t('gdpr.template_link')}</a></p>
      <div className="families-row">
        <button type="submit" className="btn primary" disabled={!dirty || save.isPending}>{save.isPending ? t('families.saving') : t('families.save')}</button>
        {status && <span role={status.ok ? 'status' : 'alert'} className={status.ok ? 'muted' : 'families-error'}>{status.text}</span>}
      </div>
      <h2 className="rule">{t('operator.device_title')}</h2>
      <OperatorPushSwitch pushKey={pushKey} />
    </form>
  );
}

export function OperatorsTab({ operators }: { operators: OperatorAccount[] }) {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const ids = useId();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState<OperatorAccount | null>(null);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['operator'] }), qc.invalidateQueries({ queryKey: ['session'] })]);
  const add = useMutation({ mutationFn: () => operatorAdd({ data: { email } }), onSuccess: async () => { setEmail(''); setError(null); await refresh(); }, onError: (e) => setError(errorText(e, t.locale)) });
  const remove = useMutation({
    mutationFn: (o: OperatorAccount) => operatorRemove({ data: { account: o.id } }),
    onSuccess: async (_r, o) => { setEnding(null); await refresh(); if (o.self) await navigate({ to: '/' }); },
    onError: (e) => setError(errorText(e, t.locale)),
  });
  return (
    <div className="operator-panel">
      <p className="families-hint">{t('operator.operators_hint')}</p>
      <ul className="families-list">
        {operators.map((o) => (
          <li key={o.id} className="ui-card families-card operator-row">
            <span><b>{o.name}</b>{o.email && <span className="muted"> · {o.email}</span>}{o.self && <span className="muted"> · {t('operator.you')}</span>}</span>
            {operators.length > 1 && (
              <button type="button" className="btn" onClick={() => setEnding(o)}>{o.self ? t('operator.step_down') : t('operator.remove_operator')}</button>
            )}
          </li>
        ))}
      </ul>
      {operators.length < 2 && <p className="families-hint">{t('operator.last_operator')}</p>}
      <form className="families-row" onSubmit={(e) => { e.preventDefault(); if (email.trim() && !add.isPending) add.mutate(); }}>
        <label className="operator-inline">
          <span>{t('operator.add_by_email')}</span>
          <input className="input" type="email" required value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} aria-describedby={`${ids}-hint`} />
        </label>
        <button type="submit" className="btn" disabled={!email.trim() || add.isPending}><UserPlus size={15} aria-hidden /> {t('operator.add_operator')}</button>
      </form>
      <small className="families-hint" id={`${ids}-hint`}>{t('operator.add_hint')}</small>
      {error && <p role="alert" className="families-error">{error}</p>}
      <ConfirmDialog
        open={!!ending} onClose={() => setEnding(null)} onConfirm={() => ending && remove.mutate(ending)} busy={remove.isPending}
        title={ending?.self ? t('operator.step_down_title') : t('operator.remove_title', { name: ending?.name ?? '' })}
        confirmLabel={ending?.self ? t('operator.step_down') : t('operator.remove_operator')}
      >
        <p>{t('operator.remove_text')}</p>
      </ConfirmDialog>
    </div>
  );
}

const ACTIONS: Record<string, Key> = {
  'family.create': 'operator.audit_family_create',
  'family.invite_renewed': 'operator.audit_invite_renewed',
  'family.suspend': 'operator.audit_suspend',
  'family.close': 'operator.audit_close',
  'family.resume': 'operator.audit_resume',
  'family.cap': 'operator.audit_cap',
  'family.recount': 'operator.audit_recount',
  'family.delete': 'operator.audit_delete',
  'request.approve': 'operator.audit_request_approve',
  'request.decline': 'operator.audit_request_decline',
  'data_request.status': 'operator.audit_data_status',
  settings: 'operator.audit_settings',
  'operator.add': 'operator.audit_operator_add',
  'operator.remove': 'operator.audit_operator_remove',
  'operator.step_down': 'operator.audit_step_down',
  'updates.on': 'ops.audit_updates_on',
  'updates.off': 'ops.audit_updates_off',
  'update.token': 'update.audit_token',
  'update.token_removed': 'update.audit_token_removed',
  'update.start': 'update.audit_start',
  policy: 'policy.audit_policy',
  'ai.operator_key': 'policy.audit_key',
  'ai.operator_key_removed': 'policy.audit_key_removed',
  'announcement.create': 'policy.audit_ann_create',
  'announcement.end': 'policy.audit_ann_end',
  'signin.methods': 'pw.audit_methods',
  'signin.reset_link': 'pw.audit_reset_link',
  'hosting.settings': 'signup.audit_settings',
  'signup_code.create': 'signup.audit_code_create',
  'signup_code.revoke': 'signup.audit_code_revoke',
};

export function AuditTab({ families }: { families: OperatorFamily[] }) {
  const t = useT();
  const { data, isPending, isError, refetch } = useQuery(auditQuery);
  const names = new Map(families.map((f) => [f.id, f.name]));
  if (isPending) return <div aria-busy="true" aria-label={t('operator.loading')}><Skeleton lines={5} /></div>;
  if (isError) return <ErrorState title={t('operator.err_load')} onRetry={() => { void refetch(); }} />;
  if (!data.length) return <EmptyState title={t('operator.audit_empty')} />;
  return (
    <div className="operator-panel">
      <p className="families-hint">{t('operator.audit_hint')}</p>
      <div className="operator-table-wrap">
        <table className="operator-table">
          <thead><tr><th scope="col">{t('operator.audit_when')}</th><th scope="col">{t('operator.audit_who')}</th><th scope="col">{t('operator.audit_what')}</th><th scope="col">{t('operator.audit_family')}</th></tr></thead>
          <tbody>
            {data.map((e) => (
              <tr key={e.id}>
                <td>{formatDate(e.at, t.locale, { dateStyle: 'medium', timeStyle: 'short' })}</td>
                <td>{e.name}</td>
                <td>{ACTIONS[e.action] ? t(ACTIONS[e.action]) : e.action}</td>
                <td>{e.family ? <>{names.get(e.family) ?? ''} <span className="families-id muted">/{e.family}</span></> : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
