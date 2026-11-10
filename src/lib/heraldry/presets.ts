// Classic designs to start from. Patterns of real heraldry, not the arms of any real family.
import type { ArmsV2 } from '~/lib/seed-format';
import type { Key } from '~/lib/i18n/dictionary';

const plain = (t: ArmsV2['field']['tinctures'][number]): ArmsV2['field'] => ({ division: 'plain', tinctures: [t], line: 'straight' });

export const PRESETS: { id: string; label: Key; arms: ArmsV2 }[] = [
  {
    id: 'griffin', label: 'heraldry.preset.griffin',
    arms: { shield: 'heater', field: plain('gules'), layers: [{ type: 'charge', charge: 'griffin', tincture: 'or', count: 1, arrangement: 'auto', on: 'field' }] },
  },
  {
    id: 'eagle', label: 'heraldry.preset.eagle',
    arms: { shield: 'heater', field: plain('or'), layers: [{ type: 'charge', charge: 'eagle', tincture: 'sable', count: 1, arrangement: 'auto', on: 'field' }] },
  },
  {
    id: 'fess-mullets', label: 'heraldry.preset.fess-mullets',
    arms: { shield: 'heater', field: plain('azure'), layers: [
      { type: 'ordinary', kind: 'fess', tincture: 'argent', line: 'wavy' },
      { type: 'charge', charge: 'mullet', tincture: 'or', count: 3, arrangement: 'auto', on: 'field' },
    ] },
  },
  {
    id: 'chevron-roses', label: 'heraldry.preset.chevron-roses',
    arms: { shield: 'heater', field: plain('argent'), layers: [
      { type: 'ordinary', kind: 'chevron', tincture: 'gules', line: 'straight' },
      { type: 'charge', charge: 'rose', tincture: 'gules', count: 3, arrangement: 'auto', on: 'field' },
    ] },
  },
  {
    id: 'quarterly', label: 'heraldry.preset.quarterly',
    arms: { shield: 'heater', field: { division: 'quarterly', tinctures: ['or', 'gules'], line: 'straight' }, layers: [
      { type: 'charge', charge: 'cross-patee', tincture: 'or', count: 1, arrangement: 'auto', on: 'field', scale: 0.7, counterchanged: true },
    ] },
  },
  {
    id: 'per-pale-counter', label: 'heraldry.preset.per-pale-counter',
    arms: { shield: 'heater', field: { division: 'per-pale', tinctures: ['azure', 'or'], line: 'straight' }, layers: [
      { type: 'ordinary', kind: 'chevron', tincture: 'or', line: 'straight', counterchanged: true },
      { type: 'charge', charge: 'escallop', tincture: 'or', count: 3, arrangement: 'auto', on: 'field', counterchanged: true },
    ] },
  },
  {
    id: 'chief-ermine', label: 'heraldry.preset.chief-ermine',
    arms: { shield: 'heater', field: plain('vert'), layers: [
      { type: 'ordinary', kind: 'chief', tincture: 'ermine', line: 'straight' },
      { type: 'charge', charge: 'garb', tincture: 'or', count: 1, arrangement: 'auto', on: 'field' },
    ] },
  },
  {
    id: 'bend-engrailed', label: 'heraldry.preset.bend-engrailed',
    arms: { shield: 'heater', field: plain('or'), layers: [
      { type: 'ordinary', kind: 'bend', tincture: 'sable', line: 'engrailed' },
      { type: 'charge', charge: 'crescent', tincture: 'or', count: 3, arrangement: 'auto', on: 'ordinary' },
    ] },
  },
  {
    id: 'cross-moline', label: 'heraldry.preset.cross-moline',
    arms: { shield: 'french', field: plain('argent'), layers: [{ type: 'charge', charge: 'cross-moline', tincture: 'sable', count: 1, arrangement: 'auto', on: 'field' }] },
  },
  {
    id: 'bordure-bezants', label: 'heraldry.preset.bordure-bezants',
    arms: { shield: 'heater', field: plain('argent'), layers: [
      { type: 'ordinary', kind: 'bordure', tincture: 'gules', line: 'straight' },
      { type: 'charge', charge: 'roundel', tincture: 'or', count: 8, arrangement: 'auto', on: 'ordinary' },
      { type: 'charge', charge: 'castle', tincture: 'sable', count: 1, arrangement: 'auto', on: 'field' },
    ] },
  },
  {
    id: 'barry-wavy', label: 'heraldry.preset.barry-wavy',
    arms: { shield: 'iberian', field: { division: 'barry', tinctures: ['argent', 'azure'], line: 'wavy', pieces: 8 }, layers: [
      { type: 'ordinary', kind: 'chief', tincture: 'ermine', line: 'straight' },
      { type: 'charge', charge: 'fish', tincture: 'gules', count: 2, arrangement: 'fess', on: 'chief' },
    ] },
  },
  {
    id: 'chequy-chief', label: 'heraldry.preset.chequy-chief',
    arms: { shield: 'heater', field: { division: 'chequy', tinctures: ['or', 'azure'], line: 'straight' }, layers: [
      { type: 'ordinary', kind: 'canton', tincture: 'ermine', line: 'straight' },
    ] },
  },
  {
    id: 'vair-pale', label: 'heraldry.preset.vair-pale',
    arms: { shield: 'swiss', field: plain('vair'), layers: [
      { type: 'ordinary', kind: 'pale', tincture: 'gules', line: 'straight' },
      { type: 'charge', charge: 'key', tincture: 'or', count: 1, arrangement: 'auto', on: 'ordinary' },
    ] },
  },
  {
    id: 'semee-lis', label: 'heraldry.preset.semee-lis',
    arms: { shield: 'heater', field: plain('azure'), layers: [
      { type: 'charge', charge: 'fleur', tincture: 'or', count: 1, arrangement: 'seme', on: 'field' },
      { type: 'ordinary', kind: 'bordure', tincture: 'argent', line: 'engrailed' },
    ] },
  },
  {
    id: 'trimount', label: 'heraldry.preset.trimount',
    arms: { shield: 'heater', field: plain('or'), layers: [
      { type: 'ordinary', kind: 'base', tincture: 'vert', line: 'straight' },
      { type: 'charge', charge: 'oak', tincture: 'vert', count: 1, arrangement: 'auto', on: 'field', scale: 0.9 },
    ] },
  },
  {
    id: 'achievement', label: 'heraldry.preset.achievement',
    arms: {
      shield: 'heater', field: plain('azure'),
      layers: [
        { type: 'ordinary', kind: 'chevron', tincture: 'or', line: 'straight' },
        { type: 'charge', charge: 'mullet-six', tincture: 'argent', count: 3, arrangement: 'auto', on: 'field' },
      ],
      achievement: { helm: 'knight', mantling: ['azure', 'or'], torse: true, crest: { charge: 'eagle-head', tincture: 'or' }, motto: 'Fide et labore', supporters: { charge: 'griffin', tincture: 'or' } },
    },
  },
];
