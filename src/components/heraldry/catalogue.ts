// The charge catalogue: every charge the arms editor offers, with its label, category, search words and
// where its drawing comes from. Classic shapes (mullet, annulet, crosses …) are drawn in classic.ts; the rest
// are game-icons.net glyphs (Lorc, Delapouite and contributors, CC BY 3.0).
//
// Pure data with no imports, so scripts/extract-icons.ts can read it: that script extracts exactly the glyphs
// named here. `core` glyphs ship in the main bundle (the v1 charges every old shield uses); the rest live in
// library.gen.ts, which loads on demand.

export type ChargeCategory =
  | 'classic' | 'crosses' | 'beasts' | 'birds' | 'sea' | 'monsters' | 'plants' | 'celestial' | 'weapons' | 'tools'
  | 'buildings' | 'crowns' | 'objects';

export interface ChargeDef {
  id: string;
  label: string;
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

export const CATEGORIES: { id: ChargeCategory; label: string }[] = [
  { id: 'classic', label: 'Classic' },
  { id: 'crosses', label: 'Crosses' },
  { id: 'beasts', label: 'Beasts' },
  { id: 'birds', label: 'Birds' },
  { id: 'sea', label: 'Fish & sea' },
  { id: 'monsters', label: 'Monsters' },
  { id: 'plants', label: 'Plants' },
  { id: 'celestial', label: 'Sky & land' },
  { id: 'weapons', label: 'Weapons' },
  { id: 'tools', label: 'Tools & trades' },
  { id: 'buildings', label: 'Buildings' },
  { id: 'crowns', label: 'Crowns' },
  { id: 'objects', label: 'Objects' },
];

const BROWN = '#8a5a32';
const GREEN = '#4c7a36';
const GREY = '#8e8e88';

export const CHARGES_V2: ChargeDef[] = [
  // ---- classic shapes, drawn by hand ----
  { id: 'mullet', label: 'Mullet', cat: 'classic', keys: 'star stern', proper: '#d4a53c' },
  { id: 'mullet-six', label: 'Mullet of six', cat: 'classic', keys: 'star six stern', proper: '#d4a53c' },
  { id: 'estoile', label: 'Estoile', cat: 'classic', keys: 'star wavy stern', proper: '#d4a53c' },
  { id: 'crescent', label: 'Crescent', cat: 'classic', keys: 'moon halbmond mond', proper: '#e8e6df' },
  { id: 'roundel', label: 'Roundel', cat: 'classic', keys: 'bezant plate torteau ball kugel scheibe' },
  { id: 'annulet', label: 'Annulet', cat: 'classic', keys: 'ring circle' },
  { id: 'lozenge', label: 'Lozenge', cat: 'classic', keys: 'diamond raute' },
  { id: 'mascle', label: 'Mascle', cat: 'classic', keys: 'voided lozenge diamond' },
  { id: 'fusil', label: 'Fusil', cat: 'classic', keys: 'spindle diamond' },
  { id: 'billet', label: 'Billet', cat: 'classic', keys: 'brick rectangle schindel' },
  { id: 'heart', label: 'Heart', cat: 'classic', keys: 'herz love', proper: '#b3312c' },
  { id: 'escutcheon', label: 'Escutcheon', cat: 'classic', keys: 'inescutcheon shield schild' },
  { id: 'fleur', label: 'Fleur-de-lis', cat: 'classic', gi: 'fleur-de-lys', core: true, plural: 'fleurs-de-lis', keys: 'lily lilie fleur de lys' },
  { id: 'trimount', label: 'Trimount', cat: 'celestial', keys: 'mount hill berg dreiberg mountain', proper: GREEN },
  { id: 'mill-wheel', label: 'Mill wheel', cat: 'tools', keys: 'mühlrad muehlrad miller müller wheel', proper: BROWN },
  { id: 'mill-rind', label: 'Mill-rind', cat: 'tools', keys: 'fer de moline mühleisen miller', proper: GREY },
  { id: 'gouttes', label: 'Goutte', cat: 'classic', keys: 'drop tropfen water', plural: 'gouttes' },

  // ---- crosses ----
  { id: 'cross-crosslet', label: 'Cross crosslet', cat: 'crosses', plural: 'crosses crosslet', keys: 'kreuz' },
  { id: 'cross-moline', label: 'Cross moline', cat: 'crosses', plural: 'crosses moline', keys: 'kreuz miller ankerkreuz' },
  { id: 'cross-patee', label: 'Cross pattée', cat: 'crosses', plural: 'crosses pattée', keys: 'kreuz tatzenkreuz paty' },
  { id: 'cross-potent', label: 'Cross potent', cat: 'crosses', plural: 'crosses potent', keys: 'kreuz krückenkreuz' },
  { id: 'cross-humetty', label: 'Cross couped', cat: 'crosses', plural: 'crosses couped', keys: 'kreuz plain greek' },
  { id: 'jerusalem-cross', label: 'Jerusalem cross', cat: 'crosses', gi: 'jerusalem-cross', plural: 'Jerusalem crosses', keys: 'kreuz' },
  { id: 'cross-iron', label: 'Cross formy', cat: 'crosses', gi: 'iron-cross', plural: 'crosses formy', keys: 'kreuz iron eisernes' },
  { id: 'camargue-cross', label: 'Mariner’s cross', cat: 'crosses', gi: 'camargue-cross', plural: 'mariner’s crosses', keys: 'anchor heart kreuz' },

  // ---- beasts ----
  { id: 'lion', label: 'Lion’s head', cat: 'beasts', gi: 'lion', core: true, plural: 'lions’ heads', keys: 'löwe lion leo', proper: '#c08a3e', facing: true },
  { id: 'wolf', label: 'Wolf’s head', cat: 'beasts', gi: 'wolf-head', plural: 'wolves’ heads', keys: 'wolf wölfe', proper: GREY, facing: true },
  { id: 'wolf-erased', label: 'Wolf’s head erased', cat: 'beasts', gi: 'direwolf', plural: 'wolves’ heads erased', keys: 'wolf', proper: GREY, facing: true },
  { id: 'bear', label: 'Bear’s head', cat: 'beasts', gi: 'bear-head', plural: 'bears’ heads', keys: 'bär baer bear bjørn björn', proper: BROWN, facing: true },
  { id: 'bear-passant', label: 'Bear passant', cat: 'beasts', gi: 'polar-bear', plural: 'bears passant', keys: 'bär baer bjørn björn', proper: BROWN, facing: true },
  { id: 'boar', label: 'Boar', cat: 'beasts', gi: 'boar', core: true, keys: 'eber schwein swine', proper: '#5a4632', facing: true },
  { id: 'stag', label: 'Stag’s head', cat: 'beasts', gi: 'stag-head', core: true, plural: 'stags’ heads', keys: 'hirsch hirsch deer hjort', proper: BROWN },
  { id: 'deer', label: 'Stag', cat: 'beasts', gi: 'deer', keys: 'hirsch deer hart hjort reh', proper: BROWN, facing: true },
  { id: 'horse', label: 'Horse’s head', cat: 'beasts', gi: 'horse-head', plural: 'horses’ heads', keys: 'pferd ross hest häst', proper: BROWN, facing: true },
  { id: 'bull', label: 'Bull’s head', cat: 'beasts', gi: 'bull', plural: 'bulls’ heads', keys: 'stier ochse ox rind', proper: BROWN },
  { id: 'bull-charging', label: 'Bull', cat: 'beasts', gi: 'charging-bull', keys: 'stier ochse ox', proper: BROWN, facing: true },
  { id: 'ram', label: 'Ram', cat: 'beasts', gi: 'ram', keys: 'widder bock', proper: '#d8d0bc', facing: true },
  { id: 'goat', label: 'Goat', cat: 'beasts', gi: 'goat', keys: 'ziege geiß bock', proper: '#d8d0bc', facing: true },
  { id: 'sheep', label: 'Sheep', cat: 'beasts', gi: 'sheep', keys: 'schaf lamb lamm', proper: '#e8e2d0', facing: true },
  { id: 'hound', label: 'Hound', cat: 'beasts', gi: 'hound', keys: 'hund dog talbot', proper: BROWN, facing: true },
  { id: 'dog-sejant', label: 'Dog sejant', cat: 'beasts', gi: 'sitting-dog', plural: 'dogs sejant', keys: 'hund dog', proper: BROWN, facing: true },
  { id: 'fox', label: 'Fox', cat: 'beasts', gi: 'fox', plural: 'foxes', keys: 'fuchs fuchs reynard räv', proper: '#c8692b', facing: true },
  { id: 'hare', label: 'Hare', cat: 'beasts', gi: 'rabbit', keys: 'hase kaninchen rabbit', proper: BROWN, facing: true },
  { id: 'squirrel', label: 'Squirrel', cat: 'beasts', gi: 'squirrel', keys: 'eichhörnchen', proper: '#a0522d', facing: true },
  { id: 'beaver', label: 'Beaver', cat: 'beasts', gi: 'beaver', keys: 'biber', proper: BROWN, facing: true },
  { id: 'badger', label: 'Badger’s head', cat: 'beasts', gi: 'badger', plural: 'badgers’ heads', keys: 'dachs brock', proper: GREY },
  { id: 'hedgehog', label: 'Hedgehog', cat: 'beasts', gi: 'hedgehog', keys: 'igel urchin', proper: BROWN, facing: true },
  { id: 'cat', label: 'Cat', cat: 'beasts', gi: 'cat', keys: 'katze', proper: GREY, facing: true },
  { id: 'elephant', label: 'Elephant', cat: 'beasts', gi: 'elephant', keys: 'elefant', proper: GREY, facing: true },
  { id: 'camel', label: 'Camel', cat: 'beasts', gi: 'camel', keys: 'kamel', proper: '#c49a5c', facing: true },
  { id: 'mouse', label: 'Mouse', cat: 'beasts', gi: 'mouse', plural: 'mice', keys: 'maus', proper: GREY, facing: true },
  { id: 'frog', label: 'Frog', cat: 'beasts', gi: 'frog', keys: 'frosch', proper: GREEN },
  { id: 'tortoise', label: 'Tortoise', cat: 'beasts', gi: 'turtle', plural: 'tortoises', keys: 'schildkröte turtle', proper: GREEN },
  { id: 'serpent', label: 'Serpent', cat: 'beasts', gi: 'snake', keys: 'schlange snake', proper: GREEN },
  { id: 'bee', label: 'Bee', cat: 'beasts', gi: 'bee', keys: 'biene imker', proper: '#d4a53c' },
  { id: 'bat', label: 'Bat', cat: 'beasts', gi: 'bat', keys: 'fledermaus', proper: '#26241f' },
  { id: 'scorpion', label: 'Scorpion', cat: 'beasts', gi: 'scorpion', keys: 'skorpion', proper: BROWN },
  { id: 'beetle', label: 'Beetle', cat: 'beasts', gi: 'scarab-beetle', keys: 'käfer scarab', proper: '#26241f' },

  // ---- birds ----
  { id: 'eagle', label: 'Eagle displayed', cat: 'birds', gi: 'eagle-emblem', core: true, plural: 'eagles displayed', keys: 'adler aar eagle örn ørn arend', proper: '#5a4632' },
  { id: 'eagle-head', label: 'Eagle’s head', cat: 'birds', gi: 'eagle-head', plural: 'eagles’ heads', keys: 'adler aar', proper: '#5a4632', facing: true },
  { id: 'hawk', label: 'Falcon displayed', cat: 'birds', gi: 'hawk-emblem', plural: 'falcons displayed', keys: 'falke habicht hawk', proper: BROWN },
  { id: 'raven', label: 'Raven', cat: 'birds', gi: 'raven', keys: 'rabe krähe crow corbie', proper: '#26241f', facing: true },
  { id: 'owl', label: 'Owl', cat: 'birds', gi: 'owl', keys: 'eule kauz', proper: BROWN },
  { id: 'barn-owl', label: 'Barn owl', cat: 'birds', gi: 'barn-owl', keys: 'eule schleiereule', proper: '#c49a5c' },
  { id: 'dove', label: 'Dove', cat: 'birds', gi: 'dove', keys: 'taube', proper: '#e8e6df', facing: true },
  { id: 'dove-olive', label: 'Dove with olive', cat: 'birds', gi: 'peace-dove', plural: 'doves with olive', keys: 'taube friede peace', proper: '#e8e6df', facing: true },
  { id: 'swan', label: 'Swan', cat: 'birds', gi: 'swan', keys: 'schwan svan zwaan', proper: '#e8e6df', facing: true },
  { id: 'cock', label: 'Cock', cat: 'birds', gi: 'rooster', keys: 'hahn rooster hane haan', proper: '#b3312c', facing: true },
  { id: 'duck', label: 'Duck', cat: 'birds', gi: 'duck', keys: 'ente', proper: BROWN, facing: true },
  { id: 'goose', label: 'Goose', cat: 'birds', gi: 'canadian-goose', plural: 'geese', keys: 'gans', proper: GREY, facing: true },
  { id: 'heron', label: 'Heron', cat: 'birds', gi: 'heron', keys: 'reiher crane kranich', proper: GREY, facing: true },
  { id: 'pelican', label: 'Pelican', cat: 'birds', gi: 'eating-pelican', keys: 'pelikan piety', proper: '#e8e6df', facing: true },
  { id: 'sparrow', label: 'Sparrow', cat: 'birds', gi: 'sparrow', keys: 'spatz sperling martlet fink finch vogel', proper: BROWN, facing: true },
  { id: 'hummingbird', label: 'Hummingbird', cat: 'birds', gi: 'hummingbird', keys: 'kolibri', proper: GREEN, facing: true },
  { id: 'ostrich', label: 'Ostrich', cat: 'birds', gi: 'ostrich', plural: 'ostriches', keys: 'strauß strauss', proper: GREY, facing: true },

  // ---- fish and the sea ----
  { id: 'fish', label: 'Fish', cat: 'sea', gi: 'salmon', plural: 'fish', keys: 'fisch salmon lachs fisher fischer fisk vis', proper: '#6a8fa8', facing: true },
  { id: 'fish-pair', label: 'Two fish', cat: 'sea', gi: 'double-fish', plural: 'pairs of fish', keys: 'fisch barbel', proper: '#6a8fa8' },
  { id: 'fish-circling', label: 'Fish in annulo', cat: 'sea', gi: 'circling-fish', plural: 'pairs of fish in annulo', keys: 'fisch', proper: '#6a8fa8' },
  { id: 'flatfish', label: 'Flatfish', cat: 'sea', gi: 'flatfish', plural: 'flatfish', keys: 'scholle butt', proper: '#c49a5c', facing: true },
  { id: 'dolphin', label: 'Dolphin', cat: 'sea', gi: 'dolphin', keys: 'delfin delphin', proper: '#6a8fa8', facing: true },
  { id: 'whale', label: 'Whale', cat: 'sea', gi: 'sperm-whale', keys: 'wal', proper: '#2d5aa0', facing: true },
  { id: 'crab', label: 'Crab', cat: 'sea', gi: 'crab', keys: 'krebs krabbe', proper: '#b3312c' },
  { id: 'escallop', label: 'Escallop', cat: 'sea', gi: 'scallop', keys: 'muschel scallop shell jakobsmuschel', proper: '#e8d8b8' },
  { id: 'starfish', label: 'Starfish', cat: 'sea', gi: 'sea-star', plural: 'starfish', keys: 'seestern', proper: '#c8692b' },
  { id: 'seahorse', label: 'Seahorse', cat: 'sea', gi: 'seahorse', keys: 'seepferdchen', proper: '#c49a5c', facing: true },
  { id: 'nautilus', label: 'Nautilus', cat: 'sea', gi: 'nautilus-shell', keys: 'schnecke shell', proper: '#e8d8b8' },
  { id: 'waves', label: 'Waves', cat: 'sea', gi: 'waves', plural: 'waves', keys: 'wellen ström strom stream river fluss bach water wasser', proper: '#2d5aa0' },
  { id: 'wave', label: 'Breaking wave', cat: 'sea', gi: 'big-wave', keys: 'welle see meer sea', proper: '#2d5aa0' },
  { id: 'anchor', label: 'Anchor', cat: 'sea', gi: 'anchor', keys: 'anker sailor', proper: GREY },
  { id: 'ship', label: 'Ship', cat: 'sea', gi: 'shooner-sailboat', keys: 'schiff lymphad boot', proper: BROWN, facing: true },
  { id: 'boat', label: 'Boat', cat: 'sea', gi: 'sailboat', keys: 'boot segel', proper: BROWN, facing: true },
  { id: 'longship', label: 'Longship', cat: 'sea', gi: 'drakkar-dragon', keys: 'viking drakkar wikinger', proper: BROWN, facing: true },

  // ---- monsters ----
  { id: 'griffin', label: 'Griffin', cat: 'monsters', gi: 'griffin-symbol', keys: 'greif gryphon griffon', proper: '#d4a53c', facing: true },
  { id: 'dragon', label: 'Dragon’s head', cat: 'monsters', gi: 'dragon-head', plural: 'dragons’ heads', keys: 'drache lindwurm', proper: GREEN, facing: true },
  { id: 'wyvern', label: 'Wyvern', cat: 'monsters', gi: 'wyvern', keys: 'drache lindwurm', proper: GREEN },
  { id: 'unicorn', label: 'Unicorn’s head', cat: 'monsters', gi: 'unicorn', plural: 'unicorns’ heads', keys: 'einhorn', proper: '#e8e6df', facing: true },
  { id: 'pegasus', label: 'Pegasus', cat: 'monsters', gi: 'pegasus', plural: 'pegasi', keys: 'flügelpferd winged horse', proper: '#e8e6df', facing: true },
  { id: 'hydra', label: 'Hydra', cat: 'monsters', gi: 'hydra', keys: 'drache', proper: GREEN, facing: true },
  { id: 'mermaid', label: 'Mermaid', cat: 'monsters', gi: 'mermaid', keys: 'meerjungfrau nixe', proper: '#6a8fa8', facing: true },
  { id: 'centaur', label: 'Centaur', cat: 'monsters', gi: 'centaur', keys: 'kentaur sagittary', proper: BROWN, facing: true },
  { id: 'sea-serpent', label: 'Sea serpent', cat: 'monsters', gi: 'sea-serpent', keys: 'seeschlange', proper: GREEN, facing: true },
  { id: 'sea-dragon', label: 'Sea dragon', cat: 'monsters', gi: 'sea-dragon', keys: 'seedrache', proper: GREEN, facing: true },
  { id: 'harpy', label: 'Harpy', cat: 'monsters', gi: 'harpy', plural: 'harpies', keys: 'harpyie', proper: BROWN },
  { id: 'wolf-rampant', label: 'Wolf rampant', cat: 'monsters', gi: 'werewolf', plural: 'wolves rampant', keys: 'wolf werwolf', proper: GREY, facing: true },
  { id: 'double-dragon', label: 'Two dragons’ heads', cat: 'monsters', gi: 'double-dragon', plural: 'pairs of dragons’ heads', keys: 'drache', proper: GREEN },

  // ---- plants ----
  { id: 'rose', label: 'Rose', cat: 'plants', gi: 'rose', core: true, keys: 'rose rosen', proper: '#b3312c' },
  { id: 'rose-slipped', label: 'Rose slipped', cat: 'plants', gi: 'shut-rose', plural: 'roses slipped', keys: 'rose stem', proper: '#b3312c' },
  { id: 'lily', label: 'Lily', cat: 'plants', gi: 'trefoil-lily', plural: 'lilies', keys: 'lilie', proper: '#e8e6df' },
  { id: 'oak', label: 'Oak tree', cat: 'plants', gi: 'oak', keys: 'eiche eichbaum ek eik tree baum', proper: GREEN },
  { id: 'pine', label: 'Pine tree', cat: 'plants', gi: 'pine-tree', keys: 'tanne fichte kiefer fir tree baum gran', proper: '#2f5a36' },
  { id: 'linden', label: 'Linden tree', cat: 'plants', gi: 'beech', keys: 'linde lind lime tree baum buche beech', proper: GREEN },
  { id: 'willow', label: 'Willow', cat: 'plants', gi: 'willow-tree', keys: 'weide tree baum', proper: GREEN },
  { id: 'birch', label: 'Birches', cat: 'plants', gi: 'birch-trees', plural: 'clumps of birches', keys: 'birke björk bjørk tree', proper: '#e8e6df' },
  { id: 'apple-tree', label: 'Fruit tree', cat: 'plants', gi: 'fruit-tree', keys: 'apfelbaum obstbaum orchard', proper: GREEN },
  { id: 'palm', label: 'Palm tree', cat: 'plants', gi: 'palm-tree', keys: 'palme', proper: GREEN },
  { id: 'linden-leaf', label: 'Linden leaf', cat: 'plants', gi: 'linden-leaf', plural: 'linden leaves', keys: 'lindenblatt lind leaf blatt seeblatt', proper: GREEN },
  { id: 'oak-leaf', label: 'Oak leaf', cat: 'plants', gi: 'oak-leaf', plural: 'oak leaves', keys: 'eichenblatt eiche', proper: GREEN },
  { id: 'maple-leaf', label: 'Maple leaf', cat: 'plants', gi: 'maple-leaf', plural: 'maple leaves', keys: 'ahorn', proper: '#b3312c' },
  { id: 'acorn', label: 'Acorn', cat: 'plants', gi: 'acorn', keys: 'eichel', proper: BROWN },
  { id: 'wheat', label: 'Ears of wheat', cat: 'plants', gi: 'wheat', plural: 'sheaves of ears', keys: 'weizen ähre korn grain feld field farmer bauer', proper: '#d4a53c' },
  { id: 'garb', label: 'Garb', cat: 'plants', gi: 'grain-bundle', keys: 'garbe sheaf wheat bauer farmer feld field', proper: '#d4a53c' },
  { id: 'grapes', label: 'Bunch of grapes', cat: 'plants', gi: 'grapes', plural: 'bunches of grapes', keys: 'traube wein vine winzer', proper: '#7b3f7f' },
  { id: 'apple', label: 'Apple', cat: 'plants', gi: 'shiny-apple', keys: 'apfel', proper: '#b3312c' },
  { id: 'pear', label: 'Pear', cat: 'plants', gi: 'pear', keys: 'birne', proper: '#c8b23c' },
  { id: 'cherries', label: 'Cherries', cat: 'plants', gi: 'cherry', plural: 'pairs of cherries', keys: 'kirsche', proper: '#b3312c' },
  { id: 'hops', label: 'Hop cone', cat: 'plants', gi: 'hops', keys: 'hopfen brewer brauer', proper: GREEN },
  { id: 'trefoil', label: 'Trefoil', cat: 'plants', gi: 'shamrock', keys: 'klee shamrock clover', proper: GREEN },
  { id: 'quatrefoil', label: 'Quatrefoil', cat: 'plants', gi: 'clover', keys: 'vierpass clover klee' },
  { id: 'cinquefoil', label: 'Cinquefoil', cat: 'plants', gi: 'flower-emblem', keys: 'fünfblatt flower blume' },
  { id: 'sunflower', label: 'Sunflower', cat: 'plants', gi: 'sunflower', keys: 'sonnenblume', proper: '#d4a53c' },
  { id: 'lotus', label: 'Lotus', cat: 'plants', gi: 'lotus-flower', keys: 'seerose', proper: '#e8a0b0' },
  { id: 'fern', label: 'Fern', cat: 'plants', gi: 'fern', keys: 'farn', proper: GREEN },
  { id: 'reeds', label: 'Bulrushes', cat: 'plants', gi: 'reed', plural: 'clumps of bulrushes', keys: 'schilf reed rohr', proper: GREEN },
  { id: 'vine-leaf', label: 'Vine leaf', cat: 'plants', gi: 'vine-leaf', plural: 'vine leaves', keys: 'weinblatt', proper: GREEN },
  { id: 'branch', label: 'Branch', cat: 'plants', gi: 'tree-branch', plural: 'branches', keys: 'zweig ast', proper: GREEN },

  // ---- sky and land ----
  { id: 'sun', label: 'Sun in splendour', cat: 'celestial', gi: 'heraldic-sun', plural: 'suns in splendour', keys: 'sonne sol zon', proper: '#d4a53c' },
  { id: 'sun-rays', label: 'Sun', cat: 'celestial', gi: 'sun', keys: 'sonne sol', proper: '#d4a53c' },
  { id: 'moon', label: 'Full moon', cat: 'celestial', gi: 'moon', core: true, keys: 'mond moon', proper: '#e8e6df' },
  { id: 'star-north', label: 'Compass star', cat: 'celestial', gi: 'polar-star', keys: 'nordstern stern star', proper: '#d4a53c' },
  { id: 'lightning', label: 'Thunderbolt', cat: 'celestial', gi: 'focused-lightning', keys: 'blitz donner', proper: '#d4a53c' },
  { id: 'flame', label: 'Flame', cat: 'celestial', gi: 'flame', keys: 'flamme feuer fire brand', proper: '#c8692b' },
  { id: 'fire', label: 'Fire', cat: 'celestial', gi: 'fire', keys: 'feuer flamme', proper: '#c8692b' },
  { id: 'drop', label: 'Drop', cat: 'celestial', gi: 'water-drop', keys: 'tropfen water wasser', proper: '#2d5aa0' },
  { id: 'rock', label: 'Rock', cat: 'celestial', gi: 'rock', keys: 'stein fels rock stone sten steen', proper: GREY },
  { id: 'stone', label: 'Ashlar', cat: 'celestial', gi: 'stone-block', keys: 'stein quader block', proper: GREY },
  { id: 'snowflake', label: 'Snowflake', cat: 'celestial', gi: 'snowflake-2', keys: 'schneeflocke schnee', proper: '#e8e6df' },

  // ---- weapons ----
  { id: 'sword', label: 'Sword', cat: 'weapons', gi: 'broadsword', core: true, keys: 'schwert', proper: GREY },
  { id: 'swords-crossed', label: 'Two swords in saltire', cat: 'weapons', gi: 'crossed-swords', plural: 'pairs of swords in saltire', keys: 'schwerter', proper: GREY },
  { id: 'axe', label: 'Battle-axe', cat: 'weapons', gi: 'battle-axe', keys: 'axt beil', proper: GREY },
  { id: 'war-axe', label: 'Axe', cat: 'weapons', gi: 'war-axe', keys: 'axt beil', proper: GREY },
  { id: 'spears', label: 'Spears', cat: 'weapons', gi: 'spears', plural: 'sheaves of spears', keys: 'speer lanze', proper: GREY },
  { id: 'bow', label: 'Bow and arrow', cat: 'weapons', gi: 'bow-arrow', plural: 'bows and arrows', keys: 'bogen pfeil archer', proper: BROWN },
  { id: 'crossbow', label: 'Crossbow', cat: 'weapons', gi: 'crossbow', keys: 'armbrust', proper: BROWN },
  { id: 'halberd', label: 'Halberd', cat: 'weapons', gi: 'halberd', keys: 'hellebarde', proper: GREY },
  { id: 'mace', label: 'Mace', cat: 'weapons', gi: 'flanged-mace', keys: 'streitkolben', proper: GREY },
  { id: 'flail', label: 'Flail', cat: 'weapons', gi: 'flail', keys: 'flegel dreschflegel', proper: GREY },
  { id: 'trident', label: 'Trident', cat: 'weapons', gi: 'trident', keys: 'dreizack', proper: GREY },
  { id: 'pheon', label: 'Pheon', cat: 'weapons', gi: 'broadhead-arrow', keys: 'pfeilspitze arrowhead', proper: GREY },
  { id: 'arrow', label: 'Arrow', cat: 'weapons', gi: 'plain-arrow', keys: 'pfeil', proper: GREY },
  { id: 'cannon', label: 'Cannon', cat: 'weapons', gi: 'cannon', keys: 'kanone geschütz', proper: '#3a3a36', facing: true },
  { id: 'helm', label: 'Helm', cat: 'weapons', gi: 'visored-helm', keys: 'helm helmet', proper: GREY },

  // ---- tools and trades ----
  { id: 'water-mill', label: 'Water mill', cat: 'tools', gi: 'water-mill', keys: 'wassermühle mühle müller miller mill', proper: BROWN },
  { id: 'windmill', label: 'Windmill', cat: 'tools', gi: 'windmill', keys: 'windmühle mühle müller miller molen mølle', proper: BROWN },
  { id: 'millstone', label: 'Millstone', cat: 'tools', gi: 'stone-wheel', keys: 'mühlstein mühle müller miller', proper: GREY },
  { id: 'wheel', label: 'Cartwheel', cat: 'tools', gi: 'cartwheel', keys: 'rad wagenrad wheel wainwright wagner', proper: BROWN },
  { id: 'cogwheel', label: 'Cogwheel', cat: 'tools', gi: 'cog', keys: 'zahnrad gear', proper: GREY },
  { id: 'hammer', label: 'Hammer', cat: 'tools', gi: 'claw-hammer', keys: 'hammer schmied smith', proper: GREY },
  { id: 'smith-hammer', label: 'Sledgehammer', cat: 'tools', gi: 'flat-hammer', keys: 'hammer schmied smith', proper: GREY },
  { id: 'thor-hammer', label: 'Thor’s hammer', cat: 'tools', gi: 'thor-hammer', plural: 'Thor’s hammers', keys: 'hammer mjölnir', proper: GREY },
  { id: 'anvil', label: 'Anvil', cat: 'tools', gi: 'anvil', keys: 'amboss schmied smith', proper: '#3a3a36' },
  { id: 'plough', label: 'Plough', cat: 'tools', gi: 'plow', keys: 'pflug bauer farmer plow', proper: BROWN },
  { id: 'spinning-wheel', label: 'Spinning wheel', cat: 'tools', gi: 'spinning-wheel', keys: 'spinnrad weber spinner', proper: BROWN },
  { id: 'ship-wheel', label: 'Ship’s wheel', cat: 'tools', gi: 'ship-wheel', keys: 'steuerrad', proper: BROWN },
  { id: 'key', label: 'Key', cat: 'tools', gi: 'key', core: true, keys: 'schlüssel', proper: GREY },
  { id: 'keys', label: 'Three keys', cat: 'tools', gi: 'three-keys', plural: 'bunches of keys', keys: 'schlüssel', proper: GREY },
  { id: 'scales', label: 'Balance', cat: 'tools', gi: 'scales', keys: 'waage justice', proper: '#d4a53c' },
  { id: 'sickle', label: 'Sickle', cat: 'tools', gi: 'sickle', keys: 'sichel', proper: GREY },
  { id: 'scythe', label: 'Scythe', cat: 'tools', gi: 'scythe', keys: 'sense', proper: GREY },
  { id: 'rake', label: 'Rake', cat: 'tools', gi: 'rake', keys: 'rechen harke', proper: BROWN },
  { id: 'pitchfork', label: 'Pitchfork', cat: 'tools', gi: 'pitchfork', keys: 'heugabel forke', proper: BROWN },
  { id: 'spade', label: 'Spade', cat: 'tools', gi: 'spade', keys: 'spaten schaufel', proper: GREY },
  { id: 'trowel', label: 'Trowel', cat: 'tools', gi: 'trowel', keys: 'kelle maurer mason', proper: GREY },
  { id: 'chisel', label: 'Chisel', cat: 'tools', gi: 'chisel', keys: 'meißel', proper: GREY },
  { id: 'saw', label: 'Saw', cat: 'tools', gi: 'hand-saw', keys: 'säge zimmermann carpenter', proper: GREY },
  { id: 'shears', label: 'Shears', cat: 'tools', gi: 'scissors', plural: 'pairs of shears', keys: 'schere schneider tailor', proper: GREY },
  { id: 'needle', label: 'Needle and thread', cat: 'tools', gi: 'sewing-needle', plural: 'needles and thread', keys: 'nadel schneider tailor', proper: GREY },
  { id: 'ladder', label: 'Ladder', cat: 'tools', gi: 'ladder', keys: 'leiter', proper: BROWN },
  { id: 'horseshoe', label: 'Horseshoe', cat: 'tools', gi: 'horseshoe', keys: 'hufeisen schmied smith', proper: GREY },
  { id: 'fish-hook', label: 'Fish-hook', cat: 'tools', gi: 'fishing-hook', keys: 'angelhaken fischer', proper: GREY },
  { id: 'barrel', label: 'Barrel', cat: 'tools', gi: 'barrel', keys: 'fass tun cooper böttcher', proper: BROWN },
  { id: 'wheelbarrow', label: 'Wheelbarrow', cat: 'tools', gi: 'wheelbarrow', keys: 'schubkarre', proper: BROWN },
  { id: 'beehive', label: 'Beehive', cat: 'tools', gi: 'beehive', keys: 'bienenkorb imker', proper: '#c49a5c' },
  { id: 'pretzel', label: 'Pretzel', cat: 'tools', gi: 'pretzel', keys: 'brezel bäcker becker baker', proper: '#a8642c' },
  { id: 'bread', label: 'Loaf', cat: 'tools', gi: 'bread', plural: 'loaves', keys: 'brot bäcker becker baker', proper: '#c49a5c' },
  { id: 'quill', label: 'Quill and inkpot', cat: 'tools', gi: 'quill-ink', plural: 'quills and inkpots', keys: 'feder schreiber writer clerk', proper: '#26241f' },
  { id: 'book', label: 'Book', cat: 'tools', gi: 'open-book', keys: 'buch scholar', proper: '#e8e6df' },
  { id: 'compass', label: 'Compass', cat: 'tools', gi: 'compass', plural: 'compasses', keys: 'kompass', proper: '#d4a53c' },
  { id: 'hourglass', label: 'Hourglass', cat: 'tools', gi: 'hourglass', plural: 'hourglasses', keys: 'sanduhr', proper: '#d4a53c' },

  // ---- buildings ----
  { id: 'tower', label: 'Tower', cat: 'buildings', gi: 'tower-flag', core: true, keys: 'turm burg', proper: GREY },
  { id: 'stone-tower', label: 'Round tower', cat: 'buildings', gi: 'stone-tower', keys: 'turm', proper: GREY },
  { id: 'castle', label: 'Castle', cat: 'buildings', gi: 'castle', keys: 'burg schloss borg', proper: GREY },
  { id: 'watchtower', label: 'Watchtower', cat: 'buildings', gi: 'watchtower', keys: 'wachturm', proper: BROWN },
  { id: 'church', label: 'Church', cat: 'buildings', gi: 'church', keys: 'kirche kerk kirke kyrka', proper: '#e8e6df' },
  { id: 'gate', label: 'Gate', cat: 'buildings', gi: 'gate', keys: 'tor hof gate pforte', proper: '#3a3a36' },
  { id: 'gatehouse', label: 'Gatehouse', cat: 'buildings', gi: 'medieval-gate', keys: 'tor burgtor', proper: GREY },
  { id: 'drawbridge', label: 'Drawbridge', cat: 'buildings', gi: 'drawbridge', keys: 'zugbrücke', proper: GREY },
  { id: 'bridge', label: 'Bridge', cat: 'buildings', gi: 'bridge', keys: 'brücke brug bro', proper: GREY },
  { id: 'house', label: 'House', cat: 'buildings', gi: 'house', keys: 'haus hus huis home', proper: '#b3312c' },
  { id: 'barn', label: 'Farmstead', cat: 'buildings', gi: 'barn', keys: 'hof scheune bauernhof farm gård gaard', proper: '#b3312c' },
  { id: 'lighthouse', label: 'Lighthouse', cat: 'buildings', gi: 'lighthouse', keys: 'leuchtturm', proper: '#e8e6df' },
  { id: 'well', label: 'Well', cat: 'buildings', gi: 'well', keys: 'brunnen born', proper: GREY },
  { id: 'fountain', label: 'Fountain', cat: 'buildings', gi: 'fountain', keys: 'brunnen springbrunnen', proper: GREY },
  { id: 'longhouse', label: 'Longhouse', cat: 'buildings', gi: 'viking-longhouse', keys: 'langhaus hall', proper: BROWN },
  { id: 'pavilion', label: 'Pavilion', cat: 'buildings', gi: 'medieval-pavilion', keys: 'zelt tent', proper: '#e8e6df' },
  { id: 'hill-fort', label: 'Castle on a hill', cat: 'buildings', gi: 'hill-fort', plural: 'castles on hills', keys: 'burg berg', proper: GREY },

  // ---- crowns ----
  { id: 'crown', label: 'Crown', cat: 'crowns', gi: 'crown', core: true, keys: 'krone könig king', proper: '#d4a53c' },
  { id: 'imperial-crown', label: 'Imperial crown', cat: 'crowns', gi: 'imperial-crown', keys: 'krone kaiser', proper: '#d4a53c' },
  { id: 'mural-crown', label: 'Mural crown', cat: 'crowns', gi: 'crenel-crown', keys: 'mauerkrone town stadt', proper: GREY },
  { id: 'laurel', label: 'Crowned wreath', cat: 'crowns', gi: 'laurel-crown', core: true, keys: 'lorbeer kranz', proper: GREEN },
  { id: 'coronet', label: 'Coronet', cat: 'crowns', gi: 'jewel-crown', keys: 'krone diadem', proper: '#d4a53c' },
  { id: 'queen-crown', label: 'Queen’s crown', cat: 'crowns', gi: 'queen-crown', keys: 'krone königin', proper: '#d4a53c' },
  { id: 'tiara', label: 'Tiara', cat: 'crowns', gi: 'pope-crown', core: true, keys: 'mitra papst', proper: '#e8e6df' },

  // ---- objects ----
  { id: 'crowned-heart', label: 'Crowned heart', cat: 'objects', gi: 'crowned-heart', keys: 'herz krone', proper: '#b3312c' },
  { id: 'hand', label: 'Hand', cat: 'objects', gi: 'hand', keys: 'hand', proper: '#e5b293' },
  { id: 'open-hand', label: 'Open hand', cat: 'objects', gi: 'open-palm', keys: 'hand', proper: '#e5b293' },
  { id: 'bell', label: 'Bell', cat: 'objects', gi: 'ringing-bell', keys: 'glocke', proper: '#d4a53c' },
  { id: 'hunting-horn', label: 'Hunting horn', cat: 'objects', gi: 'hunting-horn', keys: 'horn jagdhorn bugle jäger', proper: '#d4a53c' },
  { id: 'trumpet', label: 'Trumpet', cat: 'objects', gi: 'trumpet', keys: 'trompete', proper: '#d4a53c' },
  { id: 'harp', label: 'Harp', cat: 'objects', gi: 'harp', keys: 'harfe', proper: '#d4a53c' },
  { id: 'lyre', label: 'Lyre', cat: 'objects', gi: 'lyre', keys: 'leier', proper: '#d4a53c' },
  { id: 'drum', label: 'Drum', cat: 'objects', gi: 'drum', keys: 'trommel', proper: BROWN },
  { id: 'cup', label: 'Covered cup', cat: 'objects', gi: 'holy-grail', keys: 'kelch pokal cup chalice becher', proper: '#d4a53c' },
  { id: 'chalice', label: 'Chalice', cat: 'objects', gi: 'jeweled-chalice', keys: 'kelch cup', proper: '#d4a53c' },
  { id: 'tankard', label: 'Tankard', cat: 'objects', gi: 'beer-stein', keys: 'krug bier brauer brewer', proper: GREY },
  { id: 'jug', label: 'Ewer', cat: 'objects', gi: 'jug', keys: 'krug kanne', proper: '#d4a53c' },
  { id: 'cauldron', label: 'Cauldron', cat: 'objects', gi: 'cauldron', keys: 'kessel', proper: '#3a3a36' },
  { id: 'lantern', label: 'Lantern', cat: 'objects', gi: 'lantern', keys: 'laterne', proper: '#d4a53c' },
  { id: 'torch', label: 'Torch', cat: 'objects', gi: 'torch', plural: 'torches', keys: 'fackel', proper: '#c8692b' },
  { id: 'candle', label: 'Candlestick', cat: 'objects', gi: 'candle-holder', keys: 'kerze leuchter', proper: '#d4a53c' },
  { id: 'ring', label: 'Gem ring', cat: 'objects', gi: 'ring', keys: 'ring', proper: '#d4a53c' },
  { id: 'coins', label: 'Coins', cat: 'objects', gi: 'two-coins', plural: 'pairs of coins', keys: 'münze geld', proper: '#d4a53c' },
  { id: 'sceptre', label: 'Winged sceptre', cat: 'objects', gi: 'winged-scepter', keys: 'zepter', proper: '#d4a53c' },
  { id: 'chess-knight', label: 'Chess knight', cat: 'objects', gi: 'chess-knight', keys: 'springer schach', proper: '#26241f', facing: true },
  { id: 'harp-lamp', label: 'Oil lamp', cat: 'objects', gi: 'magic-lamp', keys: 'lampe', proper: '#d4a53c' },
  { id: 'wine', label: 'Wine glass', cat: 'objects', gi: 'wine-glass', keys: 'weinglas glas', proper: '#e8e6df' },
  { id: 'horn', label: 'Drinking horn', cat: 'objects', gi: 'beer-horn', keys: 'trinkhorn', proper: '#d4a53c' },
];

export const CHARGE_BY_ID: Record<string, ChargeDef> = Object.fromEntries(CHARGES_V2.map((c) => [c.id, c]));

/** Helms for the achievement, by rank: a glyph and the metal it is drawn in. */
export const HELM_GLYPH: Record<'esquire' | 'knight' | 'peer' | 'royal', { gi: string; metal: string; label: string }> = {
  esquire: { gi: 'frog-mouth-helm', metal: '#9a9ea3', label: 'Esquire (tilting helm)' },
  knight: { gi: 'closed-barbute', metal: '#a9adb2', label: 'Knight (visor closed)' },
  peer: { gi: 'visored-helm', metal: '#c9ccd0', label: 'Peer (barred, silver)' },
  royal: { gi: 'visored-helm', metal: '#d9b04a', label: 'Royal (barred, gold)' },
};

/** Charges that make good supporters: they stand up and fill a tall space. */
export const SUPPORTERS = ['griffin', 'wolf-rampant', 'wyvern', 'pegasus', 'deer', 'centaur', 'mermaid', 'sea-serpent'];
/** Supporters whose glyph faces the viewer's left; the rest face right, so the dexter one already faces the shield. */
export const FACES_LEFT: ReadonlySet<string> = new Set(['mermaid']);
