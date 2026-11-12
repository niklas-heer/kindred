// An operator's one-hour reset link (src/lib/auth/password.server.ts, redeemResetLink): the person sets a new password (and a
// username, if the account had none), types their two-step code when the link keeps those on, and is signed in. It changes
// nothing else: no family, no role. The token is a secret, so it never leaves as a Referer and is sent only by POST.
import { createFileRoute, Link } from '@tanstack/react-router';
import { KeyRound, LifeBuoy } from 'lucide-react';
import { useId, useState } from 'react';
import { AuthCard, AuthError } from '~/components/AuthCard';
import { NewPasswordFields, newPasswordReady } from '~/components/signin/PasswordFields';
import { forgetLocalIdentity, resetPassword } from '~/lib/auth/client';
import { fetchResetLink } from '~/lib/auth/signin.functions';
import { errorText } from '~/lib/errortext';
import { translate, useT } from '~/lib/i18n';

export const Route = createFileRoute('/reset/$token')({
  loader: async ({ params }) => ({ info: await fetchResetLink({ data: { token: params.token } }) }),
  head: ({ match }) => ({ meta: [{ title: `${translate(match.context.locale ?? 'en', 'pw.reset_title')} · Kindred` }, { name: 'referrer', content: 'no-referrer' }] }),
  staleTime: 0,
  component: Reset,
});

function Reset() {
  const t = useT();
  const { token } = Route.useParams();
  const { info } = Route.useLoaderData();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeId = useId();

  if (!info.ok) {
    return (
      <AuthCard crest={<LifeBuoy size={44} />} kicker="Kindred" title={t('pw.reset_gone_title')} lede={t('pw.reset_gone_text')}>
        <Link className="btn primary auth-go" to="/signin">{t('pw.back_to_sign_in')}</Link>
      </AuthCard>
    );
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await resetPassword({ token, password, ...(info.username ? {} : { username }), ...(info.needsCode ? { code } : {}) });
      forgetLocalIdentity();
      window.location.assign('/');
    } catch (err) {
      setError(errorText(err, t.locale));
      setBusy(false);
    }
  };
  return (
    <AuthCard crest={<LifeBuoy size={44} />} kicker="Kindred" title={t('pw.reset_title')} lede={t('pw.reset_lede', { name: info.name })}>
      <form className="auth-form" onSubmit={(e) => void submit(e)}>
        <NewPasswordFields username={username} onUsername={setUsername} password={password} onPassword={setPassword} fixedUsername={info.username} />
        {info.needsCode && (
          <label className="field" htmlFor={codeId}>
            <span>{t('pw.code')}</span>
            <input id={codeId} className="input auth-code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={8} required />
          </label>
        )}
        <AuthError>{error}</AuthError>
        <button className="btn primary auth-go" disabled={busy || !newPasswordReady(username, password, info.username) || (info.needsCode && !code.trim())}>
          <KeyRound size={19} /> {busy ? t('pw.saving') : t('pw.reset_go')}
        </button>
      </form>
    </AuthCard>
  );
}
