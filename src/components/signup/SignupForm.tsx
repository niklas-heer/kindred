// Starting a family (/signup) on a server that takes sign-ups (docs/hosting-many-families.md, "Hosting and sign-up"): your
// name, the family's name and address, a contact email, the terms and the processing agreement, "I am 16 or older", and
// Turnstile. Signed out, the new account gets a way in the server offers (`signup.methods`): a passkey, a username and
// password, or a single sign-on provider, whose verified email lets the family start even while unverified sign-ups wait.
// Signed in, the family is the account's own. When sign-up is closed or full, the page says why and offers the request form.
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { HeartHandshake, KeyRound, MailCheck, Sparkles } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { AuthCard, AuthError, PasskeyExplainer } from '~/components/AuthCard';
import { FirstRunStep, type MadeFamily } from '~/components/FirstRunStep';
import { Honeypot, Labelled } from '~/components/operator/PublicForms';
import { Turnstile } from '~/components/operator/Turnstile';
import { Skeleton, useIsClient } from '~/components/ui';
import { NewPasswordFields, newPasswordReady, WayPicker, type NewWay } from '~/components/signin/PasswordFields';
import { OIDC_ERRORS, SsoButtons, useSignInProviders } from '~/components/signin/SingleSignOn';
import { forgetLocalIdentity, passkeysSupported, signUpWithPasskey, signUpWithPassword } from '~/lib/auth/client';
import { errorText } from '~/lib/errortext';
import { useT } from '~/lib/i18n';
import { useSession } from '~/lib/session';
import { publicHostingQuery, signupSignedIn, signupWaitlist } from '~/lib/signup/signup.functions';
import type { PublicHosting } from '~/lib/signup/shared';
import '~/components/operator/operator.css';
import './signup.css';

/** As the server suggests an id (suggestId in families.server.ts), so the address fills in while the name is typed. */
const suggestId = (name: string) =>
  name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[0-9-]+/, '').slice(0, 40).replace(/-+$/, '');

export function SignupPage({ code, oidcError }: { code?: string; oidcError?: string }) {
  const t = useT();
  const { data } = useQuery(publicHostingQuery(code));
  const [made, setMade] = useState<MadeFamily | null>(null);
  const [asked, setAsked] = useState<string | null>(null);
  if (made) return <FirstRunStep {...made} />;
  if (asked) return <AuthCard crest={<MailCheck size={44} />} title={t('request.sent_title')} lede={t('request.in_touch', { email: asked })} />;
  if (!data) return <AuthCard crest={<Sparkles size={44} />} title={t('signup.title')}><Skeleton lines={5} /></AuthCard>;
  if (!data.signup.open) return <Closed data={data} />;
  return <Form data={data} code={code} oidcError={oidcError} onMade={setMade} onAsked={setAsked} />;
}

function Closed({ data }: { data: PublicHosting }) {
  const t = useT();
  const navigate = useNavigate();
  const [typed, setTyped] = useState('');
  const reason = data.signup.reason ?? 'closed';
  const lede = { closed: t('signup.closed'), not_ready: t('signup.not_ready'), day: t('signup.day'), full: t('signup.full'), code: t('signup.code_bad') }[reason];
  return (
    <AuthCard crest={<Sparkles size={44} />} kicker={data.instanceName || 'Kindred'} title={t('signup.title')} lede={lede}>
      {data.signup.requests && <Link className="btn primary auth-go" to="/request"><HeartHandshake size={18} aria-hidden /> {t('signup.ask_instead')}</Link>}
      {/* Someone given a code types it here (the operator may also send the link with the code in it). */}
      {(reason === 'closed' || reason === 'code') && data.signup.requests && (
        <form className="families-row signup-code" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) void navigate({ to: '/signup', search: { code: typed.trim() } }); }}>
          <Labelled label={t('signup.have_code')}>{(id) => <input id={id} className="input auth-code" maxLength={40} autoComplete="off" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} />}</Labelled>
          <button type="submit" className="btn" disabled={!typed.trim()}>{t('signup.use_code')}</button>
        </form>
      )}
      <p className="auth-alt"><Link to="/signin">{t('signup.have_account')}</Link></p>
    </AuthCard>
  );
}

function Form({ data, code, oidcError, onMade, onAsked }: { data: PublicHosting; code?: string; oidcError?: string; onMade: (m: MadeFamily) => void; onAsked: (email: string) => void }) {
  const t = useT();
  const session = useSession();
  const signedIn = !!session?.user;
  const client = useIsClient();
  const methods = data.signup.methods;
  // The ways a new account may be made here; a provider's button stands beside the form's own button.
  const [chosenWay, setWay] = useState<NewWay | null>(null);
  const way: NewWay = chosenWay ?? (methods.includes('passkey') ? 'passkey' : 'password');
  const byPassword = !signedIn && way === 'password' && methods.includes('password');
  const formWay = methods.includes('passkey') || methods.includes('password');
  const providers = useSignInProviders();
  const sso = !signedIn && methods.includes('oidc') ? providers : [];
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const supported = signedIn || byPassword || !client || passkeysSupported();
  const [form, setForm] = useState({ name: '', familyName: '', familyId: '', email: '' });
  const [idTouched, setIdTouched] = useState(false);
  const [accept, setAccept] = useState(false);
  const [age16, setAge16] = useState(false);
  const [website, setWebsite] = useState('');
  const [turnstile, setTurnstile] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(oidcError ? t(oidcError === 'account_exists' ? 'oidc.err.signup_exists' : OIDC_ERRORS[oidcError] ?? 'oidc.err.failed') : null);
  const turnstileKey = data.turnstileSiteKey;
  const waitlist = data.signup.waitlist && !signedIn;
  const body = { ...form, accept, age16, theme: 'codex' as const, locale: t.locale, website, turnstile, ...(code ? { code } : {}) };
  const go = useMutation({
    mutationFn: async (): Promise<{ tree?: string; email?: string }> => {
      if (waitlist) return signupWaitlist({ data: body });
      if (signedIn) return signupSignedIn({ data: body });
      if (byPassword) return signUpWithPassword({ ...body, username, password });
      return signUpWithPasskey(body);
    },
    onSuccess: (r) => {
      if (r.email) return onAsked(r.email);
      if (!signedIn) forgetLocalIdentity();
      onMade({ tree: r.tree!, family: form.familyName.trim(), steward: signedIn ? session!.user!.name : form.name.trim() });
    },
    onError: (e) => { setError(errorText(e, t.locale)); setTurnstile(undefined); },
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    setError(null);
    const next = { ...form, [k]: e.target.value };
    if (k === 'familyName' && !idTouched) next.familyId = suggestId(e.target.value);
    setForm(next);
  };
  const filled = !!((signedIn || form.name.trim()) && form.familyName.trim() && form.familyId.trim() && form.email.trim() && accept && age16 && !(turnstileKey && !turnstile));
  const ready = filled && supported && (!byPassword || newPasswordReady(username, password));
  const submit = (e: FormEvent) => { e.preventDefault(); if (ready && !go.isPending) { setError(null); go.mutate(); } };
  const origin = client ? window.location.host : '';
  return (
    <AuthCard crest={<Sparkles size={44} />} kicker={data.instanceName || 'Kindred'} title={t('signup.title')} lede={waitlist ? t('signup.lede_waitlist') : signedIn ? t('signup.lede_signed_in') : t('signup.lede')} wide>
      {code && <p className="auth-note"><KeyRound size={16} aria-hidden /> {t('signup.with_code')}</p>}
      <form className="auth-form" onSubmit={submit}>
        {!signedIn && <Labelled label={t('signup.your_name')}>{(id) => <input id={id} className="input" required maxLength={60} autoComplete="name" value={form.name} onChange={set('name')} />}</Labelled>}
        <Labelled label={t('signup.family_name')} hint={t('signup.family_name_hint')}>{(id, hint) => <input id={id} aria-describedby={hint} className="input" required maxLength={80} autoComplete="off" value={form.familyName} onChange={set('familyName')} />}</Labelled>
        <Labelled label={t('signup.family_id')} hint={t('signup.family_id_hint', { address: `${origin}/${form.familyId || '…'}` })}>
          {(id, hint) => <input id={id} aria-describedby={hint} className="input" required maxLength={40} autoComplete="off" spellCheck={false} value={form.familyId} onChange={(e) => { setIdTouched(true); set('familyId')(e); }} />}
        </Labelled>
        <Labelled label={t('signup.email')} hint={t('signup.email_hint')}>{(id, hint) => <input id={id} aria-describedby={hint} className="input" type="email" required maxLength={254} autoComplete="email" value={form.email} onChange={set('email')} />}</Labelled>
        <div className="terms-check">
          <label>
            <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} required />
            <span>{t('signup.accept')}</span>
          </label>
          <a href="/legal" target="_blank" rel="noopener">{t('signup.read_terms')}</a>
        </div>
        <div className="terms-check">
          <label>
            <input type="checkbox" checked={age16} onChange={(e) => setAge16(e.target.checked)} required />
            <span>{t('signup.age16')}</span>
          </label>
        </div>
        {!signedIn && !waitlist && formWay && <WayPicker methods={methods.filter((m) => m !== 'oidc')} value={way} onChange={(v) => { setError(null); setWay(v); }} />}
        {byPassword && !waitlist && <NewPasswordFields username={username} onUsername={setUsername} password={password} onPassword={setPassword} />}
        <Honeypot value={website} onChange={setWebsite} />
        {turnstileKey && <Turnstile siteKey={turnstileKey} onToken={setTurnstile} />}
        <AuthError>{error}</AuthError>
        {!supported && <AuthError>{t('signup.no_passkeys')}</AuthError>}
        {(signedIn || waitlist || formWay) && <button type="submit" className="btn primary auth-go" disabled={!ready || go.isPending}>
          {waitlist ? <><HeartHandshake size={19} aria-hidden /> {go.isPending ? t('request.sending') : t('signup.ask_button')}</>
            : signedIn ? <><Sparkles size={19} aria-hidden /> {go.isPending ? t('signup.making') : t('signup.start_button')}</>
            : byPassword ? <><KeyRound size={19} aria-hidden /> {go.isPending ? t('signup.making') : t('signup.password_button')}</>
            : <><KeyRound size={19} aria-hidden /> {go.isPending ? t('signup.waiting_device') : t('signup.passkey_button')}</>}
        </button>}
      </form>
      {sso.length > 0 && <>
        {/* A provider that confirms the email starts the family at once, even while unverified sign-ups wait. */}
        {waitlist ? <p className="auth-note">{t('signup.sso_skips_wait')}</p> : (signedIn || waitlist || formWay) && <p className="pw-or">{t('pw.or')}</p>}
        <SsoButtons providers={sso} purpose="signup" form={body} disabled={!filled || go.isPending} onError={(m) => { setError(m); setTurnstile(undefined); }} />
      </>}
      {!signedIn && !waitlist && !byPassword && formWay && <PasskeyExplainer creating />}
      {!signedIn && <p className="auth-alt">{t('signup.have_account_q')} <Link to="/signin">{t('signup.sign_in')}</Link></p>}
    </AuthCard>
  );
}
