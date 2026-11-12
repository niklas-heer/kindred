// Brazilian Portuguese kinship words: nouns with their grammatical gender, the possessive that agrees with each ("seu pai",
// "sua mãe"), and a relation named through someone with "de" ("o marido da sua prima", "o marido da prima"). Always "você".
import type { Kinship } from "../../graph";
import { BY_MARRIAGE, capitalise, cousinDegree, removedCount, type KinshipPart, type KinshipRules, type KinshipView } from "./shared.ts";

type Gender = "m" | "f";
interface Noun {
  word: string;
  g: Gender;
}
/** A relation: one noun, or two when the sex is open ("tio ou tia"), then words that follow both. */
interface PtKin {
  alts: Noun[];
  tail: string;
  /** Named through another person ("marido da sua prima"): it takes the article where a plain word takes "seu". */
  through?: boolean;
}

const PT_WORDS: Record<string, [string, Gender][]> = {
  father: [["pai", "m"]],
  mother: [["mãe", "f"]],
  parent: [["pai", "m"], ["mãe", "f"]],
  son: [["filho", "m"]],
  daughter: [["filha", "f"]],
  child: [["filho", "m"], ["filha", "f"]],
  grandfather: [["avô", "m"]],
  grandmother: [["avó", "f"]],
  grandparent: [["avô", "m"], ["avó", "f"]],
  grandson: [["neto", "m"]],
  granddaughter: [["neta", "f"]],
  grandchild: [["neto", "m"], ["neta", "f"]],
  brother: [["irmão", "m"]],
  sister: [["irmã", "f"]],
  sibling: [["irmão", "m"], ["irmã", "f"]],
  uncle: [["tio", "m"]],
  aunt: [["tia", "f"]],
  pibling: [["tio", "m"], ["tia", "f"]],
  nephew: [["sobrinho", "m"]],
  niece: [["sobrinha", "f"]],
  nibling: [["sobrinho", "m"], ["sobrinha", "f"]],
  husband: [["marido", "m"]],
  wife: [["esposa", "f"]],
  partner: [["companheiro", "m"], ["companheira", "f"]],
  "father-in-law": [["sogro", "m"]],
  "mother-in-law": [["sogra", "f"]],
  "parent-in-law": [["sogro", "m"], ["sogra", "f"]],
  "son-in-law": [["genro", "m"]],
  "daughter-in-law": [["nora", "f"]],
  "child-in-law": [["genro", "m"], ["nora", "f"]],
  "brother-in-law": [["cunhado", "m"]],
  "sister-in-law": [["cunhada", "f"]],
  "sibling-in-law": [["cunhado", "m"], ["cunhada", "f"]],
  stepfather: [["padrasto", "m"]],
  stepmother: [["madrasta", "f"]],
  stepparent: [["padrasto", "m"], ["madrasta", "f"]],
  stepson: [["enteado", "m"]],
  stepdaughter: [["enteada", "f"]],
  stepchild: [["enteado", "m"], ["enteada", "f"]],
  stepbrother: [["irmão por afinidade", "m"]],
  stepsister: [["irmã por afinidade", "f"]],
  stepsibling: [["irmão por afinidade", "m"], ["irmã por afinidade", "f"]],
  "foster father": [["pai de criação", "m"]],
  "foster mother": [["mãe de criação", "f"]],
  "foster parent": [["pai de criação", "m"], ["mãe de criação", "f"]],
  "foster son": [["filho de criação", "m"]],
  "foster daughter": [["filha de criação", "f"]],
  "foster child": [["filho de criação", "m"], ["filha de criação", "f"]],
  "foster brother": [["irmão de criação", "m"]],
  "foster sister": [["irmã de criação", "f"]],
  "foster sibling": [["irmão de criação", "m"], ["irmã de criação", "f"]],
  "adoptive father": [["pai adotivo", "m"]],
  "adoptive mother": [["mãe adotiva", "f"]],
  "adoptive parent": [["pai adotivo", "m"], ["mãe adotiva", "f"]],
  "adopted son": [["filho adotivo", "m"]],
  "adopted daughter": [["filha adotiva", "f"]],
  "adopted child": [["filho adotivo", "m"], ["filha adotiva", "f"]],
};

const UP = [["avô", "avó"], ["bisavô", "bisavó"], ["trisavô", "trisavó"], ["tetravô", "tetravó"], ["pentavô", "pentavó"]];
const DOWN = [["neto", "neta"], ["bisneto", "bisneta"], ["trineto", "trineta"], ["tetraneto", "tetraneta"], ["pentaneto", "pentaneta"]];
/** Grandparents `k` generations beyond the grandparent: avô, bisavô, trisavô, tetravô. */
const upWord = (k: number, g: Gender) => UP[k]?.[g === "m" ? 0 : 1] ?? `${k}× ${g === "m" ? "bisavô" : "bisavó"}`;
const downWord = (k: number, g: Gender) => DOWN[k]?.[g === "m" ? 0 : 1] ?? `${k}× ${g === "m" ? "bisneto" : "bisneta"}`;
/** "segundo" in "primo de segundo grau". */
const ORDINALS = ["", "primeiro", "segundo", "terceiro", "quarto", "quinto", "sexto", "sétimo", "oitavo", "nono", "décimo"];
const degreeTail = (n: number) => ` de ${ORDINALS[n] ?? `${n}º`} grau`;

const one = (alts: Noun[], tail = ""): PtKin => ({ alts, tail });
const noun = (word: string, g: Gender): Noun => ({ word, g });
const both = (m: string, f: string) => [noun(m, "m"), noun(f, "f")];
const bySex = (sex: "m" | "f" | undefined, m: string, f: string) => (sex === "m" ? [noun(m, "m")] : sex === "f" ? [noun(f, "f")] : both(m, f));
const reword = (kin: PtKin, f: (n: Noun) => string): PtKin => ({ ...kin, alts: kin.alts.map((n) => ({ word: f(n), g: n.g })) });
const half = (kin: PtKin) => reword(kin, (n) => `${n.g === "m" ? "meio" : "meia"}-${n.word}`);
const POSSESSIVE: Record<Gender, string> = { m: "seu", f: "sua" };
const ARTICLE: Record<Gender, string> = { m: "o", f: "a" };
/** "do seu primo", "da sua prima"; without the reader: "do primo", "da prima". */
const ofMine = (n: Noun) => `d${ARTICLE[n.g]} ${POSSESSIVE[n.g]} ${n.word}`;
const ofThe = (n: Noun) => `d${ARTICLE[n.g]} ${n.word}`;

function renderPt(k: Kinship, view: KinshipView): PtKin {
  const words = (label: string) => PT_WORDS[label] && one(PT_WORDS[label].map(([w, g]) => noun(w, g)));
  const sexOf = (word: string): "m" | "f" | undefined => (/^(husband|brother)$/.test(word) ? "m" : /^(wife|sister)$/.test(word) ? "f" : undefined);
  const spouseWord = (sex: "m" | "f" | undefined) => words(sex === "m" ? "husband" : sex === "f" ? "wife" : "partner")!;
  /** "do seu primo ou da sua prima", "do primo ou da prima": a relation as the owner of another. */
  const of = (owner: PtKin) => owner.alts.map(view === "you" && !owner.through ? ofMine : ofThe).join(" ou ") + owner.tail;

  const render = (label: string): PtKin => {
    const word = words(label);
    if (word) return word;
    if (label === BY_MARRIAGE) return one([noun("parente por afinidade", k.sex === "f" ? "f" : "m")]);
    // The husband of your wife's sister, and the sister of your brother's wife: concunhado, concunhada.
    const concu =
      label.match(/^(?:husband|wife|partner)'s (?:half-)?(?:brother|sister|sibling)'s (husband|wife|partner)$/) ??
      label.match(/^(?:half-)?(?:brother|sister|sibling)'s (?:husband|wife|partner)'s (?:half-)?(brother|sister|sibling)$/);
    if (concu) return one(bySex(sexOf(concu[1]), "concunhado", "concunhada"));
    // A tie through a marriage first, so "great-uncle's wife" is not read as a "great-" word.
    const spouse = label.match(/^(.+)'s (husband|wife|partner)$/);
    if (spouse) {
      const spouses = render(spouse[2]);
      const rel = spouse[1].replace(/half-/g, "");
      // The wife of an uncle is an aunt by marriage: "tia por afinidade", "tia-avó por afinidade".
      const pibling = rel.match(/^(?:(\d+)× )?(great-)?(?:uncle|aunt|pibling)$/);
      if (pibling) {
        const up = (g: Gender) => (pibling[2] ? `-${upWord(Number(pibling[1] ?? 1) - 1, g)}` : "");
        return one(spouses.alts.map((n) => (n.g === "f" ? noun(`tia${up("f")} por afinidade`, "f") : noun(`tio${up("m")} por afinidade`, "m"))));
      }
      return { alts: spouses.alts, tail: ` ${of(render(spouse[1]))}`, through: true };
    }
    const theirs = label.match(/^(husband|wife|partner)'s (.+)$/);
    if (theirs) {
      const rel = render(theirs[2]);
      return { alts: rel.alts, tail: `${rel.tail} ${of(render(theirs[1]))}`, through: true };
    }
    // Anyone else named through another person, the last first: "irmão do seu padrasto".
    const through = label.match(/^(.+)'s (.+)$/);
    if (through) {
      const rel = render(through[2]);
      return { alts: rel.alts, tail: `${rel.tail} ${of(render(through[1]))}`, through: true };
    }
    // Any other relative of your partner: "avô da sua esposa".
    if (label.endsWith("-in-law")) {
      const rel = render(label.slice(0, -7));
      return { alts: rel.alts, tail: `${rel.tail} ${of(spouseWord(k.spouse))}`, through: true };
    }
    // A grandparent or grandchild by marriage has no word of its own: "avô por afinidade".
    if (label.startsWith("step-")) return reword(render(label.slice(5)), (n) => `${n.word} por afinidade`);
    const cousin = label.match(/^(half-)?(?:(\w+|\d+th) )?cousin(?: (once|twice|\d+ times) removed)?$/);
    if (cousin) {
      const degree = cousinDegree(cousin[2]);
      const removed = removedCount(cousin[3]);
      const sex = k.cousin?.sex;
      const up = k.cousin?.up;
      let kin: PtKin;
      if (removed && up) {
        // A parent's cousin is an uncle or aunt of the next degree, a cousin's child a nephew or niece of it; each
        // further generation adds "avô", "bisavô" ("tio-avô de terceiro grau").
        const side = up > 0 ? bySex(sex, "tio", "tia") : bySex(sex, "sobrinho", "sobrinha");
        kin = one(
          side.map((n) => noun(removed >= 2 ? `${n.word}-${(up > 0 ? upWord : downWord)(removed - 2, n.g)}` : n.word, n.g)),
          degreeTail(degree + 1),
        );
      } else {
        kin = one(bySex(sex, "primo", "prima"), `${degree > 1 ? degreeTail(degree) : ""}${removed ? ` com ${removed === 1 ? "uma geração" : `${removed} gerações`} de diferença` : ""}`);
      }
      return cousin[1] ? half(kin) : kin;
    }
    const great = label.match(/^(?:(\d+)× )?great-(half-)?(.+)$/);
    if (great) {
      const n = Number(great[1] ?? 1);
      const base = great[3];
      let kin: PtKin;
      const sexWord = (m: string, f: string) => (/father|uncle|nephew|son$/.test(base) ? bySex("m", m, f) : /mother|aunt|niece|daughter/.test(base) ? bySex("f", m, f) : both(m, f));
      if (/^grand(father|mother|parent)$/.test(base)) kin = one(sexWord("m", "f").map((x) => noun(upWord(n, x.g), x.g)));
      else if (/^grand(son|daughter|child)$/.test(base)) kin = one(sexWord("m", "f").map((x) => noun(downWord(n, x.g), x.g)));
      else if (/^(uncle|aunt|pibling)$/.test(base)) kin = one(sexWord("tio", "tia").map((x) => noun(`${x.word}-${upWord(n - 1, x.g)}`, x.g)));
      else if (/^(nephew|niece|nibling)$/.test(base)) kin = one(sexWord("sobrinho", "sobrinha").map((x) => noun(`${x.word}-${downWord(n - 1, x.g)}`, x.g)));
      else kin = reword(render(base), (x) => `bis${x.word}`);
      return great[2] ? half(kin) : kin;
    }
    if (label.startsWith("half-")) return half(render(label.slice(5)));
    return one([noun(label, "m")]);
  };
  return render(k.label);
}

const phrase = (kin: PtKin) => kin.alts.map((n) => n.word).join(" ou ") + kin.tail;

function yourParts(k: Kinship): KinshipPart[] {
  const kin = renderPt(k, "you");
  const parts: KinshipPart[] = [];
  kin.alts.forEach((n, i) => {
    const lead = (kin.through ? ARTICLE : POSSESSIVE)[n.g];
    parts.push({ text: `${i ? " ou " : ""}${i ? lead : capitalise(lead)} ` }, { text: n.word, kin: true });
  });
  if (kin.tail) parts.push({ text: kin.tail, kin: true });
  return parts;
}

const ptBR: KinshipRules = {
  label: (k, view) => (k.label === "you" ? "você" : phrase(renderPt(k, view))),
  your(list) {
    const text = (x: Kinship) => {
      const lower = yourParts(x).map((p) => p.text).join("");
      return lower.charAt(0).toLowerCase() + lower.slice(1);
    };
    return [...new Set(list.map((x) => (x.label === "you" ? "você" : text(x))))].join(" & ");
  },
  yourParts,
};
export default ptBR;
