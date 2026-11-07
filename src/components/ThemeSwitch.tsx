import { Moon, Shield, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { setPref, usePref, type Theme } from '~/lib/prefs';

const ICONS: Record<Theme, typeof Sun> = { codex: Shield, modern: Sun, night: Moon };
const LABEL: Record<Theme, string> = { codex: 'Codex', modern: 'Paper', night: 'Night' };

/** Cycles codex → paper → night. The tree's own default applies until the reader picks one. */
export function ThemeSwitch() {
  const pref = usePref('theme') as Theme | null;
  // The applied theme is only known in the browser; render a neutral icon until then.
  const [applied, setApplied] = useState<Theme>('codex');
  useEffect(() => setApplied((document.documentElement.dataset.theme as Theme) ?? 'codex'), [pref]);
  const current = pref ?? applied;
  const order: Theme[] = ['codex', 'modern', 'night'];
  const next = order[(order.indexOf(current) + 1) % order.length];
  const Icon = ICONS[current] ?? Shield;
  return (
    <button className="btn icon" title={`Theme: ${LABEL[current]} (switch to ${LABEL[next]})`} onClick={() => setPref('theme', next)}>
      <Icon size={16} />
    </button>
  );
}
