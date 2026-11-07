// A game-icons.net glyph (CC BY 3.0) from the extracted set, drawn in the current text colour.
import { CHARGE_ICONS, type ChargeIconName } from './charges.gen';

export type GameIconName = ChargeIconName;

export function GameIcon({ name, size = 16, className, title }: { name: GameIconName; size?: number; className?: string; title?: string }) {
  const icon = CHARGE_ICONS[name];
  return (
    <svg className={className} width={size} height={size} viewBox={icon.viewBox} aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <g dangerouslySetInnerHTML={{ __html: icon.body }} />
    </svg>
  );
}
