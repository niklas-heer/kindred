// node --test src/lib/i18n/language.test.ts — the grammar the dictionary cannot hold in a single string: ordinals,
// sorting, whole anniversary names and sentence templates. Names are invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEYS, compareText, datePrecision, formatDate, ordinal, ordinalWord, translate, translateParts, type Key } from './dictionary.ts';
import { replyKey } from '../history.ts';

test('Afrikaans ordinals: -ste for 1, 8 and from 20 up, the last two digits past a hundred', () => {
  const af = (n: number) => ordinal(n, 'af');
  assert.deepEqual([1, 2, 3, 7, 8, 9, 10, 12, 19].map(af), ['1ste', '2de', '3de', '7de', '8ste', '9de', '10de', '12de', '19de']);
  assert.deepEqual([20, 21, 25, 28, 58, 99].map(af), ['20ste', '21ste', '25ste', '28ste', '58ste', '99ste']);
  assert.deepEqual([100, 101, 102, 108, 110, 120, 1000].map(af), ['100ste', '101ste', '102de', '108ste', '110de', '120ste', '1000ste']);
  assert.equal(ordinalWord(25, 'af'), '25ste');
  assert.equal(ordinal(25, 'de'), '25.');
  assert.equal(ordinal(21, 'en'), '21st');
});

test('names sort the way the reader’s language sorts them', () => {
  const names = ['Zimmer', 'Öberg', 'Muzzy', 'Müller', 'Ärmel', 'Anna 10', 'Anna 2', 'Berg'];
  assert.deepEqual([...names].sort(compareText('de')), ['Anna 2', 'Anna 10', 'Ärmel', 'Berg', 'Müller', 'Muzzy', 'Öberg', 'Zimmer']);
  assert.deepEqual([...names].sort(compareText('en')).slice(0, 3), ['Anna 2', 'Anna 10', 'Ärmel']);
  assert.ok(compareText('af')('Öberg', 'Zimmer') < 0);
});

test('a wedding anniversary carries its whole name in each language', () => {
  const name = (l: 'en' | 'de' | 'af', k: string, n: string) =>
    translate(l, 'almanac.anniversary_note', { ord: n, name: translate(l, `almanac.wedding.${k}` as Key) });
  assert.equal(name('de', 'y50', '50.'), '50. Hochzeitstag · Goldene Hochzeit');
  assert.equal(name('de', 'y35', '35.'), '35. Hochzeitstag · Leinwandhochzeit');
  assert.equal(name('de', 'y60', '60.'), '60. Hochzeitstag · Diamantene Hochzeit');
  assert.equal(name('af', 'y50', '50ste'), '50ste trouherdenking · goue bruilof');
  assert.equal(name('en', 'y25', '25th'), '25th anniversary · silver wedding');
  for (const k of KEYS.filter((k) => k.startsWith('almanac.wedding.'))) {
    assert.match(translate('de', k), /^[A-ZÄÖÜ].*(hochzeit| Hochzeit)$/, `${k} is a whole German name`);
    assert.match(translate('af', k), /bruilof$/, `${k} is a whole Afrikaans name`);
  }
});

test('a chronicle line is one sentence per language, with the parts where each language puts them', () => {
  const line = (l: 'en' | 'de' | 'af', kind: string) =>
    translateParts(l, `chronicle.line.${kind}` as Key, ['author', 'subject'])
      .map((p) => (typeof p === 'string' ? p : p.slot === 'author' ? 'Linnea Reyes' : 'Sven Ström'))
      .join('');
  assert.equal(line('de', 'quote'), 'Linnea Reyes hat einen Spruch von Sven Ström festgehalten');
  assert.equal(line('de', 'anecdote'), 'Linnea Reyes hat eine Geschichte über Sven Ström erzählt');
  assert.equal(line('af', 'quote'), 'Linnea Reyes het ’n gesegde van Sven Ström aangeteken');
  assert.equal(line('af', 'memory'), 'Linnea Reyes onthou Sven Ström');
  assert.equal(line('en', 'recipe'), 'Linnea Reyes shared a recipe from Sven Ström');
  assert.deepEqual(translateParts('de', 'chronicle.line.memory', ['author', 'subject']), [{ slot: 'author' }, ' erinnert sich an ', { slot: 'subject' }]);
});

test('a sentence around a date takes the words for how much of the date is known', () => {
  assert.deepEqual(['1890-05-03', '1890-05', '1890', '~1890', '~1890-05'].map(datePrecision), ['day', 'month', 'year', 'about', 'about']);
  const born = (l: 'de' | 'af', d: string) => translate(l, `feed.value.born_in_${datePrecision(d)}` as Key, { date: formatDate(d, l), place: 'Graz' });
  assert.equal(born('de', '1890-05-03'), 'geboren am 3. Mai 1890 in Graz');
  assert.equal(born('de', '1890-05'), 'geboren im Mai 1890 in Graz');
  assert.equal(born('de', '1890'), 'geboren 1890 in Graz');
  assert.equal(born('af', '1890'), 'gebore in 1890 in Graz');
});

test('one comment names its writer; several are counted without a name', () => {
  const text = (count: number) => translate('en', replyKey({ kind: 'comment', target: 'story', count }), { author: 'Ada', count });
  assert.equal(text(1), 'Ada commented on your memory');
  assert.equal(text(3), '3 new comments on your memory');
  assert.equal(replyKey({ kind: 'reaction', target: 'post', count: 1 }), 'history.reply.reaction_post');
});

test('a count that the screen fills in itself still chooses the plural form', () => {
  assert.deepEqual(translateParts('de', 'almanac.count.birthday', ['count'], { count: 1 }), [{ slot: 'count' }, ' Geburtstag']);
  assert.deepEqual(translateParts('de', 'almanac.count.birthday', ['count'], { count: 3 }), [{ slot: 'count' }, ' Geburtstage']);
});
