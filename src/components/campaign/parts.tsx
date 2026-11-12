// Small things the campaign's board, battle and chronicle share: the laurel, how a turn's season is said, and what the
// ground does to an attack, in words.
import { Flower2, Leaf, Snowflake, Sun } from 'lucide-react';
import { seasonOf, type Season } from '~/lib/campaign/chronicle';
import { RULES, capOn, type Ground } from '~/lib/campaign/engine';
import type { StoredSide } from '~/lib/campaign/types';
import type { Key, Translator } from '~/lib/i18n';

export type BoardSide = Pick<StoredSide, 'id' | 'name' | 'arms' | 'rival'>;

/** A laurel wreath: the mark of a season won, and of a best score. */
export function Laurel({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={`cg-laurel ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <path d="M12 21c-5-1-8-5-8-10M12 21c5-1 8-5 8-10" />
      <path d="M4.2 8.5c1.6.2 2.6 1.2 2.8 2.8M5 13c1.5-.3 2.8.4 3.4 1.8M7.2 17c1.3-.6 2.7-.2 3.6.9M19.8 8.5c-1.6.2-2.6 1.2-2.8 2.8M19 13c-1.5-.3-2.8.4-3.4 1.8M16.8 17c-1.3-.6-2.7-.2-3.6.9" />
    </svg>
  );
}

export const SEASON_ICON: Record<Season, typeof Sun> = { spring: Flower2, summer: Sun, autumn: Leaf, winter: Snowflake };
const SEASON_NAME: Record<Season, Key> = { spring: 'campaign.season.spring', summer: 'campaign.season.summer', autumn: 'campaign.season.autumn', winter: 'campaign.season.winter' };

/** "Autumn, year 2": when a turn falls. */
export function seasonLine(t: Translator, turn: number): string {
  const { season, year } = seasonOf(turn);
  return t('campaign.season.line', { season: t(SEASON_NAME[season]), year });
}

/** What the ground does to an attack, in words: the lines the order bar and the battle list under the chance. */
export function modifiers(t: Translator, ground: Ground): string[] {
  const out: string[] = [];
  const rounds = { rounds: RULES.CROSSING_ROUNDS, full: RULES.BATTLE_ROUNDS };
  if (ground.terrain === 'forest') out.push(t('campaign.mod.forest'));
  if (ground.terrain === 'highland') out.push(t('campaign.mod.highland'));
  if (ground.terrain === 'marsh') out.push(t('campaign.mod.marsh', { cap: capOn('marsh') }));
  if (ground.terrain === 'town') out.push(t('campaign.mod.town'));
  if (ground.crossing === 'river') out.push(t('campaign.mod.river', rounds));
  if (ground.crossing === 'sea') out.push(t('campaign.mod.sea', rounds));
  return out.length ? out : [t('campaign.mod.none')];
}

export const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
