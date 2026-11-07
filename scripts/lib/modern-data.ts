// Static tables for the Lindqvist–Ashworth family tree. Names are a Swedish/English/German mix.

import type { SeedHouse } from '../../src/lib/seed-format.ts';

type Arms = SeedHouse['arms'];

export interface FamilySpec {
  key: string;
  name: string;
  surname: string;
  arms: Arms;
}

/** Four houses act as family surnames. Arms are present; mottos are not used in the modern tree. */
export const FAMILIES: FamilySpec[] = [
  { key: 'lindqvist', name: 'Lindqvist', surname: 'Lindqvist',
    arms: { field: 'azure', division: 'cross', charge: 'star', chargeTincture: 'or', field2: 'argent' } },
  { key: 'ashworth', name: 'Ashworth', surname: 'Ashworth',
    arms: { field: 'gules', division: 'chevron', charge: 'tower', chargeTincture: 'argent', field2: 'or' } },
  { key: 'brandt', name: 'Brandt', surname: 'Brandt',
    arms: { field: 'vert', division: 'per-pale', charge: 'stag', chargeTincture: 'or', field2: 'argent' } },
  { key: 'sjoberg', name: 'Sjöberg', surname: 'Sjöberg',
    arms: { field: 'argent', division: 'saltire', charge: 'rose', chargeTincture: 'azure', field2: 'sable' } },
];

export const GIVEN_M_SV = ['Erik', 'Anders', 'Lars', 'Sven', 'Karl', 'Nils', 'Gustaf', 'Olof', 'Per', 'Henrik', 'Johan', 'Mikael', 'Björn', 'Kjell'];
export const GIVEN_F_SV = ['Ingrid', 'Astrid', 'Greta', 'Karin', 'Märta', 'Elsa', 'Britta', 'Signe', 'Kerstin', 'Maja', 'Lena', 'Linnea', 'Freja', 'Ebba'];
export const GIVEN_M_EN = ['Edward', 'Harold', 'George', 'Thomas', 'William', 'Arthur', 'Frederick', 'Robert', 'James', 'Peter', 'Michael', 'David', 'Simon', 'Oliver', 'Tom', 'Ben'];
export const GIVEN_F_EN = ['Margaret', 'Dorothy', 'Evelyn', 'Alice', 'Edith', 'Joan', 'Susan', 'Helen', 'Rachel', 'Emma', 'Claire', 'Hannah', 'Lucy', 'Amy', 'Kate', 'Jess'];
export const GIVEN_M_DE = ['Gottfried', 'Friedrich', 'Heinrich', 'Wolfgang', 'Hans', 'Jürgen', 'Klaus', 'Matthias', 'Lukas', 'Jonas', 'Felix', 'Tobias', 'Moritz'];
export const GIVEN_F_DE = ['Liesel', 'Hildegard', 'Gerda', 'Ursula', 'Charlotte', 'Johanna', 'Clara', 'Marlene', 'Lotte', 'Sabine', 'Julia', 'Nina', 'Miriam', 'Vera'];

/** Spouses who arrive from outside the four families. */
export const OUTSIDE_SURNAMES = ['Halvorsen', 'Morgan', 'Keller', 'Berglund', 'Whitfield', 'Vogel', 'Ström', 'Pritchard', 'Hartmann', 'Nyberg', 'Okonkwo', 'Reyes', 'Bauer', 'Holm'];

export const OCCUPATIONS = [
  'nurse', 'secondary teacher', 'civil engineer', 'carpenter', 'pharmacist', 'architect', 'IT consultant',
  'veterinarian', 'midwife', 'solicitor', 'bus driver', 'bakery owner', 'research chemist', 'airline pilot',
  'chef', 'painter', 'dentist', 'civil servant', 'farmer', 'session musician', 'translator', 'physiotherapist',
  'boat builder', 'librarian', 'electrician',
];

export const NICKNAMES = ['Lasse', 'Kalle', 'Bella', 'Tommy', 'Dolly', 'Fritzi', 'Pip', 'Sis', 'Ollie', 'Mo', 'Gunnan', 'Bob', 'Lotta', 'Nisse'];

export const FAVOURITE_FOODS = ['Lakritz', 'cardamom buns', 'Yorkshire pudding', 'pickled herring', 'dark rye', 'marzipan', 'chanterelles', 'pancakes with lingonberry', 'Sachertorte', 'mint tea'];
export const FAVOURITE_MUSIC = ['Fleetwood Mac', 'ABBA', 'Dire Straits', 'Kraftwerk', 'The Beatles', 'Nick Drake', 'Abba on vinyl', 'Joni Mitchell', 'Kate Bush'];
export const FAVOURITE_THINGS = ['sailing', 'gardening', 'crosswords', 'long walks', 'cross-country skiing', 'birdwatching', 'bread baking', 'fishing', 'knitting', 'chess'];

export const PLACES_MODERN = [
  'Gothenburg', 'Uppsala', 'Lübeck', 'Leeds', 'Dalarna', 'Hamburg', 'Bristol', 'Gotland', 'Freiburg', 'Whitby',
  'Malmö', 'Cornwall', 'Stuttgart', 'Örebro', 'Lake Windermere', 'the Black Forest',
];
