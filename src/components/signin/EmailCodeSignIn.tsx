// "Email me a sign-in code" (src/lib/auth/email-code.server.ts): the account's confirmed address, the same answer whatever it is,
// then the six-digit code, which works only in this browser (asking set its cookie), and the two-step code when the account
// has them. The email's link opens this page at the code (`/signin?code=1`); it carries no code.
import { Mail, MailCheck, Send, ShieldCheck } from 'lucide-react';
import { useId, useState } from 'react';
import { AuthError } from '~/components/AuthCard';
import { askSignInCode, finishCodeSignIn, forgetLocalIdentity, safeNext, signInWithCode } from '~/lib/auth/client';
import { errorText } from '~/lib/errortext';
import { useT } from '~/lib/i18n';
import './signin.css';

type Step = 'closed' | 'ask' | 'code' | 'second';

/**
 * `open`: the form shows at once (the only way in, or the email's link); otherwise a button opens it. `atCode`: the email's link
 * brought the reader here, so the code's field comes first.
 */
export function EmailCodeSignIn({ next, open, atCode }: { next?: string; open?: boolean; atCode?: boolean }) {
  const t = useT();
  const [step, setStep] = useState<Step>(atCode ? 'code' : open ? 'ask' : 'closed');
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [ticket, setTicket] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { email: useId(), code: useId() };

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(errorText(e, t.locale));
    }
    setBusy(false);
  };
  const done = () => {
    forgetLocalIdentity();
    // A full load, so nothing from before signing in stays in memory.
    window.location.assign(safeNext(next));
  };

  const ask = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await askSignInCode({ email: email.trim() });
      setSentTo(email.trim());
      setCode('');
      setStep('code');
    });
  };
  const check = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await signInWithCode({ code });
      if (r.step === 'code' && r.ticket) {
        setTicket(r.ticket);
        setCode('');
        setStep('second');
        return;
      }
      done();
    });
  };
  const second = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await finishCodeSignIn(useRecovery ? { ticket, recovery: code } : { ticket, code });
      done();
    });
  };

  if (step === 'closed') {
    return (
      <div className="auth-form">
        <button type="button" className="btn auth-go" onClick={() => setStep('ask')} data-testid="email-code-open">
          <Mail size={19} aria-hidden /> {t('email.code_open')}
        </button>
      </div>
    );
  }

  if (step === 'second') {
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
        <button className="btn primary auth-go" disabled={busy || !code.trim()}>{busy ? t('pw.signing_in') : t('pw.sign_in')}</button>
        <div className="pw-links">
          <button type="button" className="auth-link" onClick={() => { setUseRecovery(!useRecovery); setCode(''); setError(null); }}>
            {useRecovery ? t('pw.use_code') : t('pw.use_recovery')}
          </button>
        </div>
      </form>
    );
  }

  if (step === 'code') {
    return (
      <form className="auth-form" onSubmit={check}>
        <p className="auth-hint" role="status"><MailCheck size={16} aria-hidden /> <b>{t('email.code_sent_title')}</b></p>
        <p className="auth-hint">{sentTo ? t('email.code_sent', { email: sentTo }) : t('email.code_from_link')}</p>
        <label className="field" htmlFor={ids.code}>
          <span>{t('email.code_label')}</span>
          <input
            id={ids.code} className="input auth-code" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus spellCheck={false}
            autoComplete="one-time-code" inputMode="numeric" maxLength={8}
          />
        </label>
        <AuthError>{error}</AuthError>
        <button className="btn primary auth-go" disabled={busy || !code.trim()}>{busy ? t('pw.signing_in') : t('pw.sign_in')}</button>
        <p className="auth-hint">{t('email.code_device')}</p>
        <div className="pw-links">
          <button type="button" className="auth-link" onClick={() => { setStep('ask'); setError(null); }}>{t('email.code_again')}</button>
        </div>
      </form>
    );
  }

  return (
    <form className="auth-form" onSubmit={ask}>
      <p className="auth-hint"><Mail size={16} aria-hidden /> <b>{t('email.code_title')}</b></p>
      <p className="auth-hint">{t('email.code_lede')}</p>
      <label className="field" htmlFor={ids.email}>
        <span>{t('email.address')}</span>
        <input id={ids.email} className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254} />
      </label>
      <AuthError>{error}</AuthError>
      <button className="btn primary auth-go" disabled={busy || !email.trim()}><Send size={19} aria-hidden /> {t('email.code_send')}</button>
    </form>
  );
}
