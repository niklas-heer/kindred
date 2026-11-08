// AI activity for stewards (what the background AI tasks did, what they cost, what waits). The page lives in
// components/assistant/AiActivity.tsx; the server checks the steward's role on every call.
import { createFileRoute } from '@tanstack/react-router';
import { AiActivityPage, aiActivityHead } from '~/components/assistant/AiActivity';

export const Route = createFileRoute('/$tree/settings/activity')({
  head: aiActivityHead,
  component: AiActivityPage,
});
