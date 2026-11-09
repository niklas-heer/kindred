// ConfirmDialog: asks before something is taken away, in the app's own window instead of the browser's.
//
// Usage:
//   <ConfirmDialog open={asking} onClose={() => setAsking(false)} onConfirm={() => remove.mutate()}
//     title="Remove this saying?" confirmLabel="Remove" busy={remove.isPending}>
//     <p>“Eat first, talk later.”</p>
//   </ConfirmDialog>
//
// - The children say exactly what will go. Keep the title a question and the button the action's own verb.
// - Focus starts on Cancel, so Enter or Space pressed out of habit never removes anything.
// - `busy` disables both buttons while the removal is on its way; `error` shows why it failed and keeps the window open.
import type { ReactNode } from 'react';
import { useT } from '~/lib/i18n';
import { Dialog } from './Dialog';
import { Notice } from './states';

export interface ConfirmDialogProps {
  open: boolean;
  /** Cancel, Escape, the backdrop or the close button. */
  onClose: () => void;
  onConfirm: () => void;
  /** The question, naming what is about to go. */
  title: ReactNode;
  /** The button that goes through with it, e.g. "Remove Greta". */
  confirmLabel: ReactNode;
  busy?: boolean;
  error?: ReactNode;
  children?: ReactNode;
}

export function ConfirmDialog({ open, onClose, onConfirm, title, confirmLabel, busy = false, error, children }: ConfirmDialogProps) {
  const t = useT();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      width="min(440px, 100vw - 24px)"
      dismissible={!busy}
      bodyClassName="ui-confirm"
      footer={
        <>
          <button type="button" className="btn ghost" data-autofocus onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
          <button type="button" className="btn danger" onClick={onConfirm} disabled={busy}>{confirmLabel}</button>
        </>
      }
    >
      {children}
      {error ? <Notice>{error}</Notice> : null}
    </Dialog>
  );
}
