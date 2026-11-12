// Starting a family on a server that takes sign-ups (docs/hosting-many-families.md, "Hosting and sign-up"). `?code=` carries
// a sign-up code an operator handed out; `?oidc_error=` what went wrong at a single sign-on provider on the way back.
import { createFileRoute, redirect } from '@tanstack/react-router';
import { SignupPage } from '~/components/signup/SignupForm';
import { sessionQuery } from '~/lib/auth/functions';
import { translate } from '~/lib/i18n';

export const Route = createFileRoute('/signup')({
  validateSearch: (s: Record<string, unknown>): { code?: string; oidc_error?: string } => ({
    ...(typeof s.code === 'string' && s.code.length <= 64 ? { code: s.code } : {}),
    ...(typeof s.oidc_error === 'string' && s.oidc_error.length <= 40 ? { oidc_error: s.oidc_error } : {}),
  }),
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.fetchQuery({ ...sessionQuery, staleTime: 0 });
    if (session.needsSetup) throw redirect({ to: '/setup' });
    // A demo has no accounts, and a share link's guest is not one.
    if (session.demo || (!session.user && session.guest)) throw redirect({ to: '/' });
  },
  head: ({ match }) => ({ meta: [{ title: `${translate(match.context.locale ?? 'en', 'signup.title')} · Kindred` }] }),
  component: Signup,
});

function Signup() {
  const { code, oidc_error } = Route.useSearch();
  return <SignupPage code={code} oidcError={oidc_error} />;
}
