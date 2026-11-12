// Dutch kinship words: one possessive for everything ("je opa", "je tante"), and a relation named through someone with
// "van" ("de vrouw van je neef"). Always "je/jij".
import type { Kinship } from "../../graph";
import { BY_MARRIAGE, cousinDegree, removedCount, type KinshipPart, type KinshipRules, type KinshipView } from "./shared.ts";

/** Dutch kinship words from graph.kinship()'s English labels. Two when the sex is open ("oom of tante"). */
const NL_WORDS: Record<string, string[]> = {
  father: ["vader"],
  mother: ["moeder"],
  parent: ["ouder"],
  son: ["zoon"],
  daughter: ["dochter"],
  child: ["kind"],
  grandfather: ["opa"],
  grandmother: ["oma"],
  grandparent: ["grootouder"],
  grandson: ["kleinzoon"],
  granddaughter: ["kleindochter"],
  grandchild: ["kleinkind"],
  brother: ["broer"],
  sister: ["zus"],
  sibling: ["broer", "zus"],
  uncle: ["oom"],
  aunt: ["tante"],
  pibling: ["oom", "tante"],
  nephew: ["neef"],
  niece: ["nicht"],
  nibling: ["neef", "nicht"],
  husband: ["man"],
  wife: ["vrouw"],
  partner: ["partner"],
  "father-in-law": ["schoonvader"],
  "mother-in-law": ["schoonmoeder"],
  "parent-in-law": ["schoonouder"],
  "son-in-law": ["schoonzoon"],
  "daughter-in-law": ["schoondochter"],
  "child-in-law": ["schoonkind"],
  "brother-in-law": ["zwager"],
  "sister-in-law": ["schoonzus"],
  "sibling-in-law": ["zwager", "schoonzus"],
  stepfather: ["stiefvader"],
  stepmother: ["stiefmoeder"],
  stepparent: ["stiefouder"],
  stepson: ["stiefzoon"],
  stepdaughter: ["stiefdochter"],
  stepchild: ["stiefkind"],
  stepbrother: ["stiefbroer"],
  stepsister: ["stiefzus"],
  stepsibling: ["stiefbroer", "stiefzus"],
  "foster father": ["pleegvader"],
  "foster mother": ["pleegmoeder"],
  "foster parent": ["pleegouder"],
  "foster son": ["pleegzoon"],
  "foster daughter": ["pleegdochter"],
  "foster child": ["pleegkind"],
  "foster brother": ["pleegbroer"],
  "foster sister": ["pleegzus"],
  "foster sibling": ["pleegbroer", "pleegzus"],
  "adoptive father": ["adoptievader"],
  "adoptive mother": ["adoptiemoeder"],
  "adoptive parent": ["adoptie-ouder"],
  "adopted son": ["adoptiezoon"],
  "adopted daughter": ["adoptiedochter"],
  "adopted child": ["adoptiekind"],
};

/**
 * A Dutch relation: one word, or two when the sex is open ("oom of tante"), then words that follow both (" in de tweede
 * graad", " van je vrouw"). `through` names someone by way of another person ("de vrouw van je neef"), which takes the
 * article where a plain word takes "je".
 */
interface NlKin {
  alts: string[];
  tail: string;
  through?: boolean;
}

const GRADES = ["", "eerste", "tweede", "derde", "vierde", "vijfde", "zesde", "zevende", "achtste", "negende", "tiende"];
const grade = (n: number) => GRADES[n] ?? `${n}e`;

const one = (alts: string[], tail = ""): NlKin => ({ alts, tail });
const reword = (kin: NlKin, f: (w: string) => string): NlKin => ({ ...kin, alts: kin.alts.map(f) });
const prefixed = (kin: NlKin, pre: string) => (pre ? reword(kin, (w) => pre + w) : kin);

/** A great-uncle or great-nephew `n` generations further out: oudoom, achterneef; past two, "3× oudoom". */
const further = (n: number, word: string, one: string) => (n <= 0 ? word : n === 1 ? one + word : `${n}× ${one}${word}`);
/** Generations up: overgrootvader, betovergrootvader, oudgrootvader; past three, "4× overgrootvader". */
const upWord = (n: number, base: string) => (n === 1 ? `overgroot${base}` : n === 2 ? `betovergroot${base}` : n === 3 ? `oudgroot${base}` : `${n}× overgroot${base}`);
/** Generations down: achterkleinkind, achterachterkleinkind; past two, "3× achterkleinkind". */
const downWord = (n: number, base: string) => (n === 1 ? `achter${base}` : n === 2 ? `achterachter${base}` : `${n}× achter${base}`);

function renderNl(k: Kinship, view: KinshipView): NlKin {
  const words = (label: string) => (NL_WORDS[label] ? one(NL_WORDS[label]) : undefined);
  /** "van je neef of nicht": a relation as the owner. One that is itself named through someone takes the article: "van de zus van je vrouw". */
  const of = (owner: NlKin) => ` van ${view === "you" && !owner.through ? "je" : "de"} ${owner.alts.join(" of ")}${owner.tail}`;
  const bySex = (sex: "m" | "f" | undefined, m: string, f: string) => one(sex === "m" ? [m] : sex === "f" ? [f] : [m, f]);
  const sexOf = (word: string): "m" | "f" | undefined => (/^(husband|brother)$/.test(word) ? "m" : /^(wife|sister)$/.test(word) ? "f" : undefined);
  const spouseWord = (sex: "m" | "f" | undefined) => words(sex === "m" ? "husband" : sex === "f" ? "wife" : "partner")!;

  const render = (label: string): NlKin => {
    const word = words(label);
    if (word) return word;
    if (label === BY_MARRIAGE) return one(["aangetrouwde verwant"]);
    // The husband of your wife's sister, and the sister of your brother's wife: zwager, schoonzus.
    const schwipp =
      label.match(/^(?:husband|wife|partner)'s (?:half-)?(?:brother|sister|sibling)'s (husband|wife|partner)$/) ??
      label.match(/^(?:half-)?(?:brother|sister|sibling)'s (?:husband|wife|partner)'s (?:half-)?(brother|sister|sibling)$/);
    if (schwipp) return bySex(sexOf(schwipp[1]), "zwager", "schoonzus");
    // A tie through a marriage first, so "great-uncle's wife" is not read as a "great-" word.
    const spouse = label.match(/^(.+)'s (husband|wife|partner)$/);
    if (spouse) {
      const rel = spouse[1].replace(/half-/g, "");
      // The husband of an aunt is an uncle by marriage: "aangetrouwde oom".
      const pibling = rel.match(/^(?:(\d+)× )?(great-)?(?:uncle|aunt|pibling)$/);
      if (pibling) {
        const n = pibling[2] ? Number(pibling[1] ?? 1) : 0;
        const sex = sexOf(spouse[2]);
        const m = further(n, "oom", "oud");
        const f = further(n, "tante", "oud");
        return one(sex === "m" ? [`aangetrouwde ${m}`] : sex === "f" ? [`aangetrouwde ${f}`] : [`aangetrouwde ${m} of ${f}`]);
      }
      return { alts: render(spouse[2]).alts, tail: of(render(spouse[1])), through: true };
    }
    const theirs = label.match(/^(husband|wife|partner)'s (.+)$/);
    if (theirs) {
      const rel = render(theirs[2]);
      return { alts: rel.alts, tail: `${rel.tail}${of(render(theirs[1]))}`, through: true };
    }
    // Anyone else named through another person, the last first: "broer van je stiefvader", "stiefzoon van je zus".
    const through = label.match(/^(.+)'s (.+)$/);
    if (through) {
      const rel = render(through[2]);
      return { alts: rel.alts, tail: `${rel.tail}${of(render(through[1]))}`, through: true };
    }
    // A grandparent or grandchild by marriage: stiefopa, stiefkleinkind.
    if (label.startsWith("step-")) return prefixed(render(label.slice(5)), "stief");
    const cousin = label.match(/^(half-)?(?:(\w+|\d+th) )?cousin(?: (once|twice|\d+ times) removed)?$/);
    if (cousin) {
      const degree = cousinDegree(cousin[2]);
      const removed = removedCount(cousin[3]);
      const sex = k.cousin?.sex;
      const up = k.cousin?.up;
      const pick = (m: string, f: string) => (sex === "m" ? [m] : sex === "f" ? [f] : [m, f]);
      let kin: NlKin;
      if (removed && up) {
        // A parent's cousin is an uncle or aunt of the next degree, a cousin's child a nephew or niece of it;
        // each further generation adds oud-, achter-.
        const n = removed - 1;
        kin = one(up > 0 ? [further(n, "oom", "oud"), further(n, "tante", "oud")] : [further(n, "neef", "achter"), further(n, "nicht", "achter")]);
        if (sex === "m") kin.alts = [kin.alts[0]];
        else if (sex === "f") kin.alts = [kin.alts[1]];
        kin.tail = ` in de ${grade(degree + 1)} graad`;
      } else {
        kin = one(pick("neef", "nicht"));
        kin.tail = `${degree > 1 ? ` in de ${grade(degree)} graad` : ""}${removed ? `, ${removed === 1 ? "een generatie" : `${removed} generaties`} verschil` : ""}`;
      }
      return cousin[1] ? prefixed(kin, "half") : kin;
    }
    const great = label.match(/^(?:(\d+)× )?great-(half-)?(.+)$/);
    if (great) {
      const n = Number(great[1] ?? 1);
      const half = great[2] ? "half" : "";
      const base = great[3];
      const sex = <T,>(m: T, f: T, x: T): T => (/father|uncle|nephew|son$/.test(base) ? m : /mother|aunt|niece|daughter/.test(base) ? f : x);
      if (/^grand(father|mother|parent)$/.test(base)) {
        return one([half + upWord(n, sex("vader", "moeder", "ouder"))]);
      }
      if (/^grand(son|daughter|child)$/.test(base)) {
        return one([half + downWord(n, sex("kleinzoon", "kleindochter", "kleinkind"))]);
      }
      if (/^(uncle|aunt|pibling)$/.test(base)) {
        return one(sex(["oom"], ["tante"], ["oom", "tante"]).map((w) => half + further(n, w, "oud")));
      }
      if (/^(nephew|niece|nibling)$/.test(base)) {
        return one(sex(["neef"], ["nicht"], ["neef", "nicht"]).map((w) => half + further(n, w, "achter")));
      }
      return prefixed(render(base), `${half}over`);
    }
    if (label.startsWith("half-")) return prefixed(render(label.slice(5)), "half");
    // Any other relative of your partner: "opa van je vrouw".
    if (label.endsWith("-in-law")) {
      const rel = render(label.slice(0, -7));
      return { alts: rel.alts, tail: `${rel.tail}${of(spouseWord(k.spouse))}`, through: true };
    }
    return one([label]);
  };
  return render(k.label);
}

const words = (k: Kinship, view: KinshipView) => {
  const kin = renderNl(k, view);
  return kin.alts.join(" of ") + kin.tail;
};

function yourParts(k: Kinship): KinshipPart[] {
  const kin = renderNl(k, "you");
  const parts: KinshipPart[] = [{ text: `${kin.through ? "De" : "Je"} ` }, { text: kin.alts.join(" of "), kin: true }];
  if (kin.tail) parts.push({ text: kin.tail, kin: true });
  return parts;
}

const nl: KinshipRules = {
  label: (k, view) => (k.label === "you" ? "jij" : words(k, view)),
  your(list) {
    const phrase = (x: Kinship) => yourParts(x).map((p) => p.text).join("");
    return [...new Set(list.map((x) => (x.label === "you" ? "jij" : phrase(x).charAt(0).toLowerCase() + phrase(x).slice(1))))].join(" & ");
  },
  yourParts(k) {
    return yourParts(k);
  },
};
export default nl;
