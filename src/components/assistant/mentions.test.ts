import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkMentions } from './mentions.ts';

const opts = {
  tree: 'modern',
  people: [
    { id: 'p0084', name: 'Kerstin Holm' },
    { id: 'p0082', name: 'Kjell Holm' },
    { id: 'p0008', name: 'Kerstin Lindqvist' },
    { id: 'p0100', name: 'Anna Berg' },
    { id: 'p0101', name: 'Anna Berg' },
    { id: 'p0102', name: 'Ingrid' },
  ],
  places: ['Uppsala', 'Oslo (north)', 'Ui'],
};

test('a full name becomes a link to that person, in bold and out', () => {
  assert.equal(
    linkMentions('**Kerstin Holm** is married to Kjell Holm.', opts),
    '**[Kerstin Holm](/modern?focus=p0084)** is married to [Kjell Holm](/modern?focus=p0082).',
  );
});

test('the longer name wins when one name contains another', () => {
  assert.equal(linkMentions('Kerstin Lindqvist and Kerstin Holm', opts), '[Kerstin Lindqvist](/modern?focus=p0008) and [Kerstin Holm](/modern?focus=p0084)');
});

test('a name shared by two people is not linked, and a single word is not linked', () => {
  assert.equal(linkMentions('Anna Berg, and Ingrid came.', opts), 'Anna Berg, and Ingrid came.');
});

test('text inside an existing link, a code span or an address is left as written', () => {
  const src = 'See [Kjell Holm](https://example.org), `Kjell Holm` and https://example.org/Kjell_Holm.';
  assert.equal(linkMentions(src, opts), src);
});

test('a name is not linked inside a longer word', () => {
  assert.equal(linkMentions('Kjell Holmgren', opts), 'Kjell Holmgren');
});

test('places link to the atlas, encoded so Markdown reads the whole address', () => {
  assert.equal(
    linkMentions('Born in Uppsala, near Oslo (north).', opts),
    'Born in [Uppsala](/modern/atlas?place=Uppsala), near [Oslo (north)](/modern/atlas?place=Oslo%20%28north%29).',
  );
});

test('a short place name is not linked', () => {
  assert.equal(linkMentions('Ui', opts), 'Ui');
});

test('nothing to link returns the text unchanged', () => {
  assert.equal(linkMentions('Nothing here.', { tree: 'modern', people: [], places: [] }), 'Nothing here.');
});
