// Signing in with a username and password (src/lib/auth/password.server.ts): the form, the two-step code when the account
// has them (or a recovery code instead), and "Forgot your password?" with a recovery code. Every answer for a wrong
// username or password is the same sentence. After a flood of failures on the whole server, the form shows Turnstile.
import { useQuery } from '@tanstack/react-query';
import { KeyRound, LifeBuoy, ShieldCheck } from 'lucide-react';
import { useId, useState } from 'react';
import { AuthError } from '~/components/AuthCard';
import { Turnstile } from '~/components/operator/Turnstile';
import { finishPasswordSignIn, forgetLocalIdentity, recoverPassword, safeNext, signInWithPassword } from '~/lib/auth/client';
import { errorText } from '~/lib/errortext';
import { useT } from '~/lib/i18n';
import { publicInstanceQuery } from '~/lib/operator/operator.functions';
import { NewPasswordFields, newPasswordReady } from './PasswordFields';

const done = (next: string | undefined) => {
  forgetLocalIdentity();
  // A full load, so nothing from before signing in stays in memory.
  window.location.assign(safeNext(next));
};

export function PasswordSignIn({ next }: { next?: string }) {
  const t = useT();
  const [mode, setMode] = useState<'password' | 'code' | 'recover'>('password');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [ticket, setTicket] = useState('');
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needTurnstile, setNeedTurnstile] = useState(false);
  const [turnstile, setTurnstile] = useState<string | undefined>();
  const instance = useQuery(publicInstanceQuery);
  const ids = { user: useId(), pw: useId(), code: useId() };

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      if (e instanceof Error && e.message === 'pw.err.turnstile') setNeedTurnstile(true);
      setError(errorText(e, t.locale));
      setBusy(false);
    }
  };

  const signIn = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await signInWithPassword({ username, password, turnstile });
      if (r.step === 'code' && r.ticket) {
        setTicket(r.ticket);
        setPassword('');
        setMode('code');
        setBusy(false);
        return;
      }
      done(next);
    });
  };
  const second = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await finishPasswordSignIn(useRecovery ? { ticket, recovery: code } : { ticket, code });
      done(next);
    });
  };

  if (mode === 'recover') return <Recover next={next} onBack={() => { setMode('password'); setError(null); }} />;

  if (mode === 'code') {
    return (
      <form className="auth-form" onSubmit={second}>
        <p className="auth-hint"><ShieldCheck size={16} aria-hidden /> {useRecovery ? t('pw.recovery_prompt') : t('pw.code_prompt')}</p>
        <label className="field" htmlFor={ids.code}>
          <span>{useRecovery ? t('pw.recovery_code') : t('pw.code')}</span>
          <input
            id={ids.code} className="input auth-code" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus spellCheck={false}
            autoComplete="one-time-code" inputMode={useRecovery ? 'text' : 'numeric'} maxLength={useRecovery ? 20 : 8}
          />
        </label>
        <AuthError>{error}</AuthError>
        <button className="btn primary auth-go" disabled={busy || !code.trim()}><KeyRound size={19} /> {busy ? t('pw.signing_in') : t('pw.sign_in')}</button>
        <div className="pw-links">
          <button type="button" className="auth-link" onClick={() => { setUseRecovery(!useRecovery); setCode(''); setError(null); }}>
            {useRecovery ? t('pw.use_code') : t('pw.use_recovery')}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form className="auth-form" onSubmit={signIn}>
      <label className="field" htmlFor={ids.user}>
        <span>{t('pw.username')}</span>
        <input id={ids.user} className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={200} />
      </label>
      <label className="field" htmlFor={ids.pw}>
        <span>{t('pw.password')}</span>
        <input id={ids.pw} className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required maxLength={1024} />
      </label>
      {needTurnstile && instance.data?.turnstileSiteKey && <Turnstile siteKey={instance.data.turnstileSiteKey} onToken={setTurnstile} />}
      <AuthError>{error}</AuthError>
      <button className="btn primary auth-go" disabled={busy || !username.trim() || !password}><KeyRound size={19} /> {busy ? t('pw.signing_in') : t('pw.sign_in')}</button>
      <div className="pw-links">
        <button type="button" className="auth-link" onClick={() => { setMode('recover'); setError(null); }}>{t('pw.forgot')}</button>
      </div>
    </form>
  );
}

/** "Forgot your password?": a recovery code (and the app's code, when the account has them) and a new password. */
function Recover({ next, onBack }: { next?: string; onBack: () => void }) {
  const t = useT();
  const [username, setUsername] = useState('');
  const [recovery, setRecovery] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { user: useId(), rec: useId(), code: useId() };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await recoverPassword({ username, recovery, code: code.trim() || undefined, password });
      done(next);
    } catch (err) {
      setError(errorText(err, t.locale));
      setBusy(false);
    }
  };
  return (
    <form className="auth-form" onSubmit={(e) => void submit(e)}>
      <p className="auth-hint"><LifeBuoy size={16} aria-hidden /> {t('pw.recover_lede')}</p>
      <label className="field" htmlFor={ids.user}>
        <span>{t('pw.username')}</span>
        <input id={ids.user} className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={200} />
      </label>
      <label className="field" htmlFor={ids.rec}>
        <span>{t('pw.recovery_code')}</span>
        <input id={ids.rec} className="input auth-code" value={recovery} onChange={(e) => setRecovery(e.target.value)} required spellCheck={false} maxLength={20} />
      </label>
      <label className="field" htmlFor={ids.code}>
        <span>{t('pw.code_if_on')}</span>
        <input id={ids.code} className="input auth-code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={8} />
      </label>
      <NewPasswordFields username={username} onUsername={setUsername} password={password} onPassword={setPassword} fixedUsername={username.trim() || '…'} quiet />
      <AuthError>{error}</AuthError>
      <button className="btn primary auth-go" disabled={busy || !recovery.trim() || !newPasswordReady(username, password, username.trim() || '…')}>{busy ? t('pw.saving') : t('pw.recover_go')}</button>
      <p className="auth-hint">{t('pw.recover_none')}</p>
      <div className="pw-links"><button type="button" className="auth-link" onClick={onBack}>{t('pw.back_to_sign_in')}</button></div>
    </form>
  );
}
