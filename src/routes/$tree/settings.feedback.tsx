// The feedback inbox for stewards. The page lives in components/feedback/Inbox.tsx; the server checks the role on every call.
import { createFileRoute } from '@tanstack/react-router';
import { translate, type Locale } from '~/lib/i18n';
import { treeTitle } from '~/lib/title';
import { FeedbackInbox } from '~/components/feedback/Inbox';

export const Route = createFileRoute('/$tree/settings/feedback')({
  // The title is here rather than in the page's module: the route's options are in every page's entry chunk, and
  // importing the page for its title would put the whole page there too.
  head: (ctx) => ({ meta: [{ title: treeTitle(ctx, translate((ctx.match.context as { locale?: Locale }).locale ?? 'en', 'feedback.inbox_title')) }] }),
  component: FeedbackInbox,
});
