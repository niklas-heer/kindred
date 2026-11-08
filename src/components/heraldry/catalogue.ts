// The charge catalogue: every charge the arms editor offers, with its label, category, search words and
// where its drawing comes from. Classic shapes (mullet, annulet, crosses …) are drawn in classic.ts; the rest
// are game-icons.net glyphs (Lorc, Delapouite and contributors, CC BY 3.0).
//
// Pure data with no imports, so scripts/extract-icons.ts can read it: that script extracts exactly the glyphs
// named here. `core` glyphs ship in the main bundle (the v1 charges every old shield uses). The rest of these
// charges, and the library of charges added since (library/charges.gen.ts, from scripts/charge-library.tsv), load
// on demand: see registry.ts for the charges of both, and art.ts for their drawings.

import type { Key } from '~/lib/i18n/dictionary';

export type ChargeCategory =
  | 'classic' | 'crosses' | 'beasts' | 'birds' | 'sea' | 'monsters' | 'plants' | 'celestial' | 'weapons' | 'tools'
  | 'buildings' | 'crowns' | 'objects' | 'faith' | 'body' | 'music';

/** A charge's name in each language. The library's charges carry theirs here, not in the i18n dictionary. */
export interface ChargeNames {
  en: string;
  de: string;
  af: string;
}

export interface ChargeDef {
  id: string;
  /** The i18n key of the label ("heraldry.charge.<id>"); the blazon speaks it in English. The first charges have one. */
  label?: Key;
  /** The name in each language, for the library's charges (see library/charges.gen.ts). Exactly one of label and name is set. */
  name?: ChargeNames;
  cat: ChargeCategory;
  /** The game-icons glyph. Absent: a classic shape from classic.ts. */
  gi?: string;
  /** In the main bundle, because v1 arms or the app's badges use it. */
  core?: boolean;
  /** Irregular plural, for the blazon ("fleurs-de-lis"). */
  plural?: string;
  /** More words to search by, including German. */
  keys?: string;
  /** Its colour when blazoned "proper". */
  proper?: string;
  /** It faces one way (most glyphs face the viewer's right), so contourné means something. */
  facing?: boolean;
}

export const CATEGORIES: { id: ChargeCategory; label: Key }[] = [
  { id: 'classic', label: 'heraldry.category.classic' },
  { id: 'crosses', label: 'heraldry.category.crosses' },
  { id: 'beasts', label: 'heraldry.category.beasts' },
  { id: 'birds', label: 'heraldry.category.birds' },
  { id: 'sea', label: 'heraldry.category.sea' },
  { id: 'monsters', label: 'heraldry.category.monsters' },
  { id: 'plants', label: 'heraldry.category.plants' },
  { id: 'celestial', label: 'heraldry.category.celestial' },
  { id: 'weapons', label: 'heraldry.category.weapons' },
  { id: 'tools', label: 'heraldry.category.tools' },
  { id: 'buildings', label: 'heraldry.category.buildings' },
  { id: 'crowns', label: 'heraldry.category.crowns' },
  { id: 'objects', label: 'heraldry.category.objects' },
  { id: 'faith', label: 'heraldry.category.faith' },
  { id: 'body', label: 'heraldry.category.body' },
  { id: 'music', label: 'heraldry.category.music' },
];

const BROWN = '#8a5a32';
const GREEN = '#4c7a36';
const GREY = '#8e8e88';

export const CHARGES_V2: ChargeDef[] = [
  // ---- classic shapes, drawn by hand ----
  { id: 'mullet', label: 'heraldry.charge.mullet', cat: 'classic', keys: 'star stern', proper: '#d4a53c' },
  { id: 'mullet-six', label: 'heraldry.charge.mullet-six', cat: 'classic', keys: 'star six stern', proper: '#d4a53c' },
  { id: 'estoile', label: 'heraldry.charge.estoile', cat: 'classic', keys: 'star wavy stern', proper: '#d4a53c' },
  { id: 'crescent', label: 'heraldry.charge.crescent', cat: 'classic', keys: 'moon halbmond mond', proper: '#e8e6df' },
  { id: 'roundel', label: 'heraldry.charge.roundel', cat: 'classic', keys: 'bezant plate torteau ball kugel scheibe' },
  { id: 'annulet', label: 'heraldry.charge.annulet', cat: 'classic', keys: 'ring circle' },
  { id: 'lozenge', label: 'heraldry.charge.lozenge', cat: 'classic', keys: 'diamond raute' },
  { id: 'mascle', label: 'heraldry.charge.mascle', cat: 'classic', keys: 'voided lozenge diamond' },
  { id: 'fusil', label: 'heraldry.charge.fusil', cat: 'classic', keys: 'spindle diamond' },
  { id: 'billet', label: 'heraldry.charge.billet', cat: 'classic', keys: 'brick rectangle schindel' },
  { id: 'heart', label: 'heraldry.charge.heart', cat: 'classic', keys: 'herz love', proper: '#b3312c' },
  { id: 'escutcheon', label: 'heraldry.charge.escutcheon', cat: 'classic', keys: 'inescutcheon shield schild' },
  { id: 'fleur', label: 'heraldry.charge.fleur', cat: 'classic', gi: 'fleur-de-lys', core: true, plural: 'fleurs-de-lis', keys: 'lily lilie fleur de lys' },
  { id: 'trimount', label: 'heraldry.charge.trimount', cat: 'celestial', keys: 'mount hill berg dreiberg mountain', proper: GREEN },
  { id: 'mill-wheel', label: 'heraldry.charge.mill-wheel', cat: 'tools', keys: 'mühlrad muehlrad miller müller wheel', proper: BROWN },
  { id: 'mill-rind', label: 'heraldry.charge.mill-rind', cat: 'tools', keys: 'fer de moline mühleisen miller', proper: GREY },
  { id: 'gouttes', label: 'heraldry.charge.gouttes', cat: 'classic', keys: 'drop tropfen water', plural: 'gouttes' },

  // ---- crosses ----
  { id: 'cross-crosslet', label: 'heraldry.charge.cross-crosslet', cat: 'crosses', plural: 'crosses crosslet', keys: 'kreuz' },
  { id: 'cross-moline', label: 'heraldry.charge.cross-moline', cat: 'crosses', plural: 'crosses moline', keys: 'kreuz miller ankerkreuz' },
  { id: 'cross-patee', label: 'heraldry.charge.cross-patee', cat: 'crosses', plural: 'crosses pattée', keys: 'kreuz tatzenkreuz paty' },
  { id: 'cross-potent', label: 'heraldry.charge.cross-potent', cat: 'crosses', plural: 'crosses potent', keys: 'kreuz krückenkreuz' },
  { id: 'cross-humetty', label: 'heraldry.charge.cross-humetty', cat: 'crosses', plural: 'crosses couped', keys: 'kreuz plain greek' },
  { id: 'jerusalem-cross', label: 'heraldry.charge.jerusalem-cross', cat: 'crosses', gi: 'jerusalem-cross', plural: 'Jerusalem crosses', keys: 'kreuz' },
  { id: 'cross-iron', label: 'heraldry.charge.cross-iron', cat: 'crosses', gi: 'iron-cross', plural: 'crosses formy', keys: 'kreuz iron eisernes' },
  { id: 'camargue-cross', label: 'heraldry.charge.camargue-cross', cat: 'crosses', gi: 'camargue-cross', plural: 'mariner’s crosses', keys: 'anchor heart kreuz' },

  // ---- beasts ----
  { id: 'lion', label: 'heraldry.charge.lion', cat: 'beasts', gi: 'lion', core: true, plural: 'lions’ heads', keys: 'löwe lion leo', proper: '#c08a3e', facing: true },
  { id: 'wolf', label: 'heraldry.charge.wolf', cat: 'beasts', gi: 'wolf-head', plural: 'wolves’ heads', keys: 'wolf wölfe', proper: GREY, facing: true },
  { id: 'wolf-erased', label: 'heraldry.charge.wolf-erased', cat: 'beasts', gi: 'direwolf', plural: 'wolves’ heads erased', keys: 'wolf', proper: GREY, facing: true },
  { id: 'bear', label: 'heraldry.charge.bear', cat: 'beasts', gi: 'bear-head', plural: 'bears’ heads', keys: 'bär baer bear bjørn björn', proper: BROWN, facing: true },
  { id: 'bear-passant', label: 'heraldry.charge.bear-passant', cat: 'beasts', gi: 'polar-bear', plural: 'bears passant', keys: 'bär baer bjørn björn', proper: BROWN, facing: true },
  { id: 'boar', label: 'heraldry.charge.boar', cat: 'beasts', gi: 'boar', core: true, keys: 'eber schwein swine', proper: '#5a4632', facing: true },
  { id: 'stag', label: 'heraldry.charge.stag', cat: 'beasts', gi: 'stag-head', core: true, plural: 'stags’ heads', keys: 'hirsch hirsch deer hjort', proper: BROWN },
  { id: 'deer', label: 'heraldry.charge.deer', cat: 'beasts', gi: 'deer', keys: 'hirsch deer hart hjort reh', proper: BROWN, facing: true },
  { id: 'horse', label: 'heraldry.charge.horse', cat: 'beasts', gi: 'horse-head', plural: 'horses’ heads', keys: 'pferd ross hest häst', proper: BROWN, facing: true },
  { id: 'bull', label: 'heraldry.charge.bull', cat: 'beasts', gi: 'bull', plural: 'bulls’ heads', keys: 'stier ochse ox rind', proper: BROWN },
  { id: 'bull-charging', label: 'heraldry.charge.bull-charging', cat: 'beasts', gi: 'charging-bull', keys: 'stier ochse ox', proper: BROWN, facing: true },
  { id: 'ram', label: 'heraldry.charge.ram', cat: 'beasts', gi: 'ram', keys: 'widder bock', proper: '#d8d0bc', facing: true },
  { id: 'goat', label: 'heraldry.charge.goat', cat: 'beasts', gi: 'goat', keys: 'ziege geiß bock', proper: '#d8d0bc', facing: true },
  { id: 'sheep', label: 'heraldry.charge.sheep', cat: 'beasts', gi: 'sheep', keys: 'schaf lamb lamm', proper: '#e8e2d0', facing: true },
  { id: 'hound', label: 'heraldry.charge.hound', cat: 'beasts', gi: 'hound', keys: 'hund dog talbot', proper: BROWN, facing: true },
  { id: 'dog-sejant', label: 'heraldry.charge.dog-sejant', cat: 'beasts', gi: 'sitting-dog', plural: 'dogs sejant', keys: 'hund dog', proper: BROWN, facing: true },
  { id: 'fox', label: 'heraldry.charge.fox', cat: 'beasts', gi: 'fox', plural: 'foxes', keys: 'fuchs fuchs reynard räv', proper: '#c8692b', facing: true },
  { id: 'hare', label: 'heraldry.charge.hare', cat: 'beasts', gi: 'rabbit', keys: 'hase kaninchen rabbit', proper: BROWN, facing: true },
  { id: 'squirrel', label: 'heraldry.charge.squirrel', cat: 'beasts', gi: 'squirrel', keys: 'eichhörnchen', proper: '#a0522d', facing: true },
  { id: 'beaver', label: 'heraldry.charge.beaver', cat: 'beasts', gi: 'beaver', keys: 'biber', proper: BROWN, facing: true },
  { id: 'badger', label: 'heraldry.charge.badger', cat: 'beasts', gi: 'badger', plural: 'badgers’ heads', keys: 'dachs brock', proper: GREY },
  { id: 'hedgehog', label: 'heraldry.charge.hedgehog', cat: 'beasts', gi: 'hedgehog', keys: 'igel urchin', proper: BROWN, facing: true },
  { id: 'cat', label: 'heraldry.charge.cat', cat: 'beasts', gi: 'cat', keys: 'katze', proper: GREY, facing: true },
  { id: 'elephant', label: 'heraldry.charge.elephant', cat: 'beasts', gi: 'elephant', keys: 'elefant', proper: GREY, facing: true },
  { id: 'camel', label: 'heraldry.charge.camel', cat: 'beasts', gi: 'camel', keys: 'kamel', proper: '#c49a5c', facing: true },
  { id: 'mouse', label: 'heraldry.charge.mouse', cat: 'beasts', gi: 'mouse', plural: 'mice', keys: 'maus', proper: GREY, facing: true },
  { id: 'frog', label: 'heraldry.charge.frog', cat: 'beasts', gi: 'frog', keys: 'frosch', proper: GREEN },
  { id: 'tortoise', label: 'heraldry.charge.tortoise', cat: 'beasts', gi: 'turtle', plural: 'tortoises', keys: 'schildkröte turtle', proper: GREEN },
  { id: 'serpent', label: 'heraldry.charge.serpent', cat: 'beasts', gi: 'snake', keys: 'schlange snake', proper: GREEN },
  { id: 'bee', label: 'heraldry.charge.bee', cat: 'beasts', gi: 'bee', keys: 'biene imker', proper: '#d4a53c' },
  { id: 'bat', label: 'heraldry.charge.bat', cat: 'beasts', gi: 'bat', keys: 'fledermaus', proper: '#26241f' },
  { id: 'scorpion', label: 'heraldry.charge.scorpion', cat: 'beasts', gi: 'scorpion', keys: 'skorpion', proper: BROWN },
  { id: 'beetle', label: 'heraldry.charge.beetle', cat: 'beasts', gi: 'scarab-beetle', keys: 'käfer scarab', proper: '#26241f' },

  // ---- birds ----
  { id: 'eagle', label: 'heraldry.charge.eagle', cat: 'birds', gi: 'eagle-emblem', core: true, plural: 'eagles displayed', keys: 'adler aar eagle örn ørn arend', proper: '#5a4632' },
  { id: 'eagle-head', label: 'heraldry.charge.eagle-head', cat: 'birds', gi: 'eagle-head', plural: 'eagles’ heads', keys: 'adler aar', proper: '#5a4632', facing: true },
  { id: 'hawk', label: 'heraldry.charge.hawk', cat: 'birds', gi: 'hawk-emblem', plural: 'falcons displayed', keys: 'falke habicht hawk', proper: BROWN },
  { id: 'raven', label: 'heraldry.charge.raven', cat: 'birds', gi: 'raven', keys: 'rabe krähe crow corbie', proper: '#26241f', facing: true },
  { id: 'owl', label: 'heraldry.charge.owl', cat: 'birds', gi: 'owl', keys: 'eule kauz', proper: BROWN },
  { id: 'barn-owl', label: 'heraldry.charge.barn-owl', cat: 'birds', gi: 'barn-owl', keys: 'eule schleiereule', proper: '#c49a5c' },
  { id: 'dove', label: 'heraldry.charge.dove', cat: 'birds', gi: 'dove', keys: 'taube', proper: '#e8e6df', facing: true },
  { id: 'dove-olive', label: 'heraldry.charge.dove-olive', cat: 'birds', gi: 'peace-dove', plural: 'doves with olive', keys: 'taube friede peace', proper: '#e8e6df', facing: true },
  { id: 'swan', label: 'heraldry.charge.swan', cat: 'birds', gi: 'swan', keys: 'schwan svan zwaan', proper: '#e8e6df', facing: true },
  { id: 'cock', label: 'heraldry.charge.cock', cat: 'birds', gi: 'rooster', keys: 'hahn rooster hane haan', proper: '#b3312c', facing: true },
  { id: 'duck', label: 'heraldry.charge.duck', cat: 'birds', gi: 'duck', keys: 'ente', proper: BROWN, facing: true },
  { id: 'goose', label: 'heraldry.charge.goose', cat: 'birds', gi: 'canadian-goose', plural: 'geese', keys: 'gans', proper: GREY, facing: true },
  { id: 'heron', label: 'heraldry.charge.heron', cat: 'birds', gi: 'heron', keys: 'reiher crane kranich', proper: GREY, facing: true },
  { id: 'pelican', label: 'heraldry.charge.pelican', cat: 'birds', gi: 'eating-pelican', keys: 'pelikan piety', proper: '#e8e6df', facing: true },
  { id: 'sparrow', label: 'heraldry.charge.sparrow', cat: 'birds', gi: 'sparrow', keys: 'spatz sperling martlet fink finch vogel', proper: BROWN, facing: true },
  { id: 'hummingbird', label: 'heraldry.charge.hummingbird', cat: 'birds', gi: 'hummingbird', keys: 'kolibri', proper: GREEN, facing: true },
  { id: 'ostrich', label: 'heraldry.charge.ostrich', cat: 'birds', gi: 'ostrich', plural: 'ostriches', keys: 'strauß strauss', proper: GREY, facing: true },

  // ---- fish and the sea ----
  { id: 'fish', label: 'heraldry.charge.fish', cat: 'sea', gi: 'salmon', plural: 'fish', keys: 'fisch salmon lachs fisher fischer fisk vis', proper: '#6a8fa8', facing: true },
  { id: 'fish-pair', label: 'heraldry.charge.fish-pair', cat: 'sea', gi: 'double-fish', plural: 'pairs of fish', keys: 'fisch barbel', proper: '#6a8fa8' },
  { id: 'fish-circling', label: 'heraldry.charge.fish-circling', cat: 'sea', gi: 'circling-fish', plural: 'pairs of fish in annulo', keys: 'fisch', proper: '#6a8fa8' },
  { id: 'flatfish', label: 'heraldry.charge.flatfish', cat: 'sea', gi: 'flatfish', plural: 'flatfish', keys: 'scholle butt', proper: '#c49a5c', facing: true },
  { id: 'dolphin', label: 'heraldry.charge.dolphin', cat: 'sea', gi: 'dolphin', keys: 'delfin delphin', proper: '#6a8fa8', facing: true },
  { id: 'whale', label: 'heraldry.charge.whale', cat: 'sea', gi: 'sperm-whale', keys: 'wal', proper: '#2d5aa0', facing: true },
  { id: 'crab', label: 'heraldry.charge.crab', cat: 'sea', gi: 'crab', keys: 'krebs krabbe', proper: '#b3312c' },
  { id: 'escallop', label: 'heraldry.charge.escallop', cat: 'sea', gi: 'scallop', keys: 'muschel scallop shell jakobsmuschel', proper: '#e8d8b8' },
  { id: 'starfish', label: 'heraldry.charge.starfish', cat: 'sea', gi: 'sea-star', plural: 'starfish', keys: 'seestern', proper: '#c8692b' },
  { id: 'seahorse', label: 'heraldry.charge.seahorse', cat: 'sea', gi: 'seahorse', keys: 'seepferdchen', proper: '#c49a5c', facing: true },
  { id: 'nautilus', label: 'heraldry.charge.nautilus', cat: 'sea', gi: 'nautilus-shell', keys: 'schnecke shell', proper: '#e8d8b8' },
  { id: 'waves', label: 'heraldry.charge.waves', cat: 'sea', gi: 'waves', plural: 'waves', keys: 'wellen ström strom stream river fluss bach water wasser', proper: '#2d5aa0' },
  { id: 'wave', label: 'heraldry.charge.wave', cat: 'sea', gi: 'big-wave', keys: 'welle see meer sea', proper: '#2d5aa0' },
  { id: 'anchor', label: 'heraldry.charge.anchor', cat: 'sea', gi: 'anchor', keys: 'anker sailor', proper: GREY },
  { id: 'ship', label: 'heraldry.charge.ship', cat: 'sea', gi: 'shooner-sailboat', keys: 'schiff lymphad boot', proper: BROWN, facing: true },
  { id: 'boat', label: 'heraldry.charge.boat', cat: 'sea', gi: 'sailboat', keys: 'boot segel', proper: BROWN, facing: true },
  { id: 'longship', label: 'heraldry.charge.longship', cat: 'sea', gi: 'drakkar-dragon', keys: 'viking drakkar wikinger', proper: BROWN, facing: true },

  // ---- monsters ----
  { id: 'griffin', label: 'heraldry.charge.griffin', cat: 'monsters', gi: 'griffin-symbol', keys: 'greif gryphon griffon', proper: '#d4a53c', facing: true },
  { id: 'dragon', label: 'heraldry.charge.dragon', cat: 'monsters', gi: 'dragon-head', plural: 'dragons’ heads', keys: 'drache lindwurm', proper: GREEN, facing: true },
  { id: 'wyvern', label: 'heraldry.charge.wyvern', cat: 'monsters', gi: 'wyvern', keys: 'drache lindwurm', proper: GREEN },
  { id: 'unicorn', label: 'heraldry.charge.unicorn', cat: 'monsters', gi: 'unicorn', plural: 'unicorns’ heads', keys: 'einhorn', proper: '#e8e6df', facing: true },
  { id: 'pegasus', label: 'heraldry.charge.pegasus', cat: 'monsters', gi: 'pegasus', plural: 'pegasi', keys: 'flügelpferd winged horse', proper: '#e8e6df', facing: true },
  { id: 'hydra', label: 'heraldry.charge.hydra', cat: 'monsters', gi: 'hydra', keys: 'drache', proper: GREEN, facing: true },
  { id: 'mermaid', label: 'heraldry.charge.mermaid', cat: 'monsters', gi: 'mermaid', keys: 'meerjungfrau nixe', proper: '#6a8fa8', facing: true },
  { id: 'centaur', label: 'heraldry.charge.centaur', cat: 'monsters', gi: 'centaur', keys: 'kentaur sagittary', proper: BROWN, facing: true },
  { id: 'sea-serpent', label: 'heraldry.charge.sea-serpent', cat: 'monsters', gi: 'sea-serpent', keys: 'seeschlange', proper: GREEN, facing: true },
  { id: 'sea-dragon', label: 'heraldry.charge.sea-dragon', cat: 'monsters', gi: 'sea-dragon', keys: 'seedrache', proper: GREEN, facing: true },
  { id: 'harpy', label: 'heraldry.charge.harpy', cat: 'monsters', gi: 'harpy', plural: 'harpies', keys: 'harpyie', proper: BROWN },
  { id: 'wolf-rampant', label: 'heraldry.charge.wolf-rampant', cat: 'monsters', gi: 'werewolf', plural: 'wolves rampant', keys: 'wolf werwolf', proper: GREY, facing: true },
  { id: 'double-dragon', label: 'heraldry.charge.double-dragon', cat: 'monsters', gi: 'double-dragon', plural: 'pairs of dragons’ heads', keys: 'drache', proper: GREEN },

  // ---- plants ----
  { id: 'rose', label: 'heraldry.charge.rose', cat: 'plants', gi: 'rose', core: true, keys: 'rose rosen', proper: '#b3312c' },
  { id: 'rose-slipped', label: 'heraldry.charge.rose-slipped', cat: 'plants', gi: 'shut-rose', plural: 'roses slipped', keys: 'rose stem', proper: '#b3312c' },
  { id: 'lily', label: 'heraldry.charge.lily', cat: 'plants', gi: 'trefoil-lily', plural: 'lilies', keys: 'lilie', proper: '#e8e6df' },
  { id: 'oak', label: 'heraldry.charge.oak', cat: 'plants', gi: 'oak', keys: 'eiche eichbaum ek eik tree baum', proper: GREEN },
  { id: 'pine', label: 'heraldry.charge.pine', cat: 'plants', gi: 'pine-tree', keys: 'tanne fichte kiefer fir tree baum gran', proper: '#2f5a36' },
  { id: 'linden', label: 'heraldry.charge.linden', cat: 'plants', gi: 'beech', keys: 'linde lind lime tree baum buche beech', proper: GREEN },
  { id: 'willow', label: 'heraldry.charge.willow', cat: 'plants', gi: 'willow-tree', keys: 'weide tree baum', proper: GREEN },
  { id: 'birch', label: 'heraldry.charge.birch', cat: 'plants', gi: 'birch-trees', plural: 'clumps of birches', keys: 'birke björk bjørk tree', proper: '#e8e6df' },
  { id: 'apple-tree', label: 'heraldry.charge.apple-tree', cat: 'plants', gi: 'fruit-tree', keys: 'apfelbaum obstbaum orchard', proper: GREEN },
  { id: 'palm', label: 'heraldry.charge.palm', cat: 'plants', gi: 'palm-tree', keys: 'palme', proper: GREEN },
  { id: 'linden-leaf', label: 'heraldry.charge.linden-leaf', cat: 'plants', gi: 'linden-leaf', plural: 'linden leaves', keys: 'lindenblatt lind leaf blatt seeblatt', proper: GREEN },
  { id: 'oak-leaf', label: 'heraldry.charge.oak-leaf', cat: 'plants', gi: 'oak-leaf', plural: 'oak leaves', keys: 'eichenblatt eiche', proper: GREEN },
  { id: 'maple-leaf', label: 'heraldry.charge.maple-leaf', cat: 'plants', gi: 'maple-leaf', plural: 'maple leaves', keys: 'ahorn', proper: '#b3312c' },
  { id: 'acorn', label: 'heraldry.charge.acorn', cat: 'plants', gi: 'acorn', keys: 'eichel', proper: BROWN },
  { id: 'wheat', label: 'heraldry.charge.wheat', cat: 'plants', gi: 'wheat', plural: 'sheaves of ears', keys: 'weizen ähre korn grain feld field farmer bauer', proper: '#d4a53c' },
  { id: 'garb', label: 'heraldry.charge.garb', cat: 'plants', gi: 'grain-bundle', keys: 'garbe sheaf wheat bauer farmer feld field', proper: '#d4a53c' },
  { id: 'grapes', label: 'heraldry.charge.grapes', cat: 'plants', gi: 'grapes', plural: 'bunches of grapes', keys: 'traube wein vine winzer', proper: '#7b3f7f' },
  { id: 'apple', label: 'heraldry.charge.apple', cat: 'plants', gi: 'shiny-apple', keys: 'apfel', proper: '#b3312c' },
  { id: 'pear', label: 'heraldry.charge.pear', cat: 'plants', gi: 'pear', keys: 'birne', proper: '#c8b23c' },
  { id: 'cherries', label: 'heraldry.charge.cherries', cat: 'plants', gi: 'cherry', plural: 'pairs of cherries', keys: 'kirsche', proper: '#b3312c' },
  { id: 'hops', label: 'heraldry.charge.hops', cat: 'plants', gi: 'hops', keys: 'hopfen brewer brauer', proper: GREEN },
  { id: 'trefoil', label: 'heraldry.charge.trefoil', cat: 'plants', gi: 'shamrock', keys: 'klee shamrock clover', proper: GREEN },
  { id: 'quatrefoil', label: 'heraldry.charge.quatrefoil', cat: 'plants', gi: 'clover', keys: 'vierpass clover klee' },
  { id: 'cinquefoil', label: 'heraldry.charge.cinquefoil', cat: 'plants', gi: 'flower-emblem', keys: 'fünfblatt flower blume' },
  { id: 'sunflower', label: 'heraldry.charge.sunflower', cat: 'plants', gi: 'sunflower', keys: 'sonnenblume', proper: '#d4a53c' },
  { id: 'lotus', label: 'heraldry.charge.lotus', cat: 'plants', gi: 'lotus-flower', keys: 'seerose', proper: '#e8a0b0' },
  { id: 'fern', label: 'heraldry.charge.fern', cat: 'plants', gi: 'fern', keys: 'farn', proper: GREEN },
  { id: 'reeds', label: 'heraldry.charge.reeds', cat: 'plants', gi: 'reed', plural: 'clumps of bulrushes', keys: 'schilf reed rohr', proper: GREEN },
  { id: 'vine-leaf', label: 'heraldry.charge.vine-leaf', cat: 'plants', gi: 'vine-leaf', plural: 'vine leaves', keys: 'weinblatt', proper: GREEN },
  { id: 'branch', label: 'heraldry.charge.branch', cat: 'plants', gi: 'tree-branch', plural: 'branches', keys: 'zweig ast', proper: GREEN },

  // ---- sky and land ----
  { id: 'sun', label: 'heraldry.charge.sun', cat: 'celestial', gi: 'heraldic-sun', plural: 'suns in splendour', keys: 'sonne sol zon', proper: '#d4a53c' },
  { id: 'sun-rays', label: 'heraldry.charge.sun-rays', cat: 'celestial', gi: 'sun', keys: 'sonne sol', proper: '#d4a53c' },
  { id: 'moon', label: 'heraldry.charge.moon', cat: 'celestial', gi: 'moon', core: true, keys: 'mond moon', proper: '#e8e6df' },
  { id: 'star-north', label: 'heraldry.charge.star-north', cat: 'celestial', gi: 'polar-star', keys: 'nordstern stern star', proper: '#d4a53c' },
  { id: 'lightning', label: 'heraldry.charge.lightning', cat: 'celestial', gi: 'focused-lightning', keys: 'blitz donner', proper: '#d4a53c' },
  { id: 'flame', label: 'heraldry.charge.flame', cat: 'celestial', gi: 'flame', keys: 'flamme feuer fire brand', proper: '#c8692b' },
  { id: 'fire', label: 'heraldry.charge.fire', cat: 'celestial', gi: 'fire', keys: 'feuer flamme', proper: '#c8692b' },
  { id: 'drop', label: 'heraldry.charge.drop', cat: 'celestial', gi: 'water-drop', keys: 'tropfen water wasser', proper: '#2d5aa0' },
  { id: 'rock', label: 'heraldry.charge.rock', cat: 'celestial', gi: 'rock', keys: 'stein fels rock stone sten steen', proper: GREY },
  { id: 'stone', label: 'heraldry.charge.stone', cat: 'celestial', gi: 'stone-block', keys: 'stein quader block', proper: GREY },
  { id: 'snowflake', label: 'heraldry.charge.snowflake', cat: 'celestial', gi: 'snowflake-2', keys: 'schneeflocke schnee', proper: '#e8e6df' },

  // ---- weapons ----
  { id: 'sword', label: 'heraldry.charge.sword', cat: 'weapons', gi: 'broadsword', core: true, keys: 'schwert', proper: GREY },
  { id: 'swords-crossed', label: 'heraldry.charge.swords-crossed', cat: 'weapons', gi: 'crossed-swords', plural: 'pairs of swords in saltire', keys: 'schwerter', proper: GREY },
  { id: 'axe', label: 'heraldry.charge.axe', cat: 'weapons', gi: 'battle-axe', keys: 'axt beil', proper: GREY },
  { id: 'war-axe', label: 'heraldry.charge.war-axe', cat: 'weapons', gi: 'war-axe', keys: 'axt beil', proper: GREY },
  { id: 'spears', label: 'heraldry.charge.spears', cat: 'weapons', gi: 'spears', plural: 'sheaves of spears', keys: 'speer lanze', proper: GREY },
  { id: 'bow', label: 'heraldry.charge.bow', cat: 'weapons', gi: 'bow-arrow', plural: 'bows and arrows', keys: 'bogen pfeil archer', proper: BROWN },
  { id: 'crossbow', label: 'heraldry.charge.crossbow', cat: 'weapons', gi: 'crossbow', keys: 'armbrust', proper: BROWN },
  { id: 'halberd', label: 'heraldry.charge.halberd', cat: 'weapons', gi: 'halberd', keys: 'hellebarde', proper: GREY },
  { id: 'mace', label: 'heraldry.charge.mace', cat: 'weapons', gi: 'flanged-mace', keys: 'streitkolben', proper: GREY },
  { id: 'flail', label: 'heraldry.charge.flail', cat: 'weapons', gi: 'flail', keys: 'flegel dreschflegel', proper: GREY },
  { id: 'trident', label: 'heraldry.charge.trident', cat: 'weapons', gi: 'trident', keys: 'dreizack', proper: GREY },
  { id: 'pheon', label: 'heraldry.charge.pheon', cat: 'weapons', gi: 'broadhead-arrow', keys: 'pfeilspitze arrowhead', proper: GREY },
  { id: 'arrow', label: 'heraldry.charge.arrow', cat: 'weapons', gi: 'plain-arrow', keys: 'pfeil', proper: GREY },
  { id: 'cannon', label: 'heraldry.charge.cannon', cat: 'weapons', gi: 'cannon', keys: 'kanone geschütz', proper: '#3a3a36', facing: true },
  { id: 'helm', label: 'heraldry.charge.helm', cat: 'weapons', gi: 'visored-helm', keys: 'helm helmet', proper: GREY },

  // ---- tools and trades ----
  { id: 'water-mill', label: 'heraldry.charge.water-mill', cat: 'tools', gi: 'water-mill', keys: 'wassermühle mühle müller miller mill', proper: BROWN },
  { id: 'windmill', label: 'heraldry.charge.windmill', cat: 'tools', gi: 'windmill', keys: 'windmühle mühle müller miller molen mølle', proper: BROWN },
  { id: 'millstone', label: 'heraldry.charge.millstone', cat: 'tools', gi: 'stone-wheel', keys: 'mühlstein mühle müller miller', proper: GREY },
  { id: 'wheel', label: 'heraldry.charge.wheel', cat: 'tools', gi: 'cartwheel', keys: 'rad wagenrad wheel wainwright wagner', proper: BROWN },
  { id: 'cogwheel', label: 'heraldry.charge.cogwheel', cat: 'tools', gi: 'cog', keys: 'zahnrad gear', proper: GREY },
  { id: 'hammer', label: 'heraldry.charge.hammer', cat: 'tools', gi: 'claw-hammer', keys: 'hammer schmied smith', proper: GREY },
  { id: 'smith-hammer', label: 'heraldry.charge.smith-hammer', cat: 'tools', gi: 'flat-hammer', keys: 'hammer schmied smith', proper: GREY },
  { id: 'thor-hammer', label: 'heraldry.charge.thor-hammer', cat: 'tools', gi: 'thor-hammer', plural: 'Thor’s hammers', keys: 'hammer mjölnir', proper: GREY },
  { id: 'anvil', label: 'heraldry.charge.anvil', cat: 'tools', gi: 'anvil', keys: 'amboss schmied smith', proper: '#3a3a36' },
  { id: 'plough', label: 'heraldry.charge.plough', cat: 'tools', gi: 'plow', keys: 'pflug bauer farmer plow', proper: BROWN },
  { id: 'spinning-wheel', label: 'heraldry.charge.spinning-wheel', cat: 'tools', gi: 'spinning-wheel', keys: 'spinnrad weber spinner', proper: BROWN },
  { id: 'ship-wheel', label: 'heraldry.charge.ship-wheel', cat: 'tools', gi: 'ship-wheel', keys: 'steuerrad', proper: BROWN },
  { id: 'key', label: 'heraldry.charge.key', cat: 'tools', gi: 'key', core: true, keys: 'schlüssel', proper: GREY },
  { id: 'keys', label: 'heraldry.charge.keys', cat: 'tools', gi: 'three-keys', plural: 'bunches of keys', keys: 'schlüssel', proper: GREY },
  { id: 'scales', label: 'heraldry.charge.scales', cat: 'tools', gi: 'scales', keys: 'waage justice', proper: '#d4a53c' },
  { id: 'sickle', label: 'heraldry.charge.sickle', cat: 'tools', gi: 'sickle', keys: 'sichel', proper: GREY },
  { id: 'scythe', label: 'heraldry.charge.scythe', cat: 'tools', gi: 'scythe', keys: 'sense', proper: GREY },
  { id: 'rake', label: 'heraldry.charge.rake', cat: 'tools', gi: 'rake', keys: 'rechen harke', proper: BROWN },
  { id: 'pitchfork', label: 'heraldry.charge.pitchfork', cat: 'tools', gi: 'pitchfork', keys: 'heugabel forke', proper: BROWN },
  { id: 'spade', label: 'heraldry.charge.spade', cat: 'tools', gi: 'spade', keys: 'spaten schaufel', proper: GREY },
  { id: 'trowel', label: 'heraldry.charge.trowel', cat: 'tools', gi: 'trowel', keys: 'kelle maurer mason', proper: GREY },
  { id: 'chisel', label: 'heraldry.charge.chisel', cat: 'tools', gi: 'chisel', keys: 'meißel', proper: GREY },
  { id: 'saw', label: 'heraldry.charge.saw', cat: 'tools', gi: 'hand-saw', keys: 'säge zimmermann carpenter', proper: GREY },
  { id: 'shears', label: 'heraldry.charge.shears', cat: 'tools', gi: 'scissors', plural: 'pairs of shears', keys: 'schere schneider tailor', proper: GREY },
  { id: 'needle', label: 'heraldry.charge.needle', cat: 'tools', gi: 'sewing-needle', plural: 'needles and thread', keys: 'nadel schneider tailor', proper: GREY },
  { id: 'ladder', label: 'heraldry.charge.ladder', cat: 'tools', gi: 'ladder', keys: 'leiter', proper: BROWN },
  { id: 'horseshoe', label: 'heraldry.charge.horseshoe', cat: 'tools', gi: 'horseshoe', keys: 'hufeisen schmied smith', proper: GREY },
  { id: 'fish-hook', label: 'heraldry.charge.fish-hook', cat: 'tools', gi: 'fishing-hook', keys: 'angelhaken fischer', proper: GREY },
  { id: 'barrel', label: 'heraldry.charge.barrel', cat: 'tools', gi: 'barrel', keys: 'fass tun cooper böttcher', proper: BROWN },
  { id: 'wheelbarrow', label: 'heraldry.charge.wheelbarrow', cat: 'tools', gi: 'wheelbarrow', keys: 'schubkarre', proper: BROWN },
  { id: 'beehive', label: 'heraldry.charge.beehive', cat: 'tools', gi: 'beehive', keys: 'bienenkorb imker', proper: '#c49a5c' },
  { id: 'pretzel', label: 'heraldry.charge.pretzel', cat: 'tools', gi: 'pretzel', keys: 'brezel bäcker becker baker', proper: '#a8642c' },
  { id: 'bread', label: 'heraldry.charge.bread', cat: 'tools', gi: 'bread', plural: 'loaves', keys: 'brot bäcker becker baker', proper: '#c49a5c' },
  { id: 'quill', label: 'heraldry.charge.quill', cat: 'tools', gi: 'quill-ink', plural: 'quills and inkpots', keys: 'feder schreiber writer clerk', proper: '#26241f' },
  { id: 'book', label: 'heraldry.charge.book', cat: 'tools', gi: 'open-book', keys: 'buch scholar', proper: '#e8e6df' },
  { id: 'compass', label: 'heraldry.charge.compass', cat: 'tools', gi: 'compass', plural: 'compasses', keys: 'kompass', proper: '#d4a53c' },
  { id: 'hourglass', label: 'heraldry.charge.hourglass', cat: 'tools', gi: 'hourglass', plural: 'hourglasses', keys: 'sanduhr', proper: '#d4a53c' },

  // ---- buildings ----
  { id: 'tower', label: 'heraldry.charge.tower', cat: 'buildings', gi: 'tower-flag', core: true, keys: 'turm burg', proper: GREY },
  { id: 'stone-tower', label: 'heraldry.charge.stone-tower', cat: 'buildings', gi: 'stone-tower', keys: 'turm', proper: GREY },
  { id: 'castle', label: 'heraldry.charge.castle', cat: 'buildings', gi: 'castle', keys: 'burg schloss borg', proper: GREY },
  { id: 'watchtower', label: 'heraldry.charge.watchtower', cat: 'buildings', gi: 'watchtower', keys: 'wachturm', proper: BROWN },
  { id: 'church', label: 'heraldry.charge.church', cat: 'buildings', gi: 'church', keys: 'kirche kerk kirke kyrka', proper: '#e8e6df' },
  { id: 'gate', label: 'heraldry.charge.gate', cat: 'buildings', gi: 'gate', keys: 'tor hof gate pforte', proper: '#3a3a36' },
  { id: 'gatehouse', label: 'heraldry.charge.gatehouse', cat: 'buildings', gi: 'medieval-gate', keys: 'tor burgtor', proper: GREY },
  { id: 'drawbridge', label: 'heraldry.charge.drawbridge', cat: 'buildings', gi: 'drawbridge', keys: 'zugbrücke', proper: GREY },
  { id: 'bridge', label: 'heraldry.charge.bridge', cat: 'buildings', gi: 'bridge', keys: 'brücke brug bro', proper: GREY },
  { id: 'house', label: 'heraldry.charge.house', cat: 'buildings', gi: 'house', keys: 'haus hus huis home', proper: '#b3312c' },
  { id: 'barn', label: 'heraldry.charge.barn', cat: 'buildings', gi: 'barn', keys: 'hof scheune bauernhof farm gård gaard', proper: '#b3312c' },
  { id: 'lighthouse', label: 'heraldry.charge.lighthouse', cat: 'buildings', gi: 'lighthouse', keys: 'leuchtturm', proper: '#e8e6df' },
  { id: 'well', label: 'heraldry.charge.well', cat: 'buildings', gi: 'well', keys: 'brunnen born', proper: GREY },
  { id: 'fountain', label: 'heraldry.charge.fountain', cat: 'buildings', gi: 'fountain', keys: 'brunnen springbrunnen', proper: GREY },
  { id: 'longhouse', label: 'heraldry.charge.longhouse', cat: 'buildings', gi: 'viking-longhouse', keys: 'langhaus hall', proper: BROWN },
  { id: 'pavilion', label: 'heraldry.charge.pavilion', cat: 'buildings', gi: 'medieval-pavilion', keys: 'zelt tent', proper: '#e8e6df' },
  { id: 'hill-fort', label: 'heraldry.charge.hill-fort', cat: 'buildings', gi: 'hill-fort', plural: 'castles on hills', keys: 'burg berg', proper: GREY },

  // ---- crowns ----
  { id: 'crown', label: 'heraldry.charge.crown', cat: 'crowns', gi: 'crown', core: true, keys: 'krone könig king', proper: '#d4a53c' },
  { id: 'imperial-crown', label: 'heraldry.charge.imperial-crown', cat: 'crowns', gi: 'imperial-crown', keys: 'krone kaiser', proper: '#d4a53c' },
  { id: 'mural-crown', label: 'heraldry.charge.mural-crown', cat: 'crowns', gi: 'crenel-crown', keys: 'mauerkrone town stadt', proper: GREY },
  { id: 'laurel', label: 'heraldry.charge.laurel', cat: 'crowns', gi: 'laurel-crown', core: true, keys: 'lorbeer kranz', proper: GREEN },
  { id: 'coronet', label: 'heraldry.charge.coronet', cat: 'crowns', gi: 'jewel-crown', keys: 'krone diadem', proper: '#d4a53c' },
  { id: 'queen-crown', label: 'heraldry.charge.queen-crown', cat: 'crowns', gi: 'queen-crown', keys: 'krone königin', proper: '#d4a53c' },
  { id: 'tiara', label: 'heraldry.charge.tiara', cat: 'crowns', gi: 'pope-crown', core: true, keys: 'mitra papst', proper: '#e8e6df' },

  // ---- objects ----
  { id: 'crowned-heart', label: 'heraldry.charge.crowned-heart', cat: 'objects', gi: 'crowned-heart', keys: 'herz krone', proper: '#b3312c' },
  { id: 'hand', label: 'heraldry.charge.hand', cat: 'objects', gi: 'hand', keys: 'hand', proper: '#e5b293' },
  { id: 'open-hand', label: 'heraldry.charge.open-hand', cat: 'objects', gi: 'open-palm', keys: 'hand', proper: '#e5b293' },
  { id: 'bell', label: 'heraldry.charge.bell', cat: 'objects', gi: 'ringing-bell', keys: 'glocke', proper: '#d4a53c' },
  { id: 'hunting-horn', label: 'heraldry.charge.hunting-horn', cat: 'objects', gi: 'hunting-horn', keys: 'horn jagdhorn bugle jäger', proper: '#d4a53c' },
  { id: 'trumpet', label: 'heraldry.charge.trumpet', cat: 'objects', gi: 'trumpet', keys: 'trompete', proper: '#d4a53c' },
  { id: 'harp', label: 'heraldry.charge.harp', cat: 'objects', gi: 'harp', keys: 'harfe', proper: '#d4a53c' },
  { id: 'lyre', label: 'heraldry.charge.lyre', cat: 'objects', gi: 'lyre', keys: 'leier', proper: '#d4a53c' },
  { id: 'drum', label: 'heraldry.charge.drum', cat: 'objects', gi: 'drum', keys: 'trommel', proper: BROWN },
  { id: 'cup', label: 'heraldry.charge.cup', cat: 'objects', gi: 'holy-grail', keys: 'kelch pokal cup chalice becher', proper: '#d4a53c' },
  { id: 'chalice', label: 'heraldry.charge.chalice', cat: 'objects', gi: 'jeweled-chalice', keys: 'kelch cup', proper: '#d4a53c' },
  { id: 'tankard', label: 'heraldry.charge.tankard', cat: 'objects', gi: 'beer-stein', keys: 'krug bier brauer brewer', proper: GREY },
  { id: 'jug', label: 'heraldry.charge.jug', cat: 'objects', gi: 'jug', keys: 'krug kanne', proper: '#d4a53c' },
  { id: 'cauldron', label: 'heraldry.charge.cauldron', cat: 'objects', gi: 'cauldron', keys: 'kessel', proper: '#3a3a36' },
  { id: 'lantern', label: 'heraldry.charge.lantern', cat: 'objects', gi: 'lantern', keys: 'laterne', proper: '#d4a53c' },
  { id: 'torch', label: 'heraldry.charge.torch', cat: 'objects', gi: 'torch', plural: 'torches', keys: 'fackel', proper: '#c8692b' },
  { id: 'candle', label: 'heraldry.charge.candle', cat: 'objects', gi: 'candle-holder', keys: 'kerze leuchter', proper: '#d4a53c' },
  { id: 'ring', label: 'heraldry.charge.ring', cat: 'objects', gi: 'ring', keys: 'ring', proper: '#d4a53c' },
  { id: 'coins', label: 'heraldry.charge.coins', cat: 'objects', gi: 'two-coins', plural: 'pairs of coins', keys: 'münze geld', proper: '#d4a53c' },
  { id: 'sceptre', label: 'heraldry.charge.sceptre', cat: 'objects', gi: 'winged-scepter', keys: 'zepter', proper: '#d4a53c' },
  { id: 'chess-knight', label: 'heraldry.charge.chess-knight', cat: 'objects', gi: 'chess-knight', keys: 'springer schach', proper: '#26241f', facing: true },
  { id: 'harp-lamp', label: 'heraldry.charge.harp-lamp', cat: 'objects', gi: 'magic-lamp', keys: 'lampe', proper: '#d4a53c' },
  { id: 'wine', label: 'heraldry.charge.wine', cat: 'objects', gi: 'wine-glass', keys: 'weinglas glas', proper: '#e8e6df' },
  { id: 'horn', label: 'heraldry.charge.horn', cat: 'objects', gi: 'beer-horn', keys: 'trinkhorn', proper: '#d4a53c' },
];

export const CHARGE_BY_ID: Record<string, ChargeDef> = Object.fromEntries(CHARGES_V2.map((c) => [c.id, c]));

/** Helms for the achievement, by rank: a glyph and the metal it is drawn in. */
export const HELM_GLYPH: Record<'esquire' | 'knight' | 'peer' | 'royal', { gi: string; metal: string; label: Key }> = {
  esquire: { gi: 'frog-mouth-helm', metal: '#9a9ea3', label: 'heraldry.helm_glyph.esquire' },
  knight: { gi: 'closed-barbute', metal: '#a9adb2', label: 'heraldry.helm_glyph.knight' },
  peer: { gi: 'visored-helm', metal: '#c9ccd0', label: 'heraldry.helm_glyph.peer' },
  royal: { gi: 'visored-helm', metal: '#d9b04a', label: 'heraldry.helm_glyph.royal' },
};

/** Charges that make good supporters: they stand up and fill a tall space. */
export const SUPPORTERS = ['griffin', 'wolf-rampant', 'wyvern', 'pegasus', 'deer', 'centaur', 'mermaid', 'sea-serpent'];
/** Supporters whose glyph faces the viewer's left; the rest face right, so the dexter one already faces the shield. */
export const FACES_LEFT: ReadonlySet<string> = new Set(['mermaid']);
