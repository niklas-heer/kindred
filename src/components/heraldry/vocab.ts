// The words of heraldry v2, for pickers, the blazon and validation. Each list covers its type exactly
// (the `satisfies` checks below fail to compile if a type gains a member the list lacks).
import type {
  ChargeArrangement, FieldDivision, HelmRank, OrdinaryKind, PartitionLine, ShieldShape, TinctureV2,
} from '~/lib/seed-format';
import { TINCTURES_V2 } from './tinctures';

export const SHIELDS: { id: ShieldShape; label: string; hint: string }[] = [
  { id: 'heater', label: 'Heater', hint: 'The classic medieval shield' },
  { id: 'french', label: 'French', hint: 'Square with a small point' },
  { id: 'iberian', label: 'Iberian', hint: 'Round at the foot' },
  { id: 'swiss', label: 'Swiss', hint: 'A dipped top edge' },
  { id: 'kite', label: 'Kite', hint: 'The long Norman shield' },
  { id: 'lozenge', label: 'Lozenge', hint: 'Traditional for unmarried women and widows in some traditions' },
];

export const DIVISIONS_V2: { id: FieldDivision; label: string; lines: boolean; pieces?: boolean }[] = [
  { id: 'plain', label: 'Plain', lines: false },
  { id: 'per-pale', label: 'Per pale', lines: true },
  { id: 'per-fess', label: 'Per fess', lines: true },
  { id: 'per-bend', label: 'Per bend', lines: true },
  { id: 'per-bend-sinister', label: 'Per bend sinister', lines: true },
  { id: 'per-saltire', label: 'Per saltire', lines: true },
  { id: 'quarterly', label: 'Quarterly', lines: true },
  { id: 'per-chevron', label: 'Per chevron', lines: true },
  { id: 'per-pall', label: 'Tierced per pall', lines: true },
  { id: 'tierced-pale', label: 'Tierced per pale', lines: true },
  { id: 'tierced-fess', label: 'Tierced per fess', lines: true },
  { id: 'gyronny', label: 'Gyronny', lines: true },
  { id: 'paly', label: 'Paly', lines: true, pieces: true },
  { id: 'barry', label: 'Barry', lines: true, pieces: true },
  { id: 'bendy', label: 'Bendy', lines: true, pieces: true },
  { id: 'bendy-sinister', label: 'Bendy sinister', lines: true, pieces: true },
  { id: 'chequy', label: 'Chequy', lines: false },
  { id: 'lozengy', label: 'Lozengy', lines: false },
  { id: 'fusilly', label: 'Fusilly', lines: false },
];

export const LINES_V2: { id: PartitionLine; label: string }[] = [
  { id: 'straight', label: 'Straight' },
  { id: 'wavy', label: 'Wavy' },
  { id: 'indented', label: 'Indented' },
  { id: 'dancetty', label: 'Dancetty' },
  { id: 'embattled', label: 'Embattled' },
  { id: 'engrailed', label: 'Engrailed' },
  { id: 'invected', label: 'Invected' },
  { id: 'nebuly', label: 'Nebuly' },
];

export const ORDINARIES: { id: OrdinaryKind; label: string; chargeable: boolean }[] = [
  { id: 'chief', label: 'Chief', chargeable: true },
  { id: 'fess', label: 'Fess', chargeable: true },
  { id: 'pale', label: 'Pale', chargeable: true },
  { id: 'bend', label: 'Bend', chargeable: true },
  { id: 'bend-sinister', label: 'Bend sinister', chargeable: true },
  { id: 'chevron', label: 'Chevron', chargeable: true },
  { id: 'cross', label: 'Cross', chargeable: true },
  { id: 'saltire', label: 'Saltire', chargeable: true },
  { id: 'pall', label: 'Pall', chargeable: true },
  { id: 'pile', label: 'Pile', chargeable: true },
  { id: 'bordure', label: 'Bordure', chargeable: true },
  { id: 'orle', label: 'Orle', chargeable: true },
  { id: 'canton', label: 'Canton', chargeable: true },
  { id: 'quarter', label: 'Quarter', chargeable: true },
  { id: 'base', label: 'Base', chargeable: true },
];

export const ARRANGEMENTS: { id: ChargeArrangement; label: string; blazon: string }[] = [
  { id: 'auto', label: 'Usual', blazon: '' },
  { id: 'pale', label: 'In pale', blazon: 'in pale' },
  { id: 'fess', label: 'In fess', blazon: 'in fess' },
  { id: 'bend', label: 'In bend', blazon: 'in bend' },
  { id: 'bend-sinister', label: 'In bend sinister', blazon: 'in bend sinister' },
  { id: 'two-one', label: '2 and 1', blazon: '' },
  { id: 'one-two', label: '1 and 2', blazon: 'one and two' },
  { id: 'two-two', label: '2 and 2', blazon: '' },
  { id: 'saltire', label: 'In saltire', blazon: 'in saltire' },
  { id: 'cross', label: 'In cross', blazon: 'in cross' },
  { id: 'three-two-one', label: '3, 2 and 1', blazon: '' },
  { id: 'orle', label: 'In orle', blazon: 'in orle' },
  { id: 'seme', label: 'Semé', blazon: '' },
];

export const HELMS: { id: HelmRank; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'esquire', label: 'Esquire' },
  { id: 'knight', label: 'Knight' },
  { id: 'peer', label: 'Peer' },
  { id: 'royal', label: 'Royal' },
];

// Compile-time completeness: each list names every member of its type.
type Covers<T extends string, L extends readonly { id: string }[]> = Exclude<T, L[number]['id']> extends never ? true : never;
const _shields: Covers<ShieldShape, typeof SHIELDS> = true;
const _divs: Covers<FieldDivision, typeof DIVISIONS_V2> = true;
const _lines: Covers<PartitionLine, typeof LINES_V2> = true;
const _ords: Covers<OrdinaryKind, typeof ORDINARIES> = true;
const _arr: Covers<ChargeArrangement, typeof ARRANGEMENTS> = true;
const _helms: Covers<HelmRank, typeof HELMS> = true;
const _tinct: Covers<TinctureV2, typeof TINCTURES_V2> = true;
void [_shields, _divs, _lines, _ords, _arr, _helms, _tinct];

export const divisionLabel = (d: FieldDivision) => DIVISIONS_V2.find((x) => x.id === d)?.label ?? d;
export const ordinaryLabel = (k: OrdinaryKind) => ORDINARIES.find((x) => x.id === k)?.label ?? k;
