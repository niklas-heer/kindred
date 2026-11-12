// "New in Kindred" (src/lib/releases/): what each release brought, for whoever reads it. Public: a guest from a share link
// and someone signed out see what is for everyone; a steward also what is for stewards; an operator everything, with links
// to the full technical changelog and the migrations. The family's own "What's new" is its History page, not this.
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Sparkles } from 'lucide-react';
import { AuthCard } from '~/components/AuthCard';
import { WhatsNewList } from '~/components/releases/WhatsNew';
import { translate, useT } from '~/lib/i18n';
import { releaseReaderQuery } from '~/lib/releases/releases.functions';

export const Route = createFileRoute('/whats-new')({
  loader: ({ context }) => context.queryClient.ensureQueryData(releaseReaderQuery),
  head: ({ match }) => ({ meta: [{ title: `${translate(match.context.locale ?? 'en', 'ops.new_in_kindred')} · Kindred` }] }),
  component: WhatsNew,
});

function WhatsNew() {
  const t = useT();
  const reader = useQuery(releaseReaderQuery).data?.reader ?? 'everyone';
  return (
    <AuthCard crest={<Sparkles size={44} />} kicker="Kindred" title={t('ops.new_in_kindred')} lede={t('ops.whatsnew_lede')} wide footer={false}>
      <WhatsNewList reader={reader} />
      <p className="auth-alt"><Link to="/">{t('ops.back_home')}</Link></p>
    </AuthCard>
  );
}
