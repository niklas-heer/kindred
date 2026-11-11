// "Who is this?" as a page of its own (docs/who-is-this.md): the game the Today card plays, with room for the photograph.
// The Gallery and the Needed page link here. Members only: the layout sends a share-link guest back to the tree, and the
// server refuses them every part of it.
import { createFileRoute } from '@tanstack/react-router';
import { UserSearch } from 'lucide-react';
import { WhoIsThis } from '~/components/whois/WhoIsThis';
import '~/components/today/today.css';
import { EmptyState, PageHeader } from '~/components/ui';
import { useTreeId } from '~/lib/family';
import { translate, useT, type Locale } from '~/lib/i18n';
import { useMember } from '~/lib/session';
import { treeTitle } from '~/lib/title';

export const Route = createFileRoute('/$tree/who-is-this')({
  head: (ctx) => ({ meta: [{ title: treeTitle(ctx, translate((ctx.match.context as { locale?: Locale }).locale ?? 'en', 'whois.title')) }] }),
  component: WhoIsThisPage,
});

function WhoIsThisPage() {
  const tree = useTreeId();
  const t = useT();
  const member = !!useMember(tree);
  return (
    <div className="page">
      <div className="page-inner wi-page">
        <PageHeader title={t('whois.title')} subtitle={t('whois.page_sub')} icon={<UserSearch size={26} />} />
        {member ? <WhoIsThis tree={tree} page /> : <EmptyState icon={<UserSearch size={28} />} title={t('whois.title')} text={t('whois.none_text')} />}
      </div>
    </div>
  );
}
