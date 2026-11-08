// The feedback inbox for stewards. The page lives in components/feedback/Inbox.tsx; the server checks the role on every call.
import { createFileRoute } from '@tanstack/react-router';
import { FeedbackInbox, feedbackHead } from '~/components/feedback/Inbox';

export const Route = createFileRoute('/$tree/settings/feedback')({
  head: feedbackHead,
  component: FeedbackInbox,
});
