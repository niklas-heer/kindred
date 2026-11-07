import { QueryClient } from '@tanstack/react-query';
import { createRouter, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query';
import { NotFoundPage } from './components/NotFoundPage';
import { ErrorState, PageSkeleton } from './components/ui/states';
import { routeTree } from './routeTree.gen';

export function getRouter() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    scrollRestoration: true,
    // A skeleton only for loads slower than 300 ms, and then for at least 300 ms, so it never flickers.
    defaultPendingMs: 300,
    defaultPendingMinMs: 300,
    defaultPendingComponent: () => <PageSkeleton delay={0} />,
    defaultErrorComponent: RouteError,
    defaultNotFoundComponent: () => <NotFoundPage />,
    // A short crossfade between pages (app.css: 160 ms, none with reduced motion). Search-only changes,
    // like selecting someone on the tree, never fade.
    defaultViewTransition: { types: ({ pathChanged }) => (pathChanged ? ['page'] : false) },
  });
  setupRouterSsrQueryIntegration({ router, queryClient });
  return router;
}

function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <main className="page ui-notfound-page">
      <ErrorState
        message="This page couldn’t be loaded. Your family’s data is safe; try again in a moment."
        error={error}
        onRetry={() => { reset(); router.invalidate(); }}
      />
    </main>
  );
}
