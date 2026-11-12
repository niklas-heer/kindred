// A data request: anyone, a member or not, asks for access to, correction or deletion of data about them in a family hosted
// here (docs/hosting-many-families.md). It reaches the operator, and the family's stewards when it names their family.
import { createFileRoute } from '@tanstack/react-router';
import { DataRequestForm } from '~/components/operator/PublicForms';
import { translate } from '~/lib/i18n';

export const Route = createFileRoute('/privacy-request')({
  head: ({ match }) => ({ meta: [{ title: `${translate(match.context.locale ?? 'en', 'privacyreq.title')} · Kindred` }] }),
  component: DataRequestForm,
});
