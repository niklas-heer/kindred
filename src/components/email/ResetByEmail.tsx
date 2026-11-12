// "Forgot your password?" by email (src/lib/email/reset.server.ts): the account's confirmed address, and the same answer
// whatever it is, so the page tells nobody whether an account has it. A recovery code stays the other way.
import { useMutation } from '@tanstack/react-query';
import { LifeBuoy, MailCheck, Send } from 'lucide-react';
import { useId, useState } from 'react';
import { AuthError } from '~/components/AuthCard';
import { requestResetEmail } from '~/lib/email/email.functions';
import { errorText } from '~/lib/errortext';
import { useT } from '~/lib/i18n';

export function ResetByEmail({ onRecovery, onBack }: { onRecovery: () => void; onBack: () => void }) {
  const t = useT();
  const id = useId();
  const [email, setEmail] = useState('');
  const ask = useMutation({ mutationFn: () => requestResetEmail({ data: { email: email.trim() } }) });
  if (ask.isSuccess) {
    return (
      <div className="auth-form" role="status">
        <p className="auth-hint"><MailCheck size={16} aria-hidden /> <b>{t('email.forgot_sent_title')}</b></p>
        <p className="auth-hint">{t('email.forgot_sent')}</p>
        <div className="pw-links"><button type="button" className="auth-link" onClick={onBack}>{t('pw.back_to_sign_in')}</button></div>
      </div>
    );
  }
  return (
    <form className="auth-form" onSubmit={(e) => { e.preventDefault(); ask.mutate(); }} aria-labelledby={`${id}-h`}>
      <p className="auth-hint" id={`${id}-h`}><LifeBuoy size={16} aria-hidden /> <b>{t('email.forgot_title')}</b></p>
      <p className="auth-hint">{t('email.forgot_lede')}</p>
      <label className="field" htmlFor={id}>
        <span>{t('email.address')}</span>
        <input id={id} className="input" type="email" value={email} onChange={(e) => { ask.reset(); setEmail(e.target.value); }} autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254} />
      </label>
      <AuthError>{ask.isError ? errorText(ask.error, t.locale) : null}</AuthError>
      <button className="btn primary auth-go" disabled={ask.isPending || !email.trim()}><Send size={19} aria-hidden /> {t('email.forgot_send')}</button>
      <p className="auth-hint">{t('email.forgot_other')}</p>
      <div className="pw-links">
        <button type="button" className="auth-link" onClick={onRecovery}>{t('pw.use_recovery')}</button>
        <button type="button" className="auth-link" onClick={onBack}>{t('pw.back_to_sign_in')}</button>
      </div>
    </form>
  );
}
