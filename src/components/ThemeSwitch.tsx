import { Moon, Shield, Sun, Volume2, VolumeX } from 'lucide-react';
import { play, soundOn } from '~/lib/sfx';
import { useEffect, useState } from 'react';
import { setPref, usePref, type Theme } from '~/lib/prefs';
import { useT, type Key } from '~/lib/i18n';

export const THEME_ICONS: Record<Theme, typeof Sun> = { codex: Shield, modern: Sun, night: Moon };
/** The theme names, as translation keys. "Codex" is a name and reads the same everywhere. */
export const THEME_LABEL: Record<Theme, Key> = { codex: 'shell.themeCodex', modern: 'shell.themePaper', night: 'shell.themeNight' };
const ORDER: Theme[] = ['codex', 'modern', 'night'];

/** The theme in use: the reader's pick, else what the tree applied. Neutral (codex) until mounted. */
export function useTheme(): Theme {
  const pref = usePref('theme') as Theme | null;
  const [applied, setApplied] = useState<Theme>('codex');
  useEffect(() => {
    // After the layout has applied the tree's theme (parent effects run after this one).
    const id = requestAnimationFrame(() => setApplied((document.documentElement.dataset.theme as Theme) ?? 'codex'));
    return () => cancelAnimationFrame(id);
  }, [pref]);
  return pref ?? applied;
}

/** Sound on or off, and a toggle. On by default in the codex theme only; the choice is remembered. */
export function useSound(): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const soundPref = usePref('sound');
  const themePref = usePref('theme');
  useEffect(() => {
    const id = requestAnimationFrame(() => setOn(soundOn()));
    return () => cancelAnimationFrame(id);
  }, [soundPref, themePref]);
  const toggle = () => {
    setPref('sound', on ? 'off' : 'on');
    if (!on) setTimeout(() => play('tick'), 0);
  };
  return [on, toggle];
}

/** Cycles codex → paper → night. The tree's own default applies until the reader picks one. */
export function ThemeSwitch() {
  const t = useT();
  const current = useTheme();
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
  const Icon = THEME_ICONS[current] ?? Shield;
  const from = t(THEME_LABEL[current]);
  const to = t(THEME_LABEL[next]);
  return (
    <button className="btn icon ghost" title={t('shell.themeSwitchTitle', { current: from, next: to })} aria-label={t('shell.themeSwitchAria', { current: from, next: to })} onClick={() => setPref('theme', next)}>
      <Icon size={17} />
    </button>
  );
}

/** Sound on or off, as a ghost button like the theme switch: the icon says which. */
export function SoundSwitch() {
  const t = useT();
  const [on, toggle] = useSound();
  const Icon = on ? Volume2 : VolumeX;
  return (
    <button className="btn icon ghost" aria-pressed={on} aria-label={t('shell.sound_effects')} title={on ? t('shell.soundOn') : t('shell.soundOff')} onClick={toggle}>
      <Icon size={17} />
    </button>
  );
}
