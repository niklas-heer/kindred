// AI activity for stewards (what the background AI tasks did, what they cost, what waits). The page lives in
// components/assistant/AiActivity.tsx; the server checks the steward's role on every call.
import { createFileRoute } from '@tanstack/react-router';
import { translate, type Locale } from '~/lib/i18n';
import { treeTitle } from '~/lib/title';
import { AiActivityPage } from '~/components/assistant/AiActivity';

export const Route = createFileRoute('/$tree/settings/activity')({
  // The title is here rather than in the page's module: the route's options are in every page's entry chunk, and
  // importing the page for its title would put the whole page there too.
  head: (ctx) => ({ meta: [{ title: treeTitle(ctx, translate((ctx.match.context as { locale?: Locale }).locale ?? 'en', 'aitasks.activityTitle')) }] }),
  component: AiActivityPage,
});
