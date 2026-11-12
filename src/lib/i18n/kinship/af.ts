// Afrikaans kinship words: one word or a phrase with "se" ("vrou se suster"), "jou" before them. Always "jy".
import type { Kinship } from "../../graph";
import { BY_MARRIAGE, cousinDegree, possessive, removedCount, type KinshipRules } from "./shared.ts";

/**
 * Afrikaans kinship words (informal "jy" family, matching German "du"). Where a relation has no single
 * everyday word, the pair is written with a slash, as German does. Native review is still wanted for the
 * great-grandparent and removed-cousin forms.
 */
const AF_WORDS: Record<string, string> = {
  you: "jy",
  father: "pa",
  mother: "ma",
  parent: "ouer",
  son: "seun",
  daughter: "dogter",
  child: "kind",
  grandfather: "oupa",
  grandmother: "ouma",
  grandparent: "grootouer",
  grandson: "kleinseun",
  granddaughter: "kleindogter",
  grandchild: "kleinkind",
  brother: "broer",
  sister: "suster",
  sibling: "broer/suster",
  uncle: "oom",
  aunt: "tante",
  pibling: "oom/tante",
  nephew: "neef",
  niece: "niggie",
  nibling: "neef/niggie",
  husband: "man",
  wife: "vrou",
  partner: "lewensmaat",
  "father-in-law": "skoonpa",
  "mother-in-law": "skoonma",
  "parent-in-law": "skoonouer",
  "son-in-law": "skoonseun",
  "daughter-in-law": "skoondogter",
  "child-in-law": "skoonkind",
  "brother-in-law": "swaer",
  "sister-in-law": "skoonsuster",
  "sibling-in-law": "skoonbroer/skoonsuster",
  stepfather: "stiefpa",
  stepmother: "stiefma",
  stepparent: "stiefouer",
  stepson: "stiefseun",
  stepdaughter: "stiefdogter",
  stepchild: "stiefkind",
  stepbrother: "stiefbroer",
  stepsister: "stiefsuster",
  stepsibling: "stiefbroer/stiefsuster",
  "foster father": "pleegpa",
  "foster mother": "pleegma",
  "foster parent": "pleegouer",
  "foster son": "pleegseun",
  "foster daughter": "pleegdogter",
  "foster child": "pleegkind",
  "foster brother": "pleegbroer",
  "foster sister": "pleegsuster",
  "foster sibling": "pleegbroer/pleegsuster",
  "adoptive father": "aanneempa",
  "adoptive mother": "aanneemma",
  "adoptive parent": "aanneemouer",
  "adopted son": "aangenome seun",
  "adopted daughter": "aangenome dogter",
  "adopted child": "aangenome kind",
};

const AF_ORDINALS = ["nulde", "eerste", "tweede", "derde", "vierde", "vyfde", "sesde", "sewende", "agste", "negende", "tiende"];


function renderAf(k: Kinship): string {
  const pick = (m: string, f: string) => (k.cousin?.sex === "m" ? m : k.cousin?.sex === "f" ? f : `${m}/${f}`);
  const render = (label: string): string => {
    if (AF_WORDS[label]) return AF_WORDS[label];
    if (label === BY_MARRIAGE) return "aangetroude familielid";
    // A tie through someone first, with the possessive "se": "grootoom se vrou", "vrou se suster se man", "stiefpa se broer".
    const through = label.match(/^(.+)'s (.+)$/);
    if (through) return `${render(through[1])} se ${render(through[2])}`;
    // A grandparent or grandchild by marriage: stiefoupa, stiefkleinseun.
    if (label.startsWith("step-")) return `stief${render(label.slice(5))}`;
    const cousin = label.match(/^(half-)?(?:(\w+|\d+th) )?cousin(?: (once|twice|\d+ times) removed)?$/);
    if (cousin) {
      const degree = cousinDegree(cousin[2]);
      const removed = removedCount(cousin[3]);
      const base = cousin[1] ? pick("halfneef", "halfniggie") : pick("neef", "niggie");
      const lead = degree > 1 ? `${AF_ORDINALS[degree] ?? `${degree}de`} ${base}` : base;
      return `${lead}${removed ? ` ${removed === 1 ? "een keer" : removed === 2 ? "twee keer" : `${removed} keer`} verwyder` : ""}`;
    }
    const great = label.match(/^(?:(\d+)× )?great-(half-)?(.+)$/);
    if (great) {
      // One generation: oupagrootjie, grootoom, agterkleinkind. Each further one repeats "oor-" upwards and
      // "agter-" downwards, so a great-great-grandfather is never the same word as a great-grandfather.
      const n = Number(great[1] ?? 1);
      const half = great[2] ? "half" : "";
      const sex = (m: string, f: string, x: string) => (great[3].match(/father|uncle|nephew|son$/) ? m : great[3].match(/mother|aunt|niece|daughter/) ? f : x);
      const up = (word: string) => `${"oor-".repeat(n - 1)}${half}${word}`;
      const down = (word: string) => `${"agter-".repeat(n - 1)}${half}${word}`;
      if (/^grand(father|mother|parent)$/.test(great[3])) return up(sex("oupagrootjie", "oumagrootjie", "oorgrootouer"));
      if (/^(uncle|aunt|pibling)$/.test(great[3])) return up(sex("grootoom", "groottante", "grootoom/groottante"));
      if (/^(nephew|niece|nibling)$/.test(great[3])) return down(sex("kleinneef", "kleinniggie", "kleinneef/kleinniggie"));
      if (/^grand(son|daughter|child)$/.test(great[3])) return down(sex("agterkleinseun", "agterkleindogter", "agterkleinkind"));
      return `agter${half}${render(great[3])}`;
    }
    if (label.startsWith("half-")) return `half${render(label.slice(5))}`;
    // Any other relative of your partner: "vrou se oupa".
    if (label.endsWith("-in-law")) return `${k.spouse === "m" ? "man" : k.spouse === "f" ? "vrou" : "lewensmaat"} se ${render(label.slice(0, -7))}`;
    return label;
  };
  return render(k.label);
}

const label = (k: Kinship) => (k.label === "you" ? "jy" : renderAf(k));
const af: KinshipRules = { label, ...possessive("jou", label) };
export default af;
