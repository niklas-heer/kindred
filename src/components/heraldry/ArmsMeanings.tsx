// What the arms mean: each colour, division, ordinary and charge of a coat of arms in plain words, with its small
// swatch or drawing. The designer shows it under the preview (open on a wide screen, folded on a phone) and the house
// page shows it quietly under the large arms. It reads the arms as they are, so it updates as the design changes.
import { useEffect, useState, type ReactNode } from 'react';
import { useT, type Translator } from '~/lib/i18n';
import type { ArmsV2, ChargeLayer, OrdinaryLayer, TinctureV2 } from '~/lib/seed-format';
import { chargeArtV2, needsLibrary, useLibrary, useLibraryReady } from './art';
import { CHARGE_BY_ID } from './catalogue';
import { chargeMeaning, divisionMeaning, ordinaryMeaning, tinctureMeaning } from './meanings';
import { ArmsV2View, fieldTinctures, TinctureSwatch } from './render';
import { HEX_V2, labelV2 } from './tinctures';
import { divisionLabel, LINES_V2, ordinaryLabel } from './vocab';
import './meanings.css';

/** A charge's drawing, one colour: `color` sets it, and the surrounding colour is kept when it is absent. */
export function ChargeGlyph({ id, size = 30, color }: { id: string; size?: number; color?: string }) {
  useLibraryReady();
  const art = chargeArtV2(id);
  if (!art) return <span className="ae-glyph-wait" style={{ width: size, height: size }} />;
  return (
    <svg width={size} height={size} viewBox={art.viewBox} aria-hidden className="ae-glyph" style={color ? { color } : undefined}>
      <g fill="currentColor" color="currentColor" dangerouslySetInnerHTML={{ __html: art.body }} />
    </svg>
  );
}

/** The colour a charge is drawn in: its tincture, or its own colour when it is blazoned proper. */
function chargeColour(t: TinctureV2, charge: string): string {
  if (t === 'proper') return CHARGE_BY_ID[charge]?.proper ?? '#8a5a32';
  return HEX_V2[t];
}

/** A light colour (argent, a pale stain) needs a dark tile behind it to show on a light page. */
function isLight(hex: string): boolean {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6;
}

interface Row {
  key: string;
  kind: string;
  icon: ReactNode;
  /** The icon sits on a dark tile, for a light colour. */
  dark?: boolean;
  name: string;
  /** Where it lies, its line, its colour: the small words after the name. */
  detail?: string;
  meaning: string;
}

/** Every element of the arms, as a row a reader can take in: colours, the division, each ordinary, each charge. */
function rowsOf(arms: ArmsV2, tr: Translator): Row[] {
  const rows: Row[] = [];
  const ft = fieldTinctures(arms);
  const division = arms.field.division;
  const lineName = (line: string) => tr(LINES_V2.find((l) => l.id === line)!.label);

  for (const t of [...new Set(ft)]) {
    rows.push({ key: `t-${t}`, kind: tr('heraldry.means.colour'), icon: <TinctureSwatch t={t} size={26} />, name: tr(labelV2(t)), meaning: tr(tinctureMeaning(t)) });
  }

  const plainField = { shield: arms.shield, field: { division: 'plain' as const, tinctures: [ft[0]], line: 'straight' as const }, layers: [] };
  rows.push({
    key: 'division',
    kind: tr('heraldry.means.division'),
    icon: <ArmsV2View arms={{ ...plainField, field: arms.field, layers: [] }} size={30} className="ae-mini" />,
    name: tr(divisionLabel(division)),
    detail: division !== 'plain' && arms.field.line !== 'straight' ? lineName(arms.field.line) : undefined,
    meaning: tr(divisionMeaning(division)),
  });

  arms.layers.forEach((layer, i) => {
    if (layer.type === 'ordinary') {
      const o: OrdinaryLayer = layer;
      rows.push({
        key: `o-${i}`,
        kind: tr('heraldry.means.ordinary'),
        icon: <ArmsV2View arms={{ ...plainField, layers: [o] }} size={30} className="ae-mini" />,
        name: tr(ordinaryLabel(o.kind)),
        detail: [o.line !== 'straight' ? lineName(o.line) : '', tr(labelV2(o.tincture))].filter(Boolean).join(' · '),
        meaning: tr(ordinaryMeaning(o.kind)),
      });
      return;
    }
    const c: ChargeLayer = layer;
    const where = c.on === 'chief' ? tr('heraldry.in_chief') : c.on === 'base' ? tr('heraldry.in_base') : c.on === 'ordinary' ? tr('heraldry.on_ordinary') : '';
    const count = c.arrangement === 'seme' ? tr('heraldry.arrangement.seme') : c.count > 1 ? tr('heraldry.means.times', { count: c.count }) : '';
    const label = CHARGE_BY_ID[c.charge] ? tr(CHARGE_BY_ID[c.charge].label) : c.charge;
    rows.push({
      key: `c-${i}`,
      kind: tr('heraldry.means.charge'),
      icon: <ChargeGlyph id={c.charge} size={30} color={chargeColour(c.tincture, c.charge)} />,
      dark: isLight(chargeColour(c.tincture, c.charge)),
      name: count ? `${label} ${count}` : label,
      detail: [where, c.counterchanged ? '' : tr(labelV2(c.tincture))].filter(Boolean).join(' · '),
      meaning: tr(chargeMeaning(c.charge)),
    });
  });
  return rows;
}

/** Keeps a flag true only on a wide screen; starts false so the server and the first render agree. */
export function useWide(min = 760): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(`(min-width: ${min}px)`);
    const sync = () => setWide(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, [min]);
  return wide;
}

/**
 * The "What it means" list for a coat of arms, in a folding section. `open` sets its first state: the designer opens it
 * on a wide screen and folds it on a phone; the house page leaves it shut.
 */
export function ArmsMeanings({ arms, label, open = false, className }: {
  arms: ArmsV2;
  /** The summary line; "What it means" when absent. */
  label?: string;
  open?: boolean;
  className?: string;
}) {
  const tr = useT();
  const charges = arms.layers.filter((l): l is ChargeLayer => l.type === 'charge').map((l) => l.charge);
  useLibrary(needsLibrary(charges));
  const rows = rowsOf(arms, tr);
  const plain = !arms.layers.length;
  return (
    <details className={`ae-means${className ? ` ${className}` : ''}`} open={open}>
      <summary className="ae-means-summary">{label ?? tr('heraldry.means.title')}</summary>
      <ul className="ae-means-list">
        {rows.map((r) => (
          <li key={r.key} className="ae-means-row">
            <span className={`ae-means-icon${r.dark ? ' dark' : ''}`}>{r.icon}</span>
            <span className="ae-means-text">
              <small className="ae-means-kind">{r.kind}</small>
              <span className="ae-means-name">
                <b>{r.name}</b>
                {r.detail && <small className="subtle"> · {r.detail}</small>}
              </span>
              <span className="ae-means-line">{r.meaning}</span>
            </span>
          </li>
        ))}
      </ul>
      {plain && <p className="ae-means-plain">{tr('heraldry.means.none')}</p>}
      <p className="ae-means-note">{tr('heraldry.means.note')}</p>
    </details>
  );
}
