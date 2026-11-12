// Simplified Chinese kinship words. One possessive ("你的", just "你" before a relation already joined with 的: "你父母的
// 兄弟"), no agreement; a relation named through someone is joined with 的 ("妻子的姐妹"). Chinese splits most relatives by
// the father's or mother's side (祖父/外祖父, 叔伯/舅, 堂/表) and by age (哥/弟), and Kindred knows neither. Where the English
// word is the same on both sides, this module gives both words with "或" ("祖父或外祖父") or describes the tie from the parent
// ("父母的兄弟"), so no word claims a side it does not know.
import type { Kinship } from "../../graph";
import { BY_MARRIAGE, cousinDegree, removedCount, type KinshipPart, type KinshipRules } from "./shared.ts";

type Sex = "m" | "f" | undefined;

/** Words that need no further rules, from graph.kinship()'s English labels. */
const ZH_WORDS: Record<string, string> = {
  father: "父亲",
  mother: "母亲",
  parent: "父母",
  son: "儿子",
  daughter: "女儿",
  child: "孩子",
  brother: "兄弟",
  sister: "姐妹",
  sibling: "兄弟姐妹",
  husband: "丈夫",
  wife: "妻子",
  partner: "伴侣",
  "son-in-law": "女婿",
  "daughter-in-law": "儿媳",
  "child-in-law": "子女的配偶",
  "brother-in-law": "姻亲兄弟",
  "sister-in-law": "姻亲姐妹",
  "sibling-in-law": "姻亲兄弟姐妹",
  stepfather: "继父",
  stepmother: "继母",
  stepparent: "继父母",
  stepson: "继子",
  stepdaughter: "继女",
  stepchild: "继子女",
  stepbrother: "继兄弟",
  stepsister: "继姐妹",
  stepsibling: "继兄弟姐妹",
  "foster father": "寄养父亲",
  "foster mother": "寄养母亲",
  "foster parent": "寄养父母",
  "foster son": "寄养儿子",
  "foster daughter": "寄养女儿",
  "foster child": "寄养孩子",
  "foster brother": "寄养兄弟",
  "foster sister": "寄养姐妹",
  "foster sibling": "寄养兄弟姐妹",
  "adoptive father": "养父",
  "adoptive mother": "养母",
  "adoptive parent": "养父母",
  "adopted son": "养子",
  "adopted daughter": "养女",
  "adopted child": "养子女",
};

const NUMERALS = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
/** The relatives `g` generations up as a pair: 父母, 祖父母, 曾祖父母, 高祖父母. */
const ancestors = (g: number): string => (g <= 1 ? "父母" : g === 2 ? "祖父母" : g === 3 ? "曾祖父母" : g === 4 ? "高祖父母" : `${g}代前的祖辈`);
/**
 * A grandparent or further, `g` generations up (2 = grandparent). The father's line and the mother's line have different
 * words ("祖父", "外祖父"), so a relative whose side Kindred does not know gets both.
 */
function ancestor(g: number, sex: Sex): string {
  if (g > 4) return `${g}代前的祖辈`;
  const stem = g === 2 ? "祖" : g === 3 ? "曾祖" : "高祖";
  return sex === "m" ? `${stem}父或外${stem}父` : sex === "f" ? `${stem}母或外${stem}母` : `${stem}辈`;
}
/** A grandchild or further, `g` generations down (2 = grandchild), with the paternal and the maternal word when they differ. */
function descendant(g: number, sex: Sex): string {
  if (g > 4) return `${g}代后的孙辈`;
  if (g === 4) return sex === "m" ? "玄孙" : sex === "f" ? "玄孙女" : "玄孙辈";
  const stem = g === 2 ? "孙" : "曾孙";
  const son = g === 2 ? "孙" : "曾孙";
  return sex === "m" ? `${stem}${g === 2 ? "子" : ""}或外${son}` : sex === "f" ? `${stem}女或外${son}女` : `${stem}辈`;
}
/** A child, grandchild or further of a sibling or cousin: no side to name, the plain words. */
function offspring(g: number, sex: Sex): string {
  if (g === 1) return sex === "m" ? "儿子" : sex === "f" ? "女儿" : "孩子";
  if (g === 2) return sex === "m" ? "孙子" : sex === "f" ? "孙女" : "孙辈";
  if (g === 3) return sex === "m" ? "曾孙" : sex === "f" ? "曾孙女" : "曾孙辈";
  if (g === 4) return sex === "m" ? "玄孙" : sex === "f" ? "玄孙女" : "玄孙辈";
  return `${g}代后的孙辈`;
}
const HALF = "半血缘";
const sexOf = (word: string): Sex => (/(father|brother|uncle|nephew|son|husband)$/.test(word) ? "m" : /(mother|sister|aunt|niece|daughter|wife)$/.test(word) ? "f" : undefined);
const sibling = (sex: Sex, half: boolean) => `${half ? HALF : ""}${sex === "m" ? "兄弟" : sex === "f" ? "姐妹" : "兄弟姐妹"}`;
/** 堂表亲, 再从堂表亲, 三从堂表亲: the degree as 再从, 三从, 四从 … before the word for a cousin of either side. */
const degreeWord = (degree: number) => (degree <= 1 ? "" : degree === 2 ? "再从" : `${NUMERALS[degree] ?? degree}从`);
const cousinWord = (degree: number, sex: Sex) => `${degreeWord(degree)}${sex === "m" ? "堂表兄弟" : sex === "f" ? "堂表姐妹" : "堂表亲"}`;

function render(k: Kinship): string {
  const rec = (label: string): string => renderLabel({ ...k, label });
  return renderLabel(k);

  function renderLabel(kin: Kinship): string {
    const label = kin.label;
    if (ZH_WORDS[label]) return ZH_WORDS[label];
    // The parents of a partner have their own words, once the app knows whose partner: 公公, 岳父.
    const inLaw = label.match(/^(father|mother|parent)-in-law$/);
    if (inLaw) {
      const m = inLaw[1];
      if (kin.spouse === "m") return m === "father" ? "公公" : m === "mother" ? "婆婆" : "公婆";
      if (kin.spouse === "f") return m === "father" ? "岳父" : m === "mother" ? "岳母" : "岳父母";
      return `配偶的${m === "father" ? "父亲" : m === "mother" ? "母亲" : "父母"}`;
    }
    if (label === BY_MARRIAGE) return "姻亲";
    // A tie through a spouse of a relative: "uncle's wife", "wife's sister's husband".
    const spouse = label.match(/^(.+)'s (husband|wife|partner)$/);
    if (spouse) return `${rec(spouse[1])}的${ZH_WORDS[spouse[2]]}`;
    // Anyone else named through another person, the last first: "stepfather's brother", "wife's great-aunt".
    const through = label.match(/^(.+)'s (.+)$/);
    if (through) return `${rec(through[1])}的${rec(through[2])}`;
    if (label.startsWith("step-")) return `继${rec(label.slice(5)).split("或")[0]}`;
    const cousin = label.match(/^(half-)?(?:(\w+|\d+th) )?cousin(?: (once|twice|\d+ times) removed)?$/);
    if (cousin) {
      const degree = cousinDegree(cousin[2]);
      const removed = removedCount(cousin[3]);
      const up = kin.cousin?.up ?? 0;
      const sex = kin.cousin?.sex;
      // A parent's cousin stands above and a cousin's child below: "父母的堂表亲", "再从堂表亲的孙辈".
      const base = (s: Sex) => `${cousin[1] ? HALF : ""}${cousinWord(degree, s)}`;
      if (!removed) return base(sex);
      if (up > 0) return `${ancestors(up)}的${base(undefined)}`;
      if (up < 0) return `${base(undefined)}的${offspring(-up, sex)}`;
      return `${base(undefined)}（相隔${removed}代）`;
    }
    // Generations out: great-grandmother, 2× great-uncle, great-half-nephew.
    const lineal = label.match(/^(?:(\d+)× )?(great-)?(half-)?(grand)?(father|mother|parent|son|daughter|child|uncle|aunt|pibling|nephew|niece|nibling)$/);
    if (lineal) {
      const n = lineal[2] ? Number(lineal[1] ?? 1) : 0;
      const half = !!lineal[3];
      const sex = sexOf(lineal[5]);
      const base = lineal[5];
      if (lineal[4]) return /(son|daughter|child)$/.test(base) ? descendant(n + 2, sex) : ancestor(n + 2, sex);
      // An uncle or aunt is a parent's brother or sister, a great-uncle a grandparent's, and so on.
      if (/(uncle|aunt|pibling)$/.test(base)) return `${ancestors(n + 1)}的${sibling(sex, half)}`;
      // A nephew or niece is a sibling's child, a great-nephew a sibling's grandchild.
      const kids = n === 0 ? offspring(1, sex) : offspring(n + 1, sex);
      return `${half ? HALF : ""}兄弟姐妹的${kids}`;
    }
    if (label.startsWith("half-")) return `${HALF}${rec(label.slice(5))}`;
    // Any other relative of your partner: "妻子的祖父".
    if (label.endsWith("-in-law")) return `${kin.spouse === "m" ? "丈夫" : kin.spouse === "f" ? "妻子" : "配偶"}的${rec(label.slice(0, -7))}`;
    return label;
  }
}

/** "你的父亲", but "你父母的兄弟" rather than "你的父母的兄弟": a relation already joined with 的 takes 你 alone. */
const possessive = (word: string) => (word.includes("的") ? "你" : "你的");
const phrase = (k: Kinship) => (k.label === "you" ? "你" : `${possessive(render(k))}${render(k)}`);

function yourParts(k: Kinship): KinshipPart[] {
  const word = render(k);
  return [{ text: possessive(word) }, { text: word, kin: true }];
}

const zhHans: KinshipRules = {
  label: (k) => (k.label === "you" ? "你" : render(k)),
  your: (list) => [...new Set(list.map(phrase))].join(" & "),
  yourParts,
};
export default zhHans;
