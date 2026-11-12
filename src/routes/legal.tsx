// The legal page (docs/hosting-many-families.md): the Impressum, the privacy policy, the terms and where to report content,
// as this server's operator wrote them in the console. A section that is a single web address links there instead.
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Scale } from 'lucide-react';
import { AuthCard } from '~/components/AuthCard';
import { Skeleton } from '~/components/ui';
import { translate, useT, type Key } from '~/lib/i18n';
import { legalQuery } from '~/lib/operator/operator.functions';
import { isEmail, isUrl } from '~/lib/operator/shared';
import '~/components/operator/operator.css';
import { SubprocessorList } from '~/components/gdpr/Subprocessors';

export const Route = createFileRoute('/legal')({
  loader: ({ context }) => context.queryClient.ensureQueryData(legalQuery),
  head: ({ match }) => ({ meta: [{ title: `${translate(match.context.locale ?? 'en', 'legal.title')} · Kindred` }] }),
  component: Legal,
});

function Section({ id, title, value }: { id: string; title: Key; value: string }) {
  const t = useT();
  if (!value.trim()) return null;
  return (
    <section id={id} className="legal-section" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{t(title)}</h2>
      {isUrl(value) ? <p><a href={value.trim()} rel="noopener noreferrer">{value.trim()}</a></p>
        : isEmail(value) ? <p><a href={`mailto:${value.trim()}`}>{value.trim()}</a></p>
        : <div className="legal-text">{value.trim()}</div>}
    </section>
  );
}

function Legal() {
  const t = useT();
  const { data } = useQuery(legalQuery);
  const empty = data && ![data.impressum, data.privacy, data.terms, data.reportContact, data.processingAgreement].some((v) => v.trim());
  return (
    <AuthCard crest={<Scale size={44} />} kicker={data?.instanceName || 'Kindred'} title={t('legal.title')} wide footer={false}>
      {!data ? <Skeleton lines={5} /> : empty ? <p>{t('legal.none')}</p> : (
        <div className="legal">
          <Section id="impressum" title="legal.impressum" value={data.impressum} />
          <Section id="privacy" title="legal.privacy" value={data.privacy} />
          <Section id="terms" title="legal.terms" value={data.terms} />
          <Section id="report" title="legal.report" value={data.reportContact} />
          <Section id="processing-agreement" title="gdpr.processing_agreement" value={data.processingAgreement} />
          {data.contactEmail && <p className="muted">{t('legal.contact', { email: data.contactEmail })}</p>}
        </div>
      )}
      {/* Who this server passes data to, from its configuration (src/lib/gdpr/subprocessors.ts): always, even when it is nobody. */}
      {data && (
        <section id="subprocessors" className="legal legal-section" aria-labelledby="subprocessors-h">
          <h2 id="subprocessors-h">{t('gdpr.subs_title')}</h2>
          <p className="muted">{t('gdpr.subs_public_hint')}</p>
          <SubprocessorList list={data.subprocessors} />
        </section>
      )}
      <p className="auth-alt"><Link to="/privacy-request">{t('legal.data_request_long')}</Link></p>
    </AuthCard>
  );
}
