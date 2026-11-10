import { Portrait } from '~/components/Portrait';
import { displayName, type Family } from '~/lib/graph';
import { useT } from '~/lib/i18n';

/** The last people the reader looked at, newest first, after the one shown now (`trail[0]`). */
export function TreeTrail({ family: f, tree, trail, panel, onSelect }: { family: Family; tree: string; trail: string[]; panel: boolean; onSelect: (id: string) => void }) {
  const t = useT();
  return (
    <nav className={`trail no-pan panel${panel ? ' with-panel' : ''}`} aria-label={t('tp.recent')}>
      <span className="faint">{t('tp.trail')}</span>
      {trail.slice(1).map((id) => {
        const p = f.byId.get(id);
        return p ? (
          <button key={id} className="trail-item" onClick={() => onSelect(id)} title={displayName(p, f)} aria-label={displayName(p, f)}>
            <Portrait person={p} tree={tree} size={30} frame={false} />
          </button>
        ) : null;
      })}
    </nav>
  );
}
