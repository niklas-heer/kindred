// The stand-in for a language whose kinship words nobody has written yet: graph.kinship()'s English word, and no
// possessive, since "your" agrees with the word in most languages and a wrong form reads worse than none. A language that
// still uses it is not complete (check.ts), so no reader is offered it; it keeps pages working while a lane translates.
import type { Kinship } from "../../graph";
import { capitalise, type KinshipRules } from "./shared.ts";

const neutral: KinshipRules = {
  stub: true,
  label: (k: Kinship) => k.label,
  your: (list) => [...new Set(list.map((k) => k.label))].join(" & "),
  yourParts: (k) => [{ text: capitalise(k.label), kin: true }],
};
export default neutral;
