// The overlay stack: every open dialog, sheet, palette or popover registers a layer here, so page
// hotkeys can stand aside while one is open.
//
// Usage:
//   // A page shortcut that never fires while ⌘K, a dialog or a Select popover is open:
//   usePageHotkey('ArrowLeft', () => step(-1));
//   usePageHotkey('F', fit, { enabled: !busy });
//
//   // In a custom overlay that isn't a <Dialog> or <Select> (those register themselves):
//   const layer = useOverlayLayer(open);   // returns its id; isTopOverlay(layer) for Escape handling
//
//   // Anywhere else:
//   isOverlayOpen()       // plain check, for event handlers
//   useOverlayOpen()      // reactive, for rendering
import { useHotkey } from '@tanstack/react-hotkeys';
import { useId, useLayoutEffect, useEffect, useSyncExternalStore } from 'react';

let stack: string[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());

/** True while any overlay (dialog, sheet, palette, popover) is open. */
export const isOverlayOpen = () => stack.length > 0;
/** True when `id` is the top-most open layer: only it should react to Escape. */
export const isTopOverlay = (id: string) => stack[stack.length - 1] === id;

export function pushOverlay(id: string) {
  if (stack.includes(id)) return;
  stack = [...stack, id];
  emit();
}
export function popOverlay(id: string) {
  if (!stack.includes(id)) return;
  stack = stack.filter((x) => x !== id);
  emit();
}

const subscribe = (l: () => void) => (subs.add(l), () => void subs.delete(l));
/** Reactive: whether any overlay is open. */
export function useOverlayOpen(): boolean {
  return useSyncExternalStore(subscribe, isOverlayOpen, () => false);
}

// useLayoutEffect warns during SSR; overlays only open in the browser anyway.
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Registers a layer while `active`. Registered before paint, so a key pressed right after opening already sees it. */
export function useOverlayLayer(active: boolean): string {
  const id = useId();
  useIsoLayoutEffect(() => {
    if (!active) return;
    pushOverlay(id);
    return () => popOverlay(id);
  }, [active, id]);
  return id;
}

type HotkeyArgs = Parameters<typeof useHotkey>;

/**
 * `useHotkey` for page-level shortcuts: suspended while any overlay is open, so arrows typed in the
 * palette never walk the tree and Escape in a dialog never closes the page's panel.
 * Same arguments as `useHotkey` from @tanstack/react-hotkeys.
 */
export function usePageHotkey(hotkey: HotkeyArgs[0], callback: HotkeyArgs[1], options?: HotkeyArgs[2]) {
  const open = useOverlayOpen();
  const enabled = (options as { enabled?: boolean } | undefined)?.enabled ?? true;
  useHotkey(
    hotkey as never,
    ((...args: Parameters<HotkeyArgs[1]>) => {
      // Checked again at call time: the store may have changed since the last render.
      if (isOverlayOpen()) return;
      return (callback as (...a: unknown[]) => unknown)(...args);
    }) as never,
    { ...(options as object), enabled: enabled && !open } as never,
  );
}
