import { localizeTitle, translateMessage, useT } from '~/lib/i18n';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Crown, KeyRound, TriangleAlert, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { AuthCard, AuthError, PasskeyExplainer } from '~/components/AuthCard';
import { forgetLocalIdentity, passkeysSupported, setUpFirstSteward } from '~/lib/auth/client';
import { sessionQuery } from '~/lib/auth/functions';
import { chooseMe } from '~/lib/family';
import { opKeys } from '~/lib/api';
import { addSelfToFamily } from '~/lib/person.functions';
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
    await context.queryClient.fetchQuery({ ...sessionQuery, staleTime: 0 });
  },
  head: ({match}) => ({ meta: [{ title: localizeTitle('Set up · Kindred', match.context.locale) }] }),
  component: Setup,
});

/** A family the setup has just made: the steward is in it, and adds themselves before anything else. */
interface MadeFamily { tree: string; family: string; steward: string }

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
  const supported = !client || passkeysSupported();

  if (made) return <FirstRunStep {...made} />;

  if (session && !session.needsSetup) {
    return (
      <AuthCard crest={<Crown size={44} />} kicker="Kindred" title={t("setup.already_set_up")} lede={t("setup.kindred_already_has_a_steward_sign_in_with_your_passkey_or_ask_a_steward_for_an_invitation")}>
        <Link className="btn primary auth-go" to="/signin">{t("setup.go_to_sign_in")}</Link>
      </AuthCard>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await setUpFirstSteward(code, name, familyName);
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
      lede={t("setup.nobody_has_an_account_yet_you_ll_look_after_every_family_on_this_server_invite_relatives_and_choose_what_each_of_them_may_change")}
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
        <AuthError>{error}</AuthError>
        {!supported && <AuthError>{t("setup.this_browser_can_t_use_passkeys_try_the_newest_safari_chrome_edge_or_firefox")}</AuthError>}
        <button className="btn primary auth-go" disabled={busy || !supported || (session?.setupCodeRequired && !code.trim()) || !name.trim() || (session?.needsFamily && !familyName.trim())}>
          <KeyRound size={19} /> {busy ? t("setup.waiting_for_your_device") : t("setup.create_your_passkey")}
        </button>
      </form>
      <p className="auth-device-hint">{t("setup.save_your_passkey_in_1password_icloud_keychain_google_password_manager_or_a_security_key")}</p>
      <PasskeyExplainer creating />
    </AuthCard>
  );
}

/**
 * The first-run prompt after setup: the steward is signed in and in their new family, which is empty. They add
 * themselves to it, which makes them its starting point. Skipping goes to the family all the same.
 */
function FirstRunStep({ tree, family, steward }: MadeFamily) {
  const t = useT();
  const [keys] = useState(opKeys);
  const [who, setWho] = useState(steward);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addMe = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { tree, name: who.trim() };
      const id = await addSelfToFamily({ data: { ...body, opKey: keys.for('self', body) } });
      keys.clear('self');
      await chooseMe(tree, id);
      window.location.assign(`/${tree}`);
    } catch (err) {
      setError(err instanceof Error ? translateMessage(err.message, t.locale) : t('setup.family_add_failed'));
      setBusy(false);
    }
  };

  return (
    <AuthCard crest={<Crown size={44} />} kicker={family} title={t('setup.family_ready_title', { name: family })} lede={t('setup.family_ready_lede')}>
      <form className="auth-form" onSubmit={addMe}>
        <label className="field">
          <span>{t('setup.your_name')}</span>
          <input className="input" value={who} onChange={(e) => setWho(e.target.value)} required maxLength={120} autoFocus />
        </label>
        <AuthError>{error}</AuthError>
        <button className="btn primary auth-go" disabled={busy || !who.trim()}>
          <UserPlus size={19} /> {t('setup.add_me')}
        </button>
      </form>
      <p className="auth-device-hint"><a className="auth-link" href={`/${tree}`}>{t('setup.skip')}</a></p>
    </AuthCard>
  );
}
