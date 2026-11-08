// Draws heraldry v2: the shield (field, division, ordinaries, charges) and, when asked, the full achievement.
import { useId, type ReactNode } from 'react';
import type { Achievement, ArmsV2, ChargeLayer, Fur, OrdinaryLayer, TinctureV2 } from '~/lib/seed-format';
import { useArt, type Art, type ArtSource } from './art';
import { FACES_LEFT, HELM_GLYPH, LEANS } from './catalogue';
import { chargeDef } from './registry';
import { divisionPaint, fieldTinctures, ordinaryShape, placeCharges, SHIELD_PATH, type Spot } from './geometry';
import { FUR_COLOURS, HEX_V2, isFur } from './tinctures';

/** The tinctures a field actually uses: what is stored, padded with sensible contrasts. */
export { fieldTinctures };

// ---------- furs ----------

const ERMINE_SPOT = 'M0 -6.4a1.25 1.25 0 1 0 .01 0ZM-2.2 -4.1a1.2 1.2 0 1 0 .01 0ZM2.2 -4.1a1.2 1.2 0 1 0 .01 0ZM0 -3C-.5 0 -2 2.6 -3.2 5.6L-1 4.4L0 6.4L1 4.4L3.2 5.6C2 2.6 .5 0 0 -3Z';

function FurPattern({ id, fur, scale }: { id: string; fur: Fur; scale?: number }) {
  const pt = scale ? `scale(${scale})` : undefined;
  const [ground, mark] = FUR_COLOURS[fur];
  if (fur === 'ermine' || fur === 'ermines' || fur === 'erminois') {
    return (
      <pattern id={id} width="22" height="24" patternUnits="userSpaceOnUse" x="0" y="4" patternTransform={pt}>
        <rect width="22" height="24" fill={ground} />
        <path d={ERMINE_SPOT} fill={mark} transform="translate(5.5 7) scale(1.05)" />
        <path d={ERMINE_SPOT} fill={mark} transform="translate(16.5 19) scale(1.05)" />
      </pattern>
    );
  }
  if (fur === 'potent') {
    const t = (x: number, y: number) => `M${x} ${y}h16v4h-5v4h-6v-4h-5Z`;
    return (
      <pattern id={id} width="16" height="16" patternUnits="userSpaceOnUse" x="2" y="5" patternTransform={pt}>
        <rect width="16" height="16" fill={ground} />
        <path d={`${t(0, 0)}${t(-8, 8)}${t(8, 8)}`} fill={mark} />
      </pattern>
    );
  }
  // Vair: rows of bells. Counter-vair sets the second row base to base with the first.
  const bell = (x: number, y: number, up = true) =>
    up ? `M${x} ${y + 8}L${x + 2.5} ${y + 5.5}V${y + 2}L${x + 5} ${y}H${x + 11}L${x + 13.5} ${y + 2}V${y + 5.5}L${x + 16} ${y + 8}Z`
      : `M${x} ${y}L${x + 2.5} ${y + 2.5}V${y + 6}L${x + 5} ${y + 8}H${x + 11}L${x + 13.5} ${y + 6}V${y + 2.5}L${x + 16} ${y}Z`;
  const d = fur === 'vair' ? bell(0, 0) + bell(-8, 8) + bell(8, 8) : bell(0, 0) + bell(0, 8, false);
  return (
    <pattern id={id} width="16" height="16" patternUnits="userSpaceOnUse" x="2" y="5" patternTransform={pt}>
      <rect width="16" height="16" fill={ground} />
      <path d={d} fill={mark} />
    </pattern>
  );
}

// ---------- charges ----------

const vb = (art: Art) => art.viewBox.split(' ').map(Number);

/** One glyph centred on a spot, turned about its centre when the spot says so. `lean` is the way the drawing already leans. */
function Glyph({ art, spot, fill, mirror, lean = 0, dx = 0, dy = 0, opacity }: { art: Art; spot: Spot; fill: string; mirror?: boolean; lean?: number; dx?: number; dy?: number; opacity?: number }) {
  const [x0, , w] = vb(art);
  const glyph = (
    <svg x={spot.x - spot.s / 2 + dx} y={spot.y - spot.s / 2 + dy} width={spot.s} height={spot.s} viewBox={art.viewBox} overflow="visible" opacity={opacity}>
      <g fill={fill} color={fill} transform={mirror ? `translate(${x0 * 2 + w} 0) scale(-1 1)` : undefined} dangerouslySetInnerHTML={{ __html: art.body }} />
    </svg>
  );
  if (spot.turn === undefined) return glyph;
  return <g transform={`rotate(${spot.turn - lean} ${spot.x + dx} ${spot.y + dy})`}>{glyph}</g>;
}

/** The fill for a tincture: a colour, or a fur pattern. `proper` takes the charge's natural colour. */
type Painter = (t: TinctureV2, charge?: string) => string;

function ChargeGroup({ art, spots, tincture, charge, paint, mirror, maskId }: { art: Art; spots: Spot[]; tincture: TinctureV2; charge: string; paint: Painter; mirror?: boolean; maskId: string }) {
  const fill = paint(tincture, charge);
  const lean = LEANS[charge];
  if (isFur(tincture)) {
    // A pattern inside each glyph's own coordinates would shrink with it; paint the fur over the shield through
    // a mask of the glyphs instead.
    return (
      <>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="-20" y="-20" width="140" height="160">
          {spots.map((s, i) => <Glyph key={i} art={art} spot={s} fill="#fff" mirror={mirror} lean={lean} />)}
        </mask>
        <rect x="-10" y="-10" width="120" height="140" fill={fill} mask={`url(#${maskId})`} />
      </>
    );
  }
  return <>{spots.map((s, i) => <Glyph key={i} art={art} spot={s} fill={fill} mirror={mirror} lean={lean} />)}</>;
}

function Shadows({ art, spots, mirror, lean }: { art: Art; spots: Spot[]; mirror?: boolean; lean?: number }) {
  return <>{spots.map((s, i) => <Glyph key={i} art={art} spot={s} fill="#000" mirror={mirror} lean={lean} dx={(s.s / 50) * 0.8} dy={(s.s / 50) * 1.2} opacity={0.45} />)}</>;
}

/** Everything drawn inside the shield, in the 100 × 120 box. */
export function ShieldBody({ arms, uid, paint, source }: { arms: ArmsV2; uid: string; paint: Painter; source: ArtSource }) {
  const tinctures = fieldTinctures(arms);
  const paints = divisionPaint(arms.field.division, arms.field.line, arms.field.pieces);
  const regionMask = (i: number) => `${uid}-region${i}`;
  const usesCounterchange = arms.layers.some((l) => l.counterchanged) && tinctures.length > 1;

  const body: ReactNode[] = [];
  arms.layers.forEach((layer, li) => {
    const before = arms.layers.slice(0, li);
    if (layer.type === 'ordinary') {
      body.push(<Ordinary key={li} o={layer} arms={arms} tinctures={tinctures} paint={paint} regionMask={regionMask} />);
      return;
    }
    const art = source.charge(layer.charge);
    if (!art) return;
    const spots = placeCharges(layer, before, arms.shield);
    const mirror = !!layer.contourne;
    const counter = layer.counterchanged && tinctures.length > 1;
    body.push(
      <g key={li}>
        {spots[0]?.s >= 9 && <Shadows art={art} spots={spots} mirror={mirror} lean={LEANS[layer.charge]} />}
        {counter ? (
          tinctures.map((_, i) => (
            <g key={i} mask={`url(#${regionMask(i)})`}>
              <ChargeGroup art={art} spots={spots} tincture={tinctures[(i + 1) % tinctures.length]} charge={layer.charge} paint={paint} mirror={mirror} maskId={`${uid}-c${li}-${i}`} />
            </g>
          ))
        ) : (
          <ChargeGroup art={art} spots={spots} tincture={layer.tincture} charge={layer.charge} paint={paint} mirror={mirror} maskId={`${uid}-c${li}`} />
        )}
      </g>,
    );
  });

  return (
    <>
      {usesCounterchange && (
        <defs>
          {tinctures.map((_, i) => (
            <mask key={i} id={regionMask(i)} maskUnits="userSpaceOnUse" x="-20" y="-20" width="140" height="160">
              <rect x="-20" y="-20" width="140" height="160" fill={i === 0 ? '#fff' : '#000'} />
              {paints.map((p, k) => <path key={k} d={p.d} fill={p.t === i ? '#fff' : '#000'} />)}
            </mask>
          ))}
        </defs>
      )}
      <rect x="-10" y="-10" width="120" height="140" fill={paint(tinctures[0])} />
      {paints.map((p, k) => <path key={k} d={p.d} fill={paint(tinctures[p.t] ?? tinctures[0])} />)}
      {body}
    </>
  );
}

function Ordinary({ o, arms, tinctures, paint, regionMask }: { o: OrdinaryLayer; arms: ArmsV2; tinctures: TinctureV2[]; paint: Painter; regionMask: (i: number) => string }) {
  const shape = ordinaryShape(o, arms.shield);
  const d = shape.d + (shape.cotises ?? '');
  const counter = o.counterchanged && tinctures.length > 1;
  return (
    <g>
      {counter ? (
        tinctures.map((_, i) => <path key={i} d={d} fillRule="evenodd" fill={paint(tinctures[(i + 1) % tinctures.length])} mask={`url(#${regionMask(i)})`} />)
      ) : (
        <path d={d} fillRule="evenodd" fill={paint(o.tincture)} />
      )}
      <path d={d} fillRule="evenodd" fill="none" stroke="#000" strokeOpacity=".3" strokeWidth=".6" strokeLinejoin="round" />
    </g>
  );
}

// ---------- the whole thing ----------

/** Every tincture a design paints, so only the furs it uses get patterns. */
function usedTinctures(a: ArmsV2): Set<TinctureV2> {
  const s = new Set<TinctureV2>(fieldTinctures(a));
  for (const l of a.layers) s.add(l.tincture);
  const ach = a.achievement;
  if (ach) {
    for (const t of ach.mantling ?? []) s.add(t);
    if (ach.crest) s.add(ach.crest.tincture);
    if (ach.supporters) s.add(ach.supporters.tincture);
  }
  return s;
}

export function chargeIdsOf(a: ArmsV2, full = false): string[] {
  const ids = a.layers.filter((l): l is ChargeLayer => l.type === 'charge').map((l) => l.charge);
  if (full && a.achievement) {
    if (a.achievement.crest) ids.push(a.achievement.crest.charge);
    if (a.achievement.supporters) ids.push(a.achievement.supporters.charge);
  }
  return ids;
}

export interface ArmsV2Props {
  arms: ArmsV2;
  /** Width of the shield in pixels; the full achievement is drawn at the same shield size, so it comes out wider. */
  size?: number;
  title?: string;
  /** Draw the achievement (helm, mantling, crest, motto, supporters) when the arms have one. */
  full?: boolean;
  className?: string;
}

export function ArmsV2View({ arms, size = 32, title, full, className = 'arms' }: ArmsV2Props) {
  const uid = useId().replace(/\W/g, '');
  const ach = full ? arms.achievement : undefined;
  const helmGi = ach && ach.helm !== 'none' ? HELM_GLYPH[ach.helm].gi : undefined;
  // The charges' drawings load by category, and the achievement's helm by the weapons category.
  const source = useArt(chargeIdsOf(arms, !!ach), helmGi ? ['weapons'] : []);

  const used = usedTinctures(arms);
  const furId = (f: Fur) => `${uid}-fur-${f}`;
  const paint: Painter = (t, charge) => {
    if (isFur(t)) return `url(#${furId(t)})`;
    if (t === 'proper') return (charge && chargeDef(charge)?.proper) || HEX_V2.proper;
    return HEX_V2[t];
  };
  const clip = `${uid}-shield`;
  const shieldPath = SHIELD_PATH[arms.shield] ?? SHIELD_PATH.heater;

  const defs = (
    <defs>
      <clipPath id={clip}>
        <path d={shieldPath} />
      </clipPath>
      <linearGradient id={`${uid}-sheen`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fff" stopOpacity=".42" />
        <stop offset=".4" stopColor="#fff" stopOpacity=".06" />
        <stop offset=".6" stopColor="#000" stopOpacity="0" />
        <stop offset="1" stopColor="#000" stopOpacity=".3" />
      </linearGradient>
      <radialGradient id={`${uid}-shade`} cx=".5" cy=".42" r=".62">
        <stop offset=".62" stopColor="#000" stopOpacity="0" />
        <stop offset="1" stopColor="#000" stopOpacity=".38" />
      </radialGradient>
      {[...used].filter(isFur).map((f) => <FurPattern key={f} id={furId(f)} fur={f} />)}
    </defs>
  );

  const shield = (
    <>
      <g clipPath={`url(#${clip})`}>
        <ShieldBody arms={arms} uid={uid} paint={paint} source={source} />
        <rect width="100" height="120" fill={`url(#${uid}-sheen)`} />
        <rect width="100" height="120" fill={`url(#${uid}-shade)`} />
      </g>
      <path d={shieldPath} transform="translate(50 60) scale(.93) translate(-50 -60)" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth={1.2} />
      <path d={shieldPath} fill="none" stroke="#17130d" strokeWidth={2.5} strokeLinejoin="round" />
    </>
  );

  if (!ach) {
    return (
      <svg className={className} width={size} height={(size * 6) / 5} viewBox="0 0 100 120" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
        {title ? <title>{title}</title> : null}
        {defs}
        {shield}
      </svg>
    );
  }

  const layout = achievementLayout(ach);
  const [vx, vy, vw, vh] = layout.viewBox;
  return (
    <svg className={className} width={(size * vw) / 100} height={(size * vh) / 100} viewBox={layout.viewBox.join(' ')} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} data-achievement="">
      {title ? <title>{title}</title> : null}
      {defs}
      <AchievementParts ach={ach} arms={arms} layout={layout} paint={paint} source={source} where="behind" />
      <g transform={`translate(50 ${layout.shieldTop})`}>{shield}</g>
      <AchievementParts ach={ach} arms={arms} layout={layout} paint={paint} source={source} where="front" />
      <rect x={vx} y={vy} width={vw} height={vh} fill="none" />
    </svg>
  );
}

// ---------- the achievement ----------

interface Layout {
  viewBox: [number, number, number, number];
  crestY?: number;
  torseY?: number;
  helmY?: number;
  shieldTop: number;
  mottoY?: number;
}

/** Stacks the parts top to bottom in a 200-wide canvas, the shield's box at x 50..150. */
export function achievementLayout(ach: Achievement): Layout {
  let y = 0;
  const out: Partial<Layout> = {};
  const helm = ach.helm !== 'none';
  if (ach.crest) { out.crestY = y; y += 30; }
  if (ach.crest || ach.torse) { out.torseY = y; y += helm ? 4 : 8; }
  if (helm) { out.helmY = y; y += 34; }
  const shieldTop = y;
  let bottom = shieldTop + 118;
  if (ach.motto?.trim()) { out.mottoY = shieldTop + 112; bottom = shieldTop + 140; }
  const left = ach.supporters ? 0 : helm ? 10 : 46;
  const right = ach.supporters ? 200 : helm ? 190 : 154;
  return { viewBox: [left, -2, right - left, bottom + 4], shieldTop, ...out };
}

/** Mantling: leafy cloth falling from the helm on both sides, outside in one tincture and lined in another. */
function mantlingPaths(hy: number, st: number): { outer: string; lining: string } {
  // Drawn for the left side relative to the helm's top (hy) and the shield's top (st), then mirrored.
  const Y = (v: number) => (v < 100 ? hy + v : st + (v - 100));
  const p = (pairs: [number, number][]) => pairs.map(([x, v]) => `${x} ${Y(v).toFixed(1)}`);
  const outer = `M${p([[94, 6]])}C${p([[70, 2], [48, 14], [40, 28]])}C${p([[32, 42], [38, 52], [26, 62]])}C${p([[14, 72], [10, 100], [16, 112]])}C${p([[8, 128], [10, 146], [20, 158]])}C${p([[22, 146], [28, 140], [34, 138]])}C${p([[28, 152], [34, 166], [46, 172]])}C${p([[42, 156], [46, 144], [50, 134]])}L${p([[50, 104]])}C${p([[40, 106], [34, 96], [42, 86]])}C${p([[50, 76], [44, 62], [56, 50]])}C${p([[66, 40], [80, 30], [96, 26]])}Z`;
  const lining = `M${p([[40, 28]])}C${p([[44, 40], [52, 44], [48, 56]])}C${p([[42, 66], [30, 70], [26, 84]])}C${p([[22, 98], [28, 108], [20, 118]])}C${p([[14, 128], [16, 144], [20, 158]])}C${p([[12, 146], [10, 128], [16, 112]])}C${p([[10, 100], [14, 72], [26, 62]])}C${p([[38, 52], [32, 42], [40, 28]])}Z`;
  return { outer, lining };
}

function Torse({ y, a, b, paint }: { y: number; a: TinctureV2; b: TinctureV2; paint: Painter }) {
  const segs = 6;
  const w = 46;
  const x0 = 100 - w / 2;
  return (
    <g>
      {Array.from({ length: segs }, (_, i) => {
        const x = x0 + (i * w) / segs;
        return <path key={i} d={`M${x} ${y + 8}L${x + 3} ${y}H${x + w / segs + 3}L${x + w / segs} ${y + 8}Z`} fill={paint(i % 2 ? b : a)} stroke="#17130d" strokeWidth=".7" strokeLinejoin="round" />;
      })}
    </g>
  );
}

function Scroll({ y, text }: { y: number; text: string }) {
  const t = text.trim();
  const w = Math.min(150, Math.max(70, t.length * 5.6 + 24));
  const x0 = 100 - w / 2;
  const x1 = 100 + w / 2;
  return (
    <g>
      <path d={`M${x0 - 10} ${y + 6}L${x0 + 2} ${y + 4}V${y + 20}L${x0 - 10} ${y + 22}L${x0 - 4} ${y + 14}Z`} fill="#cfc6ae" stroke="#17130d" strokeWidth=".8" strokeLinejoin="round" />
      <path d={`M${x1 + 10} ${y + 6}L${x1 - 2} ${y + 4}V${y + 20}L${x1 + 10} ${y + 22}L${x1 + 4} ${y + 14}Z`} fill="#cfc6ae" stroke="#17130d" strokeWidth=".8" strokeLinejoin="round" />
      <path d={`M${x0} ${y + 2}Q100 ${y + 10} ${x1} ${y + 2}V${y + 18}Q100 ${y + 26} ${x0} ${y + 18}Z`} fill="#ece4cf" stroke="#17130d" strokeWidth=".9" strokeLinejoin="round" />
      <text
        x="100" y={y + 16.2} textAnchor="middle" fontSize="8.6" fill="#2a1f16"
        style={{ fontFamily: 'var(--font-display, serif)', letterSpacing: '0.04em' }}
        {...(t.length * 5.4 > w - 16 ? { textLength: w - 16, lengthAdjust: 'spacingAndGlyphs' } : {})}
      >
        {t}
      </text>
    </g>
  );
}

function AchievementParts({ ach, arms, layout, paint, source, where }: { ach: Achievement; arms: ArmsV2; layout: Layout; paint: Painter; source: ArtSource; where: 'behind' | 'front' }) {
  const tinctures = fieldTinctures(arms);
  const firstCharge = arms.layers.find((l) => l.type === 'charge')?.tincture;
  const [ma, mb] = ach.mantling ?? [tinctures.find((t) => !isFur(t) && t !== 'or' && t !== 'argent') ?? 'gules', firstCharge && (firstCharge === 'or' || firstCharge === 'argent') ? firstCharge : 'or'];
  const st = layout.shieldTop;
  if (where === 'behind') {
    const parts: ReactNode[] = [];
    if (ach.helm !== 'none' && layout.helmY !== undefined) {
      const m = mantlingPaths(layout.helmY, st);
      const side = (mirror: boolean) => (
        <g key={String(mirror)} transform={mirror ? 'translate(200 0) scale(-1 1)' : undefined}>
          <path d={m.outer} fill={paint(ma)} stroke="#17130d" strokeWidth=".9" strokeLinejoin="round" />
          <path d={m.lining} fill={paint(mb)} stroke="#17130d" strokeWidth=".7" strokeLinejoin="round" />
        </g>
      );
      parts.push(side(false), side(true));
    }
    if (ach.supporters) {
      const art = source.charge(ach.supporters.charge);
      if (art) {
        const s = 66;
        const fill = paint(ach.supporters.tincture, ach.supporters.charge);
        const spotL: Spot = { x: 26, y: st + 58, s };
        const spotR: Spot = { x: 174, y: st + 58, s };
        // Both face the shield.
        const flip = FACES_LEFT.has(ach.supporters.charge);
        parts.push(
          <g key="sup">
            <Glyph art={art} spot={spotL} fill="#000" opacity={0.35} dx={1} dy={1.5} mirror={flip} />
            <Glyph art={art} spot={spotR} fill="#000" opacity={0.35} dx={1} dy={1.5} mirror={!flip} />
            <Glyph art={art} spot={spotL} fill={fill} mirror={flip} />
            <Glyph art={art} spot={spotR} fill={fill} mirror={!flip} />
          </g>,
        );
      }
    }
    return <>{parts}</>;
  }
  const parts: ReactNode[] = [];
  if (ach.helm !== 'none' && layout.helmY !== undefined) {
    const h = HELM_GLYPH[ach.helm];
    const art = source.glyph(h.gi);
    if (art) {
      const spot: Spot = { x: 100, y: layout.helmY + 19, s: 40 };
      parts.push(
        <g key="helm">
          <Glyph art={art} spot={spot} fill="#17130d" dx={0} dy={0} />
          <Glyph art={art} spot={{ ...spot, s: spot.s - 1.6 }} fill={h.metal} />
        </g>,
      );
    }
  }
  if (layout.torseY !== undefined) parts.push(<Torse key="torse" y={layout.torseY + (ach.helm !== 'none' ? 2 : 0)} a={mb} b={ma} paint={paint} />);
  if (ach.crest && layout.crestY !== undefined) {
    const art = source.charge(ach.crest.charge);
    if (art) {
      const spot: Spot = { x: 100, y: layout.crestY + 17, s: 34 };
      parts.push(
        <g key="crest">
          <Glyph art={art} spot={spot} fill="#000" opacity={0.4} dx={0.6} dy={0.9} />
          <Glyph art={art} spot={spot} fill={paint(ach.crest.tincture, ach.crest.charge)} />
        </g>,
      );
    }
  }
  if (layout.mottoY !== undefined && ach.motto) parts.push(<Scroll key="motto" y={layout.mottoY} text={ach.motto} />);
  return <>{parts}</>;
}

/** A round swatch of one tincture, furs drawn as their pattern. For pickers. */
export function TinctureSwatch({ t, size = 26, charge }: { t: TinctureV2; size?: number; charge?: string }) {
  const id = `${useId().replace(/\W/g, '')}-sw`;
  const fill = isFur(t) ? `url(#${id})` : t === 'proper' ? (charge && chargeDef(charge)?.proper) || HEX_V2.proper : HEX_V2[t];
  return (
    <svg className="ae-swatch" width={size} height={size} viewBox="0 0 26 26" aria-hidden data-tincture={t}>
      {isFur(t) && (
        <defs>
          <FurPattern id={id} fur={t} scale={0.6} />
        </defs>
      )}
      {t === 'proper' ? (
        <g>
          <path d="M13 1A12 12 0 0 1 13 25Z" fill="#4c7a36" />
          <path d="M13 1A12 12 0 0 0 13 25Z" fill="#8a5a32" />
        </g>
      ) : (
        <circle cx="13" cy="13" r="12" fill={fill} />
      )}
      <circle cx="13" cy="13" r="12" fill="none" stroke="#000" strokeOpacity=".3" strokeWidth="1" />
    </svg>
  );
}
