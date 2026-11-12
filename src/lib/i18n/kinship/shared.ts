// What every language's kinship rules share: the shape of a module, and the parts of graph.kinship()'s English labels.
import type { Kinship } from "../../graph";

/** graph.ts BY_MARRIAGE: a tie through marriages further than a specific word reaches. */
export const BY_MARRIAGE = "relative by marriage";

/**
 * Who a relation is seen from. "you": the reader, so German says "Ehefrau deines Cousins". "them": a person named
 * beside it ("{kin} des Oberhaupts", "{a}: {rel} von {b}"), so German says "Ehefrau des Cousins".
 */
export type KinshipView = "you" | "them";

/** A piece of "your …" for a screen that sets the relation words in bold: "Deine " then "Großmutter" (kin). */
export interface KinshipPart {
  text: string;
  kin?: boolean;
}

/**
 * One language's kinship words (docs/translating.md, "Kinship"). graph.kinship() names every relation in English; a module
 * turns that label into its language. `cases.ts` is the table every module answers, and `kinship.test.ts` checks it.
 */
export interface KinshipRules {
  /** Set only on the neutral fallback (neutral.ts): a language whose module is a stub is not complete. */
  stub?: true;
  /** The relation in this language: "Großtante", "oupagrootjie"; "you" is the reader ("du", "jy"). */
  label(k: Kinship, view: KinshipView): string;
  /** The relation with the reader's possessive, lower case: "your father", "deine Großmutter"; several joined with " & ". */
  your(list: readonly Kinship[]): string;
  /** your() for one relation in parts, the relation words marked, starting with a capital. Not called for "you". */
  yourParts(k: Kinship): KinshipPart[];
}

export const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const EN_ORDINALS = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
/** "second" in "second cousin": 2. */
export const cousinDegree = (word: string | undefined) =>
  !word ? 1 : EN_ORDINALS.indexOf(word) > 0 ? EN_ORDINALS.indexOf(word) : parseInt(word, 10);
/** "twice" in "cousin twice removed": 2. */
export const removedCount = (word: string | undefined) =>
  !word ? 0 : word === "once" ? 1 : word === "twice" ? 2 : parseInt(word, 10);

/**
 * your() for a language that puts one possessive before the words and needs no agreement ("your", "jou"): the relation
 * words joined with " & ", the possessive once in front unless every relation is the reader.
 */
export function possessive(word: string, label: (k: Kinship) => string) {
  return {
    your(list: readonly Kinship[]): string {
      const words = [...new Set(list.map(label))].join(" & ");
      return list.every((x) => x.label === "you") ? words : `${word} ${words}`;
    },
    yourParts(k: Kinship): KinshipPart[] {
      return [{ text: `${capitalise(word)} ` }, { text: label(k), kin: true }];
    },
  };
}
