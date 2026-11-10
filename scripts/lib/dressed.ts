// A few of the invented modern family are given looks by hand, so the tree, the demo and the README pictures show what
// the character editor can do: the person the tree opens on, her closest family, and the two people the pictures show.
// Only what is worn and how the hair is done: the colours the generator drew stay (but for the first, whose braids are
// dark), and everyone else stays automatic.
// It draws no random numbers, so nothing else the generator makes moves.
import type { SeedLook, SeedPerson } from '../../src/lib/seed-format.ts';

export const LOOKS: Record<string, Partial<SeedLook>> = {
  // Kerstin, the carpenter the tree opens on, and Simon.
  p0084: { hair: 0, hairStyle: 'box-braids', expression: 'smile', clothing: 'plaid', clothColour: 13, earrings: 'hoops' },
  p0085: { hairStyle: 'fade', beardStyle: 'short', moustache: 'chevron', glasses: 'horn', clothing: 'jacket', clothColour: 6, expression: 'grin' },
  // Her parents and her brother.
  p0082: { hairStyle: 'coily', grey: 1, beardStyle: 'circle', clothing: 'polo', expression: 'calm', build: 7 },
  p0081: { headwear: 'headwrap', hatColour: 11, clothing: 'kaftan', clothColour: 8, trimColour: 11, earrings: 'drops', necklace: 'beads', expression: 'smile' },
  p0083: { hairStyle: 'slicked', glasses: 'rimless', clothing: 'suit-slim', expression: 'calm' },
  // Her grandparents, as their wedding year dressed them.
  p0076: { hairStyle: 'slicked', moustache: 'pencil', glasses: 'browline', clothing: 'waistcoat', extras: ['pipe'], expression: 'calm', backdrop: 'books' },
  p0080: { hairStyle: 'beehive', glasses: 'cat-eye', frames: 4, clothing: 'pearls', earrings: 'pearls', lips: 0, expression: 'smile' },
  // The children.
  p0086: { hairStyle: 'coily', clothing: 'overalls', headwear: 'cap', hatColour: 13, expression: 'grin' },
  p0087: { hairStyle: 'space-buns', clothing: 'stripes', expression: 'smile', marks: ['dimples', 'freckles'] },
  p0088: { headwear: 'bow', expression: 'grin' },
  // The two the README shows on a page of their own.
  p0061: { hairStyle: 'crown-braid', clothing: 'victorian', extras: ['brooch'], expression: 'calm', backdrop: 'drape' },
  p0146: { hairStyle: 'thinning', beardStyle: 'full', glasses: 'round', clothing: 'cardigan', extras: ['hearing-aid'], expression: 'smile' },
};

/** Adds the hand-made looks to the people who have one. A person the generator no longer makes is passed over. */
export function dressByHand(people: SeedPerson[]): void {
  for (const p of people) {
    const worn = LOOKS[p.id];
    if (worn && p.look) p.look = { ...p.look, ...worn };
  }
}
