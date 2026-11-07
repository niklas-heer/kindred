// CK3-style trait medallions: one glyph each, tinted by kind.
import type { GameIconName } from '~/components/GameIcon';

export type TraitKind = 'virtue' | 'vice' | 'other';

export const TRAITS: Record<string, { icon: GameIconName; kind: TraitKind }> = {
  brave: { icon: 'sword-brandish', kind: 'virtue' },
  craven: { icon: 'run', kind: 'vice' },
  pious: { icon: 'prayer', kind: 'virtue' },
  cynical: { icon: 'shrug', kind: 'other' },
  scholar: { icon: 'open-book', kind: 'other' },
  gardener: { icon: 'sprout', kind: 'other' },
  hunter: { icon: 'bow-arrow', kind: 'other' },
  poet: { icon: 'lyre', kind: 'other' },
  wrathful: { icon: 'enrage', kind: 'vice' },
  patient: { icon: 'hourglass', kind: 'virtue' },
  generous: { icon: 'open-treasure-chest', kind: 'virtue' },
  greedy: { icon: 'coins', kind: 'vice' },
  just: { icon: 'scales', kind: 'virtue' },
  ambitious: { icon: 'mountain-climbing', kind: 'other' },
  content: { icon: 'meditation', kind: 'virtue' },
  gregarious: { icon: 'beer-stein', kind: 'other' },
  shy: { icon: 'hood', kind: 'other' },
  chaste: { icon: 'lily-pads', kind: 'virtue' },
  lustful: { icon: 'lips', kind: 'vice' },
  strategist: { icon: 'chess-knight', kind: 'other' },
};
