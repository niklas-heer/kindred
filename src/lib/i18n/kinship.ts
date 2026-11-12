/**
 * Kinship in the reader's language: graph.kinship() names every relation in English ("great-aunt", "wife's cousin"), and
 * each language's module in kinship/ turns that into its own words, with the possessive the language needs ("deine
 * Großmutter", "die Ehefrau deines Cousins", "jou oupagrootjie"). Never build "your {kin}" from a dictionary key.
 */
import type { Kinship } from "../graph";
import { KINSHIP } from "./kinship/index.ts";
import { capitalise, type KinshipPart, type KinshipView } from "./kinship/shared.ts";
import type { Locale } from "./types.ts";

export type { KinshipPart, KinshipRules, KinshipView } from "./kinship/shared.ts";

/** The English label of graph.kinship() in the reader's language: "Großtante", "Cousine 2. Grades", "oupagrootjie". */
export function kinshipLabel(k: Kinship | undefined | null, locale: Locale = "en", view: KinshipView = "you"): string {
  if (!k) return "";
  return KINSHIP[locale].label(k, view);
}

/**
 * "your father", "deine Großmutter", "dein Großonkel", "die Ehefrau deines Cousins", "jou oupagrootjie": the relation
 * with the reader's possessive, which in German agrees with each word. Several relations (a couple's anniversary)
 * are joined with " & ". `capital` starts a sentence: "Deine Großmutter".
 */
export function yourKinship(k: Kinship | readonly Kinship[], locale: Locale = "en", opts: { capital?: boolean } = {}): string {
  const list = Array.isArray(k) ? (k as readonly Kinship[]) : [k as Kinship];
  const text = KINSHIP[locale].your(list);
  return opts.capital ? capitalise(text) : text;
}

/**
 * yourKinship() in parts, the relation words marked, for a screen that sets them in bold: "Deine <b>Großmutter</b>",
 * "Dein <b>Onkel</b> oder deine <b>Tante</b>". Starts with a capital.
 */
export function yourKinshipParts(k: Kinship, locale: Locale = "en"): KinshipPart[] {
  if (k.label === "you") return [{ text: capitalise(kinshipLabel(k, locale)), kin: true }];
  return KINSHIP[locale].yourParts(k);
}

/** Whether a language's kinship rules are still the neutral stand-in, so the language is not complete. */
export const kinshipIsStub = (locale: Locale) => KINSHIP[locale].stub === true;
