// The landing page of a server that hosts families (`instance_mode` = `hosting`), for someone signed out at `/`: the server's
// name and who runs it, where the data is kept, what a family gets, the operator's own paragraph, and the ways in (start a
// family, ask for one, sign in, a demo). It names no family and counts nothing: a stranger learns nothing about who is here.
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Cloud, HardDrive, HeartHandshake, KeyRound, LockKeyhole, LogIn, Server, Sparkles, Sprout } from 'lucide-react';
import type { ReactNode } from 'react';
import { LanguagePicker } from '~/components/LanguagePicker';
import { LegalFooter } from '~/components/operator/LegalFooter';
import { useT } from '~/lib/i18n';
import { formatBytes } from '~/lib/operator/shared';
import { publicHostingQuery } from '~/lib/signup/signup.functions';
import type { PublicHosting } from '~/lib/signup/shared';
import './signup.css';

export function Landing() {
  const t = useT();
  const { data } = useQuery(publicHostingQuery());
  if (!data) return <main className="landing" aria-busy="true" />;
  const name = data.instanceName.trim() || 'Kindred';
  const { signup } = data;
  return (
    <div className="landing-page">
      <header className="landing-top">
        <span className="landing-brand"><Sprout size={20} aria-hidden /> {name}</span>
        <nav className="landing-top-actions" aria-label={t('signup.landing_nav')}>
          <LanguagePicker />
          <Link className="btn" to="/signin"><LogIn size={16} aria-hidden /> {t('signup.sign_in')}</Link>
        </nav>
      </header>
      <main className="landing" aria-labelledby="landing-title">
        <section className="landing-hero">
          <p className="landing-kicker">{t('signup.landing_kicker')}</p>
          <h1 id="landing-title">{name}</h1>
          <p className="landing-lede">{t('signup.landing_lede')}</p>
          <div className="landing-actions">
            {signup.open
              ? <Link className="btn primary landing-go" to="/signup"><Sparkles size={18} aria-hidden /> {t('signup.start_family')}</Link>
              : signup.requests && <Link className="btn primary landing-go" to="/request"><HeartHandshake size={18} aria-hidden /> {t('signup.ask_family')}</Link>}
            <Link className="btn landing-go" to="/signin"><KeyRound size={18} aria-hidden /> {t('signup.have_account')}</Link>
          </div>
          {!signup.open && signup.requests && (signup.reason === 'day' || signup.reason === 'full') && <p className="landing-note">{t(signup.reason === 'day' ? 'signup.day_note' : 'signup.full_note')}</p>}
          {data.demoUrl && <p className="landing-demo"><a href={data.demoUrl} rel="noopener">{t('signup.see_demo')}</a></p>}
        </section>

        {data.landingText && (
          <section className="landing-words ui-card" aria-labelledby="landing-words">
            <h2 id="landing-words">{t('signup.from_operator', { name })}</h2>
            {/* The operator's paragraph is plain text: React escapes it, and line breaks are kept by CSS. */}
            <p>{data.landingText}</p>
          </section>
        )}

        <section className="landing-facts" aria-label={t('signup.facts')}>
          <Fact icon={<LockKeyhole size={22} />} title={t('signup.fact_private_title')}>{t('signup.fact_private')}</Fact>
          <Fact icon={data.where.kind === 'cloudflare' ? <Cloud size={22} /> : <Server size={22} />} title={t('signup.fact_where_title')}>
            {whereText(t, data.where)}
          </Fact>
          <Fact icon={<HardDrive size={22} />} title={t('signup.fact_room_title')}>
            {data.capBytes === null ? t('signup.fact_room_none') : t('signup.fact_room', { size: formatBytes(data.capBytes, t.locale) })} {t('signup.fact_ai')}
          </Fact>
          <Fact icon={<HeartHandshake size={22} />} title={t('signup.fact_who_title')}>
            {t('signup.fact_who', { name })}{' '}
            {data.contactEmail && <>{t('signup.fact_contact')} <a href={`mailto:${data.contactEmail}`}>{data.contactEmail}</a>.</>}{' '}
            <Link to="/legal">{t('signup.fact_legal')}</Link>
          </Fact>
        </section>
      </main>
      <LegalFooter />
    </div>
  );
}

function whereText(t: ReturnType<typeof useT>, where: PublicHosting['where']): string {
  if (where.kind === 'server') return t('signup.where_server');
  return where.jurisdiction === 'eu' ? t('signup.where_cloudflare_eu') : t('signup.where_cloudflare');
}

function Fact({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <article className="landing-fact ui-card">
      <span className="landing-fact-icon" aria-hidden>{icon}</span>
      <h2>{title}</h2>
      <p>{children}</p>
    </article>
  );
}
