// A small invented family for the exchange tests. Every case the formats must carry is in it: partial and
// approximate dates, two marriages for one person (one ended by divorce, one by death), a partnership, an
// adoptive pair of parents, a step link, a married name, a biography with "@" and line breaks and text long
// enough to need continuation lines, and a portrait. Nobody here is real.
import type { ExPerson, ExTree } from './model.ts';

const base = (p: Partial<ExPerson> & Pick<ExPerson, 'id' | 'given'>): ExPerson => ({
  furtherGiven: [],
  surname: null,
  currentGiven: null,
  currentSurname: null,
  sex: null,
  born: null,
  bornPlace: null,
  died: null,
  diedPlace: null,
  living: false,
  title: null,
  epithet: null,
  occupation: null,
  nickname: null,
  bio: null,
  portrait: null,
  ...p,
});

export const LONG_BIO = [
  'Anna kept the bakery on the square and wrote @letters@ to every cousin she had, every Sunday, for forty years.',
  '',
  'It was said she never once used a stamp she had not licked herself, which may be true. ' + 'Her hands were always floured. '.repeat(8).trim(),
].join('\n');

export function fixtureTree(): ExTree {
  return {
    id: 'linden',
    name: 'The Linden family',
    people: [
      base({ id: 'anna', given: 'Anna', surname: 'Linden', sex: 'f', born: '~1900', bornPlace: 'Lindenby', died: '1971-06-14', diedPlace: 'Ulm', bio: LONG_BIO, occupation: 'Baker', portrait: { key: 'photo/0f3c.jpg', mime: 'image/jpeg' } }),
      base({ id: 'karl', given: 'Karl', surname: 'Linden', sex: 'm', born: '1898', occupation: 'Miller' }),
      base({ id: 'greta', given: 'Greta', surname: 'Berg', currentSurname: 'Linden', sex: 'f', born: '1925-03-08', living: true }),
      base({ id: 'otto', given: 'Otto', surname: 'Linden', sex: 'm', born: '1924-11', died: '1990' }),
      base({ id: 'hanna', given: 'Hanna', furtherGiven: ['Marie', 'Luise'], surname: 'Linden', sex: 'f', born: '1950', nickname: 'Hanni', living: true }),
      base({ id: 'pim', given: 'Pim', surname: 'Linden', sex: 'x', born: '1952', living: false, died: '2001' }),
      base({ id: 'lea', given: 'Lea', surname: 'Berg', sex: 'f', born: '2001-01-01', living: true }),
      base({ id: 'jonas', given: 'Jonas', surname: 'Kern', sex: 'm', born: '1948-07-30', title: 'Dr.', living: true }),
    ],
    parents: [
      { child: 'hanna', parent: 'anna', kind: 'biological', confidence: 'certain' },
      { child: 'hanna', parent: 'karl', kind: 'biological', confidence: 'certain' },
      { child: 'otto', parent: 'karl', kind: 'biological', confidence: 'certain' },
      { child: 'otto', parent: 'greta', kind: 'biological', confidence: 'certain' },
      { child: 'pim', parent: 'karl', kind: 'adoptive', confidence: 'certain' },
      { child: 'pim', parent: 'greta', kind: 'adoptive', confidence: 'probable' },
      { child: 'lea', parent: 'greta', kind: 'step', confidence: 'probable' },
      { child: 'lea', parent: 'jonas', kind: 'biological', confidence: 'certain' },
    ],
    unions: [
      { id: 'u-anna-karl', a: 'anna', b: 'karl', kind: 'marriage', start: '1920-05-02', end: '1930', endReason: 'divorce', place: 'Lindenby' },
      { id: 'u-karl-greta', a: 'karl', b: 'greta', kind: 'marriage', start: '1935', end: '1960', endReason: 'death', place: null },
      { id: 'u-hanna-jonas', a: 'hanna', b: 'jonas', kind: 'partnership', start: '2020', end: null, endReason: null, place: null },
    ],
    extras: { stories: 3, fields: 2, houses: 1, places: 0 },
  };
}

/** A tree with no people: an import target. */
export const emptyTree = (): ExTree => ({ id: 'scratch', name: 'Scratch', people: [], parents: [], unions: [], extras: { stories: 0, fields: 0, houses: 0, places: 0 } });
