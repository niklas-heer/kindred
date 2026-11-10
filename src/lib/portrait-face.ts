// Which face a person shows: their photo, their painted portrait, or the drawing. Pure, and small, because the
// Portrait component (in every browser) and the graph (on the server) both use it. The painted portrait is shown
// only where its age and era fit the age being shown: a child view never shows an adult's painting.
import { eraOf, yearOf } from './portrait-look.ts';

/** The age a photo is taken to show when its date, or the person's birth year, is unknown: an adult. */
export const ADULT_DEFAULT_AGE = 35;
/** A painted portrait is shown only within this many years of the age in its photo. */
export const AGE_TOLERANCE = 8;

/** The year of a partial date ("1985", "1985-06", "1985-06-14"), or undefined. */
export const yearOfDate = (s?: string | null): number | undefined => yearOf(s ?? undefined);

/**
 * The age the person was in their photo: the photo's year less their birth year, when both are known and it is not
 * before the birth. Null when either is unknown (an adult is then assumed, see portraitFits).
 */
export function photoAge(born: string | null | undefined, photoYear: number | null | undefined): number | null {
  const b = yearOfDate(born);
  if (b === undefined || photoYear === null || photoYear === undefined) return null;
  const age = photoYear - b;
  return age >= 0 ? age : null;
}

/**
 * Whether a painted portrait is shown at the age being shown. Only when that age is within AGE_TOLERANCE of the age in the
 * photo (an adult, ADULT_DEFAULT_AGE, when the photo's date is unknown). When the photo's age and the person's birth year
 * are both known, the era of the age shown must also be the era of the photo, so a portrait made in one era is not shown
 * in another. Anything else falls back to the drawing.
 */
export function portraitFits(p: { born?: string | null; shown: number | undefined; photoAge: number | null }): boolean {
  if (p.shown === undefined) return false;
  const sourceAge = p.photoAge ?? ADULT_DEFAULT_AGE;
  if (Math.abs(p.shown - sourceAge) > AGE_TOLERANCE) return false;
  const born = yearOfDate(p.born);
  if (p.photoAge !== null && born !== undefined) return eraOf(born + p.shown) === eraOf(born + p.photoAge);
  return true;
}

/** What a person's face shows: their photo, the painted portrait, or the drawing. */
export type Face = 'photo' | 'portrait' | 'drawing';

/**
 * The face a person shows. The person's choice (`shownAs`) wins, but a painted portrait is shown only where it fits the
 * age (portraitFits); a choice that cannot be shown is the drawing, never a photo the person did not choose.
 */
export function chooseFace(p: { shownAs: 'photo' | 'avatar' | 'portrait'; hasPhoto: boolean; hasPortrait: boolean; fits: boolean }): Face {
  if (p.shownAs === 'avatar') return 'drawing';
  if (p.shownAs === 'photo') return p.hasPhoto ? 'photo' : 'drawing';
  return p.hasPortrait && p.fits ? 'portrait' : 'drawing';
}
