// The two forms anyone may send to this server's operator (docs/hosting-many-families.md): asking for a family (/request,
// only while the server takes requests) and a data request (/privacy-request). Each has a field people never see (a bot
// that fills it is thanked and nothing is kept) and, when the server has its keys, Cloudflare Turnstile. Kindred sends no
// email: the requester is told the operator will write to them.
import { useMutation, useQuery } from '@tanstack/react-query';
import { HeartHandshake, MailCheck, ShieldCheck } from 'lucide-react';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { AuthCard, AuthError } from '~/components/AuthCard';
import { Skeleton } from '~/components/ui';
import { errorText } from '~/lib/errortext';
import { useT, type Key } from '~/lib/i18n';
import { publicInstanceQuery, sendDataRequest, sendFamilyRequest } from '~/lib/operator/operator.functions';
import { DATA_REQUEST_KINDS, type DataRequestKind } from '~/lib/operator/shared';
import { Turnstile } from './Turnstile';
import './operator.css';

/** The field a person never sees: off screen, out of the Tab order, unnamed to a screen reader. */
export function Honeypot({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  return (
    <div className="hp-field" aria-hidden="true">
      <label>{t('request.honeypot')}<input tabIndex={-1} autoComplete="off" name="website" value={value} onChange={(e) => onChange(e.target.value)} /></label>
    </div>
  );
}

function Sent({ email, title }: { email: string; title: string }) {
  const t = useT();
  return (
    <AuthCard crest={<MailCheck size={44} />} title={title} lede={t('request.in_touch', { email })} />
  );
}

export function Labelled({ label, hint, children }: { label: string; hint?: string; children: (id: string, hintId?: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id, hint ? `${id}-hint` : undefined)}
      {hint && <small className="families-hint" id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}

export function FamilyRequestForm() {
  const t = useT();
  const instance = useQuery(publicInstanceQuery);
  const [form, setForm] = useState({ name: '', email: '', familyName: '', message: '' });
  const [website, setWebsite] = useState('');
  const [turnstile, setTurnstile] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () => sendFamilyRequest({ data: { ...form, website, turnstile, locale: t.locale } }),
    onError: (e) => setError(errorText(e, t.locale)),
  });
  if (send.isSuccess) return <Sent email={send.data.email} title={t('request.sent_title')} />;
  if (!instance.data) return <AuthCard crest={<HeartHandshake size={44} />} title={t('request.title')}><Skeleton lines={4} /></AuthCard>;
  // Sign-up keeps the waiting list open: where people ask when sign-up is full (src/lib/signup/).
  if (instance.data.familyCreation !== 'requests' && instance.data.familyCreation !== 'signup') {
    return <AuthCard crest={<HeartHandshake size={44} />} title={t('request.title')} lede={t('request.closed')}></AuthCard>;
  }
  // The waiting list is full (OPEN_REQUESTS_MAX): closed for now, until the operator answers some.
  if (instance.data.full.family) return <AuthCard crest={<HeartHandshake size={44} />} title={t('request.title')} lede={t('request.full')}></AuthCard>;
  const needsCheck = !!instance.data.turnstileSiteKey && !turnstile;
  const ready = form.name.trim() && form.email.trim() && form.familyName.trim() && !needsCheck;
  const submit = (e: FormEvent) => { e.preventDefault(); if (ready && !send.isPending) { setError(null); send.mutate(); } };
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <AuthCard crest={<HeartHandshake size={44} />} kicker={instance.data.instanceName || 'Kindred'} title={t('request.title')} lede={t('request.lede')} wide>
      <form className="auth-form" onSubmit={submit}>
        <Labelled label={t('request.your_name')}>{(id) => <input id={id} className="input" required maxLength={120} autoComplete="name" value={form.name} onChange={set('name')} />}</Labelled>
        <Labelled label={t('request.your_email')} hint={t('request.email_hint')}>{(id, hint) => <input id={id} aria-describedby={hint} className="input" type="email" required maxLength={254} autoComplete="email" value={form.email} onChange={set('email')} />}</Labelled>
        <Labelled label={t('request.family_name')}>{(id) => <input id={id} className="input" required maxLength={80} autoComplete="off" value={form.familyName} onChange={set('familyName')} />}</Labelled>
        <Labelled label={t('request.message')}>{(id) => <textarea id={id} className="input operator-text" rows={4} maxLength={2000} value={form.message} onChange={set('message')} />}</Labelled>
        <Honeypot value={website} onChange={setWebsite} />
        {instance.data.turnstileSiteKey && <Turnstile siteKey={instance.data.turnstileSiteKey} onToken={setTurnstile} />}
        <AuthError>{error}</AuthError>
        <button type="submit" className="btn primary auth-go" disabled={!ready || send.isPending}>{send.isPending ? t('request.sending') : t('request.send')}</button>
      </form>
    </AuthCard>
  );
}

export function DataRequestForm() {
  const t = useT();
  const instance = useQuery(publicInstanceQuery);
  const ids = useId();
  const [form, setForm] = useState({ name: '', email: '', family: '', message: '' });
  const [kind, setKind] = useState<DataRequestKind>('access');
  const [website, setWebsite] = useState('');
  const [turnstile, setTurnstile] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () => sendDataRequest({ data: { ...form, kind, website, turnstile } }),
    onError: (e) => setError(errorText(e, t.locale)),
  });
  if (send.isSuccess) return <Sent email={send.data.email} title={t('privacyreq.sent_title')} />;
  // Too many wait unanswered (OPEN_REQUESTS_MAX): closed for now; the operator's address still reaches them.
  if (instance.data?.full.data) {
    const email = instance.data.contactEmail;
    return (
      <AuthCard crest={<ShieldCheck size={44} />} title={t('privacyreq.title')} lede={t('privacyreq.full')}>
        {email && <p>{t('privacyreq.full_write')} <a href={`mailto:${email}`}>{email}</a></p>}
      </AuthCard>
    );
  }
  const siteKey = instance.data?.turnstileSiteKey;
  const ready = form.name.trim() && form.email.trim() && form.message.trim() && !(siteKey && !turnstile);
  const submit = (e: FormEvent) => { e.preventDefault(); if (ready && !send.isPending) { setError(null); send.mutate(); } };
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <AuthCard crest={<ShieldCheck size={44} />} kicker={instance.data?.instanceName || 'Kindred'} title={t('privacyreq.title')} lede={t('privacyreq.lede')} wide>
      <form className="auth-form" onSubmit={submit}>
        <Labelled label={t('request.your_name')}>{(id) => <input id={id} className="input" required maxLength={120} autoComplete="name" value={form.name} onChange={set('name')} />}</Labelled>
        <Labelled label={t('request.your_email')} hint={t('request.email_hint')}>{(id, hint) => <input id={id} aria-describedby={hint} className="input" type="email" required maxLength={254} autoComplete="email" value={form.email} onChange={set('email')} />}</Labelled>
        <Labelled label={t('privacyreq.family')} hint={t('privacyreq.family_hint')}>{(id, hint) => <input id={id} aria-describedby={hint} className="input" maxLength={200} autoComplete="off" value={form.family} onChange={set('family')} />}</Labelled>
        <fieldset className="operator-fieldset">
          <legend id={`${ids}-kind`}>{t('privacyreq.kind')}</legend>
          {DATA_REQUEST_KINDS.map((k) => (
            <label key={k} className="operator-radio">
              <input type="radio" name={`${ids}-kind`} value={k} checked={kind === k} onChange={() => setKind(k)} />
              <span><b>{t(`operator.kind_${k}` as Key)}</b><small>{t(`privacyreq.kind_${k}_hint` as Key)}</small></span>
            </label>
          ))}
        </fieldset>
        <Labelled label={t('privacyreq.message')} hint={t('privacyreq.message_hint')}>{(id, hint) => <textarea id={id} aria-describedby={hint} className="input operator-text" rows={5} required maxLength={4000} value={form.message} onChange={set('message')} />}</Labelled>
        <Honeypot value={website} onChange={setWebsite} />
        {siteKey && <Turnstile siteKey={siteKey} onToken={setTurnstile} />}
        <AuthError>{error}</AuthError>
        <button type="submit" className="btn primary auth-go" disabled={!ready || send.isPending}>{send.isPending ? t('request.sending') : t('request.send')}</button>
      </form>
    </AuthCard>
  );
}
