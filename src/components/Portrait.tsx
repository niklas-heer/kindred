import { useQueryClient } from '@tanstack/react-query';
import { useEffect, type CSSProperties } from 'react';
import { graphQuery } from '~/lib/api';
import type { GPerson, Graph, House, Look } from '~/lib/types';
import { CHARGE_ICONS, type ChargeIconName } from './charges.gen';
import { TINCTURE_HEX } from './Heraldry';
import { ensurePortraitDefs } from './portrait/defs';
import { detailOf, drawingUri } from './portrait/drawing';
import { shownAge } from './portrait/look';
import { chooseFace, portraitFits } from '~/lib/portrait-face';

const HEADWEAR_ICON: Partial<Record<NonNullable<Look['headwear']>, ChargeIconName>> = {
  crown: 'crown',
  circlet: 'laurel-crown',
  mitre: 'pope-crown',
};

const housesOf = new WeakMap<Graph, Map<string, House>>();

/** The person's house, read from the tree's graph if the caller did not pass it. No subscription:
 *  the graph is loaded before any portrait renders, and hundreds of portraits share it. */
function useHouse(person: GPerson, tree: string, given: House | null | undefined): House | undefined {
  const qc = useQueryClient();
  if (given !== undefined) return given ?? undefined;
  if (!person.house) return undefined;
  const graph = qc.getQueryData(graphQuery(tree).queryKey);
  if (!graph) return undefined;
  let byId = housesOf.get(graph);
  if (!byId) {
    byId = new Map(graph.houses.map((h) => [h.id, h]));
    housesOf.set(graph, byId);
  }
  return byId.get(person.house);
}

/**
 * A person's portrait: their photo, or a generated likeness (portrait/avatar.ts) aged and dressed for
 * the moment shown, on a roundel of their house's tincture. Photo and drawing share the frame, and
 * the dead of both are printed in the theme's mourning duotone (sepia in Codex). Detail drops at
 * list sizes.
 */
export function Portrait({
  person,
  tree,
  size = 96,
  frame = true,
  house: givenHouse,
  prefer,
  age,
  mourn = true,
}: {
  person: GPerson;
  tree: string;
  size?: number;
  frame?: boolean;
  /** The person's house, when the caller has it to hand; otherwise looked up from the tree. */
  house?: House | null;
  /** 'avatar' draws the likeness even when a photo exists, e.g. beside the photo it stands in for; 'portrait' shows the
   *  painted portrait where it fits the age shown, else the drawing. Absent: the person's own choice (`preferAvatar`, then
   *  `preferPortrait`), so callers need not pass it. An explicit value always wins. */
  prefer?: 'photo' | 'avatar' | 'portrait';
  /** Shows the drawing at this age (a life stage, a chronicle entry) instead of the look's own. */
  age?: number;
  /** False shows the dead in colour, as the character editor must to pick colours. */
  mourn?: boolean;
}) {
  useEffect(ensurePortraitDefs, []);
  const house = useHouse(person, tree, givenHouse);
  const detail = detailOf(size);
  const headwear = person.look?.headwear;
  // A painted portrait stands in only where it fits the age shown: near the age in its photo, and in its era (portraitFits).
  const shown = shownAge(person, new Date().getFullYear(), age);
  const fits = !!person.portrait && portraitFits({ born: person.born, shown, photoAge: person.portraitAge ?? null });
  const shownAs = prefer ?? (person.preferAvatar ? 'avatar' : person.preferPortrait ? 'portrait' : 'photo');
  const which = chooseFace({ shownAs, hasPhoto: !!person.photo, hasPortrait: !!person.portrait, fits });
  const photo = which === 'photo';
  const painted = which === 'portrait';
  const pictured = photo || painted;
  // A drawing wears its crown on its head; a photo or a painting gets the badge on the frame instead.
  const badge = pictured && headwear && HEADWEAR_ICON[headwear] ? CHARGE_ICONS[HEADWEAR_ICON[headwear]] : null;
  const src = photo
    ? `/api/photo/${tree}/${person.id}?v=${encodeURIComponent(person.photo!)}`
    : painted
      ? `/api/portrait/${tree}/${person.id}?v=${encodeURIComponent(person.portrait!)}`
      : drawingUri(person, house, detail, age);
  const name = [person.given, person.surname].filter(Boolean).join(' ');

  const cls = ['portrait', frame ? 'is-framed' : 'is-bare', `is-${detail}`].join(' ');
  const face = ['portrait-face', pictured ? 'is-photo' : 'is-drawn', person.living || !mourn ? '' : 'is-dead'].filter(Boolean).join(' ');
  const style = { width: size, height: size, '--house': house ? TINCTURE_HEX[house.arms.field] : undefined } as CSSProperties;

  return (
    <span className={cls} style={style}>
      <span className="portrait-mat">
        <span className={face}>
          <img className={painted ? 'portrait-img is-painted' : 'portrait-img'} src={src} alt={name} loading={pictured ? 'lazy' : undefined} decoding="async" draggable={false} />
        </span>
      </span>
      {badge ? (
        // Centred on the top edge, so the crown sits half above the frame, as in CK3.
        <svg
          className="portrait-crown"
          viewBox={badge.viewBox}
          width={size * 0.36}
          height={size * 0.36}
          style={{ top: -size * 0.18 }}
          aria-hidden="true"
        >
          <g dangerouslySetInnerHTML={{ __html: badge.body }} />
        </svg>
      ) : null}
    </span>
  );
}
