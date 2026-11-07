import { useQuery } from '@tanstack/react-query';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { Info, KeyRound, LogOut } from 'lucide-react';
import { useState } from 'react';
import { AuthCard, AuthError, PasskeyExplainer } from '~/components/AuthCard';
import { forgetLocalIdentity, passkeysSupported, safeNext, signInWithPasskey, signOutRequest } from '~/lib/auth/client';
import { sessionQuery } from '~/lib/auth/functions';
import { useIsClient } from '~/components/ui';

export const Route = createFileRoute('/signin')({
  validateSearch: (s: Record<string, unknown>): { next?: string } => (typeof s.next === 'string' ? { next: s.next } : {}),
  beforeLoad: async ({ context, search }) => {
    const session = await context.queryClient.fetchQuery({ ...sessionQuery, staleTime: 0 });
    if (session.needsSetup) throw redirect({ to: '/setup' });
    if (session.user) throw redirect({ href: safeNext(search.next) });
  },
  head: () => ({ meta: [{ title: 'Sign in · Kindred' }] }),
  component: SignIn,
});

function SignIn() {
  const { next } = Route.useSearch();
  const { data: session } = useQuery(sessionQuery);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const client = useIsClient();
  const supported = !client || passkeysSupported();

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithPasskey();
      forgetLocalIdentity();
      // A full load, so nothing from before signing in stays in memory.
      window.location.assign(safeNext(next));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Signing in didn’t work. Please try again.');
      setBusy(false);
    }
  };

  return (
    <AuthCard
      crest={<KeyRound size={44} />}
      kicker="Kindred"
      title="Welcome back"
      lede="Sign in to see your family’s tree, stories and birthdays."
    >
      {session?.uninvitedEmail && (
        <p className="auth-note" role="status">
          <Info size={18} />
          <span>
            You’re signed in as <b>{session.uninvitedEmail}</b>, but nobody has invited that address to a family yet. Ask a steward of your family to invite you.
            {session.accessLogout && <> <a className="auth-link" href={session.accessLogout}>Use another account</a></>}
          </span>
        </p>
      )}
      <div className="auth-form">
        <AuthError>{error}</AuthError>
        {!supported && <AuthError>This browser can’t use passkeys. Try the newest Safari, Chrome, Edge or Firefox, or your phone.</AuthError>}
        <button className="btn primary auth-go" onClick={go} disabled={busy || !supported} data-autofocus>
          <KeyRound size={19} /> {busy ? 'Waiting for your device…' : 'Sign in with a passkey'}
        </button>
      </div>
      <p className="auth-device-hint"><b>Use a passkey from another device</b><br />In the passkey prompt, choose another device or a phone, then scan the QR code. You can also choose 1Password or your password manager.</p>
      <PasskeyExplainer />
      {session?.uninvitedEmail && session.accessLogout && (
        <div className="auth-alt">
          <button className="auth-link" onClick={() => void signOutRequest().finally(() => window.location.assign(session.accessLogout!))}><LogOut size={14} /> Sign out</button>
        </div>
      )}
    </AuthCard>
  );
}
