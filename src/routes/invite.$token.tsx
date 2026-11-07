import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { KeyRound, MailX, Shield } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AuthCard, AuthError, PasskeyExplainer } from '~/components/AuthCard';
import { WhoPicker } from '~/components/FirstRun';
import { Arms } from '~/components/Heraldry';
import { ROLE_ICON } from '~/components/RoleIcon';
import { useIsClient } from '~/components/ui';
import { graphQuery } from '~/lib/api';
import { acceptWithPasskey, forgetLocalIdentity, passkeysSupported, signOutRequest } from '~/lib/auth/client';
import { acceptInvite, fetchInvite, setMyPerson } from '~/lib/auth/functions';
import { BROWSING } from '~/lib/family';
import { buildFamily } from '~/lib/graph';
import { setPref } from '~/lib/prefs';
import { ROLES } from '~/lib/roles';

export const Route = createFileRoute('/invite/$token')({
  loader: async ({ params }) => ({ info: await fetchInvite({ data: { token: params.token } }) }),
  // The link is a secret: never send it to another site as a Referer.
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData?.info.family ? `Join ${loaderData.info.family.name} · Kindred` : 'Invitation · Kindred' },
      { name: 'referrer', content: 'no-referrer' },
    ],
  }),
  staleTime: 0,
  component: Invite,
});

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' });
const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

function Invite() {
  const { token } = Route.useParams();
  const { info } = Route.useLoaderData();
  const [step, setStep] = useState<'welcome' | 'who'>('welcome');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const client = useIsClient();
  const supported = !client || passkeysSupported();
  const fam = info.family;

  // The family's own theme, unless the reader chose one.
  useEffect(() => {
    if (!fam) return;
    let saved: string | null = null;
    try { saved = localStorage.getItem('kindred:theme'); } catch {}
    document.documentElement.dataset.theme = saved ?? fam.theme;
  }, [fam]);

  const crest = fam?.crest ? <Arms arms={fam.crest} size={74} /> : <Shield size={44} />;

  if (!fam || info.status !== 'open') {
    const copy = {
      expired: ['This invitation has expired', <>Invitations last two weeks. Ask {info.inviter ?? 'whoever sent it'} for a new link.</>],
      used: ['This invitation was already used', 'If it was you, sign in with your passkey. Each link works once, for one person.'],
      revoked: ['This invitation was withdrawn', 'The steward who sent it has cancelled it. Ask them if you should have a new one.'],
      unknown: ['This invitation link isn’t valid', 'Check that you copied the whole link, or ask for a new one.'],
      open: ['', ''],
    }[info.status];
    return (
      <AuthCard crest={fam ? crest : <MailX size={44} />} kicker={fam?.name ?? 'Kindred'} title={copy[0]} lede={copy[1]}>
        <Link className="btn primary auth-go" to="/signin" search={fam ? { next: `/${fam.id}` } : {}}>Sign in</Link>
      </AuthCard>
    );
  }

  const role = ROLES.find((r) => r.id === info.role)!;

  if (step === 'who') return <WhoStep tree={fam.id} familyName={fam.name} crest={crest} />;

  if (info.alreadyMember) {
    return (
      <AuthCard crest={crest} kicker={fam.name} title="You’re already in this family" lede={<>You’re signed in as <b>{info.signedInAs}</b>, and you already belong to {fam.name}.</>}>
        <a className="btn primary auth-go" href={`/${fam.id}`}>Open {fam.name}</a>
      </AuthCard>
    );
  }

  const createPasskey = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await acceptWithPasskey(token, name);
      forgetLocalIdentity();
      setStep('who');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That didn’t work. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      await acceptInvite({ data: { token } });
      setStep('who');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That didn’t work. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard
      crest={crest}
      kicker="You’re invited"
      title={<>Join {fam.name}</>}
      lede={fam.tagline || undefined}
    >
      <div className="auth-role">
        <span aria-hidden>{ROLE_ICON[role.id]}</span>
        <div>
          <b>{info.inviter ? `${info.inviter} invited you` : 'You’ve been invited'} as {article(role.label)} {role.label.toLowerCase()}</b>
          <small>{role.description}. {info.expires ? `This invitation works until ${dateFmt.format(info.expires)}.` : ''}</small>
        </div>
      </div>
      {info.signedInAs ? (
        <div className="auth-form">
          <AuthError>{error}</AuthError>
          <button className="btn primary auth-go" onClick={join} disabled={busy} data-autofocus>
            {busy ? 'Joining…' : <>Join as {info.signedInAs}</>}
          </button>
          <div className="auth-alt">
            <span>Not {info.signedInAs}?</span>
            <button className="auth-link" onClick={() => void signOutRequest().finally(() => { forgetLocalIdentity(); window.location.reload(); })}>Sign out</button>
          </div>
        </div>
      ) : (
        <>
          <form className="auth-form" onSubmit={createPasskey}>
            <label className="field">
              <span>What should the family call you?</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={60} placeholder="Your name" />
            </label>
            <AuthError>{error}</AuthError>
            {!supported && <AuthError>This browser can’t use passkeys. Open the link in the newest Safari, Chrome, Edge or Firefox, or on your phone.</AuthError>}
            <button className="btn primary auth-go" disabled={busy || !supported || !name.trim()}>
              <KeyRound size={19} /> {busy ? 'Waiting for your device…' : 'Create your passkey'}
            </button>
          </form>
          <div className="auth-alt">
            <span>Already use Kindred?</span>
            <Link className="auth-link" to="/signin" search={{ next: `/invite/${token}` }}>Sign in first</Link>
          </div>
          <PasskeyExplainer creating />
        </>
      )}
    </AuthCard>
  );
}

/** After joining: "Who are you in this family?", then into the tree. */
function WhoStep({ tree, familyName, crest }: { tree: string; familyName: string; crest: ReactNode }) {
  const graph = useQuery(graphQuery(tree));
  const f = useMemo(() => (graph.data ? buildFamily(graph.data) : null), [graph.data]);
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
      kicker={`Welcome to ${familyName}`}
      title="Who are you in this family?"
      lede={<>Kindred names everyone from your point of view: “your great-aunt”, “your second cousin”.</>}
    >
      <div className="auth-who" aria-busy={saving}>
        {graph.isError ? (
          <AuthError>The family tree couldn’t be loaded. <button className="auth-link" onClick={() => void graph.refetch()}>Retry</button></AuthError>
        ) : !f ? (
          <p className="subtle">Loading the family…</p>
        ) : (
          <WhoPicker f={f} tree={tree} onChoose={(id) => void choose(id)} autoFocus />
        )}
      </div>
      <div className="auth-who-foot">
        <p>Not in the tree yet, or not sure? You can choose later with “This is me” on someone’s card.</p>
        <button className="btn" onClick={() => void choose(BROWSING)} disabled={saving}>Just browsing</button>
      </div>
    </AuthCard>
  );
}
