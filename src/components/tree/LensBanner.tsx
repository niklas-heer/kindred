import { X } from 'lucide-react';
import { displayName, kinship, type Family, type Kinship } from '~/lib/graph';
import { kinshipLabel, useT, yourKinship, type Translator } from '~/lib/i18n';
import type { Lens } from '~/lib/tree-view';
import type { GPerson, House } from '~/lib/types';

/**
 * What the lens in use lights, how many of those are drawn (`count`), and a way out. `target` is the far end of the
 * path lens, `me` the person the page starts from, `who` the person the reader said they are.
 */
/** "Showing how Ada is your great-aunt", the possessive agreeing with the relation; without a name for it, "related to you". */
function pathToYou(t: Translator, name: string, k: Kinship | undefined | null) {
  return kinshipLabel(k, t.locale) ? t('tp.bannerPathYours', { name, yours: yourKinship(k!, t.locale) }) : t('tp.bannerPathRelatedYou', { name });
}

export function LensBanner({ family: f, lens, target, me, who, focusPerson, house, count, onClear }: {
  family: Family; lens: Exclude<Lens, 'none'>; target: string; me: string; who: string | null; focusPerson: GPerson | undefined;
  house: House | undefined; count: string; onClear: () => void;
}) {
  const t = useT();
  return (
    <div className="lens-banner no-pan" role="status">
      <span className="lens-text">
      {lens === 'path' ? (
        // The path needs two people: with only one in view, ask for the other (or, unsaid, who the reader is).
        target === (who ?? me)
          ? <>{who ? t('tp.bannerPathPick') : t('tp.bannerPathPickStart', { me: displayName(f.byId.get(me)!, f) })}</>
          : who
          ? <>{pathToYou(t, displayName(f.byId.get(target)!, f), kinship(f, who, target))}</>
          : <>{t('tp.bannerPathRelated', { name: displayName(f.byId.get(target)!, f), me: displayName(f.byId.get(me)!, f) })}</>
      ) : lens === 'line' ? (
        <>{t('tp.bannerLine', { name: focusPerson?.given ?? '' })}</>
      ) : lens === 'living' ? (
        <>{t('tp.lensLiving')}</>
      ) : lens === 'gaps' ? (
        <>{t('tp.bannerGaps')}</>
      ) : (
        <>{t('tp.bannerHouse', { name: house?.name ?? t('tp.houseWord') })}</>
      )}
      </span>
      <span className="lens-count">{count}</span>
      <button className="btn icon ghost" onClick={onClear} aria-label={t('tp.clearLens')} title={t('tp.clearLensEsc')}><X size={14} /></button>
    </div>
  );
}
