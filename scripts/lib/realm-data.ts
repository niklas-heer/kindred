// Static tables for the generated realm of Aurelmarch. Pure data: the simulation lives in gen-realm.ts.

import type { SeedHouse, Tincture } from '../../src/lib/seed-format.ts';

type Arms = SeedHouse['arms'];

export interface HouseSpec {
  key: string;
  name: string;
  motto: string;
  arms: Arms;
  /** Surname used by children of the house's male line. */
  surname: string;
}

export const HOUSES: HouseSpec[] = [
  { key: 'valcourt', name: 'House Valcourt', surname: 'Valcourt', motto: 'Par la lance et la lumière',
    arms: { field: 'or', division: 'quarterly', charge: 'lion', chargeTincture: 'gules', field2: 'azure' } },
  { key: 'brennac', name: 'House of Brennac', surname: 'Brennac', motto: 'Ni plier ni rompre',
    arms: { field: 'argent', division: 'per-pale', charge: 'eagle', chargeTincture: 'sable', field2: 'gules' } },
  { key: 'aldermoor', name: 'Aldermoor', surname: 'Aldermoor', motto: 'The moor keeps what it is given',
    arms: { field: 'vert', division: 'per-fess', charge: 'tower', chargeTincture: 'argent', field2: 'or' } },
  { key: 'sauvel', name: 'House Sauvel', surname: 'Sauvel', motto: 'Sans peur, sans sel',
    arms: { field: 'azure', division: 'chevron', charge: 'star', chargeTincture: 'or', field2: 'argent' } },
  { key: 'morvand', name: 'House Morvand', surname: 'Morvand', motto: 'Ce qui est dû, est payé',
    arms: { field: 'purpure', division: 'bendy', charge: 'crescent', chargeTincture: 'argent', field2: 'or' } },
  { key: 'hautbrise', name: 'House of Hautbrise', surname: 'Hautbrise', motto: 'Au vent de la foi',
    arms: { field: 'sable', division: 'paly', charge: 'fleur', chargeTincture: 'or', field2: 'argent' } },
  { key: 'caerwynd', name: 'House Caerwynd', surname: 'Caerwynd', motto: 'Hold the key, hold the road',
    arms: { field: 'gules', division: 'per-bend', charge: 'key', chargeTincture: 'or', field2: 'vert' } },
  { key: 'rosemere', name: 'House Rosemere', surname: 'Rosemere', motto: 'Thorn before petal',
    arms: { field: 'argent', division: 'saltire', charge: 'rose', chargeTincture: 'gules', field2: 'vert' } },
  { key: 'ostrel', name: 'House Ostrel', surname: 'Ostrel', motto: 'Charge at the first sound of the horn',
    arms: { field: 'vert', division: 'cross', charge: 'boar', chargeTincture: 'or', field2: 'sable' } },
  { key: 'verlaine', name: 'House of Verlaine', surname: 'Verlaine', motto: 'Patience is a sharpened blade',
    arms: { field: 'azure', division: 'quarterly', charge: 'stag', chargeTincture: 'argent', field2: 'gules' } },
  { key: 'wulfhart', name: 'House Wulfhart', surname: 'Wulfhart', motto: 'Die Tür offen, das Herz still',
    arms: { field: 'sable', division: 'plain', charge: 'sword', chargeTincture: 'argent' } },
  { key: 'ancelme', name: 'House Ancelme', surname: 'Ancelme', motto: 'Bread for the poor, bread for the wall',
    arms: { field: 'purpure', division: 'per-bend', charge: 'none', chargeTincture: 'or', field2: 'argent' } },
];

/** Tinctures are kept in the type so a typo fails at compile time; the list documents the palette. */
export const TINCTURES: Tincture[] = ['or', 'argent', 'gules', 'azure', 'vert', 'sable', 'purpure'];

export const PLACES = [
  'Saint-Aubin', 'Valmorel', 'Corvenne', 'Ardelle', 'Brisach', 'Montsalve', 'Lusterne', 'Harrowden',
  'Fenbrook', 'Thessaly-on-Marr', 'Ostrand', 'Greywater', 'Castel Sainte-Ode', 'Vellmark', 'Ravensmoor',
  'Draille', 'Oberhaun', 'Sablemont', 'Ilvary', 'Cressy Ford', 'Maudrenne', 'Pellirac', 'Eskendale',
  'Tournelle', 'Saint-Maixent Vale',
];

export const GIVEN_M = [
  'Aldric', 'Bertrand', 'Caradoc', 'Dagobert', 'Eudes', 'Florent', 'Gautier', 'Hugues', 'Ivo', 'Jourdain',
  'Lothaire', 'Maurin', 'Nicolas', 'Odo', 'Pépin', 'Quentin', 'Raoul', 'Sigebert', 'Tancred', 'Ulric',
  'Vivian', 'Wido', 'Ysembart', 'Anselm', 'Bernard', 'Conrad', 'Drogo', 'Engelbert', 'Gerard', 'Hervé',
  'Isembard', 'Joscelin', 'Kenric', 'Lambert', 'Mainard', 'Norbert', 'Olivier', 'Pons', 'Remi', 'Sanche',
  'Thibault', 'Urbain', 'Walter', 'Yves', 'Arnaud', 'Blaise', 'Clement', 'Dreux', 'Emeric', 'Fulk',
];

export const GIVEN_F = [
  'Adelais', 'Berthe', 'Clemence', 'Doria', 'Elisende', 'Florence', 'Gisla', 'Hawise', 'Isolde', 'Juliane',
  'Ermengard', 'Lucia', 'Mahaut', 'Nesta', 'Ogive', 'Petronille', 'Richilde', 'Sibylle', 'Tiphaine', 'Ursel',
  'Vérane', 'Wivine', 'Yolande', 'Aude', 'Beatrix', 'Constance', 'Dulce', 'Emma', 'Frewisa', 'Gersende',
  'Helewise', 'Ida', 'Jehanne', 'Lauretta', 'Matilde', 'Odile', 'Peronelle', 'Rixende', 'Sancia', 'Teresa',
  'Agnes', 'Blanche', 'Cécile', 'Dameta', 'Eleanor', 'Felicie', 'Guiborc', 'Heloise', 'Ismene', 'Mathilde',
];

export const COMMON_SURNAMES = [
  'Miller', 'Thorne', 'Carrow', 'Fletcher', 'Dunmere', 'Osgar', 'Penhallow', 'Wexcombe', 'Lark', 'Hobb',
  'Tanner', 'Garrow', 'Selwyn', 'Mott', 'Colbrand', 'Ferrand', 'Rousse', 'Lambert', 'Amery', 'Brisson',
];

export const EPITHETS_M = [
  'the Bold', 'the Unready', 'Ironhand', 'the Pious', 'the Fair', 'the Lame', 'Goldtooth', 'the Patient',
  'the Stammerer', 'Oakheart', 'the Generous', 'the Grim', 'Longsword', 'the Hunter', 'the Wise', 'the Red',
];

export const EPITHETS_F = [
  'the Gracious', 'the Lovely', 'the Sharp-tongued', 'the Devout', 'the Builder', 'Silverhand',
  'the Learned', 'the Patient', 'the Wise', 'the Bountiful', 'the Quiet',
];

export const TRAITS = [
  'brave', 'craven', 'pious', 'cynical', 'scholar', 'gardener', 'hunter', 'poet', 'wrathful', 'patient',
  'generous', 'greedy', 'just', 'ambitious', 'content', 'gregarious', 'shy', 'chaste', 'lustful', 'strategist',
];

export const MOTTO_WORDS = ['faith', 'iron', 'river', 'oath', 'stone', 'stag'];

export const BISHOP_SEES = ['Saint-Aubin', 'Valmorel', 'Brisach', 'Ardelle', 'Oberhaun'];

export const ABBEYS = ['Fontgaillard', 'Sainte-Mélisse', 'Notre-Dame of the Reeds', 'Ovelle'];

export const OCCUPATIONS_MEDIEVAL = [
  'miller', 'reeve', 'scrivener', 'vintner', 'shepherd', 'mason', 'smith', 'falconer', 'ferryman', 'cooper',
];
