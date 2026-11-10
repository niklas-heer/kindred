// The words of heraldry v2, for pickers, the blazon and validation. Each list covers its type exactly
// (the `satisfies` checks below fail to compile if a type gains a member the list lacks).
import type {
  ChargeArrangement, FieldDivision, HelmRank, OrdinaryKind, PartitionLine, ShieldShape, TinctureV2,
} from '~/lib/seed-format';
import { TINCTURES_V2 } from './tinctures.ts';
import type { Key } from '~/lib/i18n/dictionary';

export const SHIELDS: { id: ShieldShape; label: Key; hint: Key }[] = [
  { id: 'heater', label: 'heraldry.shield.heater', hint: 'heraldry.shield_hint.heater' },
  { id: 'french', label: 'heraldry.shield.french', hint: 'heraldry.shield_hint.french' },
  { id: 'iberian', label: 'heraldry.shield.iberian', hint: 'heraldry.shield_hint.iberian' },
  { id: 'swiss', label: 'heraldry.shield.swiss', hint: 'heraldry.shield_hint.swiss' },
  { id: 'kite', label: 'heraldry.shield.kite', hint: 'heraldry.shield_hint.kite' },
  { id: 'lozenge', label: 'heraldry.shield.lozenge', hint: 'heraldry.shield_hint.lozenge' },
];

export const DIVISIONS_V2: { id: FieldDivision; label: Key; lines: boolean; pieces?: boolean }[] = [
  { id: 'plain', label: 'heraldry.division.plain', lines: false },
  { id: 'per-pale', label: 'heraldry.division.per-pale', lines: true },
  { id: 'per-fess', label: 'heraldry.division.per-fess', lines: true },
  { id: 'per-bend', label: 'heraldry.division.per-bend', lines: true },
  { id: 'per-bend-sinister', label: 'heraldry.division.per-bend-sinister', lines: true },
  { id: 'per-saltire', label: 'heraldry.division.per-saltire', lines: true },
  { id: 'quarterly', label: 'heraldry.division.quarterly', lines: true },
  { id: 'per-chevron', label: 'heraldry.division.per-chevron', lines: true },
  { id: 'per-pall', label: 'heraldry.division.per-pall', lines: true },
  { id: 'tierced-pale', label: 'heraldry.division.tierced-pale', lines: true },
  { id: 'tierced-fess', label: 'heraldry.division.tierced-fess', lines: true },
  { id: 'gyronny', label: 'heraldry.division.gyronny', lines: true },
  { id: 'paly', label: 'heraldry.division.paly', lines: true, pieces: true },
  { id: 'barry', label: 'heraldry.division.barry', lines: true, pieces: true },
  { id: 'bendy', label: 'heraldry.division.bendy', lines: true, pieces: true },
  { id: 'bendy-sinister', label: 'heraldry.division.bendy-sinister', lines: true, pieces: true },
  { id: 'chequy', label: 'heraldry.division.chequy', lines: false },
  { id: 'lozengy', label: 'heraldry.division.lozengy', lines: false },
  { id: 'fusilly', label: 'heraldry.division.fusilly', lines: false },
];

export const LINES_V2: { id: PartitionLine; label: Key }[] = [
  { id: 'straight', label: 'heraldry.line.straight' },
  { id: 'wavy', label: 'heraldry.line.wavy' },
  { id: 'indented', label: 'heraldry.line.indented' },
  { id: 'dancetty', label: 'heraldry.line.dancetty' },
  { id: 'embattled', label: 'heraldry.line.embattled' },
  { id: 'engrailed', label: 'heraldry.line.engrailed' },
  { id: 'invected', label: 'heraldry.line.invected' },
  { id: 'nebuly', label: 'heraldry.line.nebuly' },
];

export const ORDINARIES: { id: OrdinaryKind; label: Key; chargeable: boolean }[] = [
  { id: 'chief', label: 'heraldry.ordinary.chief', chargeable: true },
  { id: 'fess', label: 'heraldry.ordinary.fess', chargeable: true },
  { id: 'pale', label: 'heraldry.ordinary.pale', chargeable: true },
  { id: 'bend', label: 'heraldry.ordinary.bend', chargeable: true },
  { id: 'bend-sinister', label: 'heraldry.ordinary.bend-sinister', chargeable: true },
  { id: 'chevron', label: 'heraldry.ordinary.chevron', chargeable: true },
  { id: 'cross', label: 'heraldry.ordinary.cross', chargeable: true },
  { id: 'saltire', label: 'heraldry.ordinary.saltire', chargeable: true },
  { id: 'pall', label: 'heraldry.ordinary.pall', chargeable: true },
  { id: 'pile', label: 'heraldry.ordinary.pile', chargeable: true },
  { id: 'bordure', label: 'heraldry.ordinary.bordure', chargeable: true },
  { id: 'orle', label: 'heraldry.ordinary.orle', chargeable: true },
  { id: 'canton', label: 'heraldry.ordinary.canton', chargeable: true },
  { id: 'quarter', label: 'heraldry.ordinary.quarter', chargeable: true },
  { id: 'base', label: 'heraldry.ordinary.base', chargeable: true },
];

export const ARRANGEMENTS: { id: ChargeArrangement; label: Key; blazon: string }[] = [
  { id: 'auto', label: 'heraldry.arrangement.auto', blazon: '' },
  { id: 'pale', label: 'heraldry.arrangement.pale', blazon: 'in pale' },
  { id: 'fess', label: 'heraldry.arrangement.fess', blazon: 'in fess' },
  { id: 'bend', label: 'heraldry.arrangement.bend', blazon: 'in bend' },
  { id: 'bend-sinister', label: 'heraldry.arrangement.bend-sinister', blazon: 'in bend sinister' },
  { id: 'two-one', label: 'heraldry.arrangement.two-one', blazon: '' },
  { id: 'one-two', label: 'heraldry.arrangement.one-two', blazon: 'one and two' },
  { id: 'two-two', label: 'heraldry.arrangement.two-two', blazon: '' },
  { id: 'saltire', label: 'heraldry.arrangement.saltire', blazon: 'in saltire' },
  { id: 'cross', label: 'heraldry.arrangement.cross', blazon: 'in cross' },
  { id: 'three-two-one', label: 'heraldry.arrangement.three-two-one', blazon: '' },
  { id: 'orle', label: 'heraldry.arrangement.orle', blazon: 'in orle' },
  { id: 'seme', label: 'heraldry.arrangement.seme', blazon: '' },
];

export const HELMS: { id: HelmRank; label: Key }[] = [
  { id: 'none', label: 'heraldry.helm.none' },
  { id: 'esquire', label: 'heraldry.helm.esquire' },
  { id: 'knight', label: 'heraldry.helm.knight' },
  { id: 'peer', label: 'heraldry.helm.peer' },
  { id: 'royal', label: 'heraldry.helm.royal' },
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

export const divisionLabel = (d: FieldDivision): Key => DIVISIONS_V2.find((x) => x.id === d)!.label;
export const ordinaryLabel = (k: OrdinaryKind): Key => ORDINARIES.find((x) => x.id === k)!.label;
export const shieldLabel = (s: ShieldShape): Key => SHIELDS.find((x) => x.id === s)!.label;
export const lineLabel = (l: PartitionLine): Key => LINES_V2.find((x) => x.id === l)!.label;
