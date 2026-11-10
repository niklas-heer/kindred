import type { Kinship } from "../graph";
import type { Locale } from "./types.ts";

type Gender = "m" | "f" | "n";

/** graph.ts BY_MARRIAGE: a tie through marriages further than a specific word reaches. */
const BY_MARRIAGE = "relative by marriage";

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
const EN_ORDINALS = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];

/**
 * Who a relation is seen from. "you": the reader, so German says "Ehefrau deines Cousins". "them": a person named
 * beside it ("{kin} des Oberhaupts", "{a}: {rel} von {b}"), so German says "Ehefrau des Cousins".
 */
export type KinshipView = "you" | "them";

/** The English label of graph.kinship() in the reader's language: "Großtante", "Cousine 2. Grades", "oupagrootjie". */
export function kinshipLabel(k: Kinship | undefined | null, locale: Locale = "en", view: KinshipView = "you"): string {
  if (!k) return "";
  if (k.label === "you") return locale === "de" ? "du" : locale === "af" ? "jy" : "you";
  if (locale === "en") return k.label;
  if (locale === "af") return renderAf(k);
  const kin = renderDe(k, view);
  return kin.alts.map((n) => n.word).join(" oder ") + kin.tail;
}

/**
 * "your father", "deine Großmutter", "dein Großonkel", "die Ehefrau deines Cousins", "jou oupagrootjie": the relation
 * with the reader's possessive, which in German agrees with each word. Several relations (a couple's anniversary)
 * are joined with " & ". `capital` starts a sentence: "Deine Großmutter".
 */
export function yourKinship(k: Kinship | readonly Kinship[], locale: Locale = "en", opts: { capital?: boolean } = {}): string {
  const list = Array.isArray(k) ? (k as readonly Kinship[]) : [k as Kinship];
  let text: string;
  if (locale === "de") {
    const phrase = (x: Kinship) => yourKinshipParts(x, "de").map((p) => p.text).join("");
    text = [...new Set(list.map((x) => (x.label === "you" ? "du" : phrase(x).charAt(0).toLowerCase() + phrase(x).slice(1))))].join(" & ");
  } else {
    const words = [...new Set(list.map((x) => kinshipLabel(x, locale)))].join(" & ");
    text = list.every((x) => x.label === "you") ? words : `${locale === "af" ? "jou" : "your"} ${words}`;
  }
  return opts.capital ? capitalise(text) : text;
}

/**
 * yourKinship() in parts, the relation words marked, for a screen that sets them in bold: "Deine <b>Großmutter</b>",
 * "Dein <b>Onkel</b> oder deine <b>Tante</b>". Starts with a capital.
 */
export function yourKinshipParts(k: Kinship, locale: Locale = "en"): { text: string; kin?: boolean }[] {
  if (k.label === "you") return [{ text: capitalise(kinshipLabel(k, locale)), kin: true }];
  if (locale !== "de") return [{ text: locale === "af" ? "Jou " : "Your " }, { text: kinshipLabel(k, locale), kin: true }];
  const kin = renderDe(k, "you");
  const parts: { text: string; kin?: boolean }[] = [];
  kin.alts.forEach((n, i) => {
    const lead = (kin.through ? ARTICLE : POSSESSIVE)[n.g];
    parts.push({ text: `${i ? " oder " : ""}${i ? lead : capitalise(lead)} ` }, { text: n.word, kin: true });
  });
  if (kin.tail) parts.push({ text: kin.tail, kin: true });
  return parts;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- German ----------

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
const cousinDegree = (word: string | undefined) =>
  !word ? 1 : EN_ORDINALS.indexOf(word) > 0 ? EN_ORDINALS.indexOf(word) : parseInt(word, 10);
const removedCount = (word: string | undefined) =>
  !word ? 0 : word === "once" ? 1 : word === "twice" ? 2 : parseInt(word, 10);

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

// ---------- Afrikaans ----------

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
