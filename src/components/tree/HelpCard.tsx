// The tree's keyboard help: which keys get around the canvas.
import { X } from 'lucide-react';
import { useT, type Key } from '~/lib/i18n';

/** The keys of the tree page, opened with ? or the keyboard button on the map. */
export function HelpCard({ onClose }: { onClose: () => void }) {
  const t = useT();
  const keys: [string, Key][] = [
    ['← →', 'tp.k.neighbour'],
    ['↑ ↓', 'tp.k.parentChild'],
    ['⌘K or /', 'tp.k.find'],
    ['1 2 3', 'tp.k.views'],
    ['L', 'tp.k.lens'],
    ['C', 'tp.k.centre'],
    ['F', 'tp.k.fit'],
    ['H', 'tp.k.home'],
    ['= −', 'tp.k.zoom'],
    ['Esc', 'tp.k.esc'],
  ];
  return (
    <div className="help-card panel no-pan" role="dialog" aria-label={t('tp.keys')}>
      <header className="display">{t('tp.gettingAround')} <button className="btn icon ghost" onClick={onClose} aria-label={t('ui.close')}><X size={14} /></button></header>
      {keys.map(([k, v]) => (
        <div key={k} className="help-row"><span>{k.split(' ').map((x) => <kbd key={x}>{x}</kbd>)}</span><span>{t(v)}</span></div>
      ))}
      <p className="faint">{t('tp.canvasHint')}</p>
    </div>
  );
}
