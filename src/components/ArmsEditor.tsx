// The arms editor: a coat-of-arms designer in the manner of CK3's, opened from the house page.
// The designer itself (heraldry/Designer.tsx: layers, pickers, presets, canting suggestions) loads on first open,
// so pages that only show shields do not carry it.
//
// Usage (only for readers who may edit houses; the server refuses anyone else too):
//   {canEdit && <ArmsEditor open={open} onClose={() => setOpen(false)} house={house} tree={tree} />}
// `initialTab="name"` opens it on the suggestions ("Suggest arms from the name"); the default is the design itself.
import { lazy, Suspense, useEffect, useState } from 'react';
import type { House } from '~/lib/types';
import { blazonV2 } from './heraldry/blazon';
import { asV2 } from './heraldry/convert';
import type { DesignerTab } from './heraldry/Designer';

const Designer = lazy(() => import('./heraldry/Designer'));

export function ArmsEditor({ open, onClose, house, tree, initialTab = 'design' }: {
  open: boolean; onClose: () => void; house: House; tree: string; initialTab?: DesignerTab;
}) {
  // Mount on first open and stay mounted, so closing can animate and reopening is instant.
  const [opened, setOpened] = useState(open);
  useEffect(() => {
    if (open) setOpened(true);
  }, [open]);
  if (!opened && !open) return null;
  return (
    <Suspense fallback={null}>
      <Designer open={open} onClose={onClose} house={house} tree={tree} initialTab={initialTab} />
    </Suspense>
  );
}

/** "Quarterly or and azure, a lion's head gules": the arms in words, for the reader and for screen readers. */
export function blazon(a: House['arms']): string {
  return blazonV2(asV2(a));
}
