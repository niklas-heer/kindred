// CK3-style trait medallions: one glyph each, tinted by kind.
import type { GameIconName } from '~/components/GameIcon';
import type { Key } from './i18n/dictionary.ts';

export type TraitKind = 'virtue' | 'vice' | 'other';

/** Each trait: its glyph, its kind, and its name as a translation key (`trait.<id>`). */
export const TRAITS: Record<string, { icon: GameIconName; kind: TraitKind; label: Key }> = {
  brave: { icon: 'sword-brandish', kind: 'virtue', label: 'trait.brave' },
  craven: { icon: 'run', kind: 'vice', label: 'trait.craven' },
  pious: { icon: 'prayer', kind: 'virtue', label: 'trait.pious' },
  cynical: { icon: 'shrug', kind: 'other', label: 'trait.cynical' },
  scholar: { icon: 'open-book', kind: 'other', label: 'trait.scholar' },
  gardener: { icon: 'sprout', kind: 'other', label: 'trait.gardener' },
  hunter: { icon: 'bow-arrow', kind: 'other', label: 'trait.hunter' },
  poet: { icon: 'lyre', kind: 'other', label: 'trait.poet' },
  wrathful: { icon: 'enrage', kind: 'vice', label: 'trait.wrathful' },
  patient: { icon: 'hourglass', kind: 'virtue', label: 'trait.patient' },
  generous: { icon: 'open-treasure-chest', kind: 'virtue', label: 'trait.generous' },
  greedy: { icon: 'coins', kind: 'vice', label: 'trait.greedy' },
  just: { icon: 'scales', kind: 'virtue', label: 'trait.just' },
  ambitious: { icon: 'mountain-climbing', kind: 'other', label: 'trait.ambitious' },
  content: { icon: 'meditation', kind: 'virtue', label: 'trait.content' },
  gregarious: { icon: 'beer-stein', kind: 'other', label: 'trait.gregarious' },
  shy: { icon: 'hood', kind: 'other', label: 'trait.shy' },
  chaste: { icon: 'lily-pads', kind: 'virtue', label: 'trait.chaste' },
  lustful: { icon: 'lips', kind: 'vice', label: 'trait.lustful' },
  strategist: { icon: 'chess-knight', kind: 'other', label: 'trait.strategist' },
};
