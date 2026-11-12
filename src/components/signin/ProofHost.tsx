// The prompt for a fresh proof (src/lib/auth/proof.server.ts): when a step needs the reader to confirm it is them and they have
// no passkey this device can use, `withFreshProof` (src/lib/auth/client.ts) asks here, for the password (and two-step code) or
// for signing in again at a single sign-on provider they use. Mounted once, at the root.
//
// A provider's sign-in leaves the page: the provider sends the browser back here with `?oidc=proved` (or `linked`, after adding
// a provider to the account) or `?oidc_error=<why>`, which this says once and then takes off the address.
import { useEffect, useId, useState } from 'react';
import { Dialog } from '~/components/ui/Dialog';
import { confirmPassword, hereForReturn, onPasswordProof, startSingleSignOn, type PasswordProofAsk } from '~/lib/auth/client';
import { errorText } from '~/lib/errortext';
import { useT, type Key } from '~/lib/i18n';
import { OIDC_ERRORS } from './SingleSignOn';

export function ProofHost() {
  const t = useT();
  const [ask, setAsk] = useState<PasswordProofAsk | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [returned, setReturned] = useState<Key | null>(null);
  const pwId = useId();
  const codeId = useId();
  useEffect(() => onPasswordProof((a) => { setAsk(a); setPassword(''); setCode(''); setError(null); }), []);

  // Back from a provider: say what happened once, and take the word off the address so a reload does not say it again.
  useEffect(() => {
    const url = new URL(window.location.href);
    const ok = url.searchParams.get('oidc');
    const failed = url.searchParams.get('oidc_error');
    // The sign-in page says its own errors.
    if (!ok && (!failed || url.pathname === '/signin')) return;
    setReturned(ok === 'proved' ? 'oidc.returned_proved' : ok === 'linked' ? 'oidc.returned_linked' : OIDC_ERRORS[failed ?? ''] ?? 'oidc.err.failed');
    url.searchParams.delete('oidc');
    url.searchParams.delete('oidc_error');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const cancel = () => {
    ask?.reject(new Error('pw.proof_cancelled'));
    setAsk(null);
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ask) return;
    setBusy(true);
    setError(null);
    try {
      await confirmPassword({ password, ...(ask.totp ? { code } : {}) });
      ask.resolve();
      setAsk(null);
    } catch (err) {
      setError(errorText(err, t.locale));
    }
    setBusy(false);
  };
  const viaProvider = async (provider: string) => {
    setBusy(true);
    setError(null);
    try {
      // Leaves the page; the step is done again once the reader is back.
      await startSingleSignOn({ provider, purpose: 'proof', next: hereForReturn() });
    } catch (err) {
      setError(errorText(err, t.locale));
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open={!!ask} onClose={cancel} title={t('pw.proof_title')} description={ask?.password ? t('pw.proof_lede') : t('oidc.proof_lede')} width={420}
        footer={<>
          <button className="btn" type="button" onClick={cancel}>{t('common.cancel')}</button>
          {ask?.password && <button className="btn primary" form="pw-proof" disabled={busy || !password || (!!ask?.totp && !code.trim())}>{busy ? t('pw.checking') : t('pw.confirm')}</button>}
        </>}
      >
        {ask?.password && (
          <form id="pw-proof" className="acc-form" onSubmit={(e) => void submit(e)}>
            <label className="field" htmlFor={pwId}>
              <span>{t('pw.password')}</span>
              <input id={pwId} className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus required />
            </label>
            {ask?.totp && (
              <label className="field" htmlFor={codeId}>
                <span>{t('pw.code')}</span>
                <input id={codeId} className="input auth-code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={8} required />
              </label>
            )}
          </form>
        )}
        {!!ask?.oidc.length && (
          <div className="sso-buttons">
            {ask.password && <p className="pw-or">{t('pw.or')}</p>}
            {ask.oidc.map((p) => (
              <button key={p.id} type="button" className="btn auth-go" disabled={busy} onClick={() => void viaProvider(p.id)}>{t('oidc.confirm_with', { name: p.label })}</button>
            ))}
            <p className="auth-hint">{t('oidc.proof_hint')}</p>
          </div>
        )}
        {error && <p className="acct-error" role="alert">{error}</p>}
      </Dialog>
      <Dialog open={!!returned} onClose={() => setReturned(null)} title={returned === 'oidc.returned_proved' || returned === 'oidc.returned_linked' ? t('oidc.returned_title') : t('oidc.failed_title')} width={420}
        footer={<button className="btn primary" data-autofocus onClick={() => setReturned(null)}>{t('oidc.ok')}</button>}>
        {returned && <p className="acct-help">{t(returned)}</p>}
      </Dialog>
    </>
  );
}
