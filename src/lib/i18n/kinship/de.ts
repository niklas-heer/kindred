// German kinship words: nouns with their grammatical gender, the possessive that agrees with each ("dein Vater", "deine
// Cousine"), and a relation named through someone in the genitive ("die Ehefrau deines Cousins"). Always "du".
import type { Kinship } from "../../graph";
import { BY_MARRIAGE, capitalise, cousinDegree, removedCount, type KinshipPart, type KinshipRules, type KinshipView } from "./shared.ts";

type Gender = "m" | "f" | "n";

/** German kinship nouns with their grammatical gender, from graph.kinship()'s English labels. Two when the sex is open. */
const DE_WORDS: Record<string, [string, Gender][]> = {
  father: [["Vater", "m"]],
  mother: [["Mutter", "f"]],
  parent: [["Elternteil", "n"]],
  son: [["Sohn", "m"]],
  daughter: [["Tochter", "f"]],
  child: [["Kind", "n"]],
  grandfather: [["Großvater", "m"]],
  grandmother: [["Großmutter", "f"]],
  grandparent: [["Großelternteil", "n"]],
  grandson: [["Enkel", "m"]],
  granddaughter: [["Enkelin", "f"]],
  grandchild: [["Enkelkind", "n"]],
  brother: [["Bruder", "m"]],
  sister: [["Schwester", "f"]],
  sibling: [["Bruder", "m"], ["Schwester", "f"]],
  uncle: [["Onkel", "m"]],
  aunt: [["Tante", "f"]],
  pibling: [["Onkel", "m"], ["Tante", "f"]],
  nephew: [["Neffe", "m"]],
  niece: [["Nichte", "f"]],
  nibling: [["Neffe", "m"], ["Nichte", "f"]],
  husband: [["Ehemann", "m"]],
  wife: [["Ehefrau", "f"]],
  partner: [["Partner", "m"], ["Partnerin", "f"]],
  "father-in-law": [["Schwiegervater", "m"]],
  "mother-in-law": [["Schwiegermutter", "f"]],
  "parent-in-law": [["Schwiegerelternteil", "n"]],
  "son-in-law": [["Schwiegersohn", "m"]],
  "daughter-in-law": [["Schwiegertochter", "f"]],
  "child-in-law": [["Schwiegerkind", "n"]],
  "brother-in-law": [["Schwager", "m"]],
  "sister-in-law": [["Schwägerin", "f"]],
  "sibling-in-law": [["Schwager", "m"], ["Schwägerin", "f"]],
  stepfather: [["Stiefvater", "m"]],
  stepmother: [["Stiefmutter", "f"]],
  stepparent: [["Stiefelternteil", "n"]],
  stepson: [["Stiefsohn", "m"]],
  stepdaughter: [["Stieftochter", "f"]],
  stepchild: [["Stiefkind", "n"]],
  stepbrother: [["Stiefbruder", "m"]],
  stepsister: [["Stiefschwester", "f"]],
  stepsibling: [["Stiefbruder", "m"], ["Stiefschwester", "f"]],
  "foster father": [["Pflegevater", "m"]],
  "foster mother": [["Pflegemutter", "f"]],
  "foster parent": [["Pflegeelternteil", "n"]],
  "foster son": [["Pflegesohn", "m"]],
  "foster daughter": [["Pflegetochter", "f"]],
  "foster child": [["Pflegekind", "n"]],
  "foster brother": [["Pflegebruder", "m"]],
  "foster sister": [["Pflegeschwester", "f"]],
  "foster sibling": [["Pflegebruder", "m"], ["Pflegeschwester", "f"]],
  "adoptive father": [["Adoptivvater", "m"]],
  "adoptive mother": [["Adoptivmutter", "f"]],
  "adoptive parent": [["Adoptivelternteil", "n"]],
  "adopted son": [["Adoptivsohn", "m"]],
  "adopted daughter": [["Adoptivtochter", "f"]],
  "adopted child": [["Adoptivkind", "n"]],
};


/** One German noun: the word, its grammatical gender and its genitive ("Neffe", m, "Neffen"). */
interface Noun {
  word: string;
  g: Gender;
  gen: string;
}
/**
 * A German relation: one noun, or two when the sex is open ("Onkel oder Tante"), then words that follow both
 * (" 2. Grades", " deiner Ehefrau"). `through` names someone by way of another person ("Ehefrau deines Cousins"),
 * which takes the article ("die Ehefrau …") where a plain word takes the possessive ("deine Großtante").
 */
interface DeKin {
  alts: Noun[];
  tail: string;
  through?: boolean;
}

const POSSESSIVE: Record<Gender, string> = { m: "dein", f: "deine", n: "dein" };
const ARTICLE: Record<Gender, string> = { m: "der", f: "die", n: "das" };

function genitive(word: string, g: Gender): string {
  if (g === "f") return word;
  if (g === "m" && word.endsWith("e")) return `${word}n`; // Neffe → des Neffen
  if (/[sßxz]$/.test(word) || word.endsWith("kind")) return `${word}es`; // des Enkelkindes
  return `${word}s`;
}
const noun = (word: string, g: Gender): Noun => ({ word, g, gen: genitive(word, g) });
const one = (alts: Noun[], tail = ""): DeKin => ({ alts, tail });
/** The same relation with each word rewritten ("Onkel" → "Großonkel"); the genitive follows. */
const reword = (kin: DeKin, f: (w: string) => string): DeKin => ({
  ...kin,
  alts: kin.alts.map((n) => ({ word: f(n.word), g: n.g, gen: f(n.gen) })),
});
/** Prefixes such as "Halb", "Urgroß": "Halb" + "Bruder" is "Halbbruder". */
const prefixed = (kin: DeKin, pre: string) => (pre ? reword(kin, (w) => capitalise(pre.toLowerCase() + w.toLowerCase())) : kin);
/** Groß-, Urgroß-, Ururgroß- for an uncle or aunt `levels` generations further out. */
const collateral = (levels: number) => (levels <= 0 ? "" : `${"ur".repeat(levels - 1)}groß`);

function renderDe(k: Kinship, view: KinshipView): DeKin {
  const words = (label: string) => DE_WORDS[label] && one(DE_WORDS[label].map(([w, g]) => noun(w, g)));
  /**
   * "deines Cousins oder deiner Cousine 2. Grades": a relation as the owner in a genitive. An owner that is itself named
   * through someone takes the article: "der Schwester deiner Ehefrau".
   */
  const of = (owner: DeKin) =>
    owner.alts.map((n) => `${view === "you" && !owner.through ? (n.g === "f" ? "deiner" : "deines") : n.g === "f" ? "der" : "des"} ${n.gen}`).join(" oder ") +
    owner.tail;
  /** One word for a man and one for a woman, both when the English word leaves the sex open. */
  const bySex = (sex: "m" | "f" | undefined, m: string, f: string) => one(sex === "m" ? [noun(m, "m")] : sex === "f" ? [noun(f, "f")] : [noun(m, "m"), noun(f, "f")]);
  const sexOf = (word: string): "m" | "f" | undefined => (/^(husband|brother)$/.test(word) ? "m" : /^(wife|sister)$/.test(word) ? "f" : undefined);
  const spouseWord = (sex: "m" | "f" | undefined) => words(sex === "m" ? "husband" : sex === "f" ? "wife" : "partner")!;
  const by = (spouses: DeKin, sex: (g: Gender) => string) => one(spouses.alts.map((n) => noun(sex(n.g), n.g)));

  const render = (label: string): DeKin => {
    const word = words(label);
    if (word) return word;
    if (label === BY_MARRIAGE) return bySex(k.sex, "angeheirateter Verwandter", "angeheiratete Verwandte");
    // The husband of your wife's sister, and the sister of your brother's wife: Schwippschwager, Schwippschwägerin.
    const schwipp =
      label.match(/^(?:husband|wife|partner)'s (?:half-)?(?:brother|sister|sibling)'s (husband|wife|partner)$/) ??
      label.match(/^(?:half-)?(?:brother|sister|sibling)'s (?:husband|wife|partner)'s (?:half-)?(brother|sister|sibling)$/);
    if (schwipp) return bySex(sexOf(schwipp[1]), "Schwippschwager", "Schwippschwägerin");
    // A tie through a marriage first, so "great-uncle's wife" is not read as a "great-" word.
    const spouse = label.match(/^(.+)'s (husband|wife|partner)$/);
    if (spouse) {
      const spouses = render(spouse[2]);
      const rel = spouse[1].replace(/half-/g, "");
      // The husband of an aunt is an uncle by marriage: "angeheirateter Großonkel".
      const pibling = rel.match(/^(?:(\d+)× )?(great-)?(?:uncle|aunt|pibling)$/);
      if (pibling) {
        const pre = collateral(pibling[2] ? Number(pibling[1] ?? 1) : 0);
        return by(spouses, (g) => (g === "f" ? `angeheiratete ${capitalise(pre + "tante")}` : `angeheirateter ${capitalise(pre + "onkel")}`));
      }
      // A step-grandparent comes as "step-grandmother"; "grandfather's wife" is one who never was one (graph.kinship).
      return { alts: spouses.alts, tail: ` ${of(render(spouse[1]))}`, through: true };
    }
    const theirs = label.match(/^(husband|wife|partner)'s (.+)$/);
    if (theirs) {
      const rel = render(theirs[2]);
      return { alts: rel.alts, tail: `${rel.tail} ${of(render(theirs[1]))}`, through: true };
    }
    // Anyone else named through another person, the last first: "Bruder deines Stiefvaters", "Stiefsohn deiner Schwester".
    const through = label.match(/^(.+)'s (.+)$/);
    if (through) {
      const rel = render(through[2]);
      return { alts: rel.alts, tail: `${rel.tail} ${of(render(through[1]))}`, through: true };
    }
    // A grandparent or grandchild by marriage: Stiefgroßvater, Stiefurenkel.
    if (label.startsWith("step-")) return prefixed(render(label.slice(5)), "Stief");
    const cousin = label.match(/^(half-)?(?:(\w+|\d+th) )?cousin(?: (once|twice|\d+ times) removed)?$/);
    if (cousin) {
      const degree = cousinDegree(cousin[2]);
      const removed = removedCount(cousin[3]);
      const sex = k.cousin?.sex;
      const up = k.cousin?.up;
      const pick = (m: string, f: string) => one(sex === "m" ? [noun(m, "m")] : sex === "f" ? [noun(f, "f")] : [noun(m, "m"), noun(f, "f")]);
      let kin: DeKin;
      if (removed && up) {
        // A parent's cousin is an uncle or aunt of the next degree, a cousin's child a nephew or niece of it;
        // each further generation adds Groß-, Urgroß-.
        kin = prefixed(up > 0 ? pick("Onkel", "Tante") : pick("Neffe", "Nichte"), collateral(removed - 1));
        kin.tail = ` ${degree + 1}. Grades`;
      } else {
        kin = pick("Cousin", "Cousine");
        kin.tail = `${degree > 1 ? ` ${degree}. Grades` : ""}${removed ? `, ${removed === 1 ? "eine Generation" : `${removed} Generationen`} versetzt` : ""}`;
      }
      return cousin[1] ? prefixed(kin, "Halb") : kin;
    }
    const great = label.match(/^(?:(\d+)× )?great-(half-)?(.+)$/);
    if (great) {
      const n = Number(great[1] ?? 1);
      const side = /^(uncle|aunt|pibling|nephew|niece|nibling)$/.test(great[3]);
      return prefixed(render(great[3]), `${great[2] ? "halb" : ""}${side ? collateral(n) : "ur".repeat(n)}`);
    }
    if (label.startsWith("half-")) return prefixed(render(label.slice(5)), "Halb");
    // Any other relative of your partner: "Großvater deiner Ehefrau".
    if (label.endsWith("-in-law")) {
      const rel = render(label.slice(0, -7));
      return { alts: rel.alts, tail: `${rel.tail} ${of(spouseWord(k.spouse))}`, through: true };
    }
    return one([noun(label, "m")]);
  };
  return render(k.label);
}


const words = (k: Kinship, view: KinshipView) => {
  const kin = renderDe(k, view);
  return kin.alts.map((n) => n.word).join(" oder ") + kin.tail;
};

function yourParts(k: Kinship): KinshipPart[] {
  const kin = renderDe(k, "you");
  const parts: KinshipPart[] = [];
  kin.alts.forEach((n, i) => {
    const lead = (kin.through ? ARTICLE : POSSESSIVE)[n.g];
    parts.push({ text: `${i ? " oder " : ""}${i ? lead : capitalise(lead)} ` }, { text: n.word, kin: true });
  });
  if (kin.tail) parts.push({ text: kin.tail, kin: true });
  return parts;
}

const de: KinshipRules = {
  label: (k, view) => (k.label === "you" ? "du" : words(k, view)),
  your(list) {
    const phrase = (x: Kinship) => yourParts(x).map((p) => p.text).join("");
    return [...new Set(list.map((x) => (x.label === "you" ? "du" : phrase(x).charAt(0).toLowerCase() + phrase(x).slice(1))))].join(" & ");
  },
  yourParts,
};
export default de;
