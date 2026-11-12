import assert from 'node:assert/strict';
import { test } from 'node:test';
import { foldText } from './address.ts';
import { COLOURS, FAVOURITE_WORDS, colourName, favouriteWords, isColourLabel, parseColours, toggleColour } from './favourites.ts';

const ids = (t: string) => parseColours(t).map((x) => x.colour?.id);

test('several colours, however they were joined', () => {
  assert.deepEqual(ids('Blau & Türkis'), ['blue', 'turquoise']);
  assert.deepEqual(ids('red, green; blue/yellow + white'), ['red', 'green', 'blue', 'yellow', 'white']);
  assert.deepEqual(ids('Rot und Grün'), ['red', 'green']);
  assert.deepEqual(ids('Rooi en Groen'), ['red', 'green']);
  assert.deepEqual(ids('red and blue'), ['red', 'blue']);
});

test('names in every language, spelling and alias reach the colour', () => {
  for (const c of COLOURS) for (const n of [colourName(c, 'en'), colourName(c, 'de'), colourName(c, 'af')]) assert.ok(parseColours(n)[0].colour, n);
  assert.equal(parseColours('gray')[0].colour?.id, 'grey');
  assert.equal(parseColours('HELLBLAU')[0].colour?.id, 'sky');
});

test('a colour no one named keeps its words and has no swatch', () => {
  const [t] = parseColours('Dusty rose');
  assert.equal(t.text, 'Dusty rose');
  assert.equal(t.colour, undefined);
  assert.deepEqual(parseColours(''), []);
});

test('the swatches add and remove a colour, leaving the rest as written', () => {
  const blue = COLOURS.find((c) => c.id === 'blue')!;
  assert.equal(toggleColour('', blue, 'de'), 'Blau');
  assert.equal(toggleColour('Dusty rose', blue, 'en'), 'Dusty rose, Blue');
  assert.equal(toggleColour('Blau & Türkis', blue, 'de'), 'Türkis');
  assert.equal(toggleColour('blue', blue, 'de'), '');
});

test('every colour and word is named in all three languages, once', () => {
  for (const l of ['en', 'de', 'af'] as const) {
    const names = COLOURS.map((c) => foldText(colourName(c, l)));
    assert.deepEqual(names.filter((x, i) => names.indexOf(x) !== i), [], l);
    for (const c of COLOURS) assert.match(c.hex, /^#[0-9a-f]{6}$/);
  }
  for (const l of ['en', 'de', 'af'] as const) {
    for (const kind of Object.keys(FAVOURITE_WORDS)) {
      const words = favouriteWords(kind, l);
      assert.equal(words.length, FAVOURITE_WORDS[kind].length);
      for (const w of words) assert.ok(w.trim(), kind);
    }
  }
});

test('the usual choices come in the reader\'s language', () => {
  assert.ok(favouriteWords('flower', 'af').includes('Sonneblom'));
  assert.ok(favouriteWords('food', 'de').includes('Suppe'));
  assert.deepEqual(favouriteWords('nothing', 'en'), []);
});

test('a family\'s own word for colour counts', () => {
  for (const l of ['colour', 'Color', 'Farbe', 'Kleur', 'Lieblingsfarbe']) assert.ok(isColourLabel(l), l);
  assert.equal(isColourLabel('food'), false);
});
