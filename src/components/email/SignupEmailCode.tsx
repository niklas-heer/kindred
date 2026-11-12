// Confirming the address at sign-up (src/lib/email/verify.server.ts), while the server sends email: a six-digit code to the
// address typed above, typed back here. The right code gives the form a proof it sends with the sign-up, so the family starts
// at once even while unverified sign-ups wait. Changing the address afterwards drops the proof.
import { useMutation } from '@tanstack/react-query';
import { MailCheck, Send } from 'lucide-react';
import { useId, useState } from 'react';
import { checkSignupCode, sendSignupCode } from '~/lib/email/email.functions';
import { isMailAddress } from '~/lib/email/shared';
import { errorText } from '~/lib/errortext';
import { useT } from '~/lib/i18n';

export function SignupEmailCode({ email, code, proved, onProof }: { email: string; code?: string; proved: boolean; onProof: (proof: string | null) => void }) {
  const t = useT();
  const id = useId();
  const [ticket, setTicket] = useState<{ ticket: string; email: string } | null>(null);
  const [typed, setTyped] = useState('');
  const address = email.trim().toLowerCase();
  const send = useMutation({
    mutationFn: () => sendSignupCode({ data: { email: address, ...(code ? { code } : {}) } }),
    onSuccess: (r) => { setTicket(r); setTyped(''); check.reset(); },
  });
  const check = useMutation({
    mutationFn: () => checkSignupCode({ data: { ticket: ticket!.ticket, code: typed.trim() } }),
    onSuccess: (r) => onProof(r.proof),
  });
  if (proved) return <p className="auth-note" role="status"><MailCheck size={16} aria-hidden /> {t('email.signup_verified')}</p>;
  const current = ticket && ticket.email === address ? ticket : null;
  const error = send.isError ? send.error : check.isError ? check.error : null;
  return (
    <div className="signup-email-code">
      <p className="auth-hint">{t('email.signup_hint')}</p>
      {!current ? (
        <button type="button" className="btn" onClick={() => send.mutate()} disabled={send.isPending || !isMailAddress(address)}>
          <Send size={16} aria-hidden /> {send.isPending ? t('email.sending') : t('email.signup_send_code')}
        </button>
      ) : (
        <>
          <p className="auth-hint" role="status">{t('email.signup_code_sent', { email: current.email })}</p>
          <div className="families-row">
            <label className="field" htmlFor={id}>
              <span>{t('email.signup_code')}</span>
              <input id={id} className="input auth-code" value={typed} onChange={(e) => { check.reset(); setTyped(e.target.value); }} inputMode="numeric" autoComplete="one-time-code" maxLength={8} />
            </label>
            <button type="button" className="btn" onClick={() => check.mutate()} disabled={check.isPending || !/^\d{6}$/.test(typed.trim())}>{t('email.signup_check')}</button>
          </div>
          <button type="button" className="auth-link" onClick={() => send.mutate()} disabled={send.isPending}>{t('email.signup_resend')}</button>
        </>
      )}
      {error && <p className="acct-error" role="alert">{errorText(error, t.locale)}</p>}
    </div>
  );
}
