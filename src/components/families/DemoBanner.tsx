// The slim bar a demo (KINDRED_DEMO=1, src/lib/demo.ts) shows above every page: what this is, and where Kindred lives. Rendered
// by the root shell, so it is on every page, signed in or not; the server decides whether it is a demo, never the browser.
import { useT } from '~/lib/i18n';
import { DEMO_REPOSITORY } from '~/lib/demo';
import './families.css';

export function DemoBanner() {
  const t = useT();
  return (
    <aside className="demo-bar" aria-label={t('demo.banner_label')}>
      <p>
        <span>{t('demo.banner')}</span>{' '}
        <a href={DEMO_REPOSITORY} target="_blank" rel="noopener noreferrer">{t('demo.banner_link')}</a>
      </p>
    </aside>
  );
}
