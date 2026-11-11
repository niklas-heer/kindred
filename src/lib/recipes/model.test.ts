// The recipe model: pasted lines become rows, amounts scale, and the written-out recipe reads as one.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseServings,
  cleanRecipe, cleanTags, factorFor, formatAmount, hasSubstance, ingredientLine, minutesText, numberOf, parseIngredient, parseIngredientLines, parseStepLines,
  recipeImageUrl, recipeMarkdown, scaleAmount, MAX_STEP_IMAGES, MAX_TAGS,
} from './model.ts';

test('a pasted line becomes amount, unit, item and note', () => {
  assert.deepEqual(parseIngredient('800 g Rindfleisch, gewürfelt'), { amount: '800', unit: 'g', item: 'Rindfleisch', note: 'gewürfelt' });
  assert.deepEqual(parseIngredient('1 1/2 cups flour (sifted)'), { amount: '1 1/2', unit: 'cups', item: 'flour', note: 'sifted' });
  assert.deepEqual(parseIngredient('2 Zwiebeln'), { amount: '2', unit: '', item: 'Zwiebeln', note: '' });
  assert.deepEqual(parseIngredient('500g beef'), { amount: '500', unit: 'g', item: 'beef', note: '' });
  assert.deepEqual(parseIngredient('2 EL Paprikapulver, edelsüß'), { amount: '2', unit: 'EL', item: 'Paprikapulver', note: 'edelsüß' });
  assert.deepEqual(parseIngredient('½ tsp caraway seeds'), { amount: '½', unit: 'tsp', item: 'caraway seeds', note: '' });
  assert.deepEqual(parseIngredient('2-3 cloves garlic, crushed'), { amount: '2-3', unit: 'cloves', item: 'garlic', note: 'crushed' });
  assert.deepEqual(parseIngredient('1,5 l Rinderbrühe'), { amount: '1,5', unit: 'l', item: 'Rinderbrühe', note: '' });
  assert.deepEqual(parseIngredient('2 eetlepels botter'), { amount: '2', unit: 'eetlepels', item: 'botter', note: '' });
  assert.deepEqual(parseIngredient('1 Msp. Muskat'), { amount: '1', unit: 'Msp', item: 'Muskat', note: '' });
});

test('words alone are the item, and a unit is only ever a whole word', () => {
  assert.deepEqual(parseIngredient('Salz und Pfeffer'), { amount: '', unit: '', item: 'Salz und Pfeffer', note: '' });
  assert.deepEqual(parseIngredient('2 eggs'), { amount: '2', unit: '', item: 'eggs', note: '' });
  assert.deepEqual(parseIngredient('3 large tomatoes'), { amount: '3', unit: '', item: 'large tomatoes', note: '' });
  assert.deepEqual(parseIngredient('2 Tomaten'), { amount: '2', unit: '', item: 'Tomaten', note: '' });
  assert.deepEqual(parseIngredient('Eier'), { amount: '', unit: '', item: 'Eier', note: '' });
  assert.deepEqual(parseIngredient('2 cloves'), { amount: '2', unit: '', item: 'cloves', note: '' });
  assert.deepEqual(parseIngredient('Prise Salz'), { amount: '', unit: 'Prise', item: 'Salz', note: '' });
  // A list mark is dropped, the amount stays.
  assert.deepEqual(parseIngredient('- 2 onions'), { amount: '2', unit: '', item: 'onions', note: '' });
  assert.deepEqual(parseIngredient('• 250 ml cream'), { amount: '250', unit: 'ml', item: 'cream', note: '' });
});

test('a pasted list keeps its groups', () => {
  const groups = parseIngredientLines('800 g beef\n2 onions\n\nFor the dumplings:\n250 g flour\n2 eggs\n\n## Sauce\n1 tbsp paprika');
  assert.deepEqual(groups.map((g) => [g.name, g.items.length]), [['', 2], ['For the dumplings', 2], ['Sauce', 1]]);
  assert.equal(groups[1]!.items[0]!.item, 'flour');
  // A heading with nothing under it is dropped.
  assert.deepEqual(parseIngredientLines('Sauce:\n\n'), []);
  assert.deepEqual(parseIngredientLines('2 onions\r\n1 carrot').map((g) => g.items.length), [2]);
});

test('a pasted method becomes steps without its numbers', () => {
  assert.deepEqual(parseStepLines('1. Brown the beef.\n2) Add the onions.\nStep 3: Simmer.'), ['Brown the beef.', 'Add the onions.', 'Simmer.']);
  // Paragraphs win over lines when the text has them.
  assert.deepEqual(parseStepLines('Brown the beef\nin batches.\n\nAdd the onions.'), ['Brown the beef in batches.', 'Add the onions.']);
});

test('written numbers are read', () => {
  assert.equal(numberOf('1 1/2'), 1.5);
  assert.equal(numberOf('¾'), 0.75);
  assert.equal(numberOf('1½'), 1.5);
  assert.equal(numberOf('1,5'), 1.5);
  assert.equal(numberOf('3/4'), 0.75);
  assert.equal(numberOf('1/0'), null);
  assert.equal(numberOf('a pinch'), null);
});

test('a point between groups of three is a thousands separator: "1.000 g Mehl" is a kilogram', () => {
  assert.equal(numberOf('1.000'), 1000);
  assert.equal(numberOf('2.500'), 2500);
  assert.equal(numberOf('1.000.000'), 1_000_000);
  assert.equal(numberOf('1.000,5'), 1000.5);
  // Not when it cannot be one: a decimal with fewer figures, or a nought before the point.
  assert.equal(numberOf('1.5'), 1.5);
  assert.equal(numberOf('1.25'), 1.25);
  assert.equal(numberOf('0.250'), 0.25);
  assert.deepEqual(parseIngredient('1.000 g Mehl'), { amount: '1.000', unit: 'g', item: 'Mehl', note: '' });
  for (const locale of ['de', 'en']) {
    assert.equal(scaleAmount('1.000', 0.5, locale), '500', locale);
    assert.equal(scaleAmount('1.000', 2, locale), '2000', locale);
    assert.equal(scaleAmount('1.500', 1 / 3, locale), '500', locale);
  }
  assert.equal(scaleAmount('1.000,5', 2, 'de'), '2001');
  assert.equal(scaleAmount('0.250', 2, 'en'), '0.5');
  assert.equal(scaleAmount('0,250', 2, 'de'), '0,5');
});

test('amounts scale, and words stay words', () => {
  assert.equal(scaleAmount('1 1/2', 2), '3');
  assert.equal(scaleAmount('1', 0.5), '½');
  assert.equal(scaleAmount('3', 0.5), '1½');
  assert.equal(scaleAmount('2-3', 2), '4–6');
  assert.equal(scaleAmount('800', 1.5), '1200');
  assert.equal(scaleAmount('250', 0.5), '125');
  assert.equal(scaleAmount('1', 1 / 3), '⅓');
  // The writer used a decimal, so they get one back, in the reader's notation.
  assert.equal(scaleAmount('1,5', 2, 'de'), '3');
  assert.equal(scaleAmount('1,5', 0.5, 'de'), '0,75');
  assert.equal(scaleAmount('1.5', 0.5, 'en'), '0.75');
  assert.equal(scaleAmount('a pinch', 2), 'a pinch');
  assert.equal(scaleAmount('', 2), '');
  // At 1× the writer's own spelling stands.
  assert.equal(scaleAmount('1 1/2', 1), '1 1/2');
  assert.equal(formatAmount(133.333), '133');
  assert.equal(formatAmount(12.5), '12½');
  assert.equal(formatAmount(26.666, 'en'), '26.7');
  // A tiny amount never scales to nothing.
  assert.equal(formatAmount(0.0125), '0.01');
  assert.equal(formatAmount(0.0125, 'de'), '0,01');
  assert.equal(formatAmount(0.004), '0.004');
  assert.notEqual(scaleAmount('1/8', 0.1), '');
  assert.equal(scaleAmount('1/8', 0.1), '0.01');
  assert.equal(formatAmount(0), '');
  assert.equal(factorFor(4, 6), 1.5);
  assert.equal(factorFor(null, 6), 1);
});

test('a line of the list and a time read naturally', () => {
  assert.equal(ingredientLine({ amount: '800', unit: 'g', item: 'beef', note: 'diced' }, 2), '1600 g beef, diced');
  assert.equal(ingredientLine({ amount: '', unit: '', item: 'salt', note: '' }), 'salt');
  assert.equal(minutesText(20), '20 min');
  assert.equal(minutesText(90), '1 h 30 min');
  assert.equal(minutesText(120), '2 h');
  assert.equal(minutesText(0), '0 min');
});

test('a recipe is cleaned to what is stored', () => {
  const r = cleanRecipe({
    source: '  Grandma’s  ', servings: 4.4, prepMinutes: -3, cookMinutes: 150,
    groups: [{ name: '', items: [{ amount: ' 800 ', unit: 'g', item: ' beef ', note: '' }, { amount: '2', unit: '', item: '   ', note: '' }] }, { name: 'Empty', items: [] }],
    steps: [{ text: ' Brown the beef. ', image: null }, { text: '', image: null }, { text: '', image: 'recipe/a.jpg' }],
    notes: 'Better\r\n\r\n\r\n\r\nthe next day.', tags: ['Soup', 'soup', '#Christmas', ''],
  });
  assert.equal(r.source, 'Grandma’s');
  assert.equal(r.servings, 4);
  assert.equal(r.prepMinutes, null);
  assert.equal(r.cookMinutes, 150);
  assert.deepEqual(r.groups, [{ name: '', items: [{ amount: '800', unit: 'g', item: 'beef', note: '' }] }]);
  assert.deepEqual(r.steps, [{ text: 'Brown the beef.', image: null }, { text: '', image: 'recipe/a.jpg' }]);
  assert.equal(r.notes, 'Better\n\nthe next day.');
  assert.deepEqual(r.tags, ['Soup', 'Christmas']);
  assert.equal(hasSubstance(r), true);
  assert.equal(hasSubstance(cleanRecipe({ notes: 'only words' })), false);
});

test('tags and step pictures have their limits', () => {
  assert.equal(cleanTags(Array.from({ length: 30 }, (_, i) => `tag ${i}`)).length, MAX_TAGS);
  assert.deepEqual(cleanTags(['Café', 'cafe', 'CAFÉ']), ['Café']);
  const r = cleanRecipe({ steps: Array.from({ length: 10 }, (_, i) => ({ text: `step ${i}`, image: `recipe/${i}.jpg` })) });
  assert.equal(r.steps.filter((s) => s.image).length, MAX_STEP_IMAGES);
  assert.equal(r.steps.length, 10);
});

test('the written-out recipe is readable Markdown, and what was typed stays text', () => {
  const md = recipeMarkdown(cleanRecipe({
    source: 'Oma Hildes', servings: 4, prepMinutes: 20, cookMinutes: 150,
    groups: [{ name: '', items: [{ amount: '800', unit: 'g', item: 'beef', note: 'diced' }] }, { name: 'To serve', items: [{ amount: '', unit: '', item: 'bread_rolls', note: '' }] }],
    steps: [{ text: 'Brown the beef.', image: null }, { text: 'Simmer <slowly>.', image: null }],
    notes: 'Better the next day.',
  }));
  assert.equal(md, [
    '*Oma Hildes · Serves 4 · Preparation 20 min · Cooking 2 h 30 min*', '',
    '**Ingredients**', '', '- 800 g beef, diced', '', '*To serve*', '', '- bread\\_rolls', '',
    '**Method**', '', '1. Brown the beef.', '2. Simmer \\<slowly\\>.', '',
    '**Notes**', '', 'Better the next day.',
  ].join('\n'));
  assert.equal(recipeMarkdown(cleanRecipe({})), '');
});

test('a picture has its own address, away from the gallery', () => {
  assert.equal(recipeImageUrl('modern', 'recipe/abc.jpg'), '/api/recipe/modern/abc.jpg');
  assert.equal(recipeImageUrl('modern', 'recipe/abc.jpg', 'thumb'), '/api/recipe/modern/abc.jpg?size=thumb');
});

test('the servings box reads a comma or a point, and refuses nothing, none and too many', () => {
  assert.equal(parseServings('1,5'), 1.5);
  assert.equal(parseServings(' 1.5 '), 1.5);
  assert.equal(parseServings('4'), 4);
  assert.equal(parseServings('2.'), 2);
  assert.equal(parseServings(',5'), 0.5);
  for (const bad of ['', ' ', '0', '0,0', '1000', 'abc', '1,5,5', '-2', '1e3']) assert.equal(parseServings(bad), null, bad);
});
