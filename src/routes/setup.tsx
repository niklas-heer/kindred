import { localizeTitle, translateMessage, useT } from '~/lib/i18n';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { Crown, KeyRound, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { AuthCard, AuthError, NoAccessIdentity, PasskeyExplainer } from '~/components/AuthCard';
import { forgetLocalIdentity, passkeysSupported, setUpFirstSteward, setUpWithPassword } from '~/lib/auth/client';
import { firstWay, NewPasswordFields, newPasswordReady, useSignInMethods, WayPicker, type NewWay } from '~/components/signin/PasswordFields';
import { sessionQuery, setupWithAccess } from '~/lib/auth/functions';
import { FirstRunStep, type MadeFamily } from '~/components/FirstRunStep';
import { Notice, useIsClient } from '~/components/ui';
import { createServerFn } from '@tanstack/react-start';

// In code-protected mode, prints the code on the server's console again (at most once a minute) for whoever is setting up.
const nudgeSetupCode = createServerFn({ method: 'POST' }).handler(async () => {
  const [{ announceSetup }, { siteOrigin }, { getRequest }] = await Promise.all([
    import('~/lib/auth/setup.server'), import('~/lib/auth/session.server'), import('@tanstack/react-start/server'),
  ]);
  announceSetup(siteOrigin(getRequest()).origin, true);
});

export const Route = createFileRoute('/setup')({
  loader: async ({ context }) => {
    const session = await context.queryClient.fetchQuery({ ...sessionQuery, staleTime: 0 });
    // A demo has no setup and no accounts.
    if (session.demo) throw redirect({ to: '/' });
  },
  head: ({match}) => ({ meta: [{ title: localizeTitle('Set up · Kindred', match.context.locale) }] }),
  component: Setup,
});


function Setup() {
  const t = useT();
  const { data: session } = useQuery(sessionQuery);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [familyName, setFamilyName] = useState(() => t('setup.family_default'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<MadeFamily | null>(null);
  const client = useIsClient();
  const access = session?.auth === 'cloudflare-access';
  const methods = useSignInMethods();
  const [chosenWay, setWay] = useState<NewWay | null>(null);
  const way = chosenWay ?? firstWay(methods);
  const byPassword = !access && way === 'password' && methods.includes('password');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const supported = access || byPassword || !client || passkeysSupported();

  if (made) return <FirstRunStep {...made} />;

  if (session && !session.needsSetup && access) {
    return (
      <AuthCard crest={<Crown size={44} />} kicker="Kindred" title={t("setup.already_set_up")} lede={t('auth.already_set_up_access')}>
        <Link className="btn primary auth-go" to="/">{t('auth.go_to_kindred')}</Link>
      </AuthCard>
    );
  }

  if (session && !session.needsSetup) {
    return (
      <AuthCard crest={<Crown size={44} />} kicker="Kindred" title={t("setup.already_set_up")} lede={t("setup.kindred_already_has_a_steward_sign_in_with_your_passkey_or_ask_a_steward_for_an_invitation")}>
        <Link className="btn primary auth-go" to="/signin">{t("setup.go_to_sign_in")}</Link>
      </AuthCard>
    );
  }

  if (access && !session?.uninvitedEmail) return <NoAccessIdentity />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = access ? await setupWithAccess({ data: { code, name, familyName } })
        : byPassword ? await setUpWithPassword({ code, name, familyName, username, password })
        : await setUpFirstSteward(code, name, familyName);
      forgetLocalIdentity();
      if (result.tree) {
        setMade({ tree: result.tree, family: familyName.trim() || t('setup.family_default'), steward: name.trim() });
        setBusy(false);
      } else {
        window.location.assign('/');
      }
    } catch (err) {
      setError(err instanceof Error ? translateMessage(err.message, t.locale) : t("setup.setup_didn_t_work_please_try_again"));
      setBusy(false);
    }
  };

  return (
    <AuthCard
      crest={<Crown size={44} />}
      kicker={t("setup.first_time_setup")}
      title={t("setup.become_the_first_steward")}
      lede={access ? t('auth.setup_access_lede', { email: session?.uninvitedEmail ?? '' }) : t("setup.nobody_has_an_account_yet_you_ll_look_after_every_family_on_this_server_invite_relatives_and_choose_what_each_of_them_may_change")}
    >
      {session?.setupOpenToPublic && <Notice icon={<TriangleAlert size={15} />}>{t("setup.open_public_warning")}</Notice>}
      <form className="auth-form" onSubmit={submit}>
        {session?.needsFamily && (
          <label className="field">
            <span>{t("setup.family_name")}</span>
            <input className="input" value={familyName} onChange={(e) => setFamilyName(e.target.value)} required maxLength={80} />
            <p className="auth-hint">{t("setup.family_name_hint")}</p>
          </label>
        )}
        {session?.setupCodeRequired && <>
        <label className="field">
          <span>{t("setup.setup_code")}</span>
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
        <p className="auth-hint"> {t("setup.the_server_printed_it_in_its_terminal_when_it_started_look_for_kindred_setup")}{' '}
          <button type="button" className="auth-link" onClick={() => void nudgeSetupCode()}>{t("setup.print_it_again")}</button>
        </p>
        </>}
        <label className="field">
          <span>{t("setup.your_name")}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={60} placeholder={t("setup.as_the_family_calls_you")} />
        </label>
        {!access && <WayPicker methods={methods} value={way} onChange={setWay} />}
        {byPassword && <NewPasswordFields username={username} onUsername={setUsername} password={password} onPassword={setPassword} />}
        <AuthError>{error}</AuthError>
        {!supported && <AuthError>{t("setup.this_browser_can_t_use_passkeys_try_the_newest_safari_chrome_edge_or_firefox")}</AuthError>}
        <button className="btn primary auth-go" disabled={busy || !supported || (session?.setupCodeRequired && !code.trim()) || !name.trim() || (session?.needsFamily && !familyName.trim()) || (byPassword && !newPasswordReady(username, password))}>
          {access ? <><Crown size={19} /> {t('auth.setup_access_button')}</>
            : byPassword ? <><KeyRound size={19} /> {busy ? t('pw.saving') : t('pw.create_account')}</>
            : <><KeyRound size={19} /> {busy ? t("setup.waiting_for_your_device") : t("setup.create_your_passkey")}</>}
        </button>
      </form>
      {!access && !byPassword && <p className="auth-device-hint">{t("setup.save_your_passkey_in_1password_icloud_keychain_google_password_manager_or_a_security_key")}</p>}
      {!access && !byPassword && <PasskeyExplainer creating />}
    </AuthCard>
  );
}
