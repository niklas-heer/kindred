import { localizeTitle, useT } from '~/lib/i18n';
import { errorText } from '~/lib/errortext';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { KeyRound, LogOut } from 'lucide-react';
import { useState } from 'react';
import { AuthCard, AuthError, NoAccessIdentity, PasskeyExplainer } from '~/components/AuthCard';
import { RequestFamilyLink } from '~/components/operator/LegalFooter';
import { forgetLocalIdentity, passkeysSupported, safeNext, signInWithPasskey } from '~/lib/auth/client';
import { sessionQuery } from '~/lib/auth/functions';
import { useIsClient } from '~/components/ui';
import { useSignInMethods } from '~/components/signin/PasswordFields';
import { PasswordSignIn } from '~/components/signin/PasswordSignIn';
import { OIDC_ERRORS, SsoButtons, useSignInProviders } from '~/components/signin/SingleSignOn';

export const Route = createFileRoute('/signin')({
  validateSearch: (s: Record<string, unknown>): { next?: string; oidc_error?: string } => ({
    ...(typeof s.next === 'string' ? { next: s.next } : {}),
    // A single sign-on provider's callback that failed says why here (src/lib/auth/oidc.server.ts).
    ...(typeof s.oidc_error === 'string' ? { oidc_error: s.oidc_error } : {}),
  }),
  beforeLoad: async ({ context, search }) => {
    const session = await context.queryClient.fetchQuery({ ...sessionQuery, staleTime: 0 });
    if (session.needsSetup) throw redirect({ to: '/setup' });
    if (session.user) throw redirect({ href: safeNext(search.next) });
  },
  head: ({match}) => ({ meta: [{ title: localizeTitle('Sign in · Kindred', match.context.locale) }] }),
  component: SignIn,
});

function SignIn() {
  const { data: session } = useQuery(sessionQuery);
  return session?.auth === 'cloudflare-access' ? <AccessSignIn uninvited={session.uninvitedEmail} logout={session.accessLogout} /> : <PasskeySignIn />;
}

/** Cloudflare Access is the only sign-in: nothing to do here but say why this person isn't in. */
function AccessSignIn({ uninvited, logout }: { uninvited?: string; logout?: string }) {
  const t = useT();
  if (!uninvited) return <NoAccessIdentity />;
  return (
    <AuthCard
      crest={<KeyRound size={44} />}
      kicker="Kindred"
      title={t('auth.uninvited_title')}
      lede={<>{t("signin.you_re_signed_in_as")} <b>{uninvited}</b>{t("signin.but_nobody_has_invited_that_address_to_a_family_yet_ask_a_steward_of_your_family_to_invite_you")}</>}
    >
      {logout && <a className="btn auth-go" href={logout}><LogOut size={16} /> {t("signin.use_another_account")}</a>}
    </AuthCard>
  );
}

/** Kindred's own sign-in: a passkey, a username and password, or both, as the server's operator chose. */
function PasskeySignIn() {
  const t = useT();
  const { next, oidc_error } = Route.useSearch();
  const methods = useSignInMethods();
  const passkeys = methods.includes('passkey');
  const passwords = methods.includes('password');
  const providers = useSignInProviders();
  const sso = methods.includes('oidc') && providers.length > 0;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(oidc_error ? t(OIDC_ERRORS[oidc_error] ?? 'oidc.err.failed') : null);
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
      setError(e instanceof Error ? errorText(e, t.locale) : t("signin.signing_in_didn_t_work_please_try_again"));
      setBusy(false);
    }
  };

  return (
    <AuthCard
      crest={<KeyRound size={44} />}
      kicker="Kindred"
      title={t("signin.welcome_back")}
      lede={t("signin.sign_in_to_see_your_family_s_tree_stories_and_birthdays")}
    >
      {passkeys && <>
      <div className="auth-form">
        <AuthError>{error}</AuthError>
        {!supported && <AuthError>{t("signin.this_browser_can_t_use_passkeys_try_the_newest_safari_chrome_edge_or_firefox_or_your_phone")}</AuthError>}
        <button className={`btn ${passwords ? '' : 'primary '}auth-go`} onClick={go} disabled={busy || !supported} data-autofocus>
          <KeyRound size={19} /> {busy ? t("signin.waiting_for_your_device") : t("signin.sign_in_with_a_passkey")}
        </button>
      </div>
      <p className="auth-device-hint"><b>{t("signin.use_a_passkey_from_another_device")}</b><br />{t("signin.in_the_passkey_prompt_choose_another_device_or_a_phone_then_scan_the_qr_code_you_can_also_choose_1password_or_your_password_manager")}</p>
      </>}
      {passkeys && passwords && <p className="pw-or">{t('pw.or')}</p>}
      {passwords && <PasswordSignIn next={next} />}
      {sso && <>
        {(passkeys || passwords) && <p className="pw-or">{t('pw.or')}</p>}
        {!passkeys && <AuthError>{error}</AuthError>}
        <SsoButtons providers={providers} purpose="signin" next={safeNext(next)} onError={setError} />
      </>}
      {passkeys && <PasskeyExplainer />}
      <RequestFamilyLink />
    </AuthCard>
  );
}
