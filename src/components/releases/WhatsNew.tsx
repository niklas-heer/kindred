// "New in Kindred" (src/routes/whats-new.tsx): the highlights of each release, newest first, filtered by who reads them
// (src/lib/releases/). Anyone may open it, a share-link guest or someone signed out too; they see what is for everyone.
import { ExternalLink, ShieldAlert, Wrench } from 'lucide-react';
import { formatDate, useT } from '~/lib/i18n';
import { releasesFor, type Reader } from '~/lib/releases';
import { appVersion } from '~/lib/version';
import { DEFAULT_UPDATE_REPO } from '~/lib/operator/updates-shared';
import './releases.css';

export function WhatsNewList({ reader }: { reader: Reader }) {
  const t = useT();
  const releases = releasesFor(reader, appVersion());
  return (
    <div className="whatsnew">
      {releases.map((r, i) => (
        <section key={r.version} className="whatsnew-release" aria-labelledby={`wn-${r.version}`}>
          <h2 id={`wn-${r.version}`}>
            {t('ops.release_heading', { version: r.version })}{' '}
            {r.date && <span className="muted whatsnew-date">{formatDate(Date.parse(`${r.date}T12:00:00Z`), t.locale, { dateStyle: 'long' })}</span>}
            {i === 0 && appVersion() && <span className="chip whatsnew-current">{t('ops.release_current')}</span>}
          </h2>
          {reader === 'operators' && (r.security || r.manual) && (
            <p className="whatsnew-flags">
              {r.security && <span className="chip operator-chip"><ShieldAlert size={13} aria-hidden /> {t('ops.flag_security')}</span>}
              {r.manual && <span className="chip"><Wrench size={13} aria-hidden /> {t('ops.flag_manual')}</span>}
            </p>
          )}
          <ul>
            {r.highlights.map((h) => (
              <li key={h.title}>
                <b>{t(h.title)}</b> {t(h.text)}
                {h.audience !== 'everyone' && <span className="whatsnew-for muted"> · {t(h.audience === 'operators' ? 'ops.for_operators' : 'ops.for_stewards')}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {reader === 'operators' && (
        <p className="whatsnew-links">
          <a href={`https://github.com/${DEFAULT_UPDATE_REPO}/blob/main/CHANGELOG.md`} target="_blank" rel="noopener noreferrer">{t('ops.full_changelog')} <ExternalLink size={13} aria-hidden /></a>
          <a href={`https://github.com/${DEFAULT_UPDATE_REPO}/tree/main/migrations`} target="_blank" rel="noopener noreferrer">{t('ops.migrations')} <ExternalLink size={13} aria-hidden /></a>
        </p>
      )}
    </div>
  );
}
