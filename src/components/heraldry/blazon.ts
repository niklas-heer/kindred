// The blazon: a coat of arms in heraldic English, built from the v2 design.
// "Azure, a fess wavy argent between three mullets or" — field first, then what lies on it, in painting order.
import type { Achievement, ArmsV2, ChargeLayer, OrdinaryLayer, TinctureV2 } from '~/lib/seed-format';
import { CHARGE_BY_ID } from './catalogue';
import { CENTRAL, clampPieces, standsBetween } from './geometry';
import { fieldTinctures } from './render';
import { labelV2 } from './tinctures';
import { ARRANGEMENTS, divisionLabel, HELMS, ordinaryLabel } from './vocab';
import { translate, type Key } from '~/lib/i18n/dictionary';

const NUM = ['', 'a', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
/** The blazon is always heraldic English, whatever language the reader has chosen. */
const en = (k: Key) => translate('en', k);
const t = (x: TinctureV2) => en(labelV2(x)).toLowerCase();
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const an = (word: string) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);
const lineWord = (l: string) => (l === 'straight' ? '' : ` ${l}`);

export function chargeNoun(id: string, n: number): string {
  const c = CHARGE_BY_ID[id];
  const label = c ? en(c.label) : id;
  const keep = /^(Jerusalem|Thor)/.test(label);
  const one = keep ? label : label.charAt(0).toLowerCase() + label.slice(1);
  if (n === 1) return one;
  if (c?.plural) return c.plural;
  if (/(s|x|ch|sh)$/.test(one)) return `${one}es`;
  return `${one}s`;
}

function chargePhrase(c: ChargeLayer, opts: { seme?: boolean } = {}): string {
  const n = Math.max(1, Math.min(9, Math.round(c.count) || 1));
  const tinct = c.counterchanged ? 'counterchanged' : t(c.tincture);
  const turned = c.contourne ? ' contourné' : '';
  if (c.arrangement === 'seme' || opts.seme) return `semé of ${chargeNoun(c.charge, 2)}${turned} ${tinct}`;
  const noun = chargeNoun(c.charge, n);
  const count = n === 1 ? an(noun).split(' ')[0] : NUM[n];
  const arr = ARRANGEMENTS.find((a) => a.id === c.arrangement)?.blazon;
  return `${count} ${noun}${turned}${arr ? ` ${arr}` : ''} ${tinct}`;
}

function ordinaryNoun(o: OrdinaryLayer): string {
  return `${en(ordinaryLabel(o.kind)).toLowerCase()}${lineWord(o.line)}`;
}
function ordinaryTincture(o: OrdinaryLayer): string {
  return `${o.counterchanged ? 'counterchanged' : t(o.tincture)}${o.cotised ? ' cotised' : ''}`;
}

function fieldPhrase(a: ArmsV2): string {
  const ts = fieldTinctures(a).map(t);
  const div = a.field.division;
  if (div === 'plain') return cap(ts[0]);
  const line = lineWord(a.field.line);
  const label = en(divisionLabel(div));
  const pieces = clampPieces(a.field.pieces ?? 6);
  const list = ts.length === 3 ? `${ts[0]}, ${ts[1]} and ${ts[2]}` : `${ts[0]} and ${ts[1]}`;
  if (div === 'paly' || div === 'barry' || div === 'bendy' || div === 'bendy-sinister') return `${label}${line} of ${NUM[pieces]} ${list}`;
  if (div === 'gyronny') return `Gyronny of eight${line} ${list}`;
  return `${label}${line} ${list}`;
}

/** The shield in words. */
export function blazonV2(a: ArmsV2): string {
  const parts: string[] = [];
  const layers = a.layers;
  const used = new Set<number>();

  layers.forEach((l, i) => {
    if (used.has(i)) return;
    if (l.type === 'ordinary') {
      // Charges set on this ordinary: "on a fess azure three mullets or".
      const on = layers
        .map((x, k) => ({ x, k }))
        .filter(({ x, k }) => k > i && x.type === 'charge' && ((x.on === 'ordinary' && nearestOrdinary(layers, k) === i) || (x.on === 'chief' && l.kind === 'chief' && lastChief(layers, k) === i)));
      // Field charges standing round a central ordinary: "a fess or between three mullets argent".
      const central = !['chief', 'base', 'bordure', 'orle', 'canton', 'quarter'].includes(l.kind);
      const round = central
        ? layers.map((x, k) => ({ x, k })).find(({ x, k }) => k > i && !used.has(k) && x.type === 'charge' && x.on === 'field' && x.arrangement === 'auto' && nearestOrdinary(layers, k) === i && standsBetween(l.kind, x.count))
        : undefined;
      const noun = ordinaryNoun(l);
      let phrase = on.length
        ? `on ${an(noun)} ${ordinaryTincture(l)} ${on.map(({ x }) => chargePhrase(x as ChargeLayer)).join(' and ')}`
        : `${an(noun)} ${ordinaryTincture(l)}`;
      on.forEach(({ k }) => used.add(k));
      if (round) {
        phrase += ` between ${chargePhrase(round.x as ChargeLayer)}`;
        used.add(round.k);
      }
      parts.push(phrase);
      return;
    }
    // A lone charge on the field after an ordinary through the centre lies over it.
    const overAll = l.on === 'field' && l.arrangement !== 'seme' && layers.slice(0, i).some((x) => x.type === 'ordinary' && CENTRAL.has(x.kind) && !standsBetween(x.kind, l.count));
    parts.push(l.on === 'chief' ? `in chief ${chargePhrase(l)}` : l.on === 'base' ? `in base ${chargePhrase(l)}` : overAll ? `over all ${chargePhrase(l)}` : chargePhrase(l));
  });

  const field = fieldPhrase(a);
  if (!parts.length) return field;
  // Semé belongs to the field: "Azure semé of fleurs-de-lis or, a bordure gules".
  if (parts[0].startsWith('semé')) return [`${field} ${parts[0]}`, ...parts.slice(1)].join(', ');
  return `${field}, ${parts.join(', ')}`;
}

/** The index of the last ordinary before layer k, or -1. */
function nearestOrdinary(layers: ArmsV2['layers'], k: number): number {
  for (let i = k - 1; i >= 0; i--) if (layers[i].type === 'ordinary') return i;
  return -1;
}

function lastChief(layers: ArmsV2['layers'], k: number): number {
  for (let i = k - 1; i >= 0; i--) { const l = layers[i]; if (l.type === 'ordinary' && l.kind === 'chief') return i; }
  return -1;
}

/** The achievement in words, a sentence per part. */
export function blazonAchievement(ach: Achievement | undefined): string {
  if (!ach) return '';
  const out: string[] = [];
  const helm = HELMS.find((h) => h.id === ach.helm);
  if (ach.helm !== 'none') out.push(`Helm of ${an(helm ? en(helm.label).toLowerCase() : ach.helm)}.`);
  if (ach.mantling) out.push(`Mantling ${t(ach.mantling[0])} doubled ${t(ach.mantling[1])}.`);
  if (ach.crest) out.push(`Crest: ${ach.torse ? 'on a wreath of the colours ' : ''}${an(chargeNoun(ach.crest.charge, 1))} ${t(ach.crest.tincture)}.`);
  if (ach.supporters) out.push(`Supporters: two ${chargeNoun(ach.supporters.charge, 2)} ${t(ach.supporters.tincture)}.`);
  if (ach.motto?.trim()) out.push(`Motto: “${ach.motto.trim()}”.`);
  return out.join(' ');
}
