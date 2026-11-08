// Small national flags as inline SVG, for the country a house is based in. Common countries are drawn
// (simplified: no seals or coats of arms at this size); any other ISO 3166 code falls back to the emoji flag.
//
// Usage: <Flag code="de" /> or <Flag code="se" size={14} />. `size` is the height in pixels.
import type { ReactNode } from 'react';

type Spec =
  | { h: string[]; w?: number[] } // horizontal stripes, top to bottom, optional relative heights
  | { v: string[]; w?: number[] } // vertical stripes, left to right
  | { nordic: [string, string, string?] } // field, cross, inner cross
  | { draw: (w: number, h: number) => ReactNode; square?: boolean };

const RED = '#d52b1e';
const WHITE = '#ffffff';

function unionJack(w: number, h: number): ReactNode {
  return (
    <g>
      <rect width={w} height={h} fill="#012169" />
      <path d={`M0 0L${w} ${h}M${w} 0L0 ${h}`} stroke={WHITE} strokeWidth={h / 5} />
      <path d={`M0 0L${w} ${h}M${w} 0L0 ${h}`} stroke="#c8102e" strokeWidth={h / 15} />
      <path d={`M${w / 2} 0V${h}M0 ${h / 2}H${w}`} stroke={WHITE} strokeWidth={h / 3} />
      <path d={`M${w / 2} 0V${h}M0 ${h / 2}H${w}`} stroke="#c8102e" strokeWidth={h / 5} />
    </g>
  );
}

const star5 = (cx: number, cy: number, r: number) => {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.4 : r;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)} ${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
};

const FLAGS: Record<string, Spec> = {
  de: { h: ['#000000', '#dd0000', '#ffce00'] },
  at: { h: ['#ed2939', WHITE, '#ed2939'] },
  nl: { h: ['#ae1c28', WHITE, '#21468b'] },
  lu: { h: ['#ed2939', WHITE, '#00a1de'] },
  fr: { v: ['#002654', WHITE, '#ce1126'] },
  it: { v: ['#009246', WHITE, '#ce2b37'] },
  be: { v: ['#000000', '#fae042', '#ed2939'] },
  ie: { v: ['#169b62', WHITE, '#ff883e'] },
  ro: { v: ['#002b7f', '#fcd116', '#ce1126'] },
  mx: { v: ['#006847', WHITE, '#ce1126'] },
  ru: { h: [WHITE, '#0039a6', RED] },
  hu: { h: ['#ce2939', WHITE, '#477050'] },
  bg: { h: [WHITE, '#00966e', '#d62612'] },
  ee: { h: ['#0072ce', '#000000', WHITE] },
  lt: { h: ['#fdb913', '#006a44', '#c1272d'] },
  lv: { h: ['#9e3039', WHITE, '#9e3039'], w: [2, 1, 2] },
  pl: { h: [WHITE, '#dc143c'] },
  ua: { h: ['#0057b7', '#ffd700'] },
  sk: { h: [WHITE, '#0b4ea2', '#ee1c25'] },
  si: { h: [WHITE, '#005da4', '#ed1c24'] },
  hr: { h: ['#ff0000', WHITE, '#171796'] },
  rs: { h: ['#c6363c', '#0c4076', WHITE] },
  es: { h: ['#aa151b', '#f1bf00', '#aa151b'], w: [1, 2, 1] },
  co: { h: ['#fcd116', '#003893', '#ce1126'], w: [2, 1, 1] },
  dk: { nordic: ['#c8102e', WHITE] },
  se: { nordic: ['#006aa7', '#fecc00'] },
  no: { nordic: ['#ba0c2f', WHITE, '#00205b'] },
  fi: { nordic: [WHITE, '#002f6c'] },
  is: { nordic: ['#02529c', WHITE, '#dc1e35'] },
  fo: { nordic: [WHITE, '#0065bd', '#ef303e'] },
  ax: { nordic: ['#0064ae', '#ffd300', '#da0e15'] },
  ch: {
    square: true,
    draw: (w, h) => (
      <g>
        <rect width={w} height={h} fill="#da291c" />
        <path d={`M${w * 0.4} ${h * 0.19}h${w * 0.2}v${h * 0.21}h${w * 0.21}v${h * 0.2}h${-w * 0.21}v${h * 0.21}h${-w * 0.2}v${-h * 0.21}h${-w * 0.21}v${-h * 0.2}h${w * 0.21}Z`} fill={WHITE} />
      </g>
    ),
  },
  gb: { draw: unionJack },
  uk: { draw: unionJack },
  us: {
    draw: (w, h) => (
      <g>
        <rect width={w} height={h} fill={WHITE} />
        {Array.from({ length: 7 }, (_, i) => <rect key={i} y={(i * 2 * h) / 13} width={w} height={h / 13} fill="#b22234" />)}
        <rect width={w * 0.4} height={(h * 7) / 13} fill="#3c3b6e" />
        {Array.from({ length: 12 }, (_, i) => <circle key={i} cx={w * 0.05 + (i % 4) * w * 0.1} cy={h * 0.08 + Math.floor(i / 4) * h * 0.16} r={h * 0.025} fill={WHITE} />)}
      </g>
    ),
  },
  ca: {
    draw: (w, h) => (
      <g>
        <rect width={w} height={h} fill={WHITE} />
        <rect width={w / 4} height={h} fill="#d80621" />
        <rect x={(w * 3) / 4} width={w / 4} height={h} fill="#d80621" />
        <path d={`M${w / 2} ${h * 0.18}l${w * 0.04} ${h * 0.1}l${w * 0.05} ${-h * 0.03}l${-w * 0.02} ${h * 0.2}l${w * 0.07} ${-h * 0.07}l${w * 0.01} ${h * 0.06}l${w * 0.05} ${0}l${-w * 0.05} ${h * 0.1}l${w * 0.02} ${h * 0.04}l${-w * 0.13} ${-h * 0.02}v${h * 0.16}h${-w * 0.02}v${-h * 0.16}l${-w * 0.13} ${h * 0.02}l${w * 0.02} ${-h * 0.04}l${-w * 0.05} ${-h * 0.1}l${w * 0.05} ${0}l${w * 0.01} ${-h * 0.06}l${w * 0.07} ${h * 0.07}l${-w * 0.02} ${-h * 0.2}l${w * 0.05} ${h * 0.03}Z`} fill="#d80621" />
      </g>
    ),
  },
  cz: {
    draw: (w, h) => (
      <g>
        <rect width={w} height={h / 2} fill={WHITE} />
        <rect y={h / 2} width={w} height={h / 2} fill="#d7141a" />
        <path d={`M0 0L${w / 2} ${h / 2}L0 ${h}Z`} fill="#11457e" />
      </g>
    ),
  },
  gr: {
    draw: (w, h) => (
      <g>
        <rect width={w} height={h} fill="#0d5eaf" />
        {[1, 3, 5, 7].map((i) => <rect key={i} y={(i * h) / 9} width={w} height={h / 9} fill={WHITE} />)}
        <rect width={(h * 5) / 9} height={(h * 5) / 9} fill="#0d5eaf" />
        <rect x={(h * 2) / 9} width={h / 9} height={(h * 5) / 9} fill={WHITE} />
        <rect y={(h * 2) / 9} width={(h * 5) / 9} height={h / 9} fill={WHITE} />
      </g>
    ),
  },
  pt: {
    draw: (w, h) => (
      <g>
        <rect width={w} height={h} fill="#ff0000" />
        <rect width={w * 0.4} height={h} fill="#006600" />
        <circle cx={w * 0.4} cy={h / 2} r={h * 0.2} fill="#ffcc00" />
        <circle cx={w * 0.4} cy={h / 2} r={h * 0.12} fill={WHITE} stroke="#ff0000" strokeWidth={h * 0.04} />
      </g>
    ),
  },
  tr: {
    draw: (w, h) => (
      <g>
        <rect width={w} height={h} fill="#e30a17" />
        <circle cx={w * 0.38} cy={h / 2} r={h * 0.25} fill={WHITE} />
        <circle cx={w * 0.42} cy={h / 2} r={h * 0.2} fill="#e30a17" />
        <path d={star5(w * 0.6, h / 2, h * 0.12)} fill={WHITE} />
      </g>
    ),
  },
  jp: { draw: (w, h) => <g><rect width={w} height={h} fill={WHITE} /><circle cx={w / 2} cy={h / 2} r={h * 0.3} fill="#bc002d" /></g> },
  cn: { draw: (w, h) => <g><rect width={w} height={h} fill="#de2910" /><path d={star5(w * 0.17, h * 0.27, h * 0.15)} fill="#ffde00" /></g> },
  vn: { draw: (w, h) => <g><rect width={w} height={h} fill="#da251d" /><path d={star5(w / 2, h / 2, h * 0.3)} fill="#ffff00" /></g> },
  br: {
    draw: (w, h) => (
      <g>
        <rect width={w} height={h} fill="#009c3b" />
        <path d={`M${w / 2} ${h * 0.1}L${w * 0.92} ${h / 2}L${w / 2} ${h * 0.9}L${w * 0.08} ${h / 2}Z`} fill="#ffdf00" />
        <circle cx={w / 2} cy={h / 2} r={h * 0.22} fill="#002776" />
      </g>
    ),
  },
  ar: { draw: (w, h) => <g><rect width={w} height={h} fill="#74acdf" /><rect y={h / 3} width={w} height={h / 3} fill={WHITE} /><circle cx={w / 2} cy={h / 2} r={h * 0.1} fill="#f6b40e" /></g> },
  in: {
    draw: (w, h) => (
      <g>
        <rect width={w} height={h / 3} fill="#ff9933" />
        <rect y={h / 3} width={w} height={h / 3} fill={WHITE} />
        <rect y={(h * 2) / 3} width={w} height={h / 3} fill="#138808" />
        <circle cx={w / 2} cy={h / 2} r={h * 0.13} fill="none" stroke="#000080" strokeWidth={h * 0.03} />
      </g>
    ),
  },
  il: {
    draw: (w, h) => (
      <g>
        <rect width={w} height={h} fill={WHITE} />
        <rect y={h * 0.1} width={w} height={h * 0.15} fill="#0038b8" />
        <rect y={h * 0.75} width={w} height={h * 0.15} fill="#0038b8" />
        <path d={`M${w / 2} ${h * 0.32}L${w / 2 + h * 0.16} ${h * 0.6}H${w / 2 - h * 0.16}ZM${w / 2} ${h * 0.68}L${w / 2 + h * 0.16} ${h * 0.4}H${w / 2 - h * 0.16}Z`} fill="none" stroke="#0038b8" strokeWidth={h * 0.035} />
      </g>
    ),
  },
  au: {
    draw: (w, h) => (
      <g>
        <rect width={w} height={h} fill="#012169" />
        <svg width={w / 2} height={h / 2} viewBox={`0 0 ${w} ${h}`}>{unionJack(w, h)}</svg>
        <path d={star5(w * 0.25, h * 0.75, h * 0.13)} fill={WHITE} />
        <path d={star5(w * 0.75, h * 0.3, h * 0.07)} fill={WHITE} />
        <path d={star5(w * 0.85, h * 0.6, h * 0.07)} fill={WHITE} />
        <path d={star5(w * 0.68, h * 0.75, h * 0.07)} fill={WHITE} />
      </g>
    ),
  },
  nz: {
    draw: (w, h) => (
      <g>
        <rect width={w} height={h} fill="#012169" />
        <svg width={w / 2} height={h / 2} viewBox={`0 0 ${w} ${h}`}>{unionJack(w, h)}</svg>
        {[[0.75, 0.25], [0.68, 0.5], [0.85, 0.45], [0.75, 0.8]].map(([x, y], i) => <path key={i} d={star5(w * x, h * y, h * 0.07)} fill="#c8102e" stroke={WHITE} strokeWidth={h * 0.015} />)}
      </g>
    ),
  },
};

/** The emoji flag for any two-letter code: two regional indicator letters. */
export const emojiFlag = (code: string) =>
  /^[a-z]{2}$/i.test(code) ? String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '';

/** The country's English name, or the code. */
export function countryName(code: string, locale = 'en'): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code.toUpperCase()) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

export const DRAWN_FLAGS = Object.keys(FLAGS);

export function Flag({ code, size = 16, title, className = 'flag', locale }: { code: string; size?: number; title?: string; className?: string; locale?: string }) {
  const c = code.trim().toLowerCase();
  const spec = FLAGS[c];
  const label = title ?? countryName(c, locale);
  if (!spec) {
    const e = emojiFlag(c);
    if (!e) return null;
    return <span className={className} role="img" aria-label={label} title={label} style={{ fontSize: size, lineHeight: 1 }}>{e}</span>;
  }
  const square = 'draw' in spec && spec.square;
  const h = 20;
  const w = square ? 20 : 30;
  let body: ReactNode;
  if ('h' in spec) {
    const weights = spec.w ?? spec.h.map(() => 1);
    const total = weights.reduce((a, b) => a + b, 0);
    let y = 0;
    body = spec.h.map((col, i) => { const hh = (weights[i] / total) * h; const r = <rect key={i} y={y} width={w} height={hh + 0.01} fill={col} />; y += hh; return r; });
  } else if ('v' in spec) {
    const weights = spec.w ?? spec.v.map(() => 1);
    const total = weights.reduce((a, b) => a + b, 0);
    let x = 0;
    body = spec.v.map((col, i) => { const ww = (weights[i] / total) * w; const r = <rect key={i} x={x} width={ww + 0.01} height={h} fill={col} />; x += ww; return r; });
  } else if ('nordic' in spec) {
    const [field, cross, inner] = spec.nordic;
    body = (
      <>
        <rect width={w} height={h} fill={field} />
        <rect x={8} width={inner ? 6 : 4} height={h} fill={cross} />
        <rect y={inner ? 7 : 8} width={w} height={inner ? 6 : 4} fill={cross} />
        {inner && <><rect x={10} width={2} height={h} fill={inner} /><rect y={9} width={w} height={2} fill={inner} /></>}
      </>
    );
  } else body = spec.draw(w, h);
  return (
    <svg className={className} width={(size * w) / h} height={size} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
      <title>{label}</title>
      {body}
      <rect x=".25" y=".25" width={w - 0.5} height={h - 0.5} fill="none" stroke="#000" strokeOpacity=".22" strokeWidth=".5" rx=".6" />
    </svg>
  );
}
