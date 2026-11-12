// Italian kinship words: nouns with their gender, the possessive that agrees with each ("tuo padre", "tua cugina", without
// an article for a single relative, as Italian has it), and a relation named through someone with "di" ("la moglie di
// tuo cugino"). Always "tu".
import type { Kinship } from "../../graph";
import { BY_MARRIAGE, capitalise, cousinDegree, removedCount, type KinshipPart, type KinshipRules, type KinshipView } from "./shared.ts";

type Gender = "m" | "f";

/** Italian kinship nouns with their gender, from graph.kinship()'s English labels. Two when the sex is open. */
const IT_WORDS: Record<string, [string, Gender][]> = {
  father: [["padre", "m"]],
  mother: [["madre", "f"]],
  parent: [["genitore", "m"]],
  son: [["figlio", "m"]],
  daughter: [["figlia", "f"]],
  child: [["figlio", "m"], ["figlia", "f"]],
  grandfather: [["nonno", "m"]],
  grandmother: [["nonna", "f"]],
  grandparent: [["nonno", "m"], ["nonna", "f"]],
  grandson: [["nipote", "m"]],
  granddaughter: [["nipote", "f"]],
  grandchild: [["nipote", "m"]],
  brother: [["fratello", "m"]],
  sister: [["sorella", "f"]],
  sibling: [["fratello", "m"], ["sorella", "f"]],
  uncle: [["zio", "m"]],
  aunt: [["zia", "f"]],
  pibling: [["zio", "m"], ["zia", "f"]],
  nephew: [["nipote", "m"]],
  niece: [["nipote", "f"]],
  nibling: [["nipote", "m"]],
  husband: [["marito", "m"]],
  wife: [["moglie", "f"]],
  partner: [["compagno", "m"], ["compagna", "f"]],
  "father-in-law": [["suocero", "m"]],
  "mother-in-law": [["suocera", "f"]],
  "parent-in-law": [["suocero", "m"], ["suocera", "f"]],
  "son-in-law": [["genero", "m"]],
  "daughter-in-law": [["nuora", "f"]],
  "child-in-law": [["genero", "m"], ["nuora", "f"]],
  "brother-in-law": [["cognato", "m"]],
  "sister-in-law": [["cognata", "f"]],
  "sibling-in-law": [["cognato", "m"], ["cognata", "f"]],
  stepfather: [["patrigno", "m"]],
  stepmother: [["matrigna", "f"]],
  stepparent: [["patrigno", "m"], ["matrigna", "f"]],
  stepson: [["figliastro", "m"]],
  stepdaughter: [["figliastra", "f"]],
  stepchild: [["figliastro", "m"], ["figliastra", "f"]],
  stepbrother: [["fratello acquisito", "m"]],
  stepsister: [["sorella acquisita", "f"]],
  stepsibling: [["fratello acquisito", "m"], ["sorella acquisita", "f"]],
  "foster father": [["padre affidatario", "m"]],
  "foster mother": [["madre affidataria", "f"]],
  "foster parent": [["padre affidatario", "m"], ["madre affidataria", "f"]],
  "foster son": [["figlio in affido", "m"]],
  "foster daughter": [["figlia in affido", "f"]],
  "foster child": [["figlio in affido", "m"], ["figlia in affido", "f"]],
  "foster brother": [["fratello in affido", "m"]],
  "foster sister": [["sorella in affido", "f"]],
  "foster sibling": [["fratello in affido", "m"], ["sorella in affido", "f"]],
  "adoptive father": [["padre adottivo", "m"]],
  "adoptive mother": [["madre adottiva", "f"]],
  "adoptive parent": [["padre adottivo", "m"], ["madre adottiva", "f"]],
  "adopted son": [["figlio adottivo", "m"]],
  "adopted daughter": [["figlia adottiva", "f"]],
  "adopted child": [["figlio adottivo", "m"], ["figlia adottiva", "f"]],
};

/** One Italian noun: the word and its gender; `art` when the possessive keeps its article ("il tuo compagno"). */
interface Noun {
  word: string;
  g: Gender;
  art?: boolean;
}
/**
 * An Italian relation: one noun, or two when the sex is open ("zio o zia"), then words that follow both (" di tua
 * moglie"). `through` names someone by way of another person ("moglie di tuo cugino"), which takes the article ("la
 * moglie …") where a plain word takes the possessive ("tua prozia").
 */
interface ItKin {
  alts: Noun[];
  tail: string;
  through?: boolean;
}

const vowel = (word: string) => /^[aeiouàèéìòù]/i.test(word);
const hard = (word: string) => /^(z|s[^aeiou]|gn|ps|pn|x|y)/i.test(word);
/** "tuo", "tua"; "il tuo", "la tua" for the few nouns that keep the article. */
const possessive = (n: Noun) => `${n.art ? (n.g === "f" ? "la " : "il ") : ""}${n.g === "f" ? "tua" : "tuo"}`;
/** The definite article: "il", "lo", "l’", "la". */
const article = (n: Noun) => (vowel(n.word) ? "l’" : n.g === "f" ? "la" : hard(n.word) ? "lo" : "il");
/** "del", "dello", "dell’", "della": the article after "di". */
const ofArticle = (n: Noun) => (vowel(n.word) ? "dell’" : n.g === "f" ? "della" : hard(n.word) ? "dello" : "del");
const lead = (l: string) => (l.endsWith("’") ? l : `${l} `);

const noun = (word: string, g: Gender, art?: boolean): Noun => ({ word, g, ...(art && { art }) });
const one = (alts: Noun[], tail = ""): ItKin => ({ alts, tail });
/** The same relation with each word rewritten ("zio" → "prozio"). */
const reword = (kin: ItKin, f: (w: string, n: Noun) => string): ItKin => ({ ...kin, alts: kin.alts.map((n) => ({ ...n, word: f(n.word, n) })) });
/** Bis-, tris-, quadris-: a grandparent `n` generations further up; further out "5× bis…". */
const GREAT = ["", "bis", "tris", "quadris"];
const ancestor = (n: number, w: string) => (n < GREAT.length ? GREAT[n] + w : `${n}× bis${w}`);
/** Pro-: "prozio", "pronipote"; further out "2× prozio". */
const pro = (n: number, w: string) => (n <= 0 ? w : n === 1 ? `pro${w}` : `${n}× pro${w}`);
/** A cousin's degree in words, as Italians say it ("di secondo grado"); further out "di 11º grado". */
const ORD = ["", "primo", "secondo", "terzo", "quarto", "quinto", "sesto", "settimo", "ottavo", "nono", "decimo"];
const grado = (n: number) => `di ${ORD[n] ?? `${n}º`} grado`;

function renderIt(k: Kinship, view: KinshipView): ItKin {
  const words = (label: string) => IT_WORDS[label] && one(IT_WORDS[label].map(([w, g]) => noun(w, g, w === "compagno" || w === "compagna")));
  /** "di tuo cugino o di tua cugina": the owner of a relation. Someone named through another takes the article. */
  const of = (owner: ItKin) =>
    owner.alts
      .map((n) => (view === "you" && !owner.through ? (n.art ? `${ofArticle(n).replace(/dell’$/, "del")} ${possessive({ ...n, art: false })} ${n.word}` : `di ${possessive(n)} ${n.word}`) : `${lead(ofArticle(n))}${n.word}`))
      .join(" o ") + owner.tail;
  const spouseWord = (sex: "m" | "f" | undefined) => words(sex === "m" ? "husband" : sex === "f" ? "wife" : "partner")!;
  const agree = (w: string, n: Noun, m: string, f: string) => `${w} ${n.g === "f" ? f : m}`;

  const render = (label: string): ItKin => {
    const word = words(label);
    if (word) return word;
    if (label === BY_MARRIAGE) return one(k.sex === "f" ? [noun("parente acquisita", "f")] : [noun("parente acquisito", "m")]);
    // A tie through a marriage first, so "great-uncle's wife" is not read as a "great-" word.
    const spouse = label.match(/^(.+)'s (husband|wife|partner)$/);
    if (spouse) {
      const spouses = render(spouse[2]);
      const rel = spouse[1].replace(/half-/g, "");
      // The husband of an aunt is an uncle by marriage: "zio acquisito".
      const pibling = rel.match(/^(?:(\d+)× )?(great-)?(?:uncle|aunt|pibling)$/);
      if (pibling) {
        const n = pibling[2] ? Number(pibling[1] ?? 1) : 0;
        return one(spouses.alts.map((s) => (s.g === "f" ? noun(`${pro(n, "zia")} acquisita`, "f") : noun(`${pro(n, "zio")} acquisito`, "m"))));
      }
      return { alts: spouses.alts, tail: ` ${of(render(spouse[1]))}`, through: true };
    }
    const theirs = label.match(/^(husband|wife|partner)'s (.+)$/);
    if (theirs) {
      const rel = render(theirs[2]);
      return { alts: rel.alts, tail: `${rel.tail} ${of(render(theirs[1]))}`, through: true };
    }
    // Anyone else named through another person, the last first: "fratello di tuo patrigno", "figliastro di tua sorella".
    const through = label.match(/^(.+)'s (.+)$/);
    if (through) {
      const rel = render(through[2]);
      return { alts: rel.alts, tail: `${rel.tail} ${of(render(through[1]))}`, through: true };
    }
    // A grandparent or grandchild by marriage: "nonno acquisito".
    if (label.startsWith("step-")) return reword(render(label.slice(5)), (w, n) => agree(w, n, "acquisito", "acquisita"));
    const cousin = label.match(/^(half-)?(?:(\w+|\d+th) )?cousin(?: (once|twice|\d+ times) removed)?$/);
    if (cousin) {
      const degree = cousinDegree(cousin[2]);
      const removed = removedCount(cousin[3]);
      const sex = k.cousin?.sex;
      const up = k.cousin?.up;
      const pick = (m: string, f: string, mg: Gender = "m", fg: Gender = "f") => one(sex === "m" ? [noun(m, mg)] : sex === "f" ? [noun(f, fg)] : [noun(m, mg), noun(f, fg)]);
      let kin: ItKin;
      if (removed && up) {
        // A parent's cousin is an uncle or aunt of the next degree, a cousin's child a nephew or niece of it; each
        // further generation adds pro-.
        kin = up > 0 ? pick("zio", "zia") : pick("nipote", "nipote");
        kin = reword(kin, (w) => `${pro(removed - 1, w)} ${grado(degree + 1)}`);
      } else {
        kin = pick("cugino", "cugina");
        if (degree > 1) kin = reword(kin, (w) => `${w} ${grado(degree)}`);
        if (removed) kin = reword(kin, (w) => `${w}, ${removed === 1 ? "una generazione" : `${removed} generazioni`} di distanza`);
      }
      return cousin[1] ? half(kin) : kin;
    }
    const great = label.match(/^(?:(\d+)× )?great-(half-)?(.+)$/);
    if (great) {
      const n = Number(great[1] ?? 1);
      const inner = great[3];
      const kin = render(inner);
      const out = /^grand(father|mother|parent)$/.test(inner)
        ? reword(kin, (w) => ancestor(n, w))
        : reword(kin, (w) => pro(n, w));
      return great[2] ? half(out) : out;
    }
    if (label.startsWith("half-")) return half(render(label.slice(5)));
    // Any other relative of your partner: "nonno di tua moglie".
    if (label.endsWith("-in-law")) {
      const rel = render(label.slice(0, -7));
      return { alts: rel.alts, tail: `${rel.tail} ${of(spouseWord(k.spouse))}`, through: true };
    }
    return one([noun(label, "m")]);
  };
  return render(k.label);
}

/** Half a tie: a half-brother is a "fratellastro", any other relative "mezzo" or "mezza". */
function half(kin: ItKin): ItKin {
  return {
    ...kin,
    alts: kin.alts.map((n) => ({
      ...n,
      word: n.word === "fratello" ? "fratellastro" : n.word === "sorella" ? "sorellastra" : `${n.g === "f" ? "mezza" : "mezzo"} ${n.word}`,
    })),
  };
}

const words = (k: Kinship, view: KinshipView) => {
  const kin = renderIt(k, view);
  return kin.alts.map((n) => n.word).join(" o ") + kin.tail;
};

function yourParts(k: Kinship): KinshipPart[] {
  const kin = renderIt(k, "you");
  const parts: KinshipPart[] = [];
  kin.alts.forEach((n, i) => {
    const l = kin.through ? article(n) : possessive(n);
    parts.push({ text: `${i ? " o " : ""}${lead(i ? l : capitalise(l))}` }, { text: n.word, kin: true });
  });
  if (kin.tail) parts.push({ text: kin.tail, kin: true });
  return parts;
}

const it: KinshipRules = {
  label: (k, view) => (k.label === "you" ? "tu" : words(k, view)),
  your(list) {
    const phrase = (x: Kinship) => yourParts(x).map((p) => p.text).join("");
    return [...new Set(list.map((x) => (x.label === "you" ? "tu" : phrase(x).charAt(0).toLowerCase() + phrase(x).slice(1))))].join(" & ");
  },
  yourParts,
};
export default it;
