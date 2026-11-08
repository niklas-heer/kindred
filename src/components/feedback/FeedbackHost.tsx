// The always-loaded half of steward feedback: the shortcut, the "open" state, and the error watcher. The panel and the screen
// capture are loaded when it is first opened. Mod+Shift+F works anywhere, inside a dialog too: the listener runs in the capture
// phase, so a dialog keeping its keys to itself cannot swallow it. Stewards only; the server checks too.
import { lazy, Suspense, useEffect, useSyncExternalStore } from 'react';
import { watchClientErrors } from '~/lib/feedback-client';
import { useCan } from '~/lib/session';
import { useT } from '~/lib/i18n';
import { Dialog } from '~/components/ui/Dialog';

watchClientErrors();

let isOpen = false;
const subs = new Set<() => void>();
const set = (v: boolean) => { isOpen = v; subs.forEach((s) => s()); };
/** Opens the feedback panel from anywhere: the account menu, the palette, the phone's More sheet. */
export const openFeedback = () => set(true);

function LoadFailed({ onClose }: { tree: string; onClose: () => void }) {
  const t = useT();
  return <Dialog open onClose={onClose} title={t('feedback.title')} width={420}><p role="alert">{t('feedback.load_failed')}</p></Dialog>;
}
const Panel = lazy(() => import('./FeedbackPanel').catch(() => ({ default: LoadFailed })));

export function FeedbackHost({ tree }: { tree: string }) {
  const steward = useCan('manage-access');
  const open = useSyncExternalStore((l) => (subs.add(l), () => subs.delete(l)), () => isOpen, () => false);
  useEffect(() => {
    if (!steward) return;
    const key = (e: KeyboardEvent) => {
      if (e.repeat || !(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey || e.key.toLowerCase() !== 'f') return;
      e.preventDefault();
      e.stopPropagation();
      set(true);
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [steward]);
  // Leaving the family, or losing the role, closes it.
  useEffect(() => () => set(false), []);
  if (!open || !steward) return null;
  return <Suspense fallback={null}><Panel tree={tree} onClose={() => set(false)} /></Suspense>;
}
