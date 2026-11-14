// The Sign-in tab's single sign-on providers (src/lib/auth/oidc.server.ts): the list with each provider's health (its last
// sign-in, Google's six-month deletion, a Microsoft secret's expiry, a failing provider's error) and a test sign-in, the guided
// setup that adds one (./OperatorOidcWizard.tsx), and a form to change one. Saving and removing need the operator's fresh
// proof; the server checks the provider's discovery document before it saves one that is on.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, FlaskConical, LogIn, Pencil, Plus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { ConfirmDialog, ErrorState, Notice, Skeleton, Switch } from '~/components/ui';
import { withFreshProof } from '~/lib/auth/client';
import {
  callbackPath, cleanDay, cleanScopes, providerWarnings, SECRET_EXPIRES_KINDS, trustEmailOffered, type OidcKind, type ProviderView, type ProviderWarning,
} from '~/lib/auth/oidc';
import { deleteProvider, providersQuery, saveProvider } from '~/lib/auth/signin.functions';
import { errorText } from '~/lib/errortext';
import { formatDate, useT, type Key } from '~/lib/i18n';
import { LinkBox } from './OperatorConsole';
import { KIND_NAME, ProviderWizard } from './OperatorOidcWizard';
import { openTest, useTestResults } from './sso-test';
import '~/components/signin/signin.css';

const KIND_HELP: Record<OidcKind, Key> = {
  google: 'oidc.help_google', microsoft: 'oidc.help_microsoft', entra: 'oidc.help_entra', authentik: 'oidc.help_authentik', keycloak: 'oidc.help_keycloak', generic: 'oidc.help_generic',
};

interface Draft { label: string; clientId: string; secret: string; secretExpires: string; scopes: string; trustEmail: boolean; enabled: boolean }
const fromView = (v: ProviderView): Draft => ({ label: v.label, clientId: v.clientId, secret: '', secretExpires: v.secretExpires ?? '', scopes: v.scopes, trustEmail: v.trustEmail, enabled: v.enabled });

export function ProvidersSection() {
  const t = useT();
  const { data, isPending, isError, refetch } = useQuery(providersQuery);
  const [editing, setEditing] = useState<ProviderView | 'new' | null>(null);
  const [removing, setRemoving] = useState<ProviderView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  useTestResults();
  const remove = useMutation({
    mutationFn: (id: string) => withFreshProof(() => deleteProvider({ data: { id } })),
    onSuccess: () => { setRemoving(null); return qc.invalidateQueries({ queryKey: ['operator'] }); },
    onError: (e: Error) => setError(errorText(e, t.locale)),
  });

  if (isPending) return <Skeleton lines={3} />;
  if (isError || !data) return <ErrorState title={t('operator.err_load')} onRetry={() => { void refetch(); }} />;
  const when = (ms: number) => formatDate(ms, t.locale, { dateStyle: 'long' });

  return (
    <section aria-labelledby="sso-title">
      <h2 className="rule" id="sso-title"><LogIn size={18} aria-hidden /> {t('oidc.providers_title')}</h2>
      <p className="families-hint">{t('oidc.providers_lede')}</p>
      {data.providers.map((p) => (
        <article key={p.id} className="sso-provider" aria-label={p.label}>
          <header>
            <b>{p.label}</b>
            <span className="signin-state" data-state={p.enabled ? 'enabled' : 'unavailable'}>{p.enabled ? t('pw.state_enabled') : t('oidc.state_off')}</span>
          </header>
          <small className="families-hint">{t(KIND_NAME[p.kind])} · {p.issuer}</small>
          <small className="families-hint">{t('oidc.identities', { count: p.identities })}{p.trustEmail ? ` · ${t('oidc.trusts_email')}` : ''}</small>
          <small className="families-hint">
            {p.lastSuccess ? t('oidc.last_success', { date: when(p.lastSuccess) }) : t('oidc.never_used')}
            {p.secretExpires ? ` · ${t('oidc.secret_expires_on', { date: formatDate(p.secretExpires, t.locale) })}` : ''}
          </small>
          <ProviderWarnings p={p} />
          <span className="sso-redirect">{data.origin}{callbackPath(p.id)}</span>
          <div className="families-row">
            <button className="btn" onClick={() => { setError(null); setEditing(p); }}><Pencil size={15} /> {t('oidc.edit')}</button>
            <button className="btn" onClick={() => openTest(p.id)}><FlaskConical size={15} aria-hidden /> {t('oidc.test')}</button>
            <button className="btn ghost" onClick={() => { setError(null); setRemoving(p); }}><Trash2 size={15} /> {t('oidc.remove')}</button>
          </div>
        </article>
      ))}
      {!editing && (
        <button className="btn acct-add" onClick={() => { setError(null); setEditing('new'); }}><Plus size={16} /> {t('oidc.add')}</button>
      )}
      {error && !editing && <p className="acct-error" role="alert">{error}</p>}
      {editing === 'new' && <ProviderWizard origin={data.origin} providers={data.providers} onDone={() => setEditing(null)} />}
      {editing && editing !== 'new' && <ProviderForm origin={data.origin} existing={editing} onDone={() => setEditing(null)} />}
      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} onConfirm={() => removing && remove.mutate(removing.id)} busy={remove.isPending}
        title={t('oidc.remove_title', { name: removing?.label ?? '' })} confirmLabel={t('oidc.remove')} error={error}>
        <p>{t('oidc.remove_lede', { count: removing?.identities ?? 0 })}</p>
      </ConfirmDialog>
    </section>
  );
}

/** One warning about a provider, in plain words. */
function warningText(w: ProviderWarning, t: ReturnType<typeof useT>): string {
  // A day (YYYY-MM-DD) is written in full by formatDate itself; a style cannot be mixed with its parts.
  const long = (v: number | string) => (typeof v === 'string' ? formatDate(v, t.locale) : formatDate(v, t.locale, { dateStyle: 'long' }));
  switch (w.kind) {
    case 'google_idle': return t('oidc.warn_google_idle', { date: long(w.since) });
    case 'secret_expiring': return t('oidc.warn_secret_expiring', { count: w.days, date: long(w.day) });
    case 'secret_expired': return t('oidc.warn_secret_expired', { date: long(w.day) });
    case 'failing': return t('oidc.warn_failing', { date: formatDate(w.at, t.locale, { dateStyle: 'long', timeStyle: 'short' }), error: w.error });
  }
}

/** What needs the operator's attention for a provider now; nothing when all is well. */
export function ProviderWarnings({ p }: { p: ProviderView }) {
  const t = useT();
  const warnings = providerWarnings(p, Date.now());
  if (!warnings.length) return null;
  return (
    <ul className="sso-warnings">
      {warnings.map((w) => <li key={w.kind}><AlertTriangle size={14} aria-hidden /> {warningText(w, t)}</li>)}
    </ul>
  );
}

/** The Health tab's part: each provider's last sign-in and its warnings. Nothing when there are no providers. */
export function SsoHealth() {
  const t = useT();
  const { data } = useQuery(providersQuery);
  if (!data?.providers.length) return null;
  return (
    <section aria-labelledby="health-sso" className="ops-section">
      <h2 id="health-sso" className="rule">{t('oidc.providers_title')}</h2>
      <ul className="ops-list">
        {data.providers.map((p) => (
          <li key={p.id}>
            <b>{p.label}</b> {p.enabled ? '' : `(${t('oidc.state_off')}) `}
            <span className="muted">{p.lastSuccess ? t('oidc.last_success', { date: formatDate(p.lastSuccess, t.locale, { dateStyle: 'long' }) }) : t('oidc.never_used')}</span>
            <ProviderWarnings p={p} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProviderForm({ origin, existing, onDone }: { origin: string; existing: ProviderView; onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(() => fromView(existing));
  const [error, setError] = useState<string | null>(null);
  const ids = { label: useId(), issuer: useId(), client: useId(), secret: useId(), expires: useId(), scopes: useId() };
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const save = useMutation({
    mutationFn: () => withFreshProof(() => saveProvider({
      data: {
        id: existing.id, kind: existing.kind, label: d.label, issuer: existing.issuer, clientId: d.clientId, secret: d.secret ? d.secret : existing.hasSecret ? undefined : '',
        scopes: d.scopes, trustEmail: d.trustEmail, enabled: d.enabled, secretExpires: d.secretExpires,
      },
    })),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['operator'] }); onDone(); },
    onError: (e: Error) => setError(errorText(e, t.locale)),
  });
  const expiresProblem = !!d.secretExpires && !cleanDay(d.secretExpires);
  const ready = !expiresProblem && d.label.trim() && d.clientId.trim() && cleanScopes(d.scopes);
  const title = t('oidc.edit_title', { name: existing.label });

  return (
    <form className="acc-form sso-provider" onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }} aria-label={title}>
      <h3>{title}</h3>
      <p className="families-hint">{t(KIND_HELP[existing.kind])}</p>
      <LinkBox url={`${origin}${callbackPath(existing.id)}`} label={t('oidc.redirect_uri')} />
      <label className="field" htmlFor={ids.label}>
        <span>{t('oidc.label')}</span>
        <input id={ids.label} className="input" value={d.label} onChange={(e) => set({ label: e.target.value })} maxLength={60} required />
        <p className="auth-hint">{t('oidc.label_hint', { name: d.label || '…' })}</p>
      </label>
      <label className="field" htmlFor={ids.issuer}>
        <span>{t('oidc.issuer')}</span>
        <input id={ids.issuer} className="input" value={existing.issuer} readOnly />
        <p className="auth-hint">{t('oidc.issuer_fixed')}</p>
      </label>
      <label className="field" htmlFor={ids.client}>
        <span>{t('oidc.client_id')}</span>
        <input id={ids.client} className="input" value={d.clientId} onChange={(e) => set({ clientId: e.target.value })} maxLength={255} autoCapitalize="none" spellCheck={false} required />
      </label>
      <label className="field" htmlFor={ids.secret}>
        <span>{t('oidc.client_secret')}</span>
        <input id={ids.secret} className="input" type="password" value={d.secret} onChange={(e) => set({ secret: e.target.value })} maxLength={1000} autoComplete="off"
          placeholder={existing.hasSecret ? t('oidc.secret_kept') : undefined} />
        <p className="auth-hint">{t('oidc.secret_hint')}</p>
      </label>
      {(SECRET_EXPIRES_KINDS.includes(existing.kind) || existing.secretExpires) && (
        <label className="field" htmlFor={ids.expires}>
          <span>{t('oidc.secret_expires')}</span>
          <input id={ids.expires} className="input" type="date" value={d.secretExpires} onChange={(e) => set({ secretExpires: e.target.value })} />
          <p className="auth-hint">{expiresProblem ? <span className="pw-problem">{t('oidc.err.secret_expires')}</span> : t('oidc.secret_expires_hint')}</p>
        </label>
      )}
      <label className="field" htmlFor={ids.scopes}>
        <span>{t('oidc.scopes')}</span>
        <input id={ids.scopes} className="input" value={d.scopes} onChange={(e) => set({ scopes: e.target.value })} maxLength={1000} autoCapitalize="none" spellCheck={false} />
        <p className="auth-hint">{t('oidc.scopes_hint')}</p>
      </label>
      {trustEmailOffered(existing.kind, existing.issuer) && (
        <>
          <Switch checked={d.trustEmail} onChange={(v) => set({ trustEmail: v })}>{t('oidc.trust_email')}</Switch>
          {d.trustEmail && <Notice>{t('oidc.trust_email_warning')}</Notice>}
        </>
      )}
      <Switch checked={d.enabled} onChange={(v) => set({ enabled: v })}>{t('oidc.enabled')}</Switch>
      {existing.enabled && !d.enabled && <Notice>{t('oidc.turn_off_warning', { count: existing.identities })}</Notice>}
      {!existing.enabled && d.enabled && !existing.testedAt && <Notice>{t('oidc.enable_untested')}</Notice>}
      {error && <p className="acct-error" role="alert">{error}</p>}
      <div className="families-row">
        <button className="btn" type="button" onClick={onDone}>{t('common.cancel')}</button>
        <button className="btn primary" disabled={!ready || save.isPending}>{save.isPending ? t('pw.saving') : t('oidc.save')}</button>
      </div>
    </form>
  );
}
