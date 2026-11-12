// Confirming an email address (src/lib/email/verify.server.ts): the link from "Your email" in the account menu. Opening the
// page changes nothing (a mail program's link checker may fetch it); pressing Confirm makes the address the account's,
// verified, once. The token is a secret: sent only by POST, never as a Referer.
import { createFileRoute, Link } from '@tanstack/react-router';
import { MailCheck, MailX } from 'lucide-react';
import { useState } from 'react';
import { AuthCard, AuthError } from '~/components/AuthCard';
import { confirmEmail, fetchVerification } from '~/lib/email/email.functions';
import { errorText } from '~/lib/errortext';
import { translate, useT } from '~/lib/i18n';

export const Route = createFileRoute('/verify-email/$token')({
  loader: async ({ params }) => ({ info: await fetchVerification({ data: { token: params.token } }) }),
  head: ({ match }) => ({ meta: [{ title: `${translate(match.context.locale ?? 'en', 'email.verify_title')} · Kindred` }, { name: 'referrer', content: 'no-referrer' }] }),
  staleTime: 0,
  component: VerifyEmail,
});

function VerifyEmail() {
  const t = useT();
  const { token } = Route.useParams();
  const { info } = Route.useLoaderData();
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (done) {
    return (
      <AuthCard crest={<MailCheck size={44} />} kicker="Kindred" title={t('email.verify_done_title')} lede={t('email.verify_done', { email: done })}>
        <Link className="btn primary auth-go" to="/">{t('email.to_kindred')}</Link>
      </AuthCard>
    );
  }
  if (!info.ok) {
    return (
      <AuthCard crest={<MailX size={44} />} kicker="Kindred" title={t('email.verify_gone_title')} lede={t('email.verify_gone')}>
        <Link className="btn primary auth-go" to="/">{t('email.to_kindred')}</Link>
      </AuthCard>
    );
  }
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      setDone((await confirmEmail({ data: { token } })).email);
    } catch (e) {
      setError(errorText(e, t.locale));
      setBusy(false);
    }
  };
  return (
    <AuthCard crest={<MailCheck size={44} />} kicker="Kindred" title={t('email.verify_title')} lede={t('email.verify_lede', { email: info.email })}>
      <AuthError>{error}</AuthError>
      <button className="btn primary auth-go" onClick={() => void go()} disabled={busy}><MailCheck size={19} aria-hidden /> {t('email.verify_go')}</button>
    </AuthCard>
  );
}
