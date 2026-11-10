import { usePageHotkey } from '~/components/ui';

/** What the tree page's keys do (HelpCard lists them). */
export interface TreeKeys {
  left: () => void; right: () => void; up: () => void; down: () => void;
  /** Enter: centre the tree on the selected person. */
  enter: () => void;
  fit: () => void; centre: () => void; home: () => void;
  view: (n: 1 | 2 | 3) => void;
  lineLens: () => void;
  zoom: (by: number) => void;
  help: () => void;
  escape: () => void;
}

/** The tree page's keys, while `live` (not while a quick-add form is open). */
export function useTreeHotkeys(live: boolean, k: TreeKeys) {
  usePageHotkey('ArrowLeft', k.left, { enabled: live });
  usePageHotkey('ArrowRight', k.right, { enabled: live });
  usePageHotkey('ArrowUp', k.up, { enabled: live });
  usePageHotkey('ArrowDown', k.down, { enabled: live });
  usePageHotkey('Enter', k.enter, { enabled: live });
  usePageHotkey('F', k.fit, { enabled: live });
  usePageHotkey('C', k.centre, { enabled: live });
  usePageHotkey('H', k.home, { enabled: live });
  usePageHotkey('1', () => k.view(1), { enabled: live });
  usePageHotkey('2', () => k.view(2), { enabled: live });
  usePageHotkey('3', () => k.view(3), { enabled: live });
  usePageHotkey('L', k.lineLens, { enabled: live });
  usePageHotkey('=', () => k.zoom(1.25), { enabled: live });
  usePageHotkey('-', () => k.zoom(0.8), { enabled: live });
  usePageHotkey('?', k.help, { enabled: live });
  usePageHotkey('Escape', k.escape, { enabled: live });
}
