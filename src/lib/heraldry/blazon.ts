// The blazon: a coat of arms in words, built from the v2 design, field first, then what lies on it in painting order.
// English is true heraldic blazon: "Azure, a fess wavy argent between three mullets or".
// German and Afrikaans get a plain reading in the same order: "Blau; Balken, gewellt, in Silber, zwischen 3 × Stern in Gold".
// It is uninflected on purpose: a real German blazon needs each charge's grammatical gender, and the catalogue has none.
import type { Achievement, ArmsV2, ChargeLayer, OrdinaryLayer, TinctureV2 } from '~/lib/seed-format';
import { chargeDef, chargeName } from './registry.ts';
import { CENTRAL, clampPieces, fieldTinctures, standsBetween } from './geometry.ts';
import { labelV2 } from './tinctures.ts';
import { ARRANGEMENTS, divisionLabel, HELMS, lineLabel, ordinaryLabel } from './vocab.ts';
import { translate, type Key } from '../i18n/dictionary.ts';
import type { Locale, Vars } from '../i18n/types.ts';

const NUM = ['', 'a', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const en = (k: Key) => translate('en', k);
const t = (x: TinctureV2) => en(labelV2(x)).toLowerCase();
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const an = (word: string) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);
const lineWord = (l: string) => (l === 'straight' ? '' : ` ${l}`);

export function chargeNoun(id: string, n: number): string {
  const c = chargeDef(id);
  const label = chargeName(id, 'en');
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

/** How one language words each part; blazonV2 decides what goes where. */
interface Phrasing {
  field(a: ArmsV2): string;
  charge(c: ChargeLayer): string;
  ordinary(o: OrdinaryLayer, on: ChargeLayer[], round?: ChargeLayer): string;
  placed(where: 'chief' | 'base' | 'over', what: string): string;
  /** The field with its semé, when the first layer strews charges over it. */
  fieldSeme(field: string, seme: string): string;
  separator: string;
}

const ENGLISH: Phrasing = {
  field: fieldPhrase,
  charge: chargePhrase,
  ordinary(o, on, round) {
    const noun = ordinaryNoun(o);
    const phrase = on.length
      ? `on ${an(noun)} ${ordinaryTincture(o)} ${on.map((x) => chargePhrase(x)).join(' and ')}`
      : `${an(noun)} ${ordinaryTincture(o)}`;
    return round ? `${phrase} between ${chargePhrase(round)}` : phrase;
  },
  placed: (where, what) => `${where === 'over' ? 'over all' : `in ${where}`} ${what}`,
  fieldSeme: (field, seme) => `${field} ${seme}`,
  separator: ', ',
};

/** The plain reading for German and Afrikaans, from the app's own words for each part. */
function reading(locale: Locale): Phrasing {
  const w = (k: Key, vars?: Vars) => translate(locale, k, vars);
  const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
  // German colour names are nouns and keep their capital; Afrikaans ones do not.
  const colour = (x: TinctureV2) => (locale === 'de' ? w(labelV2(x)) : lower(w(labelV2(x))));
  const inColour = (x: TinctureV2) => (x === 'proper' ? w('heraldry.reading.proper') : w('heraldry.reading.in', { colour: colour(x) }));
  const lineAfter = (l: OrdinaryLayer['line']) => (l === 'straight' ? '' : `, ${lower(w(lineLabel(l)))}`);
  const list = (ts: TinctureV2[]) => {
    const names = ts.map(colour);
    return `${names.slice(0, -1).join(', ')} ${w('heraldry.reading.and')} ${names[names.length - 1]}`;
  };
  const charge = (c: ChargeLayer) => {
    const name = chargeName(c.charge, locale);
    const tincture = c.counterchanged ? w('heraldry.reading.counterchanged') : inColour(c.tincture);
    const turned = c.contourne ? `, ${w('heraldry.reading.turned')}` : '';
    if (c.arrangement === 'seme') return `${w('heraldry.seme_of', { noun: name })}${turned} ${tincture}`;
    const n = Math.max(1, Math.min(9, Math.round(c.count) || 1));
    const arr = ARRANGEMENTS.find((a) => a.id === c.arrangement);
    const placed = !arr?.blazon ? '' : c.arrangement === 'one-two' ? ` (${w(arr.label)})` : ` ${lower(w(arr.label))}`;
    return `${n === 1 ? name : `${n} × ${name}`}${turned}${placed} ${tincture}`;
  };
  return {
    field(a) {
      const ts = fieldTinctures(a);
      if (a.field.division === 'plain') return w(labelV2(ts[0]));
      const div = a.field.division;
      const pieces = div === 'paly' || div === 'barry' || div === 'bendy' || div === 'bendy-sinister' ? ` (${w('heraldry.reading.pieces', { count: clampPieces(a.field.pieces ?? 6) })})` : '';
      return `${w(divisionLabel(div))}${lineAfter(a.field.line)}${pieces} ${w('heraldry.reading.of')} ${list(ts)}`;
    },
    charge,
    ordinary(o, on, round) {
      const tincture = o.counterchanged ? w('heraldry.reading.counterchanged') : inColour(o.tincture);
      const cotised = o.cotised ? `, ${w('heraldry.reading.cotised')}` : '';
      const lying = on.length ? `, ${w('heraldry.reading.thereon')} ${on.map(charge).join(` ${w('heraldry.reading.and')} `)}` : '';
      const beside = round ? `, ${w('heraldry.reading.between')} ${charge(round)}` : '';
      return `${w(ordinaryLabel(o.kind))}${lineAfter(o.line)} ${tincture}${cotised}${lying}${beside}`;
    },
    placed: (where, what) => `${where === 'over' ? w('heraldry.reading.over_all') : lower(w(where === 'chief' ? 'heraldry.in_chief' : 'heraldry.in_base'))} ${what}`,
    fieldSeme: (field, seme) => `${field}, ${lower(seme)}`,
    separator: '; ',
  };
}

const phrasing = (locale: Locale): Phrasing => (locale === 'en' ? ENGLISH : reading(locale));

/** The shield in words, in the given language. AI prompts and stored decisions leave it out and get the English. */
export function blazonV2(a: ArmsV2, locale: Locale = 'en'): string {
  const say = phrasing(locale);
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
      on.forEach(({ k }) => used.add(k));
      if (round) used.add(round.k);
      parts.push(say.ordinary(l, on.map(({ x }) => x as ChargeLayer), round?.x as ChargeLayer | undefined));
      return;
    }
    // A lone charge on the field after an ordinary through the centre lies over it.
    const overAll = l.on === 'field' && l.arrangement !== 'seme' && layers.slice(0, i).some((x) => x.type === 'ordinary' && CENTRAL.has(x.kind) && !standsBetween(x.kind, l.count));
    parts.push(l.on === 'chief' ? say.placed('chief', say.charge(l)) : l.on === 'base' ? say.placed('base', say.charge(l)) : overAll ? say.placed('over', say.charge(l)) : say.charge(l));
  });

  const field = say.field(a);
  if (!parts.length) return field;
  // Semé belongs to the field: "Azure semé of fleurs-de-lis or, a bordure gules".
  const first = layers[0];
  if (first.type === 'charge' && first.on === 'field' && first.arrangement === 'seme') return [say.fieldSeme(field, parts[0]), ...parts.slice(1)].join(say.separator);
  return [field, ...parts].join(say.separator);
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
export function blazonAchievement(ach: Achievement | undefined, locale: Locale = 'en'): string {
  if (!ach) return '';
  const out: string[] = [];
  if (locale !== 'en') {
    const w = (k: Key, vars?: Vars) => translate(locale, k, vars);
    const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
    const colour = (x: TinctureV2) => (locale === 'de' ? w(labelV2(x)) : lower(w(labelV2(x))));
    const figure = (x: { charge: string; tincture: TinctureV2 }, n: number) =>
      `${n > 1 ? `${n} × ` : ''}${chargeName(x.charge, locale)} ${x.tincture === 'proper' ? w('heraldry.reading.proper') : w('heraldry.reading.in', { colour: colour(x.tincture) })}`;
    const helm = HELMS.find((h) => h.id === ach.helm);
    if (ach.helm !== 'none') out.push(`${w('heraldry.helm')}: ${helm ? w(helm.label) : ach.helm}.`);
    if (ach.mantling) out.push(`${w('heraldry.mantling')}: ${colour(ach.mantling[0])} ${w('heraldry.reading.and')} ${colour(ach.mantling[1])}.`);
    if (ach.crest) out.push(`${w('heraldry.crest')}: ${figure(ach.crest, 1)}${ach.torse ? `, ${lower(w('heraldry.torse'))}` : ''}.`);
    if (ach.supporters) out.push(`${w('heraldry.supporters')}: ${figure(ach.supporters, 2)}.`);
    if (ach.motto?.trim()) out.push(`${w('heraldry.motto')}: ${w('heraldry.reading.quote', { text: ach.motto.trim() })}.`);
    return out.join(' ');
  }
  const helm = HELMS.find((h) => h.id === ach.helm);
  if (ach.helm !== 'none') out.push(`Helm of ${an(helm ? en(helm.label).toLowerCase() : ach.helm)}.`);
  if (ach.mantling) out.push(`Mantling ${t(ach.mantling[0])} doubled ${t(ach.mantling[1])}.`);
  if (ach.crest) out.push(`Crest: ${ach.torse ? 'on a wreath of the colours ' : ''}${an(chargeNoun(ach.crest.charge, 1))} ${t(ach.crest.tincture)}.`);
  if (ach.supporters) out.push(`Supporters: two ${chargeNoun(ach.supporters.charge, 2)} ${t(ach.supporters.tincture)}.`);
  if (ach.motto?.trim()) out.push(`Motto: “${ach.motto.trim()}”.`);
  return out.join(' ');
}
