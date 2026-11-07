import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Crown, KeyRound } from 'lucide-react';
import { useState } from 'react';
import { AuthCard, AuthError, PasskeyExplainer } from '~/components/AuthCard';
import { forgetLocalIdentity, passkeysSupported, setUpFirstSteward } from '~/lib/auth/client';
import { sessionQuery } from '~/lib/auth/functions';
import { useIsClient } from '~/components/ui';
import { createServerFn } from '@tanstack/react-start';

// Prints the code on the server's console again (at most once a minute) for whoever is setting up.
const nudgeSetupCode = createServerFn({ method: 'POST' }).handler(async () => {
  const [{ announceSetup }, { siteOrigin }, { getRequest }] = await Promise.all([
    import('~/lib/auth/setup.server'), import('~/lib/auth/session.server'), import('@tanstack/react-start/server'),
  ]);
  announceSetup(siteOrigin(getRequest()).origin, true);
});

export const Route = createFileRoute('/setup')({
  loader: async ({ context }) => {
    await context.queryClient.fetchQuery({ ...sessionQuery, staleTime: 0 });
  },
  head: () => ({ meta: [{ title: 'Set up · Kindred' }] }),
  component: Setup,
});

function Setup() {
  const { data: session } = useQuery(sessionQuery);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const client = useIsClient();
  const supported = !client || passkeysSupported();

  if (session && !session.needsSetup) {
    return (
      <AuthCard crest={<Crown size={44} />} kicker="Kindred" title="Already set up" lede="Kindred already has a steward. Sign in with your passkey, or ask a steward for an invitation.">
        <Link className="btn primary auth-go" to="/signin">Go to sign in</Link>
      </AuthCard>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await setUpFirstSteward(code, name);
      forgetLocalIdentity();
      window.location.assign('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup didn’t work. Please try again.');
      setBusy(false);
    }
  };

  return (
    <AuthCard
      crest={<Crown size={44} />}
      kicker="First-time setup"
      title="Become the first steward"
      lede="Nobody has an account yet. You’ll look after every family on this server: invite relatives, and choose what each of them may change."
    >
      <form className="auth-form" onSubmit={submit}>
        <label className="field">
          <span>Setup code</span>
          <input
            className="input auth-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            required
            maxLength={40}
          />
        </label>
        <p className="auth-hint">
          The server printed it in its terminal when it started (look for “Kindred setup”).{' '}
          <button type="button" className="auth-link" onClick={() => void nudgeSetupCode()}>Print it again</button>
        </p>
        <label className="field">
          <span>Your name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={60} placeholder="As the family calls you" />
        </label>
        <AuthError>{error}</AuthError>
        {!supported && <AuthError>This browser can’t use passkeys. Try the newest Safari, Chrome, Edge or Firefox.</AuthError>}
        <button className="btn primary auth-go" disabled={busy || !supported || !code.trim() || !name.trim()}>
          <KeyRound size={19} /> {busy ? 'Waiting for your device…' : 'Create your passkey'}
        </button>
      </form>
      <PasskeyExplainer creating />
    </AuthCard>
  );
}
