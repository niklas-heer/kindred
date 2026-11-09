// The rules a parent link keeps wherever it is made: the link form (relations.server.ts `linkPlan`) and the GEDCOM
// import (exchange/plan.ts). Pure, so the import plan can use them without a database.

/** A person has at most this many parents of one kind (the link form makes birth parents, so there it is all of them). */
export const MAX_PARENTS = 2;

/** The first year of a stored date ("~1890-05" → 1890), or NaN when there is none. */
export const yearIn = (d: string | null | undefined) => (d ? parseInt(d.replace(/^~/, ''), 10) : NaN);

/**
 * Whether a child born `childBorn` cannot have a parent born `parentBorn`: the child was born first, or in the same
 * year. An unknown year on either side is no reason to refuse.
 */
export const bornBeforeParent = (childBorn: string | null | undefined, parentBorn: string | null | undefined) => yearIn(childBorn) <= yearIn(parentBorn);
