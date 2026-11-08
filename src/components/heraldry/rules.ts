// The rule of tincture (no metal on metal, no colour on colour), checked layer by layer, with a fix for each
// breach; and randomised arms that keep it.
import type { ArmsLayer, ArmsV2, ChargeLayer, FieldDivision, OrdinaryKind, OrdinaryLayer, PartitionLine, ShieldShape, TinctureV2 } from '~/lib/seed-format';
import { chargeNoun } from './blazon';
import { CENTRAL, standsBetween, tinctureCount } from './geometry';
import { fieldTinctures } from './render';
import { kindOf, labelV2 } from './tinctures';
import { ordinaryLabel } from './vocab';

export interface Clash {
  /** The layer at fault, or -1 for the field. */
  layer: number;
  message: string;
  /** A one-click repair, when there is an obvious one. */
  fix?: { label: string; apply: (a: ArmsV2) => ArmsV2 };
}

const lc = (x: TinctureV2) => labelV2(x).toLowerCase();
/** Only metal and colour are bound by the rule; furs and proper go anywhere. */
const bound = (x: TinctureV2) => kindOf(x) === 'metal' || kindOf(x) === 'colour';
const clashes2 = (a: TinctureV2, b: TinctureV2) => bound(a) && bound(b) && kindOf(a) === kindOf(b);

/** The tincture that best contrasts with everything in `under`: a metal on colours, a colour on metals. */
export function contrastFor(under: TinctureV2[], prefer?: TinctureV2): TinctureV2 {
  const kinds = new Set(under.filter(bound).map(kindOf));
  if (kinds.size === 2 || kinds.size === 0) return prefer ?? 'argent';
  const wantMetal = kinds.has('colour');
  if (prefer && bound(prefer) && (kindOf(prefer) === 'metal') === wantMetal) return prefer;
  const pool: TinctureV2[] = wantMetal ? ['or', 'argent'] : ['gules', 'azure', 'sable', 'vert', 'purpure'];
  return pool.find((p) => !under.includes(p)) ?? pool[0];
}

/** What a layer lies on: the tinctures beneath it. */
export function underOf(a: ArmsV2, index: number): TinctureV2[] {
  const l = a.layers[index];
  const field = fieldTinctures(a);
  if (l.type === 'ordinary') return field;
  const before = a.layers.slice(0, index);
  const lastOrd = [...before].reverse().find((x): x is OrdinaryLayer => x.type === 'ordinary');
  const chief = [...before].reverse().find((x): x is OrdinaryLayer => x.type === 'ordinary' && x.kind === 'chief');
  if (l.on === 'ordinary' && lastOrd) return lastOrd.counterchanged ? field : [lastOrd.tincture];
  if (l.on === 'chief' && chief) return chief.counterchanged ? field : [chief.tincture];
  const base = [...before].reverse().find((x): x is OrdinaryLayer => x.type === 'ordinary' && x.kind === 'base');
  if (l.on === 'base' && base) return base.counterchanged ? field : [base.tincture];
  // Over a central ordinary (a lone charge on a cross, a fess …) it touches the ordinary too.
  const over = before.filter((x): x is OrdinaryLayer => x.type === 'ordinary' && CENTRAL.has(x.kind) && !standsBetween(x.kind, l.count));
  if (l.on === 'field' && l.arrangement !== 'seme' && over.length) return [...field, ...over.map((o) => o.tincture)];
  // On the field. A single charge over a partition touches every part; several may sit apart, but we cannot
  // tell cheaply, so treat them the same: warn, and offer counterchanging.
  return field;
}

const setLayer = (a: ArmsV2, i: number, patch: Partial<ArmsLayer>): ArmsV2 => ({ ...a, layers: a.layers.map((l, k) => (k === i ? ({ ...l, ...patch } as ArmsLayer) : l)) });

export function tinctureClashesV2(a: ArmsV2): Clash[] {
  const out: Clash[] = [];
  const field = fieldTinctures(a);
  if (field.length > 1 && new Set(field).size < field.length) {
    out.push({ layer: -1, message: `The field repeats ${lc(field.find((x, i) => field.indexOf(x) !== i)!)}, so part of the division disappears.` });
  }
  a.layers.forEach((l, i) => {
    if (l.counterchanged && field.length > 1) return;
    const under = underOf(a, i);
    const bad = [...new Set(under.filter((u) => clashes2(u, l.tincture)))];
    if (!bad.length) return;
    const kind = kindOf(l.tincture);
    const what = l.type === 'ordinary' ? ordinaryLabel(l.kind).toLowerCase() : chargeNoun(l.charge, (l as ChargeLayer).count);
    const message = `The ${lc(l.tincture)} ${what} ${l.type === 'charge' && l.count > 1 ? 'lie' : 'lies'} on ${bad.map(lc).join(' and ')}: ${kind} on ${kind}.`;
    const mixed = new Set(under.filter(bound).map(kindOf)).size === 2;
    const partition = field.length > 1 && under.length === field.length && under.every((t, k) => t === field[k]);
    const fix: Clash['fix'] = mixed && partition
      ? { label: 'Counterchange', apply: (x) => setLayer(x, i, { counterchanged: true }) }
      : mixed ? undefined
        : { label: `Make it ${labelV2(contrastFor(under))}`, apply: (x) => setLayer(x, i, { tincture: contrastFor(under) }) };
    out.push({ layer: i, message, fix });
  });
  return out;
}

// ---------- randomise ----------

type Rnd = () => number;
const pick = <T,>(xs: readonly T[], rnd: Rnd): T => xs[Math.floor(rnd() * xs.length)];
const weighted = <T,>(xs: readonly [T, number][], rnd: Rnd): T => {
  let r = rnd() * xs.reduce((s, x) => s + x[1], 0);
  for (const [x, w] of xs) if ((r -= w) <= 0) return x;
  return xs[xs.length - 1][0];
};

const METALS: TinctureV2[] = ['or', 'argent'];
const COLOURS: TinctureV2[] = ['gules', 'azure', 'vert', 'sable', 'purpure'];
const RARE_COLOURS: TinctureV2[] = ['murrey', 'sanguine', 'tenne'];

/** Charges that read well at any size: the common stock of real heraldry. */
const STOCK = [
  'mullet', 'estoile', 'crescent', 'roundel', 'annulet', 'lozenge', 'mascle', 'billet', 'fleur', 'cross-crosslet',
  'cross-moline', 'cross-patee', 'heart', 'escallop', 'lion', 'eagle', 'boar', 'stag', 'wolf', 'bear', 'griffin',
  'rose', 'trefoil', 'cinquefoil', 'oak', 'garb', 'tower', 'castle', 'key', 'sword', 'crown', 'bee', 'fish', 'swan',
  'raven', 'pheon', 'mill-rind', 'wheel', 'horseshoe', 'bell', 'hunting-horn', 'cup', 'sun', 'trimount', 'mill-wheel',
];

/** A random coat of arms that keeps the rule of tincture. */
export function randomArmsV2(rnd: Rnd = Math.random): ArmsV2 {
  const shield = weighted<ShieldShape>([['heater', 60], ['french', 10], ['iberian', 10], ['swiss', 8], ['kite', 8], ['lozenge', 4]], rnd);
  const colour = () => (rnd() < 0.12 ? pick(RARE_COLOURS, rnd) : pick(COLOURS, rnd));
  const metal = () => pick(METALS, rnd);
  const division = weighted<FieldDivision>([
    ['plain', 38], ['per-pale', 8], ['per-fess', 8], ['per-bend', 5], ['quarterly', 7], ['per-chevron', 4], ['per-saltire', 3],
    ['paly', 4], ['barry', 4], ['bendy', 3], ['chequy', 3], ['gyronny', 2], ['lozengy', 2], ['per-pall', 2], ['tierced-pale', 1],
  ], rnd);
  const n = tinctureCount(division);
  const startMetal = rnd() < 0.35;
  let tinctures: TinctureV2[];
  if (n === 1) tinctures = [rnd() < 0.1 ? pick<TinctureV2>(['ermine', 'vair', 'ermines'], rnd) : startMetal ? metal() : colour()];
  else if (n === 2) tinctures = startMetal ? [metal(), colour()] : [colour(), metal()];
  else {
    const c1 = colour();
    tinctures = [metal(), c1, pick(COLOURS.filter((c) => c !== c1), rnd)];
  }
  const lineable = !['plain', 'chequy', 'lozengy', 'fusilly'].includes(division);
  const line: PartitionLine = lineable && rnd() < 0.25 ? pick<PartitionLine>(['wavy', 'indented', 'embattled', 'engrailed', 'nebuly', 'dancetty'], rnd) : 'straight';
  const busy = ['chequy', 'lozengy', 'gyronny', 'paly', 'barry', 'bendy', 'per-pall', 'tierced-pale'].includes(division);
  const a: ArmsV2 = { shield, field: { division, tinctures, line }, layers: [] };

  // Maybe an ordinary. On a field of metal and colour together no single tincture can contrast with both,
  // so it is counterchanged, or a fur.
  const mixed = (ts: TinctureV2[]) => new Set(ts.filter(bound).map(kindOf)).size > 1;
  let ord: OrdinaryLayer | undefined;
  if (rnd() < (busy ? 0.4 : 0.55)) {
    const kind = weighted<OrdinaryKind>([
      ['chief', 14], ['fess', 12], ['chevron', 12], ['bend', 9], ['pale', 6], ['cross', 8], ['saltire', 7], ['bordure', 9],
      ['canton', 4], ['pile', 3], ['pall', 2], ['orle', 2], ['bend-sinister', 2], ['quarter', 2],
    ], rnd);
    const field = fieldTinctures(a);
    const counter = mixed(field) && rnd() < 0.7;
    const tincture: TinctureV2 = counter ? field[1]
      : mixed(field) ? pick<TinctureV2>(['ermine', 'vair'], rnd)
        : rnd() < 0.08 ? 'ermine' : contrastFor(field, rnd() < 0.5 ? metal() : colour());
    ord = {
      type: 'ordinary', kind, line: rnd() < 0.3 ? pick<PartitionLine>(['wavy', 'engrailed', 'indented', 'embattled', 'invected'], rnd) : 'straight',
      tincture,
      ...(counter && { counterchanged: true }),
      ...(['fess', 'bend', 'chevron'].includes(kind) && rnd() < 0.12 && { cotised: true }),
    };
    a.layers.push(ord);
  }

  // Maybe charges: on the ordinary, round it, or on the field.
  if (rnd() < 0.78) {
    const charge = pick(STOCK, rnd);
    const field = fieldTinctures(a);
    const chargeable = !!ord && !ord.counterchanged && ['chief', 'fess', 'pale', 'bend', 'chevron', 'cross', 'saltire', 'bordure'].includes(ord.kind);
    let onOrd = chargeable && rnd() < 0.4;
    let count = weighted([[1, 5], [2, 1], [3, 4], [4, 1], [5, 1], [6, 1]], rnd);
    if (onOrd) count = ord!.kind === 'bordure' ? 8 : ord!.kind === 'cross' || ord!.kind === 'saltire' ? weighted([[1, 1], [5, 1]], rnd) : weighted([[1, 2], [3, 3]], rnd);
    else if (ord && (ord.kind === 'canton' || ord.kind === 'quarter')) return a;
    else if (ord && CENTRAL.has(ord.kind)) {
      // Field charges stand round a central ordinary; where none can, they go on it instead.
      const round = [2, 3, 4, 6].filter((k) => standsBetween(ord!.kind, k));
      if (round.length) count = pick(round, rnd);
      else if (chargeable) { onOrd = true; count = 1; }
      else return a;
    } else if (ord) count = weighted([[1, 2], [2, 2], [3, 5]], rnd);
    const layer: ChargeLayer = { type: 'charge', charge, arrangement: 'auto', on: onOrd ? 'ordinary' : 'field', count, tincture: 'or' };
    if (onOrd) layer.tincture = contrastFor([ord!.tincture]);
    else if (mixed(field)) { layer.counterchanged = true; layer.tincture = field[1]; }
    else layer.tincture = contrastFor(field);
    a.layers.push(layer);
  }
  return a;
}
