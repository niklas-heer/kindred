// "About and credits": the version, the project, and the third-party work the licences ask us to name.
import { useT } from '~/lib/i18n';
import { appVersion, releaseUrl } from '~/lib/version';
import { Dialog } from './ui';

const PROJECT = 'https://github.com/niklas-heer/kindred';

// One line per source. The text is a dictionary key; the link goes to where the work comes from.
const CREDITS = [
  { key: 'about.charges', href: 'https://game-icons.net' },
  { key: 'about.places', href: 'https://www.geonames.org' },
  { key: 'about.fonts', href: 'https://openfontlicense.org' },
  { key: 'about.map', href: 'https://www.naturalearthdata.com' },
] as const;

export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const version = appVersion();
  return (
    <Dialog open={open} onClose={onClose} title={t('about.title')} width={480} bodyClassName="about-body">
      <p>{t('about.intro')}</p>
      <p>
        {version ? <><a href={releaseUrl(version)} target="_blank" rel="noopener noreferrer">{t('accountmenu.version', { version })}</a> · </> : null}
        <a href={PROJECT} target="_blank" rel="noopener noreferrer">{t('about.project')}</a>
      </p>
      <h3 className="about-h">{t('about.credits')}</h3>
      <ul className="about-credits">
        {CREDITS.map((c) => (
          <li key={c.key}><a href={c.href} target="_blank" rel="noopener noreferrer">{t(c.key)}</a></li>
        ))}
      </ul>
    </Dialog>
  );
}
