// Spanish kinship words: nouns with their grammatical gender, "tu" before them (one possessive for both genders), and a
// relation named through someone with "de" ("el esposo de tu prima", "el esposo de la prima"). Always "tú". Neutral
// Spanish: "esposo/esposa", "tío abuelo", "de acogida" are understood in Spain and Latin America alike.
import type { Kinship } from "../../graph";
import { BY_MARRIAGE, capitalise, cousinDegree, removedCount, type KinshipPart, type KinshipRules, type KinshipView } from "./shared.ts";

type Gender = "m" | "f";
interface Noun {
  word: string;
  g: Gender;
}
/** A Spanish relation: one noun, or two when the sex is open ("tío o tía"), then words that follow both. */
interface EsKin {
  alts: Noun[];
  tail: string;
  /** Named through another person ("esposo de tu prima"): it takes the article where a plain word takes "tu". */
  through?: boolean;
}

const ES_WORDS: Record<string, [string, Gender][]> = {
  father: [["padre", "m"]],
  mother: [["madre", "f"]],
  parent: [["padre", "m"], ["madre", "f"]],
  son: [["hijo", "m"]],
  daughter: [["hija", "f"]],
  child: [["hijo", "m"], ["hija", "f"]],
  grandfather: [["abuelo", "m"]],
  grandmother: [["abuela", "f"]],
  grandparent: [["abuelo", "m"], ["abuela", "f"]],
  grandson: [["nieto", "m"]],
  granddaughter: [["nieta", "f"]],
  grandchild: [["nieto", "m"], ["nieta", "f"]],
  brother: [["hermano", "m"]],
  sister: [["hermana", "f"]],
  sibling: [["hermano", "m"], ["hermana", "f"]],
  uncle: [["tío", "m"]],
  aunt: [["tía", "f"]],
  pibling: [["tío", "m"], ["tía", "f"]],
  nephew: [["sobrino", "m"]],
  niece: [["sobrina", "f"]],
  nibling: [["sobrino", "m"], ["sobrina", "f"]],
  husband: [["esposo", "m"]],
  wife: [["esposa", "f"]],
  partner: [["pareja", "f"]],
  "father-in-law": [["suegro", "m"]],
  "mother-in-law": [["suegra", "f"]],
  "parent-in-law": [["suegro", "m"], ["suegra", "f"]],
  "son-in-law": [["yerno", "m"]],
  "daughter-in-law": [["nuera", "f"]],
  "child-in-law": [["yerno", "m"], ["nuera", "f"]],
  "brother-in-law": [["cuñado", "m"]],
  "sister-in-law": [["cuñada", "f"]],
  "sibling-in-law": [["cuñado", "m"], ["cuñada", "f"]],
  stepfather: [["padrastro", "m"]],
  stepmother: [["madrastra", "f"]],
  stepparent: [["padrastro", "m"], ["madrastra", "f"]],
  stepson: [["hijastro", "m"]],
  stepdaughter: [["hijastra", "f"]],
  stepchild: [["hijastro", "m"], ["hijastra", "f"]],
  stepbrother: [["hermanastro", "m"]],
  stepsister: [["hermanastra", "f"]],
  stepsibling: [["hermanastro", "m"], ["hermanastra", "f"]],
  "foster father": [["padre de acogida", "m"]],
  "foster mother": [["madre de acogida", "f"]],
  "foster parent": [["padre de acogida", "m"], ["madre de acogida", "f"]],
  "foster son": [["hijo de acogida", "m"]],
  "foster daughter": [["hija de acogida", "f"]],
  "foster child": [["hijo de acogida", "m"], ["hija de acogida", "f"]],
  "foster brother": [["hermano de acogida", "m"]],
  "foster sister": [["hermana de acogida", "f"]],
  "foster sibling": [["hermano de acogida", "m"], ["hermana de acogida", "f"]],
  "adoptive father": [["padre adoptivo", "m"]],
  "adoptive mother": [["madre adoptiva", "f"]],
  "adoptive parent": [["padre adoptivo", "m"], ["madre adoptiva", "f"]],
  "adopted son": [["hijo adoptivo", "m"]],
  "adopted daughter": [["hija adoptiva", "f"]],
  "adopted child": [["hijo adoptivo", "m"], ["hija adoptiva", "f"]],
};

const o = (g: Gender) => (g === "m" ? "o" : "a");
/** Grandparents `k` generations beyond the grandparent: abuelo, bisabuelo, tatarabuelo, trastatarabuelo. */
const upWord = (k: number, g: Gender) => (["abuel", "bisabuel", "tatarabuel", "trastatarabuel"][k] ?? `${k}× bisabuel`) + o(g);
/** The same for grandchildren: nieto, bisnieto, tataranieto, trastataranieto. */
const downWord = (k: number, g: Gender) => (["niet", "bisniet", "tataraniet", "trastataraniet"][k] ?? `${k}× bisniet`) + o(g);
/** "segundo" in "primo de segundo grado" (the form that goes before "grado"). */
const ORDINALS = ["", "primer", "segundo", "tercer", "cuarto", "quinto", "sexto", "séptimo", "octavo", "noveno", "décimo"];
const degreeTail = (n: number) => ` de ${ORDINALS[n] ?? `${n}.º`} grado`;

const one = (alts: Noun[], tail = ""): EsKin => ({ alts, tail });
const noun = (word: string, g: Gender): Noun => ({ word, g });
const both = (m: string, f: string) => [noun(m, "m"), noun(f, "f")];
const bySex = (sex: "m" | "f" | undefined, m: string, f: string) => (sex === "m" ? [noun(m, "m")] : sex === "f" ? [noun(f, "f")] : both(m, f));
const reword = (kin: EsKin, f: (n: Noun) => string): EsKin => ({ ...kin, alts: kin.alts.map((n) => ({ word: f(n), g: n.g })) });
const half = (kin: EsKin) => reword(kin, (n) => `${n.g === "m" ? "medio" : "media"} ${n.word}`);
/** The article of a noun, and "de" + article: "del primo", "de la prima". */
const article = (g: Gender) => (g === "m" ? "el" : "la");
const ofArticle = (g: Gender) => (g === "m" ? "del" : "de la");

function renderEs(k: Kinship, view: KinshipView): EsKin {
  const words = (label: string) => ES_WORDS[label] && one(ES_WORDS[label].map(([w, g]) => noun(w, g)));
  const sexOf = (word: string): "m" | "f" | undefined => (/^(husband|brother)$/.test(word) ? "m" : /^(wife|sister)$/.test(word) ? "f" : undefined);
  const spouseWord = (sex: "m" | "f" | undefined) => words(sex === "m" ? "husband" : sex === "f" ? "wife" : "partner")!;
  /** "de tu primo o prima", "del primo o de la prima": a relation as the owner of another. */
  const of = (owner: EsKin) =>
    view === "you" && !owner.through
      ? `de tu ${owner.alts.map((n) => n.word).join(" o ")}${owner.tail}`
      : `${owner.alts.map((n) => `${ofArticle(n.g)} ${n.word}`).join(" o ")}${owner.tail}`;

  const render = (label: string): EsKin => {
    const word = words(label);
    if (word) return word;
    if (label === BY_MARRIAGE) return one(bySex(k.sex, "pariente político", "pariente política"));
    // The husband of your wife's sister, and the sister of your brother's wife: concuñado, concuñada.
    const concu =
      label.match(/^(?:husband|wife|partner)'s (?:half-)?(?:brother|sister|sibling)'s (husband|wife|partner)$/) ??
      label.match(/^(?:half-)?(?:brother|sister|sibling)'s (?:husband|wife|partner)'s (?:half-)?(brother|sister|sibling)$/);
    if (concu) return one(bySex(sexOf(concu[1]), "concuñado", "concuñada"));
    // A tie through a marriage first, so "great-uncle's wife" is not read as a "great-" word.
    const spouse = label.match(/^(.+)'s (husband|wife|partner)$/);
    if (spouse) {
      const spouses = render(spouse[2]);
      const rel = spouse[1].replace(/half-/g, "");
      // The wife of an uncle is an aunt by marriage: "tía política", "tía abuela política".
      const pibling = rel.match(/^(?:(\d+)× )?(great-)?(?:uncle|aunt|pibling)$/);
      if (pibling) {
        const grand = pibling[2] ? ` ${upWord(Number(pibling[1] ?? 1) - 1, "f")}` : "";
        const grandM = pibling[2] ? ` ${upWord(Number(pibling[1] ?? 1) - 1, "m")}` : "";
        return one(spouses.alts.map((n) => (n.g === "f" ? noun(`tía${grand} política`, "f") : noun(`tío${grandM} político`, "m"))));
      }
      return { alts: spouses.alts, tail: ` ${of(render(spouse[1]))}`, through: true };
    }
    const theirs = label.match(/^(husband|wife|partner)'s (.+)$/);
    if (theirs) {
      const rel = render(theirs[2]);
      return { alts: rel.alts, tail: `${rel.tail} ${of(render(theirs[1]))}`, through: true };
    }
    // Anyone else named through another person, the last first: "hermano de tu padrastro".
    const through = label.match(/^(.+)'s (.+)$/);
    if (through) {
      const rel = render(through[2]);
      return { alts: rel.alts, tail: `${rel.tail} ${of(render(through[1]))}`, through: true };
    }
    // Any other relative of your partner: "abuelo de tu esposa".
    if (label.endsWith("-in-law")) {
      const rel = render(label.slice(0, -7));
      return { alts: rel.alts, tail: `${rel.tail} ${of(spouseWord(k.spouse))}`, through: true };
    }
    // A grandparent or grandchild by marriage: abuelastro, nietastro (bisabuelastro).
    if (label.startsWith("step-")) {
      return reword(render(label.slice(5)), (n) => n.word.replace(/(abuel|niet)[oa]$/, (_, stem) => `${stem}astr${o(n.g)}`));
    }
    const cousin = label.match(/^(half-)?(?:(\w+|\d+th) )?cousin(?: (once|twice|\d+ times) removed)?$/);
    if (cousin) {
      const degree = cousinDegree(cousin[2]);
      const removed = removedCount(cousin[3]);
      const sex = k.cousin?.sex;
      const up = k.cousin?.up;
      let kin: EsKin;
      if (removed && up) {
        // A parent's cousin is an uncle or aunt of the next degree, a cousin's child a nephew or niece of it; each
        // further generation adds "abuelo", "bisabuelo" ("tío abuelo de tercer grado").
        const side = up > 0 ? bySex(sex, "tío", "tía") : bySex(sex, "sobrino", "sobrina");
        kin = one(
          side.map((n) => noun(removed >= 2 ? `${n.word} ${(up > 0 ? upWord : downWord)(removed - 2, n.g)}` : n.word, n.g)),
          degreeTail(degree + 1),
        );
      } else {
        kin = one(bySex(sex, "primo", "prima"), `${degree > 1 ? degreeTail(degree) : ""}${removed ? ` con ${removed === 1 ? "una generación" : `${removed} generaciones`} de diferencia` : ""}`);
      }
      return cousin[1] ? half(kin) : kin;
    }
    const great = label.match(/^(?:(\d+)× )?great-(half-)?(.+)$/);
    if (great) {
      const n = Number(great[1] ?? 1);
      const base = great[3];
      let kin: EsKin;
      const sexWord = (m: string, f: string) => (/father|uncle|nephew|son$/.test(base) ? bySex("m", m, f) : /mother|aunt|niece|daughter/.test(base) ? bySex("f", m, f) : both(m, f));
      if (/^grand(father|mother|parent)$/.test(base)) kin = one(sexWord("m", "f").map((x) => noun(upWord(n, x.g), x.g)));
      else if (/^grand(son|daughter|child)$/.test(base)) kin = one(sexWord("m", "f").map((x) => noun(downWord(n, x.g), x.g)));
      else if (/^(uncle|aunt|pibling)$/.test(base)) kin = one(sexWord("tío", "tía").map((x) => noun(`${x.word} ${upWord(n - 1, x.g)}`, x.g)));
      else if (/^(nephew|niece|nibling)$/.test(base)) kin = one(sexWord("sobrino", "sobrina").map((x) => noun(`${x.word} ${downWord(n - 1, x.g)}`, x.g)));
      else kin = reword(render(base), (x) => `bis${x.word}`);
      return great[2] ? half(kin) : kin;
    }
    if (label.startsWith("half-")) return half(render(label.slice(5)));
    return one([noun(label, "m")]);
  };
  return render(k.label);
}

const phrase = (kin: EsKin) => kin.alts.map((n) => n.word).join(" o ") + kin.tail;

function yourParts(k: Kinship): KinshipPart[] {
  const kin = renderEs(k, "you");
  const parts: KinshipPart[] = [];
  if (kin.through) {
    kin.alts.forEach((n, i) => parts.push({ text: i ? ` o ${article(n.g)} ` : `${capitalise(article(n.g))} ` }, { text: n.word, kin: true }));
  } else {
    parts.push({ text: "Tu " }, { text: kin.alts.map((n) => n.word).join(" o "), kin: true });
  }
  if (kin.tail) parts.push({ text: kin.tail, kin: true });
  return parts;
}

const es: KinshipRules = {
  label: (k, view) => (k.label === "you" ? "tú" : phrase(renderEs(k, view))),
  your(list) {
    const text = (x: Kinship) => {
      const lower = yourParts(x).map((p) => p.text).join("");
      return lower.charAt(0).toLowerCase() + lower.slice(1);
    };
    return [...new Set(list.map((x) => (x.label === "you" ? "tú" : text(x))))].join(" & ");
  },
  yourParts,
};
export default es;
