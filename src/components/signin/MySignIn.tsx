// The account menu's password section (in "Your name & passkeys"): set or change the password (the first one also picks the
// username, which links this way in to the account), remove it, turn two-step codes on or off, and make new recovery codes.
// Every change asks for a fresh proof first (withFreshProof). Shown only while the server offers passwords, or while the
// reader still has one to remove.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, KeyRound, ShieldCheck, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { Dialog } from '~/components/ui/Dialog';
import { forgetLocalIdentity, withFreshProof } from '~/lib/auth/client';
import { confirmMyTotp, mySignInQuery, removeMyPassword, renewMyRecoveryCodes, setMyPassword, startMyTotp, stopMyTotp } from '~/lib/auth/signin.functions';
import { errorText } from '~/lib/errortext';
import { formatDate, useT } from '~/lib/i18n';
import { NewPasswordFields, newPasswordReady } from './PasswordFields';
import { QrCode } from './QrCode';
import './signin.css';

export function MySignIn({ open }: { open: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const me = useQuery({ ...mySignInQuery, enabled: open });
  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [totpSetup, setTotpSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const codeId = useId();
  const refresh = () => qc.invalidateQueries({ queryKey: ['session'] });
  const failed = (e: Error) => setError(errorText(e, t.locale));

  const save = useMutation({
    mutationFn: () => withFreshProof(() => setMyPassword({ data: { username: me.data?.username ? undefined : username, password } })),
    onSuccess: () => { setEditing(false); setPassword(''); return refresh(); },
    onError: failed,
  });
  const remove = useMutation({
    mutationFn: () => withFreshProof(() => removeMyPassword()),
    onSuccess: ({ signedOut }) => {
      setConfirmRemove(false);
      if (signedOut) { forgetLocalIdentity(); window.location.assign('/signin'); return; }
      return refresh();
    },
    onError: (e: Error) => { setConfirmRemove(false); failed(e); },
  });
  const begin = useMutation({ mutationFn: () => withFreshProof(() => startMyTotp()), onSuccess: (s) => { setTotpSetup(s); setTotpCode(''); }, onError: failed });
  const confirm = useMutation({
    mutationFn: () => withFreshProof(() => confirmMyTotp({ data: { code: totpCode } })),
    onSuccess: (r) => { setTotpSetup(null); setCodes(r.codes); return refresh(); },
    onError: failed,
  });
  const stop = useMutation({ mutationFn: () => withFreshProof(() => stopMyTotp()), onSuccess: refresh, onError: failed });
  const renew = useMutation({ mutationFn: () => withFreshProof(() => renewMyRecoveryCodes()), onSuccess: (r) => { setCodes(r.codes); return refresh(); }, onError: failed });

  const d = me.data;
  if (!d) return null;
  const offered = d.methods.includes('password');
  if (!offered && !d.password) return null;
  // Another way in remains without the password: a passkey the server accepts, or a single sign-on provider.
  const otherWay = (d.passkeys > 0 && d.methods.includes('passkey')) || d.oidc > 0;
  const busy = save.isPending || remove.isPending || begin.isPending || confirm.isPending || stop.isPending || renew.isPending;

  return (
    <>
      <h3 className="acct-h">{t('pw.section')}</h3>
      {d.password ? (
        <p className="acct-help">{t('pw.has_password', { username: d.username ?? '', date: formatDate(d.password.setAt, t.locale) })}</p>
      ) : (
        <p className="acct-help">{t('pw.no_password')}</p>
      )}
      {error && <p className="acct-error" role="alert">{error}</p>}
      {editing ? (
        <form className="acc-form" onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}>
          <NewPasswordFields username={username} onUsername={setUsername} password={password} onPassword={setPassword} fixedUsername={d.username} />
          <div className="families-row">
            <button className="btn" type="button" onClick={() => { setEditing(false); setPassword(''); }}>{t('common.cancel')}</button>
            <button className="btn primary" disabled={busy || !newPasswordReady(username, password, d.username)}>{t('pw.save_password')}</button>
          </div>
        </form>
      ) : offered && (
        <div className="families-row">
          <button className="btn acct-add" onClick={() => { setError(null); setEditing(true); }} disabled={busy}>
            <KeyRound size={16} /> {d.password ? t('pw.change_password') : t('pw.add_password')}
          </button>
          {d.password && (
            <button className="btn ghost acct-add" onClick={() => { setError(null); setConfirmRemove(true); }} disabled={busy || !otherWay}
              title={otherWay ? undefined : t('pw.only_way')}>
              <Trash2 size={16} /> {t('pw.remove_password')}
            </button>
          )}
        </div>
      )}
      {save.isSuccess && !editing && <p className="acct-ok" role="status"><Check size={15} /> {t('pw.saved')}</p>}

      {d.password && offered && <>
        <h3 className="acct-h">{t('pw.totp_section')}</h3>
        <p className="acct-help">{d.totp ? t('pw.totp_on') : t('pw.totp_off')}</p>
        {totpSetup ? (
          <form className="acc-form" onSubmit={(e) => { e.preventDefault(); setError(null); confirm.mutate(); }}>
            <p className="acct-help">{t('pw.totp_setup')}</p>
            <QrCode text={totpSetup.uri} label={t('oidc.qr_label')} />
            <p className="acct-help">{t('oidc.qr_or_type')}</p>
            <p className="pw-secret">{totpSetup.secret.replace(/(.{4})/g, '$1 ').trim()}</p>
            <p className="acct-help"><a className="auth-link" href={totpSetup.uri}>{t('pw.totp_open_app')}</a></p>
            <label className="field" htmlFor={codeId}>
              <span>{t('pw.code')}</span>
              <input id={codeId} className="input auth-code" value={totpCode} onChange={(e) => setTotpCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={8} required />
            </label>
            <div className="families-row">
              <button className="btn" type="button" onClick={() => setTotpSetup(null)}>{t('common.cancel')}</button>
              <button className="btn primary" disabled={busy || !totpCode.trim()}>{t('pw.totp_confirm')}</button>
            </div>
          </form>
        ) : d.totp ? (
          <div className="families-row">
            <button className="btn acct-add" onClick={() => { setError(null); renew.mutate(); }} disabled={busy}><ShieldCheck size={16} /> {t('pw.new_codes')}</button>
            <button className="btn ghost acct-add" onClick={() => { setError(null); stop.mutate(); }} disabled={busy}>{t('pw.totp_turn_off')}</button>
          </div>
        ) : (
          <button className="btn acct-add" onClick={() => { setError(null); begin.mutate(); }} disabled={busy}><ShieldCheck size={16} /> {t('pw.totp_turn_on')}</button>
        )}
        {d.totp && <p className="acct-help">{t('pw.codes_left', { count: d.recoveryLeft })}</p>}
      </>}

      <Dialog open={!!codes} onClose={() => setCodes(null)} title={t('pw.codes_title')} description={t('pw.codes_lede')} width={440}
        footer={<button className="btn primary" onClick={() => setCodes(null)}>{t('pw.codes_saved')}</button>}>
        <ul className="pw-codes">{codes?.map((c) => <li key={c}>{c}</li>)}</ul>
      </Dialog>
      <Dialog open={confirmRemove} onClose={() => setConfirmRemove(false)} title={t('pw.remove_title')} description={t('pw.remove_lede')} width={420}
        footer={<>
          <button className="btn" data-autofocus onClick={() => setConfirmRemove(false)}>{t('common.cancel')}</button>
          <button className="btn primary acct-danger" onClick={() => remove.mutate()} disabled={remove.isPending}>{t('pw.remove_password')}</button>
        </>}
      />
    </>
  );
}
