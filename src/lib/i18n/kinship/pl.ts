// Polish kinship words: nouns with their grammatical gender and genitive ("twój wujek", "twoja ciocia"), and a relation named
// through someone in the genitive ("żona twojego kuzyna"). The possessive agrees with the noun; where the sex is open both
// words are given ("twój wujek lub twoja ciocia"). Always "ty". Names are never declined, so no module sentence needs them.
import type { Kinship } from "../../graph";
import { BY_MARRIAGE, capitalise, cousinDegree, removedCount, type KinshipPart, type KinshipRules, type KinshipView } from "./shared.ts";

type Gender = "m" | "f" | "n";

/** One noun with its gender, in the nominative and the genitive singular. */
interface Noun {
  nom: string;
  gen: string;
  g: Gender;
}
/** An adjective that follows its noun ("ojciec zastępczy"): the stem and its endings by gender, nominative and genitive. */
interface Adj {
  m: [string, string];
  f: [string, string];
  n: [string, string];
}
/** One word of a relation: its noun, adjectives that agree with it, and an invariable genitive phrase after it. */
interface Alt {
  noun: Noun;
  adjs: Adj[];
  rest: string;
}
/**
 * A Polish relation: one word, or two when the sex is open ("wujek lub ciocia"), then words that follow all of them
 * (" drugiego stopnia", " twojej żony"). `through` names someone by way of another person ("żona twojego kuzyna"), which
 * takes no possessive of its own where a plain word takes "twój/twoja".
 */
interface PlKin {
  alts: Alt[];
  tail: string;
  through?: boolean;
}

const n = (nom: string, gen: string, g: Gender): Noun => ({ nom, gen, g });
const hard = (stem: string): Adj => ({ m: [`${stem}y`, `${stem}ego`], f: [`${stem}a`, `${stem}ej`], n: [`${stem}e`, `${stem}ego`] });
/** "przyrodni": brat przyrodni, siostra przyrodnia (it ends in a soft i). */
const HALF: Adj = { m: ["przyrodni", "przyrodniego"], f: ["przyrodnia", "przyrodniej"], n: ["przyrodnie", "przyrodniego"] };
const FOSTER = hard("zastępcz");
const ADOPTIVE = hard("adopcyjn");
const ADOPTED = hard("adoptowan");

const alt = (noun: Noun, adjs: Adj[] = [], rest = ""): Alt => ({ noun, adjs, rest });
const one = (alts: Alt[], tail = ""): PlKin => ({ alts, tail });

const NOUNS = {
  ojciec: n("ojciec", "ojca", "m"),
  matka: n("matka", "matki", "f"),
  rodzic: n("rodzic", "rodzica", "m"),
  syn: n("syn", "syna", "m"),
  corka: n("córka", "córki", "f"),
  dziecko: n("dziecko", "dziecka", "n"),
  dziadek: n("dziadek", "dziadka", "m"),
  babcia: n("babcia", "babci", "f"),
  wnuk: n("wnuk", "wnuka", "m"),
  wnuczka: n("wnuczka", "wnuczki", "f"),
  brat: n("brat", "brata", "m"),
  siostra: n("siostra", "siostry", "f"),
  rodzenstwo: n("rodzeństwo", "rodzeństwa", "n"),
  wujek: n("wujek", "wujka", "m"),
  ciocia: n("ciocia", "cioci", "f"),
  bratanek: n("bratanek", "bratanka", "m"),
  siostrzeniec: n("siostrzeniec", "siostrzeńca", "m"),
  bratanica: n("bratanica", "bratanicy", "f"),
  siostrzenica: n("siostrzenica", "siostrzenicy", "f"),
  maz: n("mąż", "męża", "m"),
  zona: n("żona", "żony", "f"),
  partner: n("partner", "partnera", "m"),
  partnerka: n("partnerka", "partnerki", "f"),
  tesc: n("teść", "teścia", "m"),
  tesciowa: n("teściowa", "teściowej", "f"),
  ziec: n("zięć", "zięcia", "m"),
  synowa: n("synowa", "synowej", "f"),
  szwagier: n("szwagier", "szwagra", "m"),
  szwagierka: n("szwagierka", "szwagierki", "f"),
  ojczym: n("ojczym", "ojczyma", "m"),
  macocha: n("macocha", "macochy", "f"),
  pasierb: n("pasierb", "pasierba", "m"),
  pasierbica: n("pasierbica", "pasierbicy", "f"),
  kuzyn: n("kuzyn", "kuzyna", "m"),
  kuzynka: n("kuzynka", "kuzynki", "f"),
  powinowaty: n("powinowaty", "powinowatego", "m"),
  powinowata: n("powinowata", "powinowatej", "f"),
};
const N = NOUNS;
const m = (nn: Noun, ...adjs: Adj[]) => alt(nn, adjs);

/** English words from graph.kinship() with a single Polish word (or two, when the sex is open). */
const PL_WORDS: Record<string, PlKin> = {
  father: one([m(N.ojciec)]),
  mother: one([m(N.matka)]),
  parent: one([m(N.rodzic)]),
  son: one([m(N.syn)]),
  daughter: one([m(N.corka)]),
  child: one([m(N.dziecko)]),
  grandfather: one([m(N.dziadek)]),
  grandmother: one([m(N.babcia)]),
  grandparent: one([m(N.dziadek), m(N.babcia)]),
  grandson: one([m(N.wnuk)]),
  granddaughter: one([m(N.wnuczka)]),
  grandchild: one([m(N.wnuk), m(N.wnuczka)]),
  brother: one([m(N.brat)]),
  sister: one([m(N.siostra)]),
  sibling: one([m(N.rodzenstwo)]),
  uncle: one([m(N.wujek)]),
  aunt: one([m(N.ciocia)]),
  pibling: one([m(N.wujek), m(N.ciocia)]),
  nephew: one([m(N.bratanek), m(N.siostrzeniec)]),
  niece: one([m(N.bratanica), m(N.siostrzenica)]),
  nibling: one([alt(N.dziecko, [], " brata lub siostry")]),
  husband: one([m(N.maz)]),
  wife: one([m(N.zona)]),
  partner: one([m(N.partner), m(N.partnerka)]),
  "father-in-law": one([m(N.tesc)]),
  "mother-in-law": one([m(N.tesciowa)]),
  "parent-in-law": one([m(N.tesc), m(N.tesciowa)]),
  "son-in-law": one([m(N.ziec)]),
  "daughter-in-law": one([m(N.synowa)]),
  "child-in-law": one([m(N.ziec), m(N.synowa)]),
  "brother-in-law": one([m(N.szwagier)]),
  "sister-in-law": one([m(N.szwagierka)]),
  "sibling-in-law": one([m(N.szwagier), m(N.szwagierka)]),
  stepfather: one([m(N.ojczym)]),
  stepmother: one([m(N.macocha)]),
  stepparent: one([m(N.ojczym), m(N.macocha)]),
  stepson: one([m(N.pasierb)]),
  stepdaughter: one([m(N.pasierbica)]),
  stepchild: one([m(N.pasierb), m(N.pasierbica)]),
  stepbrother: one([alt(N.brat, [], " z nowej rodziny")]),
  stepsister: one([alt(N.siostra, [], " z nowej rodziny")]),
  stepsibling: one([alt(N.brat, [], " z nowej rodziny"), alt(N.siostra, [], " z nowej rodziny")]),
  "foster father": one([m(N.ojciec, FOSTER)]),
  "foster mother": one([m(N.matka, FOSTER)]),
  "foster parent": one([m(N.rodzic, FOSTER)]),
  "foster son": one([m(N.syn, FOSTER)]),
  "foster daughter": one([m(N.corka, FOSTER)]),
  "foster child": one([m(N.dziecko, FOSTER)]),
  "foster brother": one([m(N.brat, FOSTER)]),
  "foster sister": one([m(N.siostra, FOSTER)]),
  "foster sibling": one([m(N.brat, FOSTER), m(N.siostra, FOSTER)]),
  "adoptive father": one([m(N.ojciec, ADOPTIVE)]),
  "adoptive mother": one([m(N.matka, ADOPTIVE)]),
  "adoptive parent": one([m(N.rodzic, ADOPTIVE)]),
  "adopted son": one([m(N.syn, ADOPTED)]),
  "adopted daughter": one([m(N.corka, ADOPTED)]),
  "adopted child": one([m(N.dziecko, ADOPTED)]),
};

const STOPNIA = ["", "pierwszego", "drugiego", "trzeciego", "czwartego", "piątego", "szóstego", "siódmego", "ósmego", "dziewiątego", "dziesiątego"];
const stopnia = (d: number) => ` ${STOPNIA[d] ?? `${d}.`} stopnia`;

const POSS_NOM: Record<Gender, string> = { m: "twój", f: "twoja", n: "twoje" };
const POSS_GEN: Record<Gender, string> = { m: "twojego", f: "twojej", n: "twojego" };

/** "pra" repeated `n` times in front of a noun's two forms: prababcia, prapradziadek. Past three it counts: "4× pradziadek". */
const praNoun = (nn: Noun, count: number): Noun =>
  count <= 3 ? n("pra".repeat(count) + nn.nom, "pra".repeat(count) + nn.gen, nn.g) : n(`${count}× pra${nn.nom}`, `${count}× pra${nn.gen}`, nn.g);
const praAlt = (a: Alt, count: number): Alt => ({ ...a, noun: praNoun(a.noun, count) });
/** The ancestor `r` generations above, in the genitive: "rodzica", "dziadka lub babci", "pradziadka lub prababci". */
const ancestors = (r: number) =>
  r <= 1 ? "rodzica" : r === 2 ? "dziadka lub babci" : `${praNoun(N.dziadek, r - 2).gen} lub ${praNoun(N.babcia, r - 2).gen}`;

function renderPl(k: Kinship, view: KinshipView): PlKin {
  const words = (label: string) => PL_WORDS[label];
  const form = (a: Alt, c: "nom" | "gen") => [a.noun[c], ...a.adjs.map((j) => j[a.noun.g][c === "nom" ? 0 : 1])].join(" ") + a.rest;
  /** "twojego kuzyna lub twojej kuzynki": a relation as the owner in the genitive. */
  const of = (owner: PlKin) =>
    ` ${owner.alts
      .map((a, i) => {
        const poss = view === "you" && !owner.through && (i === 0 || owner.alts[i - 1].noun.g !== a.noun.g);
        return `${poss ? `${POSS_GEN[a.noun.g]} ` : ""}${form(a, "gen")}`;
      })
      .join(" lub ")}${owner.tail}`;
  const spouseWord = (sex: "m" | "f" | undefined) => words(sex === "m" ? "husband" : sex === "f" ? "wife" : "partner");
  const prefixHalf = (kin: PlKin) => ({ ...kin, alts: kin.alts.map((a) => ({ ...a, adjs: [HALF, ...a.adjs] })) });

  const render = (label: string): PlKin => {
    const word = words(label);
    if (word) return word;
    if (label === BY_MARRIAGE) return one(k.sex === "m" ? [m(N.powinowaty)] : k.sex === "f" ? [m(N.powinowata)] : [m(N.powinowaty), m(N.powinowata)]);
    // A tie through a marriage first, so "great-uncle's wife" is not read as a "great-" word.
    const spouse = label.match(/^(.+)'s (husband|wife|partner)$/);
    if (spouse) return { alts: render(spouse[2]).alts, tail: of(render(spouse[1])), through: true };
    const theirs = label.match(/^(husband|wife|partner)'s (.+)$/);
    if (theirs) {
      const rel = render(theirs[2]);
      return { alts: rel.alts, tail: `${rel.tail}${of(render(theirs[1]))}`, through: true };
    }
    // Anyone else named through another person, the last first: "brat twojego ojczyma", "pasierb twojej siostry".
    const through = label.match(/^(.+)'s (.+)$/);
    if (through) {
      const rel = render(through[2]);
      return { alts: rel.alts, tail: `${rel.tail}${of(render(through[1]))}`, through: true };
    }
    // A grandparent or grandchild by a stepparent: "dziadek z nowej rodziny".
    if (label.startsWith("step-")) {
      const rel = render(label.slice(5));
      return { ...rel, tail: `${rel.tail} z nowej rodziny` };
    }
    const cousin = label.match(/^(half-)?(?:(\w+|\d+th) )?cousin(?: (once|twice|\d+ times) removed)?$/);
    if (cousin) {
      const degree = cousinDegree(cousin[2]);
      const removed = removedCount(cousin[3]);
      const sex = k.cousin?.sex;
      const up = k.cousin?.up;
      const deg = degree > 1 ? stopnia(degree) : "";
      const pick = (nm: Noun, nf: Noun, rest = "") => (sex === "m" ? [alt(nm, [], rest)] : sex === "f" ? [alt(nf, [], rest)] : [alt(nm, [], rest), alt(nf, [], rest)]);
      let kin: PlKin;
      if (removed && up && up > 0) {
        // A parent's cousin: "kuzyn rodzica", "kuzynka dziadka lub babci".
        kin = one(pick(N.kuzyn, N.kuzynka), `${deg} ${ancestors(removed)}`);
      } else if (removed && up && up < 0) {
        // A cousin's child: "syn kuzyna lub kuzynki", "wnuczka kuzyna lub kuzynki drugiego stopnia".
        const kids = removed === 1 ? pick(N.syn, N.corka) : pick(praNoun(N.wnuk, Math.max(removed - 2, 0)), praNoun(N.wnuczka, Math.max(removed - 2, 0)));
        kin = one(kids.map((a) => ({ ...a, rest: " kuzyna lub kuzynki" })), deg);
      } else {
        kin = one(pick(N.kuzyn, N.kuzynka), `${deg}${removed ? `, ${removed === 1 ? "jedno pokolenie" : removed < 5 ? `${removed} pokolenia` : `${removed} pokoleń`} różnicy` : ""}`);
      }
      return cousin[1] ? prefixHalf(kin) : kin;
    }
    const great = label.match(/^(?:(\d+)× )?great-(half-)?(.+)$/);
    if (great) {
      const count = Number(great[1] ?? 1);
      const base = great[3];
      const halfed = (kin: PlKin) => (great[2] ? prefixHalf(kin) : kin);
      if (/^grand(father|mother|parent)$/.test(base)) {
        const kin = render(base);
        return halfed({ ...kin, alts: kin.alts.map((a) => praAlt(a, count)) });
      }
      if (/^grand(son|daughter|child)$/.test(base)) {
        const kin = render(base);
        return halfed({ ...kin, alts: kin.alts.map((a) => praAlt(a, count)) });
      }
      // A great-uncle is a grandparent's brother: "brat dziadka lub babci", "siostra pradziadka lub prababci".
      if (/^(uncle|aunt|pibling)$/.test(base)) {
        const anc = ancestors(count + 1);
        const heads = base === "uncle" ? [N.brat] : base === "aunt" ? [N.siostra] : [N.brat, N.siostra];
        return halfed(one(heads.map((h) => alt(h, [], ` ${anc}`))));
      }
      // A great-nephew is a sibling's grandchild: "wnuk brata lub siostry", "prawnuk brata lub siostry".
      if (/^(nephew|niece|nibling)$/.test(base)) {
        const heads =
          base === "nephew" ? [praNoun(N.wnuk, count - 1)] : base === "niece" ? [praNoun(N.wnuczka, count - 1)] : [praNoun(N.wnuk, count - 1), praNoun(N.wnuczka, count - 1)];
        return halfed(one(heads.map((h) => alt(h, [], " brata lub siostry"))));
      }
      return halfed(render(base));
    }
    if (label.startsWith("half-")) return prefixHalf(render(label.slice(5)));
    // Any other relative of your partner: "dziadek twojej żony".
    if (label.endsWith("-in-law")) {
      const rel = render(label.slice(0, -7));
      return { alts: rel.alts, tail: `${rel.tail}${of(spouseWord(k.spouse))}`, through: true };
    }
    return one([alt(n(label, label, "m"))]);
  };
  return render(k.label);
}

const phrase = (kin: PlKin, c: "nom") => {
  const parts = kin.alts.map((a) => [a.noun[c], ...a.adjs.map((j) => j[a.noun.g][0])].join(" ") + a.rest);
  return { parts, alts: kin.alts };
};

const words = (k: Kinship, view: KinshipView) => {
  const kin = renderPl(k, view);
  return phrase(kin, "nom").parts.join(" lub ") + kin.tail;
};

function yourParts(k: Kinship): KinshipPart[] {
  const kin = renderPl(k, "you");
  const { parts, alts } = phrase(kin, "nom");
  const out: KinshipPart[] = [];
  parts.forEach((text, i) => {
    const first = i === 0;
    const poss = !kin.through && (first || alts[i - 1].noun.g !== alts[i].noun.g);
    const lead = poss ? `${POSS_NOM[alts[i].noun.g]} ` : "";
    out.push({ text: `${first ? "" : " lub "}${first ? capitalise(lead) : lead}` });
    out.push({ text: kin.through && first ? capitalise(text) : text, kin: true });
  });
  if (kin.tail) out.push({ text: kin.tail, kin: true });
  return out.filter((p) => p.text !== "");
}

const pl: KinshipRules = {
  label: (k, view) => (k.label === "you" ? "ty" : words(k, view)),
  your(list) {
    const phraseOf = (x: Kinship) => yourParts(x).map((p) => p.text).join("");
    return [...new Set(list.map((x) => (x.label === "you" ? "ty" : phraseOf(x).charAt(0).toLowerCase() + phraseOf(x).slice(1))))].join(" & ");
  },
  yourParts,
};
export default pl;
