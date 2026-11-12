// The Sign-in tab's single sign-on providers (src/lib/auth/oidc.server.ts): the list, and a form to add or change one, with
// presets and help for Google, Microsoft Entra ID, Authentik and Keycloak, and the exact redirect URI to register at the
// provider. Saving and removing need the operator's fresh proof; the server checks the provider's discovery document first.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LogIn, Pencil, Plus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { ConfirmDialog, ErrorState, Notice, Select, Skeleton, Switch } from '~/components/ui';
import { withFreshProof } from '~/lib/auth/client';
import { callbackPath, cleanScopes, issuerProblem, OIDC_KINDS, OIDC_PRESETS, PROVIDER_ID, type OidcKind, type ProviderView } from '~/lib/auth/oidc';
import { deleteProvider, providersQuery, saveProvider } from '~/lib/auth/signin.functions';
import { errorText } from '~/lib/errortext';
import { useT, type Key } from '~/lib/i18n';
import { LinkBox } from './OperatorConsole';
import '~/components/signin/signin.css';

const KIND_NAME: Record<OidcKind, Key> = { google: 'oidc.kind_google', entra: 'oidc.kind_entra', authentik: 'oidc.kind_authentik', keycloak: 'oidc.kind_keycloak', generic: 'oidc.kind_generic' };
const KIND_HELP: Record<OidcKind, Key> = { google: 'oidc.help_google', entra: 'oidc.help_entra', authentik: 'oidc.help_authentik', keycloak: 'oidc.help_keycloak', generic: 'oidc.help_generic' };

interface Draft { id: string; kind: OidcKind; label: string; issuer: string; clientId: string; secret: string; scopes: string; trustEmail: boolean; enabled: boolean }

const fromPreset = (kind: OidcKind): Draft => {
  const p = OIDC_PRESETS[kind];
  return { id: p.id, kind, label: p.label, issuer: p.issuer, clientId: '', secret: '', scopes: p.scopes, trustEmail: false, enabled: true };
};
const fromView = (v: ProviderView): Draft => ({ id: v.id, kind: v.kind, label: v.label, issuer: v.issuer, clientId: v.clientId, secret: '', scopes: v.scopes, trustEmail: v.trustEmail, enabled: v.enabled });

export function ProvidersSection() {
  const t = useT();
  const { data, isPending, isError, refetch } = useQuery(providersQuery);
  const [editing, setEditing] = useState<{ draft: Draft; existing: ProviderView | null } | null>(null);
  const [removing, setRemoving] = useState<ProviderView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => withFreshProof(() => deleteProvider({ data: { id } })),
    onSuccess: () => { setRemoving(null); return qc.invalidateQueries({ queryKey: ['operator'] }); },
    onError: (e: Error) => setError(errorText(e, t.locale)),
  });

  if (isPending) return <Skeleton lines={3} />;
  if (isError || !data) return <ErrorState title={t('operator.err_load')} onRetry={() => { void refetch(); }} />;

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
          <span className="sso-redirect">{data.origin}{callbackPath(p.id)}</span>
          <div className="families-row">
            <button className="btn" onClick={() => { setError(null); setEditing({ draft: fromView(p), existing: p }); }}><Pencil size={15} /> {t('oidc.edit')}</button>
            <button className="btn ghost" onClick={() => { setError(null); setRemoving(p); }}><Trash2 size={15} /> {t('oidc.remove')}</button>
          </div>
        </article>
      ))}
      {!editing && (
        <button className="btn acct-add" onClick={() => { setError(null); setEditing({ draft: fromPreset('google'), existing: null }); }}><Plus size={16} /> {t('oidc.add')}</button>
      )}
      {error && !editing && <p className="acct-error" role="alert">{error}</p>}
      {editing && <ProviderForm origin={data.origin} initial={editing.draft} existing={editing.existing} taken={data.providers.map((p) => p.id)} onDone={() => setEditing(null)} />}
      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} onConfirm={() => removing && remove.mutate(removing.id)} busy={remove.isPending}
        title={t('oidc.remove_title', { name: removing?.label ?? '' })} confirmLabel={t('oidc.remove')} error={error}>
        <p>{t('oidc.remove_lede', { count: removing?.identities ?? 0 })}</p>
      </ConfirmDialog>
    </section>
  );
}

function ProviderForm({ origin, initial, existing, taken, onDone }: { origin: string; initial: Draft; existing: ProviderView | null; taken: string[]; onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(initial);
  const [error, setError] = useState<string | null>(null);
  const ids = { id: useId(), label: useId(), issuer: useId(), client: useId(), secret: useId(), scopes: useId() };
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const save = useMutation({
    mutationFn: () => withFreshProof(() => saveProvider({
      data: { id: d.id, kind: d.kind, label: d.label, issuer: d.issuer.trim(), clientId: d.clientId, secret: d.secret ? d.secret : existing?.hasSecret ? undefined : '', scopes: d.scopes, trustEmail: d.trustEmail, enabled: d.enabled },
    })),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['operator'] }); onDone(); },
    onError: (e: Error) => setError(errorText(e, t.locale)),
  });
  const idProblem = !existing && (!PROVIDER_ID.test(d.id) ? 'oidc.err.id' : taken.includes(d.id) ? 'oidc.err.id_taken' : null);
  const issuer = existing ? null : d.issuer && issuerProblem(d.issuer.trim());
  const ready = !idProblem && !issuer && d.label.trim() && d.clientId.trim() && cleanScopes(d.scopes);

  return (
    <form className="acc-form sso-provider" onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }} aria-label={existing ? t('oidc.edit_title', { name: existing.label }) : t('oidc.add')}>
      <h3>{existing ? t('oidc.edit_title', { name: existing.label }) : t('oidc.add')}</h3>
      {!existing && (
        <label className="field">
          <span>{t('oidc.kind')}</span>
          <Select<OidcKind> value={d.kind} onChange={(kind) => setD({ ...fromPreset(kind), clientId: d.clientId, secret: d.secret })} aria-label={t('oidc.kind')}
            options={OIDC_KINDS.map((k) => ({ value: k, label: t(KIND_NAME[k]) }))} />
        </label>
      )}
      <p className="families-hint">{t(KIND_HELP[d.kind])}</p>
      {!existing && (
        <label className="field" htmlFor={ids.id}>
          <span>{t('oidc.id')}</span>
          <input id={ids.id} className="input" value={d.id} onChange={(e) => set({ id: e.target.value.toLowerCase() })} maxLength={32} autoCapitalize="none" spellCheck={false} required />
          <p className="auth-hint">{idProblem ? <span className="pw-problem">{t(idProblem)}</span> : t('oidc.id_hint')}</p>
        </label>
      )}
      <LinkBox url={`${origin}${callbackPath(d.id || '…')}`} label={t('oidc.redirect_uri')} />
      <label className="field" htmlFor={ids.label}>
        <span>{t('oidc.label')}</span>
        <input id={ids.label} className="input" value={d.label} onChange={(e) => set({ label: e.target.value })} maxLength={60} required />
        <p className="auth-hint">{t('oidc.label_hint', { name: d.label || '…' })}</p>
      </label>
      <label className="field" htmlFor={ids.issuer}>
        <span>{t('oidc.issuer')}</span>
        <input id={ids.issuer} className="input" value={d.issuer} onChange={(e) => set({ issuer: e.target.value })} readOnly={!!existing} maxLength={500} autoCapitalize="none" spellCheck={false} required />
        <p className="auth-hint">{issuer ? <span className="pw-problem">{t(issuer)}</span> : existing ? t('oidc.issuer_fixed') : t('oidc.issuer_hint')}</p>
      </label>
      <label className="field" htmlFor={ids.client}>
        <span>{t('oidc.client_id')}</span>
        <input id={ids.client} className="input" value={d.clientId} onChange={(e) => set({ clientId: e.target.value })} maxLength={255} autoCapitalize="none" spellCheck={false} required />
      </label>
      <label className="field" htmlFor={ids.secret}>
        <span>{t('oidc.client_secret')}</span>
        <input id={ids.secret} className="input" type="password" value={d.secret} onChange={(e) => set({ secret: e.target.value })} maxLength={1000} autoComplete="off"
          placeholder={existing?.hasSecret ? t('oidc.secret_kept') : undefined} />
        <p className="auth-hint">{t('oidc.secret_hint')}</p>
      </label>
      <label className="field" htmlFor={ids.scopes}>
        <span>{t('oidc.scopes')}</span>
        <input id={ids.scopes} className="input" value={d.scopes} onChange={(e) => set({ scopes: e.target.value })} maxLength={1000} autoCapitalize="none" spellCheck={false} />
        <p className="auth-hint">{t('oidc.scopes_hint')}</p>
      </label>
      <Switch checked={d.trustEmail} onChange={(v) => set({ trustEmail: v })}>{t('oidc.trust_email')}</Switch>
      {d.trustEmail && <Notice>{t('oidc.trust_email_warning')}</Notice>}
      <Switch checked={d.enabled} onChange={(v) => set({ enabled: v })}>{t('oidc.enabled')}</Switch>
      {existing?.enabled && !d.enabled && <Notice>{t('oidc.turn_off_warning', { count: existing.identities })}</Notice>}
      {error && <p className="acct-error" role="alert">{error}</p>}
      <div className="families-row">
        <button className="btn" type="button" onClick={onDone}>{t('common.cancel')}</button>
        <button className="btn primary" disabled={!ready || save.isPending}>{save.isPending ? t('pw.saving') : t('oidc.save')}</button>
      </div>
    </form>
  );
}
