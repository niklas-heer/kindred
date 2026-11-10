import { Link } from '@tanstack/react-router';
import { ChevronUp, Landmark, Users } from 'lucide-react';
import { Arms } from '~/components/Heraldry';
import { displayName, type Family } from '~/lib/graph';
import { formatNumber, useT } from '~/lib/i18n';
import type { GPerson, House } from '~/lib/types';

/**
 * The banner over a dynasty: the house it follows (or "Descendants of" its first person), how many it holds, and a way
 * to start a generation earlier. `big` introduces it; folded, it is a pill that keeps out of the top generation's way.
 */
export function HouseBanner({ family: f, tree, rootPerson, rootHouse, line, members, big, onToggle, older, onOlder }: {
  family: Family; tree: string; rootPerson: GPerson; rootHouse: House | undefined; line: 'house' | 'all'; members: number;
  big: boolean; onToggle: () => void; older: string | undefined; onOlder: () => void;
}) {
  const t = useT();
  // "Descendants of {name}", as the words before and after the name, in whatever order the language puts them.
  const descOf = t('tp.descendantsOf', { name: '\u0001' }).split('\u0001').map((w) => w.trim());
  return (
    <div className={`house-banner no-pan${big ? '' : ' compact'}`}>
      <button
        className="banner-id"
        onClick={onToggle}
        aria-expanded={big}
        title={big ? t('tp.bannerFold') : t('tp.houseDetails')}
      >
        {line === 'house' && rootHouse ? <Arms arms={rootHouse.arms} size={20} /> : <Users size={16} />}
        <span className="banner-text">
          {line === 'house' && rootHouse ? <b className="display">{rootHouse.name}</b> : (
            // The name once. Short of room, the words around it go first (tree.css, .banner-of).
            <b className="display banner-of">
              {descOf[0] && <span>{descOf[0]}</span>}
              <span className="banner-name">{displayName(rootPerson, f)}{descOf[1] ? ` ${descOf[1]}` : ''}</span>
            </b>
          )}
          {line === 'house' && rootHouse ? (big ? (
            <span className="faint banner-more">
              {t('tp.memberCount', { count: members })} · {t('tp.from', { name: displayName(rootPerson, f) })}
              {rootHouse.motto ? <> · <i>“{rootHouse.motto}”</i></> : null}
            </span>
          ) : (
            <span className="faint banner-count">{formatNumber(members, t.locale)}</span>
          )) : (
            <span className="faint banner-count">· {formatNumber(members, t.locale)}</span>
          )}
        </span>
      </button>
      {line === 'house' && rootHouse && (
        <Link className="btn ghost banner-page" to="/$tree/house/$house" params={{ tree, house: rootHouse.id }} title={t('panel.openHouse', { name: rootHouse.name })} aria-label={t('panel.openHouse', { name: rootHouse.name })}>
          <Landmark size={15} aria-hidden />{big && <span className="banner-btn-label">{t('tp.housePage')}</span>}
        </Link>
      )}
      {older && (
        <button className="btn ghost" onClick={onOlder} title={t('tp.olderTitle')} aria-label={t('tp.startEarlier')}>
          <ChevronUp size={15} aria-hidden />{big && <span className="banner-btn-label">{t('tp.older')}</span>}
        </button>
      )}
    </div>
  );
}
