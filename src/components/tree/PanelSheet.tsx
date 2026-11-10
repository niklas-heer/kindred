import { ArrowLeft, ChevronUp } from 'lucide-react';
import type { PointerEventHandler, ReactNode, Ref } from 'react';
import { useT } from '~/lib/i18n';
import type { Snap } from './useBottomSheet';

/**
 * The person panel's frame: docked beside the tree on wide screens, a bottom sheet with a grip on a phone (useBottomSheet).
 * Opened fully on a phone (`dialog`) it covers the page: a dialog named after the person (`name`).
 */
export function PanelSheet({ ref, snap, dialog, name, drag, onBack, onCycle, onPeek, children }: {
  ref: Ref<HTMLDivElement>; snap: Snap; dialog: boolean; name: string | undefined;
  drag: { onPointerDown: PointerEventHandler; onPointerMove: PointerEventHandler; onPointerUp: PointerEventHandler; onPointerCancel: PointerEventHandler };
  onBack: () => void; onCycle: () => void; onPeek: () => void; children: ReactNode;
}) {
  const t = useT();
  return (
    <div
      ref={ref}
      className="panel-sheet"
      data-snap={snap}
      // Opened fully on a phone it covers the page: a dialog named after the person, which takes focus and gives it back.
      role={dialog ? 'dialog' : undefined}
      aria-label={dialog && name !== undefined ? name : undefined}
      tabIndex={dialog ? -1 : undefined}
      {...drag}
    >
      <div className="sheet-bar">
        {snap === 'full' && (
          <button className="btn ghost sheet-back" onClick={onBack}><ArrowLeft size={16} /> {t('tp.backToTree')}</button>
        )}
        <button
          className="sheet-grip"
          // At peek the whole strip below is one button that does the same, so this one steps aside for it.
          inert={snap === 'peek'}
          onClick={onCycle}
          aria-label={snap === 'peek' ? t('tp.showMore') : snap === 'half' ? t('tp.showEverything') : t('tp.showLess')}
          title={snap === 'full' ? t('tp.showLess') : t('tp.showMore')}
        >
          <span />
        </button>
      </div>
      {children}
      {snap === 'peek' && (
        <button className="sheet-peek-hit" onClick={onPeek} aria-label={t('tp.moreAbout', { name: name ?? '' })}>
          <ChevronUp size={18} aria-hidden />
        </button>
      )}
    </div>
  );
}
