import { Moon, Shield, Sun, Volume2, VolumeX } from 'lucide-react';
import { play, soundOn } from '~/lib/sfx';
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

/** Sound on or off. On by default in the codex theme only; the choice is remembered. */
export function SoundSwitch() {
  const [on, setOn] = useState(false);
  // After the layout has applied the theme (parent effects run after this one).
  const soundPref = usePref('sound');
  const themePref = usePref('theme');
  useEffect(() => {
    const id = requestAnimationFrame(() => setOn(soundOn()));
    return () => cancelAnimationFrame(id);
  }, [soundPref, themePref]);
  const Icon = on ? Volume2 : VolumeX;
  return (
    <button
      className="btn icon"
      aria-pressed={on}
      title={on ? 'Sound on (click to mute)' : 'Sound off (click to turn on)'}
      onClick={() => {
        setPref('sound', on ? 'off' : 'on');
        if (!on) setTimeout(() => play('tick'), 0);
      }}
    >
      <Icon size={16} />
    </button>
  );
}
