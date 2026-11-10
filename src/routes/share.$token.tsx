import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { DoorOpen, Link2Off, Shield } from 'lucide-react';
import { useState } from 'react';
import { AuthCard, AuthError } from '~/components/AuthCard';
import { fetchShareEntry, openShareLink } from '~/lib/auth/share.functions';
import { translate, useT } from '~/lib/i18n';
import { useSession } from '~/lib/session';

/** The token in the path after a visit ends: the page says so, and asks for nothing. */
const LEFT = 'left';

export const Route = createFileRoute('/share/$token')({
  loader: async ({ params }) => {
    if (params.token === LEFT) return { entry: { status: 'left' as const } };
    const entry = await fetchShareEntry({ data: { token: params.token } });
    // Already looking around through this link: nothing to ask.
    if (entry.status === 'inside') throw redirect({ to: '/$tree', params: { tree: entry.tree } });
    return { entry };
  },
  // The link is a secret, so it must never reach another site as a Referer; and it is nobody's search result.
  head: ({ match }) => ({
    meta: [
      { title: translate(match.context.locale, 'share.pageTitle') },
      { name: 'referrer', content: 'no-referrer' },
      { name: 'robots', content: 'noindex' },
    ],
  }),
  staleTime: 0,
  component: SharePage,
});

function SharePage() {
  const t = useT();
  const { token } = Route.useParams();
  const { entry } = Route.useLoaderData();
  const session = useSession();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);

  if (entry.status === 'left') {
    return (
      <AuthCard crest={<DoorOpen size={44} />} kicker="Kindred" title={t('share.leftTitle')} lede={t('share.leftLede')}>
        {!session?.guestHost && <div className="auth-alt"><Link to="/signin">{t('share.signIn')}</Link></div>}
      </AuthCard>
    );
  }
  if (entry.status === 'closed' || closed) {
    return <AuthCard crest={<Link2Off size={44} />} kicker="Kindred" title={t('share.closedTitle')} lede={t('share.closedLede')}>{null}</AuthCard>;
  }

  const needsPassword = entry.status === 'open' && entry.password;
  const open = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await openShareLink({ data: { token, password: needsPassword ? password : undefined } });
      if (r.status === 'ok') {
        // A full load, so the family is read with the visit's own cookie and nothing from before stays in memory.
        window.location.assign(`/${r.tree}`);
        return;
      }
      if (r.status === 'closed') setClosed(true);
      else setError(t(r.status === 'slow' ? 'share.slow' : 'share.wrong'));
    } catch {
      setError(t('share.err'));
    }
    setBusy(false);
  };

  return (
    <AuthCard crest={<Shield size={44} />} kicker="Kindred" title={t('share.visitTitle')} lede={t(needsPassword ? 'share.visitLedePassword' : 'share.visitLedeOpen')}>
      <form className="auth-form" onSubmit={open}>
        {needsPassword && (
          <label className="field">
            <span>{t('share.passwordField')}</span>
            {/* The password arrives in a message and is pasted or typed once, so the letters stay visible. */}
            <input className="input" value={password} onChange={(e) => setPassword(e.target.value)} required maxLength={100} autoFocus autoComplete="off" autoCapitalize="characters" spellCheck={false} aria-invalid={error ? true : undefined} aria-describedby={error ? 'share-error' : undefined} />
          </label>
        )}
        <AuthError id="share-error">{error}</AuthError>
        {entry.status === 'open' && entry.measured && <p className="auth-device-hint">{t('join.measured_entry')}</p>}
        <button className="btn primary auth-go" disabled={busy || (needsPassword && !password.trim())}>{busy ? t('share.entering') : t('share.enter')}</button>
      </form>
    </AuthCard>
  );
}
