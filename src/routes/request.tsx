// Asking for a family on this server, while its operator takes requests (docs/hosting-many-families.md).
import { createFileRoute } from '@tanstack/react-router';
import { FamilyRequestForm } from '~/components/operator/PublicForms';
import { translate } from '~/lib/i18n';

export const Route = createFileRoute('/request')({
  head: ({ match }) => ({ meta: [{ title: `${translate(match.context.locale ?? 'en', 'request.title')} · Kindred` }] }),
  component: FamilyRequestForm,
});
