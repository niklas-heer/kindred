import { useQueryClient } from '@tanstack/react-query';
import { useEffect, type CSSProperties } from 'react';
import { graphQuery } from '~/lib/api';
import type { GPerson, Graph, House, Look } from '~/lib/types';
import { CHARGE_ICONS, type ChargeIconName } from './charges.gen';
import { TINCTURE_HEX } from './Heraldry';
import { ensurePortraitDefs } from './portrait/defs';
import { detailOf, drawingUri } from './portrait/drawing';

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
 * A woodcut cameo: the person drawn in ink on a roundel of their house's tincture, dressed for
 * their era. Uploaded photos sit in the same roundel. The dead are printed in the theme's
 * mourning duotone (sepia in Codex). Detail drops at list sizes.
 */
export function Portrait({
  person,
  tree,
  size = 96,
  frame = true,
  house: givenHouse,
}: {
  person: GPerson;
  tree: string;
  size?: number;
  frame?: boolean;
  /** The person's house, when the caller has it to hand; otherwise looked up from the tree. */
  house?: House | null;
}) {
  useEffect(ensurePortraitDefs, []);
  const house = useHouse(person, tree, givenHouse);
  const detail = detailOf(size);
  const headwear = person.look?.headwear;
  const badge = headwear && HEADWEAR_ICON[headwear] ? CHARGE_ICONS[HEADWEAR_ICON[headwear]] : null;
  const src = person.photo
    ? `/api/photo/${tree}/${person.id}?v=${encodeURIComponent(person.photo)}`
    : drawingUri(person, house, detail);
  const name = [person.given, person.surname].filter(Boolean).join(' ');

  const cls = ['portrait', frame ? 'is-framed' : 'is-bare', `is-${detail}`].join(' ');
  const face = ['portrait-face', person.photo ? 'is-photo' : 'is-drawn', person.living ? '' : 'is-dead'].filter(Boolean).join(' ');
  const style = { width: size, height: size, '--house': house ? TINCTURE_HEX[house.arms.field] : undefined } as CSSProperties;

  return (
    <span className={cls} style={style}>
      <span className="portrait-mat">
        <span className={face}>
          <img className="portrait-img" src={src} alt={name} loading={person.photo ? 'lazy' : undefined} decoding="async" draggable={false} />
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
