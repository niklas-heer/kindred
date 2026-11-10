// node --test src/lib/photo-suggest.test.ts — who the face-box name picker lists first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { photoSuggestions } from './photo-suggest.ts';
import type { MediaItem } from './photos/types.ts';
import type { GPerson } from './types.ts';

const person = (id: string, born?: string, died?: string): GPerson => ({ id, given: id, born, died, living: !died, stories: 0, contacts: 0 });
const people = [person('old', '1871', '1940'), person('gran', '1930', '2010'), person('mum', '1958'), person('me', '1985'), person('kid', '2015'), person('undated')];
let tagId = 1;
const photo = (key: string, taken: string | null, album: string | null, who: string[], suggested: string[] = []): MediaItem => ({
  key, mime: 'image/jpeg', width: 4, height: 3, taken, place: null, caption: null, album, uploadedBy: 'x', uploadedAt: '2024-01-01',
  tags: [
    ...who.map((p) => ({ id: tagId++, person: p, box: { x: 0, y: 0, w: 0.1, h: 0.1 }, confirmed: true })),
    ...suggested.map((p) => ({ id: tagId++, person: p, box: { x: 0, y: 0, w: 0.1, h: 0.1 }, confirmed: false })),
  ],
});

test('people named in the same album come first, most often named first', () => {
  const item = photo('a', null, 'wedding', []);
  const all = [item, photo('b', null, 'wedding', ['mum', 'gran']), photo('c', null, 'wedding', ['gran']), photo('d', null, 'other', ['kid'])];
  assert.deepEqual(photoSuggestions(item, all, people), ['gran', 'mum']);
});

test('then people named in pictures from about the same time, then the reader’s family, then anyone alive that year', () => {
  const item = photo('a', '1990-06', null, []);
  const all = [item, photo('b', '1991', null, ['mum']), photo('c', '1960', null, ['old'])];
  assert.deepEqual(photoSuggestions(item, all, people, ['me', 'kid']), ['mum', 'me', 'kid', 'gran']);
});

test('someone already named in this picture is not offered again, and an unconfirmed guess elsewhere counts for nothing', () => {
  const item = photo('a', null, 'album', ['mum']);
  const all = [item, photo('b', null, 'album', ['mum', 'gran'], ['me'])];
  assert.deepEqual(photoSuggestions(item, all, people), ['gran']);
});

test('an undated picture in no album falls back to the reader’s family, and never invents people', () => {
  const item = photo('a', null, null, []);
  assert.deepEqual(photoSuggestions(item, [item], people, ['me', 'gone']), ['me']);
  assert.deepEqual(photoSuggestions(item, [item], people), []);
});
