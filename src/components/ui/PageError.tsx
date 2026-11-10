// PageError: what a page's route shows when its data could not be loaded, with a way to try again.
//
// Usage: errorComponent: () => <PageError title="almanac.title" message="almanac.error" />
import { useRouter } from '@tanstack/react-router';
import { useT, type Key } from '~/lib/i18n';
import { PageHeader } from './PageHeader';
import { ErrorState } from './states';

export function PageError({ title, message }: { title: Key; message: Key }) {
  const router = useRouter();
  const t = useT();
  return (
    <div className="page">
      <PageHeader title={t(title)} />
      <ErrorState message={t(message)} onRetry={() => { void router.invalidate(); }} />
    </div>
  );
}
