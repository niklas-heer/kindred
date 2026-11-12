// The password prompt for a fresh proof (src/lib/auth/proof.server.ts): when a step needs the reader to confirm it is them and
// they have no passkey this device can use, `withFreshProof` (src/lib/auth/client.ts) asks here. Mounted once, at the root.
import { useEffect, useId, useState } from 'react';
import { Dialog } from '~/components/ui/Dialog';
import { confirmPassword, onPasswordProof, type PasswordProofAsk } from '~/lib/auth/client';
import { errorText } from '~/lib/errortext';
import { useT } from '~/lib/i18n';

export function ProofHost() {
  const t = useT();
  const [ask, setAsk] = useState<PasswordProofAsk | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pwId = useId();
  const codeId = useId();
  useEffect(() => onPasswordProof((a) => { setAsk(a); setPassword(''); setCode(''); setError(null); }), []);

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

  return (
    <Dialog open={!!ask} onClose={cancel} title={t('pw.proof_title')} description={t('pw.proof_lede')} width={420}
      footer={<>
        <button className="btn" type="button" onClick={cancel}>{t('common.cancel')}</button>
        <button className="btn primary" form="pw-proof" disabled={busy || !password || (!!ask?.totp && !code.trim())}>{busy ? t('pw.checking') : t('pw.confirm')}</button>
      </>}
    >
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
        {error && <p className="acct-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  );
}
