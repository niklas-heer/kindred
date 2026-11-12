// French kinship words: nouns with their gender, the possessive that agrees with each ("ton père", "ta cousine"), and a
// relation named through someone with "de" ("la femme de ton cousin"). Always "tu".
import type { Kinship } from "../../graph";
import { BY_MARRIAGE, capitalise, cousinDegree, removedCount, type KinshipPart, type KinshipRules, type KinshipView } from "./shared.ts";

type Gender = "m" | "f";

/** French kinship nouns with their gender, from graph.kinship()'s English labels. Two when the sex is open. */
const FR_WORDS: Record<string, [string, Gender][]> = {
  father: [["père", "m"]],
  mother: [["mère", "f"]],
  parent: [["parent", "m"]],
  son: [["fils", "m"]],
  daughter: [["fille", "f"]],
  child: [["enfant", "m"]],
  grandfather: [["grand-père", "m"]],
  grandmother: [["grand-mère", "f"]],
  grandparent: [["grand-parent", "m"]],
  grandson: [["petit-fils", "m"]],
  granddaughter: [["petite-fille", "f"]],
  grandchild: [["petit-enfant", "m"]],
  brother: [["frère", "m"]],
  sister: [["sœur", "f"]],
  sibling: [["frère", "m"], ["sœur", "f"]],
  uncle: [["oncle", "m"]],
  aunt: [["tante", "f"]],
  pibling: [["oncle", "m"], ["tante", "f"]],
  nephew: [["neveu", "m"]],
  niece: [["nièce", "f"]],
  nibling: [["neveu", "m"], ["nièce", "f"]],
  husband: [["mari", "m"]],
  wife: [["femme", "f"]],
  partner: [["compagnon", "m"], ["compagne", "f"]],
  "father-in-law": [["beau-père", "m"]],
  "mother-in-law": [["belle-mère", "f"]],
  "parent-in-law": [["beau-parent", "m"]],
  "son-in-law": [["gendre", "m"]],
  "daughter-in-law": [["belle-fille", "f"]],
  "child-in-law": [["gendre", "m"], ["belle-fille", "f"]],
  "brother-in-law": [["beau-frère", "m"]],
  "sister-in-law": [["belle-sœur", "f"]],
  "sibling-in-law": [["beau-frère", "m"], ["belle-sœur", "f"]],
  stepfather: [["beau-père", "m"]],
  stepmother: [["belle-mère", "f"]],
  stepparent: [["beau-parent", "m"]],
  stepson: [["beau-fils", "m"]],
  stepdaughter: [["belle-fille", "f"]],
  stepchild: [["beau-fils", "m"], ["belle-fille", "f"]],
  stepbrother: [["frère par alliance", "m"]],
  stepsister: [["sœur par alliance", "f"]],
  stepsibling: [["frère par alliance", "m"], ["sœur par alliance", "f"]],
  "foster father": [["père d’accueil", "m"]],
  "foster mother": [["mère d’accueil", "f"]],
  "foster parent": [["parent d’accueil", "m"]],
  "foster son": [["fils d’accueil", "m"]],
  "foster daughter": [["fille d’accueil", "f"]],
  "foster child": [["enfant d’accueil", "m"]],
  "foster brother": [["frère d’accueil", "m"]],
  "foster sister": [["sœur d’accueil", "f"]],
  "foster sibling": [["frère d’accueil", "m"], ["sœur d’accueil", "f"]],
  "adoptive father": [["père adoptif", "m"]],
  "adoptive mother": [["mère adoptive", "f"]],
  "adoptive parent": [["parent adoptif", "m"]],
  "adopted son": [["fils adoptif", "m"]],
  "adopted daughter": [["fille adoptive", "f"]],
  "adopted child": [["enfant adoptif", "m"]],
};

/** One French noun: the word and its gender. */
interface Noun {
  word: string;
  g: Gender;
}
/**
 * A French relation: one noun, or two when the sex is open ("oncle ou tante"), then words that follow both (" de ta
 * femme"). `through` names someone by way of another person ("femme de ton cousin"), which takes the article ("la femme
 * …") where a plain word takes the possessive ("ta grand-tante").
 */
interface FrKin {
  alts: Noun[];
  tail: string;
  through?: boolean;
}

const vowel = (word: string) => /^[aeiouyhàâäéèêëîïôöùûüœ]/i.test(word);
/** "ton", "ta", "ton" before a vowel ("ton arrière-grand-mère"). */
const possessive = (n: Noun) => (n.g === "f" && !vowel(n.word) ? "ta" : "ton");
/** The definite article, elided before a vowel: "le", "la", "l’". */
const article = (n: Noun) => (vowel(n.word) ? "l’" : n.g === "f" ? "la" : "le");
/** "du", "de la", "de l’": the article after "de". */
const ofArticle = (n: Noun) => (vowel(n.word) ? "de l’" : n.g === "f" ? "de la" : "du");
/** An article or possessive and the noun: "l’oncle", "la tante", "ton oncle". Elided articles take no space. */
const lead = (l: string) => (l.endsWith("’") ? l : `${l} `);

const noun = (word: string, g: Gender): Noun => ({ word, g });
const one = (alts: Noun[], tail = ""): FrKin => ({ alts, tail });
/** The same relation with each word rewritten ("oncle" → "grand-oncle"). */
const reword = (kin: FrKin, f: (w: string) => string): FrKin => ({ ...kin, alts: kin.alts.map((n) => ({ word: f(n.word), g: n.g })) });
const prefixed = (kin: FrKin, pre: string) => (pre ? reword(kin, (w) => pre + w) : kin);
/** "arrière-" repeated, as many as French writes out. */
const arriere = (n: number) => (n <= 0 ? "" : n <= 3 ? "arrière-".repeat(n) : `${n}× arrière-`);
/** Prefix of an uncle or aunt `levels` generations further out: grand-, arrière-grand-. */
const collateralUp = (levels: number) => (levels <= 0 ? "" : `${arriere(levels - 1)}grand-`);
/** Prefix of a nephew or niece `levels` generations further down: petit-, arrière-petit-. */
const collateralDown = (levels: number) => (levels <= 0 ? "" : `${arriere(levels - 1)}petit-`);

function renderFr(k: Kinship, view: KinshipView): FrKin {
  const words = (label: string) => FR_WORDS[label] && one(FR_WORDS[label].map(([w, g]) => noun(w, g)));
  /** "de ton cousin ou de ta cousine": the owner of a relation. Someone named through another takes the article. */
  const of = (owner: FrKin) =>
    owner.alts
      .map((n) => (view === "you" && !owner.through ? `de ${possessive(n)} ${n.word}` : `${ofArticle(n)}${ofArticle(n).endsWith("’") ? "" : " "}${n.word}`))
      .join(" ou ") + owner.tail;
  /** One word for a man and one for a woman, both when the English word leaves the sex open. */
  const bySex = (sex: "m" | "f" | undefined, m: string, f: string) => one(sex === "m" ? [noun(m, "m")] : sex === "f" ? [noun(f, "f")] : [noun(m, "m"), noun(f, "f")]);
  const spouseWord = (sex: "m" | "f" | undefined) => words(sex === "m" ? "husband" : sex === "f" ? "wife" : "partner")!;

  const render = (label: string): FrKin => {
    const word = words(label);
    if (word) return word;
    if (label === BY_MARRIAGE) return one(k.sex === "f" ? [noun("parente par alliance", "f")] : [noun("parent par alliance", "m")]);
    // A tie through a marriage first, so "great-uncle's wife" is not read as a "great-" word.
    const spouse = label.match(/^(.+)'s (husband|wife|partner)$/);
    if (spouse) {
      const spouses = render(spouse[2]);
      const rel = spouse[1].replace(/half-/g, "");
      // The husband of an aunt is an uncle by marriage: "oncle par alliance".
      const pibling = rel.match(/^(?:(\d+)× )?(great-)?(?:uncle|aunt|pibling)$/);
      if (pibling) {
        const pre = collateralUp(pibling[2] ? Number(pibling[1] ?? 1) : 0);
        return one(spouses.alts.map((n) => (n.g === "f" ? noun(`${pre}tante par alliance`, "f") : noun(`${pre}oncle par alliance`, "m"))));
      }
      return { alts: spouses.alts, tail: ` ${of(render(spouse[1]))}`, through: true };
    }
    const theirs = label.match(/^(husband|wife|partner)'s (.+)$/);
    if (theirs) {
      const rel = render(theirs[2]);
      return { alts: rel.alts, tail: `${rel.tail} ${of(render(theirs[1]))}`, through: true };
    }
    // Anyone else named through another person, the last first: "frère de ton beau-père", "beau-fils de ta sœur".
    const through = label.match(/^(.+)'s (.+)$/);
    if (through) {
      const rel = render(through[2]);
      return { alts: rel.alts, tail: `${rel.tail} ${of(render(through[1]))}`, through: true };
    }
    // A grandparent or grandchild by marriage: "grand-père par alliance".
    if (label.startsWith("step-")) return reword(render(label.slice(5)), (w) => `${w} par alliance`);
    const cousin = label.match(/^(half-)?(?:(\w+|\d+th) )?cousin(?: (once|twice|\d+ times) removed)?$/);
    if (cousin) {
      const degree = cousinDegree(cousin[2]);
      const removed = removedCount(cousin[3]);
      const sex = k.cousin?.sex;
      const up = k.cousin?.up;
      const pick = (m: string, f: string) => one(sex === "m" ? [noun(m, "m")] : sex === "f" ? [noun(f, "f")] : [noun(m, "m"), noun(f, "f")]);
      let kin: FrKin;
      if (removed && up) {
        // A parent's cousin is an uncle or aunt "à la mode de Bretagne", a cousin's child a nephew or niece of it; each
        // further generation adds grand-, arrière-grand-.
        const rank = degree === 1 ? " à la mode de Bretagne" : ` au ${degree + 1}e degré`;
        kin = prefixed(up > 0 ? pick("oncle", "tante") : pick("neveu", "nièce"), up > 0 ? collateralUp(removed - 1) : collateralDown(removed - 1));
        kin = reword(kin, (w) => w + rank);
      } else {
        kin = pick("cousin", "cousine");
        if (degree === 2) kin = one(kin.alts.map((n) => noun(`${n.word} ${n.g === "f" ? "issue" : "issu"} de germain`, n.g)));
        else if (degree > 2) kin = reword(kin, (w) => `${w} au ${degree}e degré`);
        if (removed) kin = reword(kin, (w) => `${w}, ${removed === 1 ? "une génération" : `${removed} générations`} d’écart`);
      }
      return cousin[1] ? prefixed(kin, "demi-") : kin;
    }
    const great = label.match(/^(?:(\d+)× )?great-(half-)?(.+)$/);
    if (great) {
      const n = Number(great[1] ?? 1);
      const up = /^(uncle|aunt|pibling)$/.test(great[3]);
      const down = /^(nephew|niece|nibling)$/.test(great[3]);
      return prefixed(render(great[3]), `${great[2] ? "demi-" : ""}${up ? collateralUp(n) : down ? collateralDown(n) : arriere(n)}`);
    }
    if (label.startsWith("half-")) return prefixed(render(label.slice(5)), "demi-");
    // Any other relative of your partner: "grand-père de ta femme".
    if (label.endsWith("-in-law")) {
      const rel = render(label.slice(0, -7));
      return { alts: rel.alts, tail: `${rel.tail} ${of(spouseWord(k.spouse))}`, through: true };
    }
    return one([noun(label, "m")]);
  };
  return render(k.label);
}

const words = (k: Kinship, view: KinshipView) => {
  const kin = renderFr(k, view);
  return kin.alts.map((n) => n.word).join(" ou ") + kin.tail;
};

function yourParts(k: Kinship): KinshipPart[] {
  const kin = renderFr(k, "you");
  const parts: KinshipPart[] = [];
  kin.alts.forEach((n, i) => {
    const l = kin.through ? article(n) : possessive(n);
    parts.push({ text: `${i ? " ou " : ""}${lead(i ? l : capitalise(l))}` }, { text: n.word, kin: true });
  });
  if (kin.tail) parts.push({ text: kin.tail, kin: true });
  return parts;
}

const fr: KinshipRules = {
  label: (k, view) => (k.label === "you" ? "toi" : words(k, view)),
  your(list) {
    const phrase = (x: Kinship) => yourParts(x).map((p) => p.text).join("");
    return [...new Set(list.map((x) => (x.label === "you" ? "toi" : phrase(x).charAt(0).toLowerCase() + phrase(x).slice(1))))].join(" & ");
  },
  yourParts,
};
export default fr;
