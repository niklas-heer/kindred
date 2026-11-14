// /operator/sso-test: the operator's test sign-in for a single sign-on provider, in a window the console opened
// (src/components/operator/sso-test.ts). Without a result it starts the real flow (purpose `test`, src/lib/auth/oidc.server.ts)
// and leaves for the provider; the provider's callback comes back here with `?oidc_test=ok` or the code of what failed, which
// this says in plain words, with the provider's own words when it gave some. The test signs nobody in, makes no account and
// links nothing. Only an operator gets here; the server checks that again when the flow starts and when it comes back.
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { CheckCircle2, FlaskConical } from 'lucide-react';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { AuthCard, AuthError } from '~/components/AuthCard';
import { OIDC_ERRORS } from '~/components/signin/SingleSignOn';
import { announceTest, testPath } from '~/components/operator/sso-test';
import { sessionQuery } from '~/lib/auth/functions';
import { startSingleSignOn } from '~/lib/auth/client';
import { providersQuery } from '~/lib/auth/signin.functions';
import { errorText } from '~/lib/errortext';
import { translate, useT, type Key } from '~/lib/i18n';
import '~/components/signin/signin.css';

export const Route = createFileRoute('/operator_/sso-test')({
  validateSearch: z.object({
    // The router reads `?provider=42` as a number; a provider's id is always text.
    provider: z.coerce.string().max(40).optional().catch(undefined),
    oidc_test: z.string().max(40).optional().catch(undefined),
    popup: z.literal('yes').optional().catch(undefined),
  }),
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (session.demo || !session.user) throw redirect({ to: '/signin', search: { next: location.href } });
    if (!session.user.operator) throw redirect({ to: '/' });
  },
  head: ({ match }) => ({ meta: [{ title: `${translate(match.context.locale ?? 'en', 'oidc.test')} · Kindred` }] }),
  component: TestPage,
});

/** What the test's failures mean for the operator setting the provider up; the rest say what the sign-in pages say. */
const TEST_ERRORS: Record<string, Key> = { provider: 'oidc.test_err_provider', token: 'oidc.test_err_token', denied: 'oidc.test_err_denied' };
/** Closes the console's test window; a browser that does not let the page close it goes back to the console instead. */
function closeOrBack() {
  window.close();
  setTimeout(() => window.location.assign('/operator?tab=signin'), 300);
}

/** The provider's own words are shown for a failure newer than this. */
const RECENT_MS = 15 * 60_000;

function TestPage() {
  const t = useT();
  const { provider, oidc_test: result, popup } = Route.useSearch();
  const [error, setError] = useState<string | null>(null);
  const providers = useQuery({ ...providersQuery, enabled: !!result && result !== 'ok' });
  const p = providers.data?.providers.find((x) => x.id === provider);
  const said = p?.lastError && p.lastErrorAt && Date.now() - p.lastErrorAt < RECENT_MS ? p.lastError : null;

  useEffect(() => {
    if (!provider) return;
    if (result) {
      announceTest(provider);
      return;
    }
    startSingleSignOn({ provider, purpose: 'test', next: testPath(provider, !!popup) }).catch((e: Error) => {
      setError(errorText(e, t.locale));
      announceTest(provider);
    });
  }, [provider, result, popup, t.locale]);

  const ok = result === 'ok';
  const failed = error ?? (result && !ok ? t(TEST_ERRORS[result] ?? OIDC_ERRORS[result] ?? 'oidc.err.failed') : null);
  return (
    <AuthCard crest={<FlaskConical size={44} />} kicker="Kindred" title={p ? `${t('oidc.test')}: ${p.label}` : t('oidc.test')} footer={false}>
      <div className="auth-form">
        {!provider ? <AuthError>{t('oidc.err.provider_off')}</AuthError>
          : ok ? <p className="auth-lede" role="status"><CheckCircle2 size={18} aria-hidden /> {t('oidc.test_ok')}</p>
          : failed ? (
            <>
              <AuthError>{failed}</AuthError>
              {said && <p className="families-hint">{t('oidc.test_said', { error: said })}</p>}
            </>
          )
          : <p className="auth-lede" role="status">{t('oidc.leaving')}</p>}
        {(ok || failed || !provider) && (
          <div className="families-row">
            {popup && <button className="btn primary" onClick={closeOrBack}>{t('oidc.test_close')}</button>}
            <a className="btn" href="/operator?tab=signin">{t('oidc.test_back')}</a>
          </div>
        )}
      </div>
    </AuthCard>
  );
}
