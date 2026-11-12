import { formatDate, translate, useT } from '~/lib/i18n';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { KeyRound, MailX, Shield } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AuthCard, AuthError, NoAccessIdentity, PasskeyExplainer } from '~/components/AuthCard';
import { WhoChooser } from '~/components/FirstRun';
import { Arms } from '~/components/Heraldry';
import { ROLE_ICON } from '~/components/RoleIcon';
import { useIsClient } from '~/components/ui';
import { graphQuery } from '~/lib/api';
import { acceptWithPasskey, acceptWithPassword, forgetLocalIdentity, passkeysSupported, signOutRequest } from '~/lib/auth/client';
import { firstWay, NewPasswordFields, newPasswordReady, useSignInMethods, WayPicker, type NewWay } from '~/components/signin/PasswordFields';
import { SsoButtons, useSignInProviders } from '~/components/signin/SingleSignOn';
import { errorText } from '~/lib/errortext';
import { acceptInvite, fetchInvite, joinWithAccess, sessionQuery, setMyPerson } from '~/lib/auth/functions';
import { TermsCheck } from '~/components/operator/TermsCheck';
import { BROWSING } from '~/lib/family';
import { buildFamily } from '~/lib/graph';
import { setPref } from '~/lib/prefs';
import { ROLES } from '~/lib/roles';
import { useSession } from '~/lib/session';

export const Route = createFileRoute('/invite/$token')({
  // The session too, so a Cloudflare Access site's first paint never shows a passkey form.
  loader: async ({ params, context }) => {
    await context.queryClient.ensureQueryData(sessionQuery);
    return { info: await fetchInvite({ data: { token: params.token } }) };
  },
  // The link is a secret: never send it to another site as a Referer.
  head: ({ loaderData, match }) => ({
    meta: [
      { title: loaderData?.info.family ? translate(match.context.locale, 'invite.title', {family:loaderData.info.family.name}) : translate(match.context.locale, 'invite.invitation') },
      { name: 'referrer', content: 'no-referrer' },
    ],
  }),
  staleTime: 0,
  component: Invite,
});


function Invite() {
  const t = useT();
  const { token } = Route.useParams();
  const { info } = Route.useLoaderData();
  const [step, setStep] = useState<'welcome' | 'who'>('welcome');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A steward's invitation, on a server whose operator wrote terms: "I accept the terms" first (the server refuses without).
  const [accepted, setAccepted] = useState(false);
  const client = useIsClient();
  const fam = info.family;
  const session = useSession();
  const access = session?.auth === 'cloudflare-access';
  const methods = useSignInMethods();
  const providers = useSignInProviders();
  // Single sign-on is the only way in this server offers: its buttons are the form's only way to finish.
  const onlySso = !access && !methods.includes('passkey') && !methods.includes('password');
  const [chosenWay, setWay] = useState<NewWay | null>(null);
  const way = chosenWay ?? firstWay(methods);
  const byPassword = !access && way === 'password' && methods.includes('password');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const supported = byPassword || !client || passkeysSupported();

  // The family's own theme, unless the reader chose one.
  useEffect(() => {
    if (!fam) return;
    let saved: string | null = null;
    try { saved = localStorage.getItem('kindred:theme'); } catch {}
    document.documentElement.dataset.theme = saved ?? fam.theme;
  }, [fam]);

  const crest = fam?.crest ? <Arms arms={fam.crest} size={74} /> : <Shield size={44} />;

  // A member who opens their own old link again (people click the link in the email for weeks) is told what is true:
  // they are in, and here is the way. Whatever became of the link itself no longer matters to them.
  if (fam && info.alreadyMember && step === 'welcome') {
    return (
      <AuthCard crest={crest} kicker={fam.name} title={t("invitetoken.you_re_already_in_this_family")} lede={<>{t("invitetoken.you_re_signed_in_as")} <b>{info.signedInAs}</b> {t("invitetoken.and_you_already_belong_to")} {fam.name}.</>}>
        <a className="btn primary auth-go" href={`/${fam.id}`} data-autofocus>{t("invitetoken.open")} {fam.name}</a>
      </AuthCard>
    );
  }

  if (!fam || info.status !== 'open') {
    const copy = {
      expired: [t("invitetoken.this_invitation_has_expired"), <>{t("invitetoken.invitations_last_two_weeks_ask")} {info.inviter ?? t("invitetoken.whoever_sent_it")} {t("invitetoken.for_a_new_link")}</>],
      // Someone signed in is never told to sign in: the link was used by another person.
      used: [t("invitetoken.this_invitation_was_already_used"), access ? t('auth.invite_used_access') : info.signedInAs ? t('invitetoken.used_signed_in', { name: info.signedInAs }) : t("invitetoken.if_it_was_you_sign_in_with_your_passkey_each_link_works_once_for_one_person")],
      revoked: [t("invitetoken.this_invitation_was_withdrawn"), t("invitetoken.the_steward_who_sent_it_has_cancelled_it_ask_them_if_you_should_have_a_new_one")],
      unknown: [t("invitetoken.this_invitation_link_isn_t_valid"), t("invitetoken.check_that_you_copied_the_whole_link_or_ask_for_a_new_one")],
      open: ['', ''],
    }[info.status];
    return (
      <AuthCard crest={fam ? crest : <MailX size={44} />} kicker={fam?.name ?? 'Kindred'} title={copy[0]} lede={copy[1]}>
        {access
          ? <Link className="btn primary auth-go" to="/">{t('auth.go_to_kindred')}</Link>
          : info.signedInAs
          ? <Link className="btn primary auth-go" to="/" search={{ families: 'all' }}>{t('invitetoken.to_your_families')}</Link>
          : <Link className="btn primary auth-go" to="/signin" search={fam ? { next: `/${fam.id}` } : {}}>{t("invitetoken.sign_in")}</Link>}
      </AuthCard>
    );
  }

  const role = ROLES.find((r) => r.id === info.role)!;

  if (step === 'who') return <WhoStep tree={fam.id} familyName={fam.name} crest={crest} name={name.trim() || info.signedInAs || undefined} />;

  if (access && !info.signedInAs && !session?.uninvitedEmail) return <NoAccessIdentity />;

  const createAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const acceptTerms = info.terms ? accepted : undefined;
      if (access) await joinWithAccess({ data: { token, name, acceptTerms } });
      else if (byPassword) await acceptWithPassword({ token, name, username, password, acceptTerms });
      else await acceptWithPasskey(token, name, acceptTerms);
      forgetLocalIdentity();
      setStep('who');
    } catch (err) {
      setError(err instanceof Error ? errorText(err, t.locale) : t("invitetoken.that_didn_t_work_please_try_again"));
    } finally {
      setBusy(false);
    }
  };
  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      await acceptInvite({ data: { token, acceptTerms: info.terms ? accepted : undefined } });
      setStep('who');
    } catch (err) {
      setError(err instanceof Error ? err.message : t("invitetoken.that_didn_t_work_please_try_again"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard
      crest={crest}
      kicker={t("invitetoken.you_re_invited")}
      title={<>{t("invitetoken.join")} {fam.name}</>}
      lede={fam.tagline || undefined}
    >
      <div className="auth-role">
        <span aria-hidden>{ROLE_ICON[role.id]}</span>
        <div>
          <b>{info.inviter ? t('invite.invitedAs', {name:info.inviter, role:t(`role.${role.id}`)}) : t('invite.invitedAsAnon', {role:t(`role.${role.id}`)})}</b>
          <small>{t(`role.${role.id}Description`)}. {info.expires ? t('invite.expires', {date:formatDate(info.expires,t.locale)}) : ''}</small>
        </div>
      </div>
      {info.signedInAs ? (
        <div className="auth-form">
          {info.terms && <TermsCheck checked={accepted} onChange={setAccepted} />}
          <AuthError>{error}</AuthError>
          <button className="btn primary auth-go" onClick={join} disabled={busy || (!!info.terms && !accepted)} data-autofocus>
            {busy ? t("invitetoken.joining") : <>{t("invitetoken.join_as")} {info.signedInAs}</>}
          </button>
          <div className="auth-alt">
            <span>{t("invitetoken.not")} {info.signedInAs}?</span>
            {session?.accessLogout
              ? <a className="auth-link" href={session.accessLogout}>{t("invitetoken.sign_out")}</a>
              : <button className="auth-link" onClick={() => void signOutRequest().finally(() => { forgetLocalIdentity(); window.location.reload(); })}>{t("invitetoken.sign_out")}</button>}
          </div>
        </div>
      ) : (
        <>
          <form className="auth-form" onSubmit={createAccount}>
            <label className="field">
              <span>{t("invitetoken.what_should_the_family_call_you")}</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={60} placeholder={t("invitetoken.your_name")} />
            </label>
            {!access && <WayPicker methods={methods} value={way} onChange={setWay} />}
            {byPassword && <NewPasswordFields username={username} onUsername={setUsername} password={password} onPassword={setPassword} />}
            {info.terms && <TermsCheck checked={accepted} onChange={setAccepted} />}
            <AuthError>{error}</AuthError>
            {!access && !onlySso && !supported && <AuthError>{t("invitetoken.this_browser_can_t_use_passkeys_open_the_link_in_the_newest_safari_chrome_edge_or_firefox_or_on_your_phone")}</AuthError>}
            {!onlySso && <button className="btn primary auth-go" disabled={busy || (!access && !supported) || !name.trim() || (!!info.terms && !accepted) || (byPassword && !newPasswordReady(username, password))}>
              {access ? t('auth.join_as', { email: session?.uninvitedEmail ?? '' })
                : byPassword ? <><KeyRound size={19} /> {busy ? t('pw.saving') : t('pw.create_account')}</>
                : <><KeyRound size={19} /> {busy ? t("invitetoken.waiting_for_your_device") : t("invitetoken.create_your_passkey")}</>}
            </button>}
          </form>
          {!access && methods.includes('oidc') && providers.length > 0 && <>
            {!onlySso && <p className="pw-or">{t('pw.or')}</p>}
            <SsoButtons providers={providers} purpose="invite" token={token} name={name.trim()} acceptTerms={info.terms ? accepted : undefined}
              disabled={busy || !name.trim() || (!!info.terms && !accepted)} onError={setError} />
          </>}
          {!access && <>
            <div className="auth-alt">
              <span>{t("invitetoken.already_use_kindred")}</span>
              <Link className="auth-link" to="/signin" search={{ next: `/invite/${token}` }}>{t("invitetoken.sign_in_first")}</Link>
            </div>
            {!byPassword && !onlySso && <PasskeyExplainer creating />}
          </>}
        </>
      )}
    </AuthCard>
  );
}

/** After joining: "Who are you in this family?" (the same chooser stewards see in the tree), then into the tree. */
function WhoStep({ tree, familyName, crest, name }: { tree: string; familyName: string; crest: ReactNode; name?: string }) {
  const t = useT();
  const graph = useQuery(graphQuery(tree));
  const f = useMemo(() => (graph.data ? buildFamily(graph.data) : null), [graph.data]);
  const session = useSession();
  const [saving, setSaving] = useState(false);
  const choose = async (id: string) => {
    setSaving(true);
    setPref(`me:${tree}`, id);
    try { await setMyPerson({ data: { tree, person: id } }); } catch {}
    window.location.assign(id === BROWSING ? `/${tree}` : `/${tree}?focus=${encodeURIComponent(id)}`);
  };
  return (
    <AuthCard
      wide
      crest={crest}
      kicker={t('invite.welcome', {family:familyName})}
      title={t("invitetoken.who_are_you_in_this_family")}
      lede={<>{t("invitetoken.kindred_names_everyone_from_your_point_of_view_your_great_aunt_your_second_cousin")}</>}
    >
      <div className="auth-who" aria-busy={saving}>
        {graph.isError ? (
          <AuthError>{t("invitetoken.the_family_tree_couldn_t_be_loaded")} <button className="auth-link" onClick={() => void graph.refetch()}>{t("invitetoken.retry")}</button></AuthError>
        ) : !f ? (
          <p className="subtle">{t("invitetoken.loading_the_family")}</p>
        ) : (
          <WhoChooser f={f} tree={tree} onChoose={(id) => void choose(id)} name={name ?? session?.user?.name} autoFocus busy={saving} />
        )}
      </div>
    </AuthCard>
  );
}
