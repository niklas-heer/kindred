// AI settings for a family (stewards only). The page lives in components/assistant/AiSettings.tsx.
import { createFileRoute } from '@tanstack/react-router';
import { translate, type Locale } from '~/lib/i18n';
import { treeTitle } from '~/lib/title';
import { AiSettingsPage } from '~/components/assistant/AiSettings';

export const Route = createFileRoute('/$tree/settings/ai')({
  // The title is here rather than in the page's module: the route's options are in every page's entry chunk, and
  // importing the page for its title would put the whole page there too.
  head: (ctx) => ({ meta: [{ title: treeTitle(ctx, translate((ctx.match.context as { locale?: Locale }).locale ?? 'en', 'ai.settings_title')) }] }),
  component: AiSettingsPage,
});
