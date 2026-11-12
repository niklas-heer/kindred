// The operator console (docs/hosting-many-families.md): the families of this server and how each is run, the waiting list, the
// data requests, the instance's settings, its operators and the audit log. Only an operator gets here; the server checks that
// on every call (src/lib/operator/operator.functions.ts), so this page only decides what to show.
import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { OperatorConsole, OPERATOR_TABS } from '~/components/operator/OperatorConsole';
import { sessionQuery } from '~/lib/auth/functions';
import { translate } from '~/lib/i18n';

export const Route = createFileRoute('/operator')({
  validateSearch: z.object({ tab: z.enum(OPERATOR_TABS).optional().catch(undefined) }),
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (session.needsSetup) throw redirect({ to: '/setup' });
    // A demo has no operator, and a guest has no account.
    if (session.demo || session.guest && !session.user) throw redirect({ to: '/' });
    if (!session.user) throw redirect({ to: '/signin', search: { next: location.href } });
    if (!session.user.operator) throw redirect({ to: '/' });
  },
  head: ({ match }) => ({ meta: [{ title: `${translate(match.context.locale ?? 'en', 'operator.title')} · Kindred` }] }),
  component: Page,
});

function Page() {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  return <OperatorConsole tab={tab ?? 'families'} onTab={(next) => void navigate({ search: { tab: next === 'families' ? undefined : next }, replace: true })} />;
}
