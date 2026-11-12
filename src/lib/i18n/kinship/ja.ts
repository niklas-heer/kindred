// Japanese kinship words. No grammatical gender, no agreement and one possessive ("あなたの"), so a relation named through
// someone is joined with の ("妻の姉妹"). The app knows neither who is older ("兄"/"弟", "伯父"/"叔父") nor which side
// of the family a relative is on, so it uses the neutral word: hiragana "おじ", "いとこ", "きょうだい".
import type { Kinship } from "../../graph";
import { BY_MARRIAGE, cousinDegree, removedCount, type KinshipPart, type KinshipRules } from "./shared.ts";

type Sex = "m" | "f" | undefined;

/** Words that need no further rules, from graph.kinship()'s English labels. */
const JA_WORDS: Record<string, string> = {
  father: "父",
  mother: "母",
  parent: "親",
  son: "息子",
  daughter: "娘",
  child: "子ども",
  brother: "兄弟",
  sister: "姉妹",
  sibling: "きょうだい",
  uncle: "おじ",
  aunt: "おば",
  pibling: "おじ・おば",
  nephew: "甥",
  niece: "姪",
  nibling: "甥・姪",
  husband: "夫",
  wife: "妻",
  partner: "パートナー",
  "father-in-law": "義父",
  "mother-in-law": "義母",
  "parent-in-law": "義理の親",
  "son-in-law": "娘婿",
  "daughter-in-law": "息子の妻",
  "child-in-law": "子の配偶者",
  "brother-in-law": "義理の兄弟",
  "sister-in-law": "義理の姉妹",
  "sibling-in-law": "義理のきょうだい",
  stepfather: "継父",
  stepmother: "継母",
  stepparent: "継親",
  stepson: "継息子",
  stepdaughter: "継娘",
  stepchild: "継子",
  stepbrother: "継兄弟",
  stepsister: "継姉妹",
  stepsibling: "継きょうだい",
  "foster father": "里父",
  "foster mother": "里母",
  "foster parent": "里親",
  "foster son": "里子（男）",
  "foster daughter": "里子（女）",
  "foster child": "里子",
  "foster brother": "里親家庭の兄弟",
  "foster sister": "里親家庭の姉妹",
  "foster sibling": "里親家庭のきょうだい",
  "adoptive father": "養父",
  "adoptive mother": "養母",
  "adoptive parent": "養親",
  "adopted son": "養子",
  "adopted daughter": "養女",
  "adopted child": "養子",
};

/** The generation `g` steps up as a pair of grandparents-and-up: 親, 祖父母, 曽祖父母, 高祖父母. */
const ancestors = (g: number): string => (g <= 1 ? "親" : g === 2 ? "祖父母" : g === 3 ? "曽祖父母" : g === 4 ? "高祖父母" : `${g}代前の祖父母`);
/** A grandparent or further, `g` generations up (2 = grandparent), by sex. */
function ancestor(g: number, sex: Sex): string {
  const [m, f] = g === 2 ? ["祖父", "祖母"] : g === 3 ? ["曽祖父", "曽祖母"] : g === 4 ? ["高祖父", "高祖母"] : [`${g}代前の祖父`, `${g}代前の祖母`];
  return sex === "m" ? m : sex === "f" ? f : ancestors(g);
}
/** A grandchild or further, `g` generations down (2 = grandchild). Beyond grandchildren Japanese does not mark the sex. */
function descendant(g: number, sex: Sex): string {
  if (g === 1) return sex === "m" ? "息子" : sex === "f" ? "娘" : "子ども";
  if (g === 2) return sex === "m" ? "孫息子" : sex === "f" ? "孫娘" : "孫";
  return g === 3 ? "曽孫" : g === 4 ? "玄孫" : `${g}代目の子孫`;
}
const HALF = "片親違いの";
const sexOf = (word: string): Sex => (/(father|brother|uncle|nephew|son|husband)$/.test(word) ? "m" : /(mother|sister|aunt|niece|daughter|wife)$/.test(word) ? "f" : undefined);
const sibling = (sex: Sex, half: boolean) => `${half ? HALF : ""}${sex === "m" ? "兄弟" : sex === "f" ? "姉妹" : "きょうだい"}`;
/** いとこ, はとこ, then "3番目のいとこ". */
const cousinWord = (degree: number) => (degree <= 1 ? "いとこ" : degree === 2 ? "はとこ" : `${degree}番目のいとこ`);

function render(k: Kinship): string {
  const rec = (label: string): string => renderLabel({ ...k, label });
  return renderLabel(k);

  function renderLabel(kin: Kinship): string {
    const label = kin.label;
    if (JA_WORDS[label]) return JA_WORDS[label];
    if (label === BY_MARRIAGE) return "姻族";
    // A tie through a spouse of a relative: "uncle's wife", "wife's sister's husband".
    const spouse = label.match(/^(.+)'s (husband|wife|partner)$/);
    if (spouse) return `${rec(spouse[1])}の${JA_WORDS[spouse[2]]}`;
    // Anyone else named through another person, the last first: "stepfather's brother", "wife's great-aunt".
    const through = label.match(/^(.+)'s (.+)$/);
    if (through) return `${rec(through[1])}の${rec(through[2])}`;
    if (label.startsWith("step-")) return `継${rec(label.slice(5))}`;
    const cousin = label.match(/^(half-)?(?:(\w+|\d+th) )?cousin(?: (once|twice|\d+ times) removed)?$/);
    if (cousin) {
      const degree = cousinDegree(cousin[2]);
      const removed = removedCount(cousin[3]);
      const up = kin.cousin?.up ?? 0;
      const base = cousin[1] ? "祖父母の一方が違ういとこ" : cousinWord(degree);
      if (!removed) return base;
      // A parent's cousin stands above, a cousin's child below: "親のいとこ", "はとこの孫".
      if (up > 0) return `${ancestors(up)}の${base}`;
      if (up < 0) return `${base}の${descendant(-up, kin.cousin?.sex)}`;
      return `${base}（${removed}世代違い）`;
    }
    // Generations out: great-grandmother, 2× great-uncle, great-half-nephew.
    const lineal = label.match(/^(?:(\d+)× )?(great-)?(half-)?(grand)?(father|mother|parent|son|daughter|child|uncle|aunt|pibling|nephew|niece|nibling)$/);
    if (lineal) {
      const n = lineal[2] ? Number(lineal[1] ?? 1) : 0;
      const half = !!lineal[3];
      const sex = sexOf(lineal[5]);
      if (lineal[4]) return /(son|daughter|child)$/.test(lineal[5]) ? descendant(n + 2, sex) : ancestor(n + 2, sex);
      if (/(uncle|aunt|pibling)$/.test(lineal[5])) {
        if (n === 1 && !half) return sex === "m" ? "大おじ" : sex === "f" ? "大おば" : "大おじ・大おば";
        return `${ancestors(n + 1)}の${sibling(sex, half)}`;
      }
      // A sibling's grandchild and further.
      return `${half ? HALF : ""}兄弟姉妹の${descendant(n + 1, sex)}`;
    }
    if (label.startsWith("half-")) return `${HALF}${rec(label.slice(5))}`;
    // Any other relative of your partner: "妻の祖父".
    if (label.endsWith("-in-law")) return `${kin.spouse === "m" ? "夫" : kin.spouse === "f" ? "妻" : "配偶者"}の${rec(label.slice(0, -7))}`;
    return label;
  }
}

const phrase = (k: Kinship) => (k.label === "you" ? "あなた" : `あなたの${render(k)}`);

function yourParts(k: Kinship): KinshipPart[] {
  return [{ text: "あなたの" }, { text: render(k), kin: true }];
}

const ja: KinshipRules = {
  label: (k) => (k.label === "you" ? "あなた" : render(k)),
  your: (list) => [...new Set(list.map(phrase))].join(" & "),
  yourParts,
};
export default ja;
