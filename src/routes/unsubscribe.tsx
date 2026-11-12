// Unsubscribing from one kind of email (src/lib/email/send.server.ts): the link at the foot of every email that is not about an
// account's security. Opening it changes nothing; the button does. The link's proof covers the address and the kind, so it
// unsubscribes nobody else and from nothing else. A mail program's one-click unsubscribe posts to /api/unsubscribe instead.
import { createFileRoute, Link } from '@tanstack/react-router';
import { MailMinus, MailX } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { AuthCard, AuthError } from '~/components/AuthCard';
import { unsubscribeMail } from '~/lib/email/email.functions';
import { isOptionalCategory, type OptionalCategory } from '~/lib/email/shared';
import { errorText } from '~/lib/errortext';
import { translate, useT, type Key } from '~/lib/i18n';

const CATEGORY: Record<OptionalCategory, Key> = { invitation: 'email.cat_invitation', operator: 'email.cat_operator', family: 'email.cat_family', receipt: 'email.cat_receipt' };

export const Route = createFileRoute('/unsubscribe')({
  validateSearch: z.object({ r: z.string().max(100).optional().catch(undefined), c: z.string().max(40).optional().catch(undefined), t: z.string().max(100).optional().catch(undefined) }),
  head: ({ match }) => ({ meta: [{ title: `${translate(match.context.locale ?? 'en', 'email.unsub_title')} · Kindred` }, { name: 'referrer', content: 'no-referrer' }, { name: 'robots', content: 'noindex' }] }),
  component: Unsubscribe,
});

function Unsubscribe() {
  const t = useT();
  const { r, c, t: mac } = Route.useSearch();
  const [state, setState] = useState<'ask' | 'busy' | 'done' | 'bad'>(r && mac && isOptionalCategory(c) ? 'ask' : 'bad');
  const [error, setError] = useState<string | null>(null);
  if (state === 'bad') return <AuthCard crest={<MailX size={44} />} kicker="Kindred" title={t('email.unsub_title')} lede={t('email.unsub_bad')}><Link className="btn auth-go" to="/">{t('email.to_kindred')}</Link></AuthCard>;
  if (state === 'done') return <AuthCard crest={<MailMinus size={44} />} kicker="Kindred" title={t('email.unsub_done_title')} lede={t('email.unsub_done')}><Link className="btn auth-go" to="/">{t('email.to_kindred')}</Link></AuthCard>;
  const go = async () => {
    setState('busy');
    setError(null);
    try {
      const { ok } = await unsubscribeMail({ data: { r: r!, c: c!, t: mac! } });
      setState(ok ? 'done' : 'bad');
    } catch (e) {
      setError(errorText(e, t.locale));
      setState('ask');
    }
  };
  return (
    <AuthCard crest={<MailMinus size={44} />} kicker="Kindred" title={t('email.unsub_title')} lede={t('email.unsub_lede', { category: t(CATEGORY[c as OptionalCategory]) })}>
      <AuthError>{error}</AuthError>
      <button className="btn primary auth-go" onClick={() => void go()} disabled={state === 'busy'}><MailMinus size={19} aria-hidden /> {t('email.unsub_go')}</button>
    </AuthCard>
  );
}
