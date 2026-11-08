// AI settings for a family (stewards only). The page lives in components/assistant/AiSettings.tsx.
import { createFileRoute } from '@tanstack/react-router';
import { AiSettingsPage, aiSettingsHead } from '~/components/assistant/AiSettings';

export const Route = createFileRoute('/$tree/settings/ai')({
  head: aiSettingsHead,
  component: AiSettingsPage,
});
