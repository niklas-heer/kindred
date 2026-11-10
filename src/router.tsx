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

// A page change crossfades (defaultViewTransition below). When the window is resized or a phone is turned while one runs,
// the browser gives the transition up and rejects a promise only the router holds. The page has changed all the same, so
// this is not an error: without this it reaches the console and the client error log as an unhandled rejection.
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason as { name?: string; message?: string } | undefined;
    if (reason?.name === 'InvalidStateError' && /^Transition was (aborted|skipped)/.test(reason.message ?? '')) e.preventDefault();
  });
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
      if (!isLocale(lang)) return;
      try {
        await loadLocale(lang);
      } catch (e) {
        // The words did not arrive: a deploy replaced the file between the page and this request, or the connection
        // dropped. Rethrowing would leave the server's page on screen with nothing answering, so load it afresh, once.
        let again = false;
        try { again = sessionStorage.getItem('kindred:locale-retry') !== location.pathname; sessionStorage.setItem('kindred:locale-retry', location.pathname); } catch { /* storage is off: do not loop */ }
        if (again) { location.reload(); await new Promise(() => {}); }
        throw e;
      }
      try { sessionStorage.removeItem('kindred:locale-retry'); } catch { /* storage is off */ }
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
