// What a person's card on the tree says to a screen reader beyond the name and years it shows.

/** The parts a card can add, each already in the reader's language; absent ones are left out. */
export interface CardExtras {
  /** "you", on the reader's own card. */
  you?: string;
  /** How they are related to the reader: "your aunt". */
  kin?: string;
  /** "appears again", on a second drawing of someone already in the tree. */
  again?: string;
  stories?: string;
  birthday?: string;
  disputed?: string;
}

/**
 * The rest of a card's spoken name, in a fixed order: who they are to the reader first, since that is what a
 * reader walking the tree by keyboard wants to know, then what the badges show. Empty when there is nothing to add.
 */
export function cardExtras(e: CardExtras): string {
  return [e.you, e.kin, e.again, e.birthday, e.stories, e.disputed].filter(Boolean).join(', ');
}

/**
 * What the tree announces when the arrow keys move the selection: the person, their years, and how they are
 * related, to the reader when the reader has said who they are, else to the person the selection came from.
 */
export function selectionAnnouncement(parts: { name: string; years?: string; kin?: string }): string {
  return [parts.name, parts.years, parts.kin].filter(Boolean).join(', ');
}
