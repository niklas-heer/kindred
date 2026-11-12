// The operator console's Sign-in tab: a card per way in (Unavailable, Configured or Enabled, with how many accounts use it and
// how many have nothing else), saving the choice after showing what it changes, and a one-hour reset link for someone who
// cannot sign in. Rules: src/lib/auth/methods.server.ts and src/lib/operator/signin.server.ts. Both changes need a fresh proof.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fingerprint, KeyRound, LifeBuoy, LogIn } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { ErrorState, Notice, Skeleton, Switch } from '~/components/ui';
import { withFreshProof } from '~/lib/auth/client';
import type { MethodCard, SignInMethod } from '~/lib/auth/methods';
import { makeResetLink, previewSignInMethods, saveSignInMethods, signInSettingsQuery } from '~/lib/auth/signin.functions';
import { errorText } from '~/lib/errortext';
import { formatDate, useT, type Key } from '~/lib/i18n';
import { LinkBox } from './OperatorConsole';
import '~/components/signin/signin.css';

const NAME: Record<SignInMethod, Key> = { passkey: 'pw.method_passkey', password: 'pw.method_password', oidc: 'pw.method_oidc' };
const HINT: Record<SignInMethod, Key> = { passkey: 'pw.method_passkey_hint', password: 'pw.method_password_hint', oidc: 'pw.method_oidc_hint' };
const STATE: Record<MethodCard['state'], Key> = { unavailable: 'pw.state_unavailable', configured: 'pw.state_configured', enabled: 'pw.state_enabled' };
const ICON: Record<SignInMethod, typeof KeyRound> = { passkey: Fingerprint, password: KeyRound, oidc: LogIn };

export function SignInTab() {
  const t = useT();
  const qc = useQueryClient();
  const { data, isPending, isError, refetch } = useQuery(signInSettingsQuery);
  const [chosen, setChosen] = useState<SignInMethod[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (data) setChosen(data.methods.filter((m) => m.state === 'enabled').map((m) => m.id)); }, [data]);
  const enabledNow = data?.methods.filter((m) => m.state === 'enabled').map((m) => m.id) ?? [];
  const changed = !!chosen && (chosen.length !== enabledNow.length || chosen.some((m) => !enabledNow.includes(m)));
  const impact = useQuery({
    queryKey: ['operator', 'signin', 'preview', chosen], enabled: changed && !!chosen?.length,
    queryFn: () => previewSignInMethods({ data: { methods: chosen! } }),
  });
  const save = useMutation({
    mutationFn: () => withFreshProof(() => saveSignInMethods({ data: { methods: chosen! } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['operator'] }),
    onError: (e) => setError(errorText(e, t.locale)),
  });

  if (isPending) return <Skeleton lines={4} />;
  if (isError || !data) return <ErrorState title={t('operator.err_load')} onRetry={() => { void refetch(); }} />;
  const access = data.mode === 'cloudflare-access';
  const locked = access || data.source === 'break-glass';

  return (
    <section aria-labelledby="signin-title">
      <h2 className="rule" id="signin-title">{t('pw.console_title')}</h2>
      <p className="families-hint">{t('pw.console_lede')}</p>
      {access && <Notice>{t('pw.console_access')}</Notice>}
      {data.source === 'break-glass' && <Notice>{t('pw.console_break_glass')}</Notice>}
      {data.source === 'KINDRED_AUTH' && <Notice>{t('pw.console_imported')}</Notice>}
      <div className="signin-methods">
        {data.methods.map((m) => {
          const Icon = ICON[m.id];
          const on = !!chosen?.includes(m.id);
          return (
            <article key={m.id} className="signin-method">
              <h3><Icon size={18} aria-hidden /> {t(NAME[m.id])}</h3>
              <span className="signin-state" data-state={m.state}>{t(STATE[m.state])}</span>
              <p className="families-hint">{t(HINT[m.id])}</p>
              <p className="families-hint">{t('pw.method_counts', { count: m.accounts, only: m.onlyWay })}</p>
              <Switch checked={on} disabled={locked || m.state === 'unavailable'} onChange={(v) => setChosen((c) => (v ? [...(c ?? []), m.id] : (c ?? []).filter((x) => x !== m.id)))}>
                {t('pw.method_offer')}
              </Switch>
            </article>
          );
        })}
      </div>
      {changed && chosen && (
        <div role="status">
          {!chosen.length ? <p className="acct-error">{t('pw.err.no_method')}</p>
            : impact.data && impact.data.lockedOut > 0 ? <Notice>{t('pw.console_locked_out', { count: impact.data.lockedOut })}</Notice>
            : null}
          {impact.data && impact.data.removed.length > 0 && <p className="families-hint">{t('pw.console_sessions_end')}</p>}
        </div>
      )}
      {error && <p className="acct-error" role="alert">{error}</p>}
      {!locked && (
        <button className="btn primary" disabled={!changed || !chosen?.length || save.isPending} onClick={() => { setError(null); save.mutate(); }}>
          {save.isPending ? t('pw.saving') : t('pw.console_save')}
        </button>
      )}
      {!access && <ResetLink />}
    </section>
  );
}

/** A one-hour link that lets one account set a new password. */
function ResetLink() {
  const t = useT();
  const [who, setWho] = useState('');
  const [clearTotp, setClearTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const make = useMutation({
    mutationFn: () => withFreshProof(() => makeResetLink({ data: { who: who.trim(), clearTotp } })),
    onError: (e) => setError(errorText(e, t.locale)),
  });
  return (
    <>
      <h2 className="rule"><LifeBuoy size={18} aria-hidden /> {t('pw.reset_section')}</h2>
      <p className="families-hint">{t('pw.reset_section_lede')}</p>
      <form className="acc-form" onSubmit={(e) => { e.preventDefault(); setError(null); make.mutate(); }}>
        <label className="field" htmlFor={id}>
          <span>{t('pw.reset_who')}</span>
          <input id={id} className="input" value={who} onChange={(e) => setWho(e.target.value)} maxLength={254} autoCapitalize="none" spellCheck={false} required />
        </label>
        <Switch checked={clearTotp} onChange={setClearTotp}>{t('pw.reset_clear_totp')}</Switch>
        {error && <p className="acct-error" role="alert">{error}</p>}
        <button className="btn" disabled={make.isPending || !who.trim()}>{t('pw.reset_make')}</button>
      </form>
      {make.data && (
        <LinkBox url={`${window.location.origin}/reset/${make.data.token}`} label={t('pw.reset_link_for', { name: make.data.name, time: formatDate(make.data.expires, t.locale, { hour: '2-digit', minute: '2-digit' }) })} />
      )}
    </>
  );
}
