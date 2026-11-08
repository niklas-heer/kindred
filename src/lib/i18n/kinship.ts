import type { Kinship } from "../graph";
import type { Locale } from "./types.ts";

/** German kinship words, rendered from graph.kinship()'s English labels. */
const DE_WORDS: Record<string, string> = {
  you: "du",
  father: "Vater",
  mother: "Mutter",
  parent: "Elternteil",
  son: "Sohn",
  daughter: "Tochter",
  child: "Kind",
  grandfather: "Großvater",
  grandmother: "Großmutter",
  grandparent: "Großelternteil",
  grandson: "Enkel",
  granddaughter: "Enkelin",
  grandchild: "Enkelkind",
  brother: "Bruder",
  sister: "Schwester",
  sibling: "Geschwister",
  uncle: "Onkel",
  aunt: "Tante",
  pibling: "Onkel/Tante",
  nephew: "Neffe",
  niece: "Nichte",
  nibling: "Neffe/Nichte",
  husband: "Ehemann",
  wife: "Ehefrau",
  partner: "Partner/Partnerin",
  "father-in-law": "Schwiegervater",
  "mother-in-law": "Schwiegermutter",
  "parent-in-law": "Schwiegerelternteil",
  "son-in-law": "Schwiegersohn",
  "daughter-in-law": "Schwiegertochter",
  "child-in-law": "Schwiegerkind",
  "brother-in-law": "Schwager",
  "sister-in-law": "Schwägerin",
  "sibling-in-law": "Schwager/Schwägerin",
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
};

const AF_ORDINALS = ["nulde", "eerste", "tweede", "derde", "vierde", "vyfde", "sesde", "sewende", "agste", "negende", "tiende"];

/** Accepts graph.kinship() without changing its backwards-compatible English label. */
export function kinshipLabel(k: Kinship | undefined | null, locale: Locale = "en"): string {
  if (!k) return "";
  if (locale === "en") return k.label;
  return locale === "de" ? renderDe(k.label) : renderAf(k.label);
}

function renderDe(label: string): string {
  const words = DE_WORDS;
  const ordinals = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
  const render = (label: string): string => {
    if (words[label]) return words[label];
    const cousin = label.match(/^(half-)?(?:(\w+|\d+th) )?cousin(?: (once|twice|\d+ times) removed)?$/);
    if (cousin) {
      const degree = cousin[2]
        ? ordinals.indexOf(cousin[2]) > 0
          ? ordinals.indexOf(cousin[2])
          : parseInt(cousin[2])
        : 1;
      return `${cousin[1] ? "Halb-" : ""}Cousin/Cousine${degree > 1 ? ` ${degree}. Grades` : ""}${cousin[3] ? `, ${cousin[3] === "once" ? "einmal" : cousin[3] === "twice" ? "zweimal" : `${parseInt(cousin[3])}-mal`} entfernt` : ""}`;
    }
    const great = label.match(/^(?:(\d+)× )?great-(.+)$/);
    if (great) {
      const n = Number(great[1] ?? 1);
      const base = render(great[2]);
      const collateral = /^(half-)?(uncle|aunt|pibling|nephew|niece|nibling)$/.test(great[2]);
      const count = collateral ? n - 1 : n;
      return `${count ? "Ur" + "ur".repeat(count - 1) : ""}${collateral ? (count ? "groß" : "Groß") : ""}${base.toLowerCase()}`;
    }
    if (label.startsWith("half-")) return `Halb${render(label.slice(5)).toLowerCase()}`;
    if (label.endsWith("-in-law")) return `${render(label.slice(0, -7))} (angeheiratet)`;
    const spouse = label.match(/^(.+)'s (husband|wife|partner)$/);
    if (spouse) return `${render(spouse[2])} von ${render(spouse[1])}`;
    return label;
  };
  return render(label);
}

function renderAf(label: string): string {
  const render = (label: string): string => {
    if (AF_WORDS[label]) return AF_WORDS[label];
    const cousin = label.match(/^(half-)?(?:(\w+|\d+th) )?cousin(?: (once|twice|\d+ times) removed)?$/);
    if (cousin) {
      const english = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
      const degree = cousin[2] ? (english.indexOf(cousin[2]) > 0 ? english.indexOf(cousin[2]) : parseInt(cousin[2])) : 1;
      const base = cousin[1] ? "halfneef/halfniggie" : "neef/niggie";
      const lead = degree > 1 ? `${AF_ORDINALS[degree] ?? `${degree}de`} ${base}` : base;
      const removed = cousin[3]
        ? ` ${cousin[3] === "once" ? "een keer" : cousin[3] === "twice" ? "twee keer" : `${parseInt(cousin[3])} keer`} verwyder`
        : "";
      return `${lead}${removed}`;
    }
    const great = label.match(/^(?:(\d+)× )?great-(.+)$/);
    if (great) {
      const base = great[2];
      if (base === "grandmother") return "agterouma";
      if (base === "grandfather") return "agteroupa";
      if (base === "grandparent") return "agterouer";
      if (base === "aunt") return "groottante";
      if (base === "uncle") return "grootoom";
      if (base === "niece" || base === "nephew" || base === "nibling") return "kleinneef/kleinniggie";
      if (base === "child" || base === "son" || base === "daughter" || base === "grandchild") return "agterkleinkind";
      return `agter${render(base)}`;
    }
    if (label.startsWith("half-")) return `half${render(label.slice(5))}`;
    if (label.endsWith("-in-law")) return `${render(label.slice(0, -7))} (skoon)`;
    const spouse = label.match(/^(.+)'s (husband|wife|partner)$/);
    if (spouse) return `${render(spouse[2])} van ${render(spouse[1])}`;
    return label;
  };
  return render(label);
}
