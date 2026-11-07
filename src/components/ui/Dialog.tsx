// Dialog: an accessible modal on the native <dialog> (top layer; the rest of the page is inert).
//
// Usage:
//   <Dialog open={open} onClose={() => setOpen(false)} title="Add a parent" variant="event"
//     footer={<button className="btn primary" form="f">Save</button>} dirty={form.isDirty}>
//     <form id="f">…</form>
//   </Dialog>
//
// - Accessible name: `title` (rendered as the heading) or `label` (aria-label only).
// - Focus: `initialFocus` (a ref or a CSS selector inside the dialog), else the first field, else the
//   first control, else the panel. Tab is trapped; focus returns to the opener on close.
// - Escape closes only the top-most layer (a Select popover inside closes first). Page hotkeys are
//   suspended while it is open (see overlay.ts).
// - `dismissible={false}` ignores backdrop presses. `dirty` asks "Discard changes?" before closing by
//   Escape, backdrop or the close button. Calling `onClose` yourself (after saving) never asks.
// - `bare` renders children straight into the panel with no padding, for custom layouts (the palette).
import { X } from 'lucide-react';
import {
  useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore,
  type CSSProperties, type KeyboardEvent, type ReactNode, type Ref, type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { isTopOverlay, useOverlayLayer } from './overlay';
import { Fleuron } from './PageHeader';
import './ui.css';

export interface DialogProps {
  open: boolean;
  /** Called when the reader asks to close (Escape, backdrop, close button), after any discard prompt. */
  onClose: () => void;
  /** Visible heading; also the accessible name. */
  title?: ReactNode;
  /** Accessible name when there is no visible title. */
  label?: string;
  /** A line under the title; also the accessible description. */
  description?: ReactNode;
  /** `event`: the CK3 event window (gold frame, centred title). `plain`: a quiet panel. Default `plain`. */
  variant?: 'event' | 'plain';
  /** `center` (default), `top` (palette-like, 12vh from the top) or `sheet` (slides up from the bottom). */
  placement?: 'center' | 'top' | 'sheet';
  /** Panel width in px (or any CSS length). Default 480. */
  width?: number | string;
  /** What gets focus on open: a ref or a selector inside the dialog. Default: the first field. */
  initialFocus?: RefObject<HTMLElement | null> | string;
  /** Close on a press outside the panel. Default true. */
  dismissible?: boolean;
  /** Unsaved input: Escape, backdrop and × ask "Discard changes?" first. */
  dirty?: boolean;
  /** Show the × button in the header. Default: true when there is a title. */
  closeButton?: boolean;
  /** Buttons along the bottom edge. */
  footer?: ReactNode;
  /** No header, body padding or footer chrome: children fill the panel. */
  bare?: boolean;
  /** Extra classes on the panel. */
  className?: string;
  /** Extra classes on the body wrapper (ignored when `bare`). */
  bodyClassName?: string;
  style?: CSSProperties;
  /** The panel element, e.g. to focus it yourself. */
  panelRef?: Ref<HTMLDivElement>;
  /** Keys pressed inside the dialog (Escape and Tab are handled first). */
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  children?: ReactNode;
}

const FIELD = 'input:not([type="hidden"]):not([disabled]):not([type="file"]), select:not([disabled]), textarea:not([disabled]), [role="combobox"]:not([aria-disabled="true"])';
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

const visible = (el: HTMLElement) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
export const focusablesIn = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => visible(el) && !el.closest('[inert]'));

const noop = () => () => {};
/** True in the browser after hydration, false on the server. */
export const useIsClient = () => useSyncExternalStore(noop, () => true, () => false);

export function Dialog({
  open, onClose, title, label, description, variant = 'plain', placement = 'center', width, initialFocus,
  dismissible = true, dirty = false, closeButton, footer, bare = false, className = '', bodyClassName = '',
  style, panelRef, onKeyDown, children,
}: DialogProps) {
  const client = useIsClient();
  const shown = open && client;
  const layer = useOverlayLayer(shown);
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [confirming, setConfirming] = useState(false);
  const titleId = useId();
  const descId = useId();
  const keep = useRef<HTMLButtonElement>(null);
  const pressedOutside = useRef(false);

  // Latest props for the native listeners and effects without re-running them.
  const latest = useRef({ onClose, dirty, initialFocus });
  latest.current = { onClose, dirty, initialFocus };

  const requestClose = useCallback(() => {
    if (latest.current.dirty) setConfirming(true);
    else latest.current.onClose();
  }, []);

  // Open: remember the opener, show modally, place focus. Close (unmount): give focus back.
  useLayoutEffect(() => {
    if (!shown) return;
    const el = dialog.current;
    if (!el) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!el.open) {
      try { el.showModal(); } catch { el.setAttribute('open', ''); }
    }
    const target = latest.current.initialFocus;
    const p = panel.current!;
    const pick =
      (typeof target === 'string' ? p.querySelector<HTMLElement>(target) : target?.current) ??
      p.querySelector<HTMLElement>('[autofocus], [data-autofocus]') ??
      [...p.querySelectorAll<HTMLElement>(FIELD)].find(visible) ??
      focusablesIn(p).find((b) => !b.classList.contains('ui-dialog-close')) ??
      p;
    pick.focus({ preventScroll: true });
    return () => {
      if (el.open) el.close();
      const back = opener.current;
      // After the dialog is gone; only if focus didn't move somewhere on purpose meanwhile.
      requestAnimationFrame(() => {
        if (back?.isConnected && (document.activeElement === document.body || !document.activeElement)) back.focus({ preventScroll: true });
      });
    };
  }, [shown]);

  useEffect(() => { if (!open) setConfirming(false); }, [open]);
  useEffect(() => { if (confirming) keep.current?.focus(); }, [confirming]);

  // The platform's own cancel (e.g. Android back) goes through the same path.
  useEffect(() => {
    const el = dialog.current;
    if (!shown || !el) return;
    const cancel = (e: Event) => { e.preventDefault(); if (isTopOverlay(layer)) requestClose(); };
    el.addEventListener('cancel', cancel);
    return () => el.removeEventListener('cancel', cancel);
  }, [shown, layer, requestClose]);

  if (!shown) return null;

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    // Keys inside a dialog belong to it: never to page hotkeys or the components behind it.
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      if (!isTopOverlay(layer)) return;
      if (confirming) { setConfirming(false); return; }
      requestClose();
      return;
    }
    if (e.key === 'Tab') {
      const p = panel.current!;
      const scope = confirming ? (p.querySelector<HTMLElement>('.ui-dialog-confirm') ?? p) : p;
      const items = focusablesIn(scope);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === first || at === p || !scope.contains(at))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (at === last || !scope.contains(at))) { e.preventDefault(); first.focus(); }
      return;
    }
    if (!confirming) onKeyDown?.(e);
  };

  const showClose = closeButton ?? !!title;
  const named = title ? { 'aria-labelledby': titleId } : { 'aria-label': label };

  return createPortal(
    <dialog
      ref={dialog}
      className={`ui-dialog ui-dialog--${variant}`}
      data-placement={placement}
      role="dialog"
      aria-modal="true"
      {...named}
      aria-describedby={description ? descId : undefined}
      // Pointer down and up both on the backdrop: a drag that starts in a field never closes it.
      onPointerDown={(e) => { pressedOutside.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (e.target !== e.currentTarget || !pressedOutside.current) return;
        pressedOutside.current = false;
        if (dismissible && isTopOverlay(layer)) requestClose();
      }}
    >
      <div
        ref={(el) => {
          panel.current = el;
          if (typeof panelRef === 'function') panelRef(el);
          else if (panelRef) (panelRef as { current: HTMLDivElement | null }).current = el;
        }}
        tabIndex={-1}
        className={`ui-dialog-panel panel ${className}`}
        style={{ ...(width !== undefined ? { ['--dialog-w' as string]: typeof width === 'number' ? `${width}px` : width } : null), ...style }}
        onKeyDown={onKey}
      >
        {bare ? children : (
          <>
            {(title || showClose) && (
              <header className="ui-dialog-head">
                {title && <h2 id={titleId} className="ui-dialog-title">{title}</h2>}
                {title && variant === 'event' && <span className="ui-dialog-fleuron" aria-hidden><Fleuron size={14} /></span>}
                {showClose && (
                  <button type="button" className="btn icon ghost ui-dialog-close" onClick={requestClose} aria-label="Close" title="Close (Esc)">
                    <X size={16} />
                  </button>
                )}
              </header>
            )}
            {description && <p id={descId} className="ui-dialog-desc">{description}</p>}
            <div className={`ui-dialog-body ${bodyClassName}`}>{children}</div>
            {footer && <footer className="ui-dialog-foot">{footer}</footer>}
          </>
        )}
        {confirming && (
          <div className="ui-dialog-confirm" role="alertdialog" aria-modal="true" aria-labelledby={`${titleId}-c`}>
            <div>
              <b id={`${titleId}-c`}>Discard changes?</b>
              <p>What you typed here will be lost.</p>
              <div className="ui-row">
                <button ref={keep} type="button" className="btn" onClick={() => setConfirming(false)}>Keep editing</button>
                <button type="button" className="btn primary" onClick={() => { setConfirming(false); latest.current.onClose(); }}>Discard</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </dialog>,
    document.body,
  );
}
