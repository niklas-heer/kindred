// Family-wiki contributions for the Lindqvist–Ashworth tree: quotes, recipes, memories, notes, anecdotes.
// Templates with random slots; authors are relatives, so the voice is warm and specific.

import type { Rng } from './rng.ts';
import { PLACES_MODERN } from './modern-data.ts';

export interface ModernSubject {
  label: string; // "Oma Ingrid", "Farbror Lars", "Dad", "Tom"
  sex: 'm' | 'f' | 'x';
  place: string;
}

export interface ModernDraft {
  kind: 'note' | 'quote' | 'anecdote' | 'recipe' | 'memory';
  title?: string;
  body: string;
  context?: string;
}

const QUOTES = [
  'Det ordnar sig. It always does, in the end.',
  'Eat something first, then we will talk about it.',
  'You do not need a reason to bake bread on a Tuesday.',
  'Wear the good coat. You never know who will be looking.',
  'Tea before the tears, always.',
  'Lock the door, but leave the kettle on.',
  'We are not rich, but we are never short of stories.',
  'A boat is only a hole in the water you pay for, so pay gladly.',
  'If it is not worth a walk, it is not worth a car.',
  'Make a list, then lose the list. The list was never the point.',
];

const QUOTE_CONTEXT = [
  'Said over the washing-up after Midsommar in {place}, {year}.',
  'Said on the platform at {place} when the train was late again, {year}.',
  'Said at the kitchen table, {place}, the winter the pipes froze.',
  'Repeated at every birthday since {year}.',
];

/** Each dish carries its own ingredients, so a recipe never mixes two kitchens. */
const RECIPES: [string, string[]][] = [
  ['kanelbullar', ['- 500 g strong flour, 25 g butter, 1 egg', '- 2 dl milk, 1 tsp cardamom, a pinch of salt']],
  ['Yorkshire puddings', ['- 150 g plain flour, 2 eggs, 150 ml milk', '- beef dripping, very hot, and no timidity']],
  ['pickled herring', ['- 4 herring fillets, 2 dl vinegar, 1 dl sugar', '- onion rings, allspice, two bay leaves']],
  ['rhubarb crumble', ['- 500 g rhubarb, 100 g sugar, a splash of orange', '- 120 g oats, 80 g flour, 80 g cold butter']],
  ['Bienenstich', ['- 250 g flour, 125 g butter, 1 egg', '- 100 g flaked almonds, 100 g honey, 2 tbsp cream']],
  ['lingonberry pancakes', ['- 2 dl flour, 3 dl milk, 2 eggs', '- a jar of lingonberries, warmed gently']],
];

const MEMORY_OPENERS = [
  'The summer we drove up to {place} with the caravan, {label} sang the whole way and nobody minded.',
  'I still have the postcard {label} sent from {place} in {year}: "Weather dreadful, cake excellent."',
  'Christmas Eve in {place}, {label} burnt the rice pudding and laughed so hard the almond was never found.',
  'The first time I saw the sea at {place}, {label} held my hand and said nothing, which was exactly right.',
];

const NOTES = [
  'Allergic to nuts. Please, really, check the cake tins before you bring anything.',
  'Gift ideas: a proper hiking map, a good bread knife, anything with a bird on it.',
  'Prefers tea to coffee, and will tell you so if you forget.',
  'Shoe size 42 in Swedish, but the wide fit. Do not buy the narrow ones again.',
  'Lactose intolerant, so the cream goes on the side, thank you.',
  'Keep the spare key with the neighbour at number 14, not with Tom.',
  'Birthday: plan the walk in the morning, the cake in the afternoon, and no speeches.',
];

const ANECDOTES = [
  'On the ferry to Gotland, {label} tried to feed a seagull a whole pastry and the gull won, with the pastry.',
  'When the boat at {place} would not start, {label} rowed back to the harbour in a borrowed hat and sang the whole way.',
  'At the school play, {label} forgot the lines and improvised a song about the lighthouse, which the teacher still asks about.',
  'The garden hose incident at {place} is spoken about in hushed tones. Nobody confessed. Everybody knows.',
];

function fill(template: string, subject: ModernSubject, year: number): string {
  const vars: Record<string, string> = {
    label: subject.label,
    place: subject.place,
    year: String(year),
  };
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = vars[key];
    if (v === undefined) throw new Error(`missing modern slot ${key}`);
    return v;
  });
}

export function makeModernStory(rng: Rng, subject: ModernSubject): ModernDraft {
  const year = rng.int(1975, 2025);
  const roll = rng.next();
  if (roll < 0.25) {
    return {
      kind: 'quote',
      body: `"${rng.pick(QUOTES)}"`,
      context: fill(rng.pick(QUOTE_CONTEXT), { ...subject, place: subject.place || rng.pick(PLACES_MODERN) }, year),
    };
  }
  if (roll < 0.45) {
    const [dish, lines] = rng.pick(RECIPES);
    return {
      kind: 'recipe',
      title: `${subject.label}'s ${dish}`,
      body: [
        `Written down from memory, so the quantities are guesses.`,
        '',
        ...lines,
        '- a little patience, and the radio on',
        '',
        `${subject.label} always said it was the butter that made the difference, not the oven.`,
      ].join('\n'),
    };
  }
  if (roll < 0.65) {
    return {
      kind: 'memory',
      title: `${subject.place}, ${year}`,
      body: fill(rng.pick(MEMORY_OPENERS), subject, year),
    };
  }
  if (roll < 0.85) {
    return { kind: 'note', title: 'Practical', body: rng.pick(NOTES) };
  }
  return {
    kind: 'anecdote',
    title: 'The story everyone tells',
    body: fill(rng.pick(ANECDOTES), subject, year),
  };
}
