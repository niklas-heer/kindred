import { QueryClient } from '@tanstack/react-query';
import { createRouter, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query';
import { getGlobalStartContext } from '@tanstack/react-start';
import { NotFoundPage } from './components/NotFoundPage';
import { Main } from './components/ui/Main';
import { ErrorState, PageSkeleton } from './components/ui/states';
import { isLocale, loadLocale, useT } from './lib/i18n';
import { routeTree } from './routeTree.gen';

/** This request's nonce for the page's inline scripts (src/start.ts). The browser reads it back from a meta tag itself. */
function cspNonce(): string | undefined {
  try {
    return (getGlobalStartContext() as { cspNonce?: string } | undefined)?.cspNonce;
  } catch {
    return undefined; // Start also makes a router outside the request middleware, for a redirect: that renders no page.
  }
}

export function getRouter() {
  const nonce = cspNonce();
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    scrollRestoration: true,
    ssr: nonce ? { nonce } : undefined,
    // A skeleton only for loads slower than 300 ms, and then for at least 300 ms, so it never flickers.
    defaultPendingMs: 300,
    defaultPendingMinMs: 300,
    defaultPendingComponent: () => <PageSkeleton delay={0} />,
    defaultErrorComponent: RouteError,
    defaultNotFoundComponent: () => <NotFoundPage />,
    // A short crossfade between pages (app.css: 160 ms, none with reduced motion). Search-only changes,
    // like selecting someone on the tree, never fade.
    defaultViewTransition: { types: ({ pathChanged }) => (pathChanged ? ['page'] : false) },
    // Before hydration, in the browser: fetch the language the server rendered in (the root sets it as <html lang>),
    // so the first client render has the same words and hydration matches. The browser ships only English.
    hydrate: async () => {
      const lang = document.documentElement.lang;
      if (isLocale(lang)) await loadLocale(lang);
    },
  });
  setupRouterSsrQueryIntegration({ router, queryClient });
  return router;
}

function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const t = useT();
  return (
    <Main className="page ui-notfound-page">
      <ErrorState
        message={t('common.page_load_failed')}
        error={error}
        onRetry={() => { reset(); router.invalidate(); }}
      />
    </Main>
  );
}
