// The toolbar over the tree: the view, the controls of that view, the lens, and how cards show names and ages.
import { Crown, FileQuestion, GitFork, Glasses, HeartPulse, Network, Route as RouteIcon, Shield, SlidersHorizontal, Waypoints } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import { Arms } from '~/components/Heraldry';
import { Dialog, Select, type SelectOption } from '~/components/ui';
import type { NameMode } from '~/lib/graph';
import { useT } from '~/lib/i18n';
import type { View } from '~/lib/layout';
import type { Lens } from '~/lib/tree-view';
import type { House } from '~/lib/types';
import { DisplayChoices, type AgeMode } from './DisplayChoices';

/** The reader's display choices for the cards, and how to change them. */
export interface CardDisplay {
  nameMode: NameMode;
  ageMode: AgeMode;
  changeNameMode: (m: NameMode) => void;
  changeAgeMode: (m: AgeMode) => void;
}

/**
 * The toolbar row. `tight` is how far it has had to shrink (useToolbarFit); `roomy` whether names and ages still fit in
 * the row, else they open from the Display button. A phone keeps the row to the view, the lens and Display: `controls`
 * (the view's own) open from Display there.
 */
export function TreeToolbar({ ref, phone, tight, roomy, view, onView, controls, lens, onLens, focusGiven, house, who, display, onDisplay }: {
  ref: Ref<HTMLDivElement>; phone: boolean; tight: 0 | 1 | 2; roomy: boolean;
  view: View; onView: (v: View) => void; controls: ReactNode;
  lens: Lens; onLens: (l: Lens) => void;
  /** The selected person's given name and house, and whether the reader has said who they are: the lenses' names. */
  focusGiven: string; house: House | undefined; who: boolean;
  display: CardDisplay; onDisplay: () => void;
}) {
  const t = useT();
  const viewOptions: (SelectOption<View> & { title: string })[] = [
    { value: 'family', label: t('tp.view.family'), icon: <Network size={15} />, title: t('tp.viewTitle.family') },
    { value: 'dynasty', label: t('tp.view.dynasty'), icon: <Crown size={15} />, title: t('tp.viewTitle.dynasty') },
    { value: 'ancestors', label: t('tp.view.ancestors'), icon: <GitFork size={15} style={{ transform: 'rotate(180deg)' }} />, title: t('tp.viewTitle.ancestors') },
  ];
  const lensOptions: SelectOption<Lens>[] = [
    { value: 'none', label: t('tp.lensEveryone'), icon: <Glasses size={16} /> },
    { value: 'line', label: t('tp.lensLine', { name: focusGiven }), icon: <Waypoints size={16} />, hint: 'L' },
    { value: 'house', label: house ? house.name : t('tp.lensSameHouse'), icon: house ? <Arms arms={house.arms} size={16} /> : <Shield size={16} /> },
    { value: 'living', label: t('tp.lensLiving'), icon: <HeartPulse size={16} /> },
    { value: 'gaps', label: t('needed.title'), icon: <FileQuestion size={16} /> },
    { value: 'path', label: who ? t('tp.lensPathMe') : t('tp.lensPathStart'), icon: <RouteIcon size={16} /> },
  ];
  const lensLabel = lensOptions.find((o) => o.value === lens)?.label ?? t('tp.lensEveryone');
  return (
    <div ref={ref} className={`tree-toolbar panel no-pan${phone ? ' is-phone' : tight ? ' is-tight' : ''}`} role="toolbar" aria-label={t('tp.toolbarAria')} data-tour="tree-toolbar">
      <div className="seg tb-views" role="group" aria-label={t('tp.view')}>
        {viewOptions.map((o) => (
          <button key={o.value} className="btn" aria-pressed={view === o.value} onClick={() => onView(o.value)} title={o.title} aria-label={o.label}>
            <span className="tb-view-icon" aria-hidden>{o.icon}</span><span className="tb-label">{o.label}</span>
          </button>
        ))}
      </div>
      {!phone && <Select className="tb-view-select" size="sm" value={view} onChange={onView} options={viewOptions} aria-label={t('tp.view')} menuWidth={170} />}
      {/* A phone keeps the row to the view, the lens and Display: the rest of these open from Display, each with its name. */}
      {!phone && (
        <>
          <span className="tb-sep" />
          {controls}
        </>
      )}
      <span className="tb-sep" />
      <Select
        className={`tb-lens${lens !== 'none' ? ' on' : ''}`}
        size="sm"
        aria-label={t('tp.lensLabel', { lens: lensLabel })}
        title={t('tp.lensLabel', { lens: lensLabel })}
        menuWidth={250}
        value={lens}
        options={lensOptions}
        onChange={onLens}
      />
      {roomy ? (
        <>
          <span className="tb-sep" />
          <div className="tb-display-row" role="group" aria-label={t('tp.cardDisplay')}>
            <DisplayChoices nameMode={display.nameMode} onName={display.changeNameMode} ageMode={display.ageMode} onAge={display.changeAgeMode} />
          </div>
        </>
      ) : (
        <button type="button" className="btn tb-display" onClick={onDisplay} aria-haspopup="dialog" aria-label={t('tp.display')} title={t(phone ? 'tp.display' : 'tp.namesAndAges')}>
          <SlidersHorizontal size={16} aria-hidden /><span className="tb-label">{t('tp.display')}</span>
        </button>
      )}
    </div>
  );
}

/** The Display sheet: names and ages when the toolbar has no room for them, and on a phone the view's own controls (`children`) too. */
export function DisplaySheet({ open, phone, onClose, display, children }: { open: boolean; phone: boolean; onClose: () => void; display: CardDisplay; children?: ReactNode }) {
  const t = useT();
  return (
    <Dialog open={open} onClose={onClose} title={t(phone ? 'tp.display' : 'tp.namesAndAges')} placement={phone ? 'sheet' : 'center'} width={420}>
      <div className="tb-display-sheet">
        {children}
        <div className="tb-sheet-group" role="group" aria-label={t('tp.cardDisplay')}>
          <DisplayChoices labelled nameMode={display.nameMode} onName={display.changeNameMode} ageMode={display.ageMode} onAge={display.changeAgeMode} />
        </div>
      </div>
    </Dialog>
  );
}
