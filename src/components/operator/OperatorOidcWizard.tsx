// The guided setup of a single sign-on provider (docs/self-host.md, "Single sign-on"): pick a provider, follow its numbered
// steps at the provider (deep links to the right pages, the exact values to paste with copy buttons, the notes that matter),
// paste the client ID and secret, save it still off, run a test sign-in in a new window (the real flow; it signs nobody in,
// makes no account and links nothing), and only then turn it on. Saving and turning on need the operator's fresh proof.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, FlaskConical } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Notice, Select, Switch } from '~/components/ui';
import { withFreshProof } from '~/lib/auth/client';
import {
  callbackPath, cleanDay, cleanScopes, issuerProblem, OIDC_KINDS, OIDC_PRESETS, PROVIDER_ID, SECRET_EXPIRES_KINDS, trustEmailOffered, type OidcKind, type ProviderView,
} from '~/lib/auth/oidc';
import { saveProvider } from '~/lib/auth/signin.functions';
import { errorText } from '~/lib/errortext';
import { formatDate, useT, type Key } from '~/lib/i18n';
import { LinkBox } from './OperatorConsole';
import { openTest } from './sso-test';

export const KIND_NAME: Record<OidcKind, Key> = {
  google: 'oidc.kind_google', microsoft: 'oidc.kind_microsoft', entra: 'oidc.kind_entra', authentik: 'oidc.kind_authentik', keycloak: 'oidc.kind_keycloak', generic: 'oidc.kind_generic',
};

/** A value to paste at the provider: the app's name, the site's domain, its origin, the redirect URI. */
type Paste = 'name' | 'domain' | 'origin' | 'redirect';
interface Step { title: Key; text: Key; link?: string; paste?: Paste[]; note?: Key }

const AZURE_NEW_APP = 'https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/CreateApplicationBlade';
const STEPS: Record<OidcKind, Step[]> = {
  google: [
    { title: 'oidc.g_project', text: 'oidc.g_project_text', link: 'https://console.cloud.google.com/projectcreate' },
    { title: 'oidc.g_branding', text: 'oidc.g_branding_text', link: 'https://console.cloud.google.com/auth/branding', paste: ['name', 'domain'] },
    { title: 'oidc.g_audience', text: 'oidc.g_audience_text', link: 'https://console.cloud.google.com/auth/audience' },
    { title: 'oidc.g_client', text: 'oidc.g_client_text', link: 'https://console.cloud.google.com/auth/clients/create', paste: ['name', 'origin', 'redirect'], note: 'oidc.note_redirect' },
    { title: 'oidc.g_secret', text: 'oidc.g_secret_text', note: 'oidc.note_google_idle' },
  ],
  microsoft: [
    { title: 'oidc.m_account', text: 'oidc.m_account_text', link: 'https://portal.azure.com/' },
    { title: 'oidc.m_register', text: 'oidc.m_register_text', link: AZURE_NEW_APP, paste: ['name', 'redirect'], note: 'oidc.note_redirect' },
    { title: 'oidc.m_client_id', text: 'oidc.m_client_id_text' },
    { title: 'oidc.m_secret', text: 'oidc.m_secret_text', note: 'oidc.note_secret_expiry' },
  ],
  entra: [
    { title: 'oidc.m_register', text: 'oidc.e_register_text', link: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade', paste: ['name', 'redirect'], note: 'oidc.note_redirect' },
    { title: 'oidc.m_client_id', text: 'oidc.e_client_id_text' },
    { title: 'oidc.m_secret', text: 'oidc.m_secret_text', note: 'oidc.note_secret_expiry' },
  ],
  authentik: [{ title: 'oidc.x_register', text: 'oidc.help_authentik', paste: ['redirect'], note: 'oidc.note_redirect' }],
  keycloak: [{ title: 'oidc.x_register', text: 'oidc.help_keycloak', paste: ['redirect'], note: 'oidc.note_redirect' }],
  generic: [{ title: 'oidc.x_register', text: 'oidc.help_generic', paste: ['redirect'], note: 'oidc.note_redirect' }],
};

const PASTE_LABEL: Record<Paste, Key> = { name: 'oidc.paste_name', domain: 'oidc.paste_domain', origin: 'oidc.paste_origin', redirect: 'oidc.redirect_uri' };
/** Presets whose issuer is fixed: the wizard does not ask for it. */
const FIXED_ISSUER: readonly OidcKind[] = ['google', 'microsoft'];

interface Draft { id: string; kind: OidcKind; label: string; issuer: string; clientId: string; secret: string; secretExpires: string; scopes: string; trustEmail: boolean }
const fromPreset = (kind: OidcKind): Draft => {
  const p = OIDC_PRESETS[kind];
  return { id: p.id, kind, label: p.label, issuer: p.issuer, clientId: '', secret: '', secretExpires: '', scopes: p.scopes, trustEmail: false };
};

export function ProviderWizard({ origin, providers, onDone }: { origin: string; providers: ProviderView[]; onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(() => fromPreset('google'));
  /** The provider's id once it is saved: from then on the wizard changes that provider. */
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ids = { id: useId(), label: useId(), issuer: useId(), client: useId(), secret: useId(), expires: useId(), scopes: useId() };
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const saved = savedId ? providers.find((p) => p.id === savedId) ?? null : null;
  const host = new URL(origin).host;
  const paste: Record<Paste, string> = { name: host, domain: new URL(origin).hostname, origin, redirect: `${origin}${callbackPath(d.id || '…')}` };

  const input = (enabled: boolean) => ({
    id: d.id, kind: d.kind, label: d.label, issuer: d.issuer.trim(), clientId: d.clientId, scopes: d.scopes, trustEmail: d.trustEmail, enabled,
    secret: d.secret ? d.secret : saved?.hasSecret ? undefined : '', secretExpires: d.secretExpires,
  });
  const save = useMutation({
    mutationFn: () => withFreshProof(() => saveProvider({ data: input(false) })),
    onSuccess: async () => {
      setSavedId(d.id);
      set({ secret: '' });
      await qc.invalidateQueries({ queryKey: ['operator'] });
    },
    onError: (e: Error) => setError(errorText(e, t.locale)),
  });
  const enable = useMutation({
    mutationFn: () => withFreshProof(() => saveProvider({ data: input(true) })),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['operator'] }); onDone(); },
    onError: (e: Error) => setError(errorText(e, t.locale)),
  });

  const idProblem = !saved && (!PROVIDER_ID.test(d.id) ? 'oidc.err.id' : providers.some((p) => p.id === d.id) ? 'oidc.err.id_taken' : null);
  const issuer = saved ? null : d.issuer && issuerProblem(d.issuer.trim());
  const expiresProblem = !!d.secretExpires && !cleanDay(d.secretExpires);
  const ready = !idProblem && !issuer && !expiresProblem && d.label.trim() && d.clientId.trim() && cleanScopes(d.scopes);
  const dirty = !!saved && (d.clientId !== saved.clientId || !!d.secret || d.label.trim() !== saved.label || (d.secretExpires || null) !== saved.secretExpires
    || cleanScopes(d.scopes) !== saved.scopes || d.trustEmail !== saved.trustEmail);
  const tested = !!saved?.testedAt && !dirty;
  const steps = STEPS[d.kind];
  const n = steps.length;
  const failed = saved?.lastError && saved.lastErrorAt && (!saved.testedAt || saved.lastErrorAt > saved.testedAt) ? saved.lastError : null;

  return (
    <form className="acc-form sso-provider sso-wizard" aria-label={t('oidc.add')} onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}>
      <h3>{t('oidc.add')}</h3>
      <p className="families-hint">{t('oidc.wizard_lede')}</p>
      <label className="field">
        <span>{t('oidc.kind')}</span>
        {saved ? <input className="input" readOnly value={t(KIND_NAME[d.kind])} aria-label={t('oidc.kind')} />
          : <Select<OidcKind> value={d.kind} onChange={(kind) => setD(fromPreset(kind))} aria-label={t('oidc.kind')}
            options={OIDC_KINDS.map((k) => ({ value: k, label: t(KIND_NAME[k]) }))} />}
      </label>
      <label className="field" htmlFor={ids.id}>
        <span>{t('oidc.id')}</span>
        <input id={ids.id} className="input" value={d.id} onChange={(e) => set({ id: e.target.value.toLowerCase() })} readOnly={!!saved} maxLength={32} autoCapitalize="none" spellCheck={false} required />
        <p className="auth-hint">{idProblem ? <span className="pw-problem">{t(idProblem)}</span> : t('oidc.id_hint')}</p>
      </label>

      <ol className="sso-steps">
        {steps.map((s, i) => (
          <WizardStep key={`${d.kind}-${i}`} n={i + 1} title={t(s.title)}>
            <p>{t(s.text)}</p>
            {s.link && (
              <p><a href={s.link} target="_blank" rel="noopener noreferrer">{t('oidc.open_page', { page: t(s.title) })} <ExternalLink size={13} aria-hidden /></a></p>
            )}
            {s.paste?.map((k) => <LinkBox key={k} url={paste[k]} label={t(PASTE_LABEL[k])} />)}
            {s.note && <Notice>{t(s.note)}</Notice>}
          </WizardStep>
        ))}

        <WizardStep n={n + 1} title={t('oidc.step_paste')}>
          <label className="field" htmlFor={ids.label}>
            <span>{t('oidc.label')}</span>
            <input id={ids.label} className="input" value={d.label} onChange={(e) => set({ label: e.target.value })} maxLength={60} required />
            <p className="auth-hint">{t('oidc.label_hint', { name: d.label || '…' })}</p>
          </label>
          {!FIXED_ISSUER.includes(d.kind) && (
            <label className="field" htmlFor={ids.issuer}>
              <span>{t('oidc.issuer')}</span>
              <input id={ids.issuer} className="input" value={d.issuer} onChange={(e) => set({ issuer: e.target.value })} readOnly={!!saved} maxLength={500} autoCapitalize="none" spellCheck={false} required />
              <p className="auth-hint">{issuer ? <span className="pw-problem">{t(issuer)}</span> : t('oidc.issuer_hint')}</p>
            </label>
          )}
          <label className="field" htmlFor={ids.client}>
            <span>{t('oidc.client_id')}</span>
            <input id={ids.client} className="input" value={d.clientId} onChange={(e) => set({ clientId: e.target.value.trim() })} maxLength={255} autoCapitalize="none" spellCheck={false} required />
          </label>
          <label className="field" htmlFor={ids.secret}>
            <span>{t('oidc.client_secret')}</span>
            <input id={ids.secret} className="input" type="password" value={d.secret} onChange={(e) => set({ secret: e.target.value })} maxLength={1000} autoComplete="off"
              placeholder={saved?.hasSecret ? t('oidc.secret_kept') : undefined} />
            <p className="auth-hint">{t('oidc.secret_hint')}</p>
          </label>
          {SECRET_EXPIRES_KINDS.includes(d.kind) && (
            <label className="field" htmlFor={ids.expires}>
              <span>{t('oidc.secret_expires')}</span>
              <input id={ids.expires} className="input" type="date" value={d.secretExpires} onChange={(e) => set({ secretExpires: e.target.value })} />
              <p className="auth-hint">{expiresProblem ? <span className="pw-problem">{t('oidc.err.secret_expires')}</span> : t('oidc.secret_expires_hint')}</p>
            </label>
          )}
          <details className="sso-more">
            <summary>{t('oidc.more_settings')}</summary>
            <label className="field" htmlFor={ids.scopes}>
              <span>{t('oidc.scopes')}</span>
              <input id={ids.scopes} className="input" value={d.scopes} onChange={(e) => set({ scopes: e.target.value })} maxLength={1000} autoCapitalize="none" spellCheck={false} />
              <p className="auth-hint">{t('oidc.scopes_hint')}</p>
            </label>
            {trustEmailOffered(d.kind, d.issuer.trim()) && (
              <>
                <Switch checked={d.trustEmail} onChange={(v) => set({ trustEmail: v })}>{t('oidc.trust_email')}</Switch>
                {d.trustEmail && <Notice>{t('oidc.trust_email_warning')}</Notice>}
              </>
            )}
          </details>
          <div className="families-row">
            <button className="btn" type="button" onClick={onDone}>{t('common.cancel')}</button>
            <button className="btn primary" disabled={!ready || save.isPending || (!!saved && !dirty)}>{save.isPending ? t('pw.saving') : t('oidc.save_off')}</button>
          </div>
          {saved && !dirty && <p className="auth-hint" role="status"><CheckCircle2 size={14} aria-hidden /> {t('oidc.saved_off')}</p>}
        </WizardStep>

        <WizardStep n={n + 2} title={t('oidc.step_test')}>
          <p>{t('oidc.step_test_text')}</p>
          <button className="btn" type="button" disabled={!saved || dirty} onClick={() => saved && openTest(saved.id)}><FlaskConical size={15} aria-hidden /> {t('oidc.test')}</button>
          <p className="auth-hint" role="status">
            {!saved || dirty ? t('oidc.test_save_first')
              : tested ? <><CheckCircle2 size={14} aria-hidden /> {t('oidc.tested', { date: formatDate(saved.testedAt!, t.locale, { dateStyle: 'long', timeStyle: 'short' }) })}</>
              : failed ? <span className="pw-problem">{t('oidc.test_said', { error: failed })}</span>
              : t('oidc.not_tested')}
          </p>
        </WizardStep>

        <WizardStep n={n + 3} title={t('oidc.step_enable')}>
          <p>{t('oidc.step_enable_text')}</p>
          <button className="btn primary" type="button" disabled={!tested || enable.isPending} onClick={() => { setError(null); enable.mutate(); }}>
            {enable.isPending ? t('pw.saving') : t('oidc.enable')}
          </button>
        </WizardStep>
      </ol>
      {error && <p className="acct-error" role="alert">{error}</p>}
    </form>
  );
}

function WizardStep({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  const id = useId();
  return (
    <li className="sso-step" aria-labelledby={id}>
      <h4 id={id}><span className="sso-step-n" aria-hidden>{n}</span> {title}</h4>
      {children}
    </li>
  );
}
