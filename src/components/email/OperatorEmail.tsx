// The console's Email tab (src/lib/email/, docs/hosting-many-families.md, "Email"): how the server sends email (off, Resend,
// Postmark, Mailgun with its EU region, or SMTP on Node), the sender, replies, the key (sealed on the server, never shown
// again; the environment's wins), the server's hourly ceiling, and a test email. Saving needs the operator's fresh proof.
// Also `EmailHealth`, its line on the Health tab: the last day's sends and the latest failures.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Mail, Send } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { ErrorState, Notice, Select, Skeleton, Switch } from '~/components/ui';
import { withFreshProof } from '~/lib/auth/client';
import { mailHealthQuery, mailSettingsQuery, saveMailSettings, sendTestMail } from '~/lib/email/email.functions';
import { MAIL_PROVIDERS, type MailgunRegion, type MailProvider, type MailSettingsView, type SmtpSecurity } from '~/lib/email/shared';
import { errorText } from '~/lib/errortext';
import { formatDate, useT, type Key } from '~/lib/i18n';
import '~/components/operator/operator.css';
import '~/components/operator/ops.css';

const PROVIDER_NAME: Record<MailProvider, Key> = {
  off: 'email.provider_off', resend: 'email.provider_resend', postmark: 'email.provider_postmark', mailgun: 'email.provider_mailgun', smtp: 'email.provider_smtp',
};

type Draft = Omit<MailSettingsView, 'secret' | 'smtpAvailable' | 'on'> & { secret: string; removeSecret: boolean };
const draftOf = (v: MailSettingsView): Draft => ({ ...v, secret: '', removeSecret: false });

export function EmailTab() {
  const t = useT();
  const { data, isPending, isError, refetch } = useQuery(mailSettingsQuery);
  if (isPending) return <div aria-busy="true" aria-label={t('operator.loading')}><Skeleton lines={6} /></div>;
  if (isError || !data) return <ErrorState title={t('operator.err_load')} onRetry={() => { void refetch(); }} />;
  return <EmailForm view={data} />;
}

function EmailForm({ view }: { view: MailSettingsView }) {
  const t = useT();
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(() => draftOf(view));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setD(draftOf(view)), [view]);
  const set = (patch: Partial<Draft>) => { setError(null); save.reset(); setD((x) => ({ ...x, ...patch })); };
  const ids = { from: useId(), fromName: useId(), reply: useId(), key: useId(), domain: useId(), host: useId(), port: useId(), user: useId(), perHour: useId() };
  const save = useMutation({
    mutationFn: () => withFreshProof(() => saveMailSettings({
      data: {
        provider: d.provider, fromName: d.fromName, fromAddress: d.fromAddress, replyTo: d.replyTo, mailgunDomain: d.mailgunDomain, mailgunRegion: d.mailgunRegion,
        smtpHost: d.smtpHost, smtpPort: d.smtpPort, smtpSecurity: d.smtpSecurity, smtpUser: d.smtpUser, perHour: d.perHour,
        secret: d.secret.trim() ? d.secret.trim() : d.removeSecret ? '' : undefined,
      },
    })),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['operator', 'mail'] }); await qc.invalidateQueries({ queryKey: ['instance', 'mail-on'] }); },
    onError: (e: Error) => setError(errorText(e, t.locale)),
  });
  const off = d.provider === 'off';
  const smtp = d.provider === 'smtp';
  const envName = smtp ? 'KINDRED_SMTP_PASSWORD' : 'KINDRED_MAIL_API_KEY';
  const providers = MAIL_PROVIDERS.filter((p) => p !== 'smtp' || view.smtpAvailable || view.provider === 'smtp');

  return (
    <div className="operator-panel">
      <section aria-labelledby="mail-title" className="ops-section">
        <h2 id="mail-title" className="rule"><Mail size={18} aria-hidden /> {t('email.title')}</h2>
        <p className="families-hint">{t('email.lede')}</p>
        <p role="status" className="signin-state" data-state={view.on ? 'enabled' : 'unavailable'}>
          {view.on ? t('email.state_on') : view.provider === 'off' ? t('email.state_off') : t('email.state_incomplete')}
        </p>
        <form className="acc-form" onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }} aria-labelledby="mail-title">
          <label className="field">
            <span>{t('email.provider')}</span>
            <Select<MailProvider> value={d.provider} onChange={(provider) => set({ provider })} aria-label={t('email.provider')}
              options={providers.map((p) => ({ value: p, label: t(PROVIDER_NAME[p]) }))} />
          </label>
          {smtp && !view.smtpAvailable && <Notice>{t('email.smtp_unavailable')}</Notice>}
          {!off && <>
            <label className="field" htmlFor={ids.from}>
              <span>{t('email.from_address')}</span>
              <input id={ids.from} className="input" type="email" value={d.fromAddress} onChange={(e) => set({ fromAddress: e.target.value })} maxLength={254} autoCapitalize="none" spellCheck={false} required />
              <p className="auth-hint">{t('email.from_address_hint')}</p>
            </label>
            <label className="field" htmlFor={ids.fromName}>
              <span>{t('email.from_name')}</span>
              <input id={ids.fromName} className="input" value={d.fromName} onChange={(e) => set({ fromName: e.target.value })} maxLength={80} />
              <p className="auth-hint">{t('email.from_name_hint')}</p>
            </label>
            <label className="field" htmlFor={ids.reply}>
              <span>{t('email.reply_to')}</span>
              <input id={ids.reply} className="input" type="email" value={d.replyTo} onChange={(e) => set({ replyTo: e.target.value })} maxLength={254} autoCapitalize="none" spellCheck={false} />
              <p className="auth-hint">{t('email.reply_to_hint')}</p>
            </label>
            {d.provider === 'mailgun' && <>
              <label className="field" htmlFor={ids.domain}>
                <span>{t('email.mailgun_domain')}</span>
                <input id={ids.domain} className="input" value={d.mailgunDomain} onChange={(e) => set({ mailgunDomain: e.target.value })} maxLength={253} autoCapitalize="none" spellCheck={false} required />
              </label>
              <label className="field">
                <span>{t('email.mailgun_region')}</span>
                <Select<MailgunRegion> value={d.mailgunRegion} onChange={(mailgunRegion) => set({ mailgunRegion })} aria-label={t('email.mailgun_region')}
                  options={[{ value: 'eu', label: t('email.region_eu') }, { value: 'us', label: t('email.region_us') }]} />
              </label>
            </>}
            {smtp && <>
              <label className="field" htmlFor={ids.host}>
                <span>{t('email.smtp_host')}</span>
                <input id={ids.host} className="input" value={d.smtpHost} onChange={(e) => set({ smtpHost: e.target.value })} maxLength={253} autoCapitalize="none" spellCheck={false} required />
              </label>
              <label className="field">
                <span>{t('email.smtp_security')}</span>
                <Select<SmtpSecurity> value={d.smtpSecurity} onChange={(smtpSecurity) => set({ smtpSecurity, smtpPort: smtpSecurity === 'tls' ? 465 : 587 })} aria-label={t('email.smtp_security')}
                  options={[{ value: 'starttls', label: t('email.smtp_starttls') }, { value: 'tls', label: t('email.smtp_tls') }]} />
              </label>
              <label className="field" htmlFor={ids.port}>
                <span>{t('email.smtp_port')}</span>
                <input id={ids.port} className="input" type="number" min={1} max={65535} value={d.smtpPort} onChange={(e) => set({ smtpPort: Number(e.target.value) || 587 })} />
              </label>
              <label className="field" htmlFor={ids.user}>
                <span>{t('email.smtp_user')}</span>
                <input id={ids.user} className="input" value={d.smtpUser} onChange={(e) => set({ smtpUser: e.target.value })} maxLength={200} autoCapitalize="none" spellCheck={false} autoComplete="off" />
              </label>
            </>}
            <label className="field" htmlFor={ids.key}>
              <span>{smtp ? t('email.smtp_password') : t('email.key')}</span>
              <input id={ids.key} className="input" type="password" value={d.secret} onChange={(e) => set({ secret: e.target.value, removeSecret: false })} maxLength={2000} autoComplete="off"
                placeholder={view.secret === 'stored' && !d.removeSecret ? t('email.secret_kept') : undefined} disabled={view.secret === 'env'} />
              <p className="auth-hint">{view.secret === 'env' ? t('email.secret_env', { name: envName }) : t('email.secret_hint')}</p>
            </label>
            {view.secret === 'stored' && !d.secret && (
              <Switch checked={d.removeSecret} onChange={(v) => set({ removeSecret: v })}>{t('email.remove_secret')}</Switch>
            )}
            <label className="field" htmlFor={ids.perHour}>
              <span>{t('email.per_hour')}</span>
              <input id={ids.perHour} className="input" type="number" min={1} max={100000} value={d.perHour} onChange={(e) => set({ perHour: Math.max(1, Number(e.target.value) || 1) })} />
              <p className="auth-hint">{t('email.per_hour_hint')}</p>
            </label>
            <Notice>{t('email.subprocessor_note')}</Notice>
          </>}
          {error && <p className="acct-error" role="alert">{error}</p>}
          <div className="families-row">
            <button className="btn primary" disabled={save.isPending}>{save.isPending ? t('email.saving') : t('email.save')}</button>
            {save.isSuccess && <span className="acct-ok" role="status"><Check size={15} aria-hidden /> {t('email.saved')}</span>}
          </div>
        </form>
      </section>
      {view.on && <TestEmail />}
    </div>
  );
}

function TestEmail() {
  const t = useT();
  const id = useId();
  const [to, setTo] = useState('');
  const send = useMutation({ mutationFn: () => withFreshProof(() => sendTestMail({ data: { to: to.trim() } })) });
  const answer = send.data;
  return (
    <section aria-labelledby={`${id}-h`} className="ops-section">
      <h2 id={`${id}-h`} className="rule"><Send size={18} aria-hidden /> {t('email.test_title')}</h2>
      <form className="families-row" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
        <label className="field" htmlFor={id}>
          <span>{t('email.test_to')}</span>
          <input id={id} className="input" type="email" value={to} onChange={(e) => { send.reset(); setTo(e.target.value); }} maxLength={254} autoCapitalize="none" spellCheck={false} required />
        </label>
        <button className="btn" disabled={send.isPending || !to.trim()}>{send.isPending ? t('email.test_sending') : t('email.test_send')}</button>
      </form>
      {answer?.ok && <p className="acct-ok" role="status"><Check size={15} aria-hidden /> {t('email.test_sent', { email: to.trim() })}</p>}
      {answer && !answer.ok && <p className="acct-error" role="alert">{answer.error?.startsWith('email.err.') ? errorText(new Error(answer.error), t.locale) : t('email.test_failed', { reason: answer.error ?? '' })}</p>}
      {send.isError && <p className="acct-error" role="alert">{errorText(send.error, t.locale)}</p>}
    </section>
  );
}

/** Email on the Health tab: the last day's sends, and the latest failures with the provider's reason. */
export function EmailHealth() {
  const t = useT();
  const { data } = useQuery(mailHealthQuery);
  if (!data) return null;
  const when = (ms: number) => formatDate(ms, t.locale, { dateStyle: 'long', timeStyle: 'short' });
  return (
    <section aria-labelledby="health-mail" className="ops-section">
      <h2 id="health-mail" className="rule">{t('email.health_title')}</h2>
      {!data.on && data.day.sent + data.day.failed === 0 ? <p role="status">{t('email.health_off')}</p> : <>
        <p role="status">{t('email.health_day', { sent: data.day.sent, failed: data.day.failed, skipped: data.day.skipped })}</p>
        <h3>{t('email.health_failures')}</h3>
        {data.failures.length ? (
          <ul className="ops-list">
            {data.failures.map((f, i) => (
              <li key={`${f.at}-${i}`}><span className="families-error"><AlertTriangle size={13} aria-hidden /> {when(f.at)}</span> <code>{f.category}</code> <span className="muted">{f.error}</span></li>
            ))}
          </ul>
        ) : <p>{t('email.health_none')}</p>}
      </>}
    </section>
  );
}
