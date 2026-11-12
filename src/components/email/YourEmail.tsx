// "Your email" in the account menu (src/lib/email/verify.server.ts): the account's address and whether it is confirmed, and a
// one-time link to confirm it (or another one). The address changes only when the link is opened. Moving away from a
// confirmed address asks for a fresh proof first, as that address can reset the password.
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, MailCheck, Send } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Dialog } from '~/components/ui/Dialog';
import { withFreshProof } from '~/lib/auth/client';
import { myEmailQuery, startEmailVerification } from '~/lib/email/email.functions';
import { errorText } from '~/lib/errortext';
import { useT } from '~/lib/i18n';

export function YourEmailDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const id = useId();
  const mine = useQuery({ ...myEmailQuery, enabled: open });
  const [email, setEmail] = useState('');
  // The account's address fills the field once it arrives, unless the reader has typed already.
  const [typed, setTyped] = useState(false);
  useEffect(() => { if (open && mine.data && !typed) setEmail(mine.data.email ?? ''); }, [open, mine.data, typed]);
  useEffect(() => { if (!open) setTyped(false); }, [open]);
  const send = useMutation({ mutationFn: () => withFreshProof(() => startEmailVerification({ data: { email: email.trim() } })) });
  useEffect(() => { if (open) send.reset(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = mine.data;
  const status = !d?.email ? t('email.status_none') : d.verified ? t('email.status_verified') : t('email.status_unverified');
  const same = !!d?.verified && d.email?.toLowerCase() === email.trim().toLowerCase();
  return (
    <Dialog open={open} onClose={onClose} title={t('email.menu')} width={480} bodyClassName="acct-dialog">
      <p className="acct-help">{t('email.dialog_lede')}</p>
      <form className="acct-rename" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
        <label className="field" htmlFor={id}>
          <span>{t('email.address')} <small className="signin-state" data-state={d?.verified ? 'enabled' : 'unavailable'}>{status}</small></span>
          <input id={id} className="input" type="email" value={email} onChange={(e) => { send.reset(); setTyped(true); setEmail(e.target.value); }} maxLength={254} autoComplete="email" autoCapitalize="none" spellCheck={false} required />
        </label>
        <button className="btn" disabled={send.isPending || !email.trim() || same}>
          {d?.verified && same ? <><MailCheck size={15} aria-hidden /> {t('email.status_verified')}</> : <><Send size={15} aria-hidden /> {send.isPending ? t('email.sending') : t('email.send_link')}</>}
        </button>
      </form>
      {send.isSuccess && <p className="acct-ok" role="status"><Check size={15} aria-hidden /> {t('email.link_sent', { email: send.data.email })}</p>}
      {send.isError && <p className="acct-error" role="alert">{errorText(send.error, t.locale)}</p>}
    </Dialog>
  );
}
