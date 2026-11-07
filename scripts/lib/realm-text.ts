// Story and biography text for the realm of Aurelmarch. Templates with random slots, so each story reads
// differently while the wording stays specific. Everything draws from the passed-in rng.

import type { Rng } from './rng.ts';

export interface TextSubject {
  name: string; // given name, e.g. "Mathilde"
  title?: string; // e.g. "Duchess of Brisach"
  sex: 'm' | 'f';
  place: string; // seat or home
  year: number;
  house?: string; // "House Valcourt"
}

export type StoryKind = 'note' | 'quote' | 'anecdote' | 'recipe' | 'memory';

export interface StoryDraft {
  kind: StoryKind;
  title?: string;
  body: string;
  author: string;
  context?: string;
}

const CHRONICLES = [
  'The Chronicle of Saint-Aubin',
  'The Brisach Annals',
  'Annals of Valmorel',
  'The Ardelle Roll',
  'The register of Brother Anselm',
  'The Oberhaun Chronicle',
];

const MONKS = ['Brother Anselm', 'Brother Odo the Copyist', 'Prior Gerard', 'Brother Tiburce', 'Sister Ermengard, precentor'];

const KINSFOLK = [
  'Aunt Gisla', 'Cousin Ysolde', 'Her steward, Pons', 'Nurse Berthe', 'Her younger brother Remi',
  'The household at Greywater', 'A lady-in-waiting, Doria', 'Grandmother Adelais', 'Her squire, Kenric',
];

const DEEDS = [
  'held the ford below {place} against the Ostrand levies',
  'rebuilt the bridge at {place} after the flood',
  'sealed the charter of the wool-guild at {place}',
  'endowed a chantry in the chapel at {place}',
  'took the tithe of the eastern parishes in person',
  'settled the quarrel over the mill at {place}',
  'rode out to meet the envoys of the emperor',
  'hanged three men at the crossroads and wept afterwards',
];

const OBJECTS = ['psalter', 'hunting horn', 'silver cup', 'grey warhorse', 'hawk named Sorrow', 'lute', 'ring of green glass', 'carved chess set'];
const ANIMALS = ['hound', 'falcon', 'grey mare', 'stag', 'old wolfhound', 'barn cat'];
const DISHES = [
  'spiced pears', 'honeyed almonds', 'saffron lamb', 'barley pottage', 'elderflower wine', 'quince paste', 'frumenty',
];

const QUOTES = [
  'Bread is cheaper than walls, and the walls are coming down anyway.',
  'A king who sleeps well has not been listening.',
  'Bring me the ledger, not the excuse.',
  'Let them sing, but count the choir.',
  'I would rather be loved in Saint-Aubin than feared in Valmorel.',
  'The moor does not forgive, and neither do I.',
  'If God wanted us patient, He would have made the rivers slower.',
  'Pray for the dead, and then go and feed the living.',
];

const QUOTE_CONTEXT = [
  'Said in the great hall at {place}, {year}, to a steward who had asked for more silver.',
  'Overheard by a clerk at {place} in the winter of {year}.',
  'Spoken from the saddle at {place}, {year}, while the rain came down.',
  'Recorded at the feast of the Assumption, {place}, {year}.',
];

const ANECDOTE_OPENERS = [
  'On the morning of the wedding at {place}, {name} forgot the ring and sent a boy running back for it.',
  'The night before the siege of {place}, {name} played dice with the cook and lost the {object}.',
  'When the frost came early in {year}, {name} walked the {place} walls with a lantern and no escort.',
  'At the harvest fair, {name} bought every apple in the market and gave them to the children of {place}.',
];

const ANECDOTE_ENDINGS = [
  'The household still tells it at Christmas, and gets it wrong every time.',
  'Nobody remembers who won, but everybody agrees the {animal} was in the right.',
  '{Pron} never admitted it, but {poss} hands were shaking for an hour.',
];

const MEMORY_OPENERS = [
  'I was small when {name} took me to see the {animal} at {place}.',
  'I remember {name} at the window of the solar in {year}, counting the boats on the {place} road.',
  'The last time I saw {name}, {pron} was teaching the {animal} to sit, and swearing at it in two languages.',
];

const NOTE_TEMPLATES = [
  '{chronicle} records that {name} {deed}, and adds that the abbey bells were rung for the whole of the vigil.',
  '{chronicle} gives {year} as the year {name} first took up the {object} of the house. The scribe notes it was raining.',
  'In {year}, {name} {deed}. {chronicle} is quieter about the cost, which was considerable.',
];

function fill(template: string, subject: TextSubject, extra: Record<string, string>, rng: Rng): string {
  const pron = subject.sex === 'f' ? 'she' : 'he';
  const poss = subject.sex === 'f' ? 'her' : 'his';
  const vars: Record<string, string> = {
    name: subject.name,
    place: subject.place,
    year: String(subject.year),
    pron,
    Pron: pron.charAt(0).toUpperCase() + pron.slice(1),
    poss,
    object: rng.pick(OBJECTS),
    animal: rng.pick(ANIMALS),
    ...extra,
  };
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = vars[key];
    if (v === undefined) throw new Error(`missing template slot ${key}`);
    return v;
  });
}

function author(rng: Rng, kind: StoryKind): string {
  return kind === 'note' || rng.chance(0.2) ? rng.pick(CHRONICLES) : rng.chance(0.5) ? rng.pick(MONKS) : rng.pick(KINSFOLK);
}

export function makeStory(rng: Rng, subject: TextSubject): StoryDraft {
  const roll = rng.next();
  if (roll < 0.3) {
    const chronicle = rng.pick(CHRONICLES);
    const deed = fill(rng.pick(DEEDS), subject, {}, rng);
    return {
      kind: 'note',
      body: fill(rng.pick(NOTE_TEMPLATES), subject, { chronicle, deed }, rng),
      author: chronicle,
    };
  }
  if (roll < 0.5) {
    const quote = rng.pick(QUOTES);
    return {
      kind: 'quote',
      body: `"${quote}"`,
      author: subject.name,
      context: fill(rng.pick(QUOTE_CONTEXT), subject, {}, rng),
    };
  }
  if (roll < 0.7) {
    return {
      kind: 'anecdote',
      title: 'The ' + rng.pick(['frost', 'ring', 'apples', 'dice', 'wedding', 'hound']) + ' affair',
      body: fill(rng.pick(ANECDOTE_OPENERS), subject, {}, rng) + ' ' + fill(rng.pick(ANECDOTE_ENDINGS), subject, {}, rng),
      author: author(rng, 'anecdote'),
    };
  }
  if (roll < 0.85) {
    const dish = rng.pick(DISHES);
    const honorific = subject.title?.match(/^(King|Queen|Duke|Duchess|Count|Countess|Bishop|Abbess|Knight)\b/)?.[1];
    const who = honorific ? `${honorific} ${subject.name}` : subject.name;
    return {
      kind: 'recipe',
      title: `${who}'s ${dish}`,
      body: [
        `- ${rng.int(3, 9)} measures of the best of the season's ${dish.split(' ').slice(-1)[0]}`,
        '- a spoonful of honey, or two if the cook is kind',
        '- a pinch of saffron, which must be bought, never borrowed',
        '',
        `${subject.name} insisted it be eaten before compline, and always stood over the pot.`,
      ].join('\n'),
      author: rng.pick(KINSFOLK),
    };
  }
  return {
    kind: 'memory',
    title: `${subject.name} at ${subject.place}`,
    body: fill(rng.pick(MEMORY_OPENERS), subject, {}, rng),
    author: author(rng, 'memory'),
  };
}

export function makeBio(rng: Rng, subject: TextSubject, epithet?: string): string {
  const bySex = subject.sex === 'f' ? 'She' : 'He';
  const lines = [
    `**${subject.name}${epithet ? ' ' + epithet : ''}**${subject.house ? ` of ${subject.house}` : ''} is remembered as ${rng.pick(['patient', 'stubborn', 'generous', 'careful', 'quick to anger'])}.`,
    subject.title
      ? `${bySex} bore the style ${subject.title}, with the seat at ${subject.place}.`
      : `${bySex} kept house at ${subject.place}.`,
  ];
  if (rng.chance(0.5)) {
    lines.push(`${bySex === 'She' ? 'Her' : 'His'} household kept ${rng.pick(['a good cellar', 'the best hounds', 'an old psalter', 'a library of forty books'])}.`);
  }
  return lines.join(' ');
}
