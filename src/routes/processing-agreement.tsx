// The processing agreement template (docs/processing-agreement.md), rendered for an operator to read and copy into the console.
// Marked as a template on the page itself: it is a starting point, not legal advice, and binds nobody until an operator adopts it.
import { createFileRoute, Link } from '@tanstack/react-router';
import { FileText } from 'lucide-react';
import { AuthCard } from '~/components/AuthCard';
import { translate, useT } from '~/lib/i18n';
import { renderMarkdown } from '~/lib/markdown';
import template from '../../docs/processing-agreement.md?raw';
import '~/components/operator/operator.css';

export const Route = createFileRoute('/processing-agreement')({
  head: ({ match }) => ({ meta: [{ title: `${translate(match.context.locale ?? 'en', 'gdpr.template_title')} · Kindred` }] }),
  component: Template,
});

function Template() {
  const t = useT();
  return (
    <AuthCard crest={<FileText size={44} />} kicker="Kindred" title={t('gdpr.template_title')} wide footer={false}>
      <p className="operator-warning" role="note">{t('gdpr.template_warning')}</p>
      <div className="legal-text gdpr-template" dangerouslySetInnerHTML={{ __html: renderMarkdown(template, { images: 'text' }) }} />
      <p className="auth-alt"><Link to="/legal">{t('legal.title')}</Link></p>
    </AuthCard>
  );
}
