// Classic heraldic shapes, drawn by hand in a 100 × 100 box. Bodies carry no fill: the renderer sets it.

const r2 = (n: number) => Math.round(n * 100) / 100;
const polar = (cx: number, cy: number, r: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [r2(cx + r * Math.cos(a)), r2(cy + r * Math.sin(a))];
};

/** A star of `n` points, the first pointing up. The mullet of v1 is star(5, 50, 19.5) centred at 50,54. */
function star(n: number, outer: number, inner: number, cy = 50): string {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const [x, y] = polar(50, cy, i % 2 ? inner : outer, -90 + (i * 180) / n);
    pts.push(`${x} ${y}`);
  }
  return `M${pts.join('L')}Z`;
}

/** The v1 mullet, exactly: one five-pointed star. */
export const MULLET = star(5, 50, 19.5, 54);

/** Six wavy rays: each ray leaves the centre on one curve and returns on another that bends the same way. */
function estoile(): string {
  let d = '';
  for (let k = 0; k < 6; k++) {
    const a = -90 + k * 60;
    const p1 = polar(50, 50, 12, a - 30);
    const tip = polar(50, 50, 49, a);
    const p2 = polar(50, 50, 12, a + 30);
    const c1 = polar(50, 50, 26, a - 26);
    const c2 = polar(50, 50, 36, a + 10);
    const c3 = polar(50, 50, 34, a + 26);
    const c4 = polar(50, 50, 22, a + 6);
    d += `${k ? 'L' : 'M'}${p1[0]} ${p1[1]}C${c1[0]} ${c1[1]} ${c2[0]} ${c2[1]} ${tip[0]} ${tip[1]}C${c3[0]} ${c3[1]} ${c4[0]} ${c4[1]} ${p2[0]} ${p2[1]}`;
  }
  return `<path d="${d}Z"/><circle cx="50" cy="50" r="15"/>`;
}

/** A wheel with paddles on its rim: the miller's wheel of German and Dutch heraldry. */
function millWheel(): string {
  let spokes = '';
  for (let k = 0; k < 6; k++) spokes += `<rect x="47.5" y="14" width="5" height="72" transform="rotate(${k * 30} 50 50)"/>`;
  let paddles = '';
  for (let k = 0; k < 12; k++) paddles += `<path d="M44 2H56L55 12H45Z" transform="rotate(${k * 30} 50 50)"/>`;
  return `<path fill-rule="evenodd" d="M50 10a40 40 0 1 0 .01 0ZM50 17a33 33 0 1 1-.01 0Z"/>${spokes}<circle cx="50" cy="50" r="10"/>${paddles}`;
}

/** Four arms around a centre: one arm drawn pointing up, turned four times. */
const quad = (arm: string) => [0, 90, 180, 270].map((r) => `<path d="${arm}" transform="rotate(${r} 50 50)"/>`).join('');

export const CLASSIC: Record<string, string> = {
  mullet: `<path d="${MULLET}"/>`,
  'mullet-six': `<path d="${star(6, 49, 24)}"/>`,
  estoile: estoile(),
  crescent: '<path d="M23.54 30A40 40 0 1 0 76.46 30A32 32 0 1 1 23.54 30Z"/>',
  roundel: '<circle cx="50" cy="50" r="42"/>',
  annulet: '<path fill-rule="evenodd" d="M50 8a42 42 0 1 0 .01 0ZM50 20a30 30 0 1 1-.01 0Z"/>',
  lozenge: '<path d="M50 3L85 50L50 97L15 50Z"/>',
  mascle: '<path fill-rule="evenodd" d="M50 3L85 50L50 97L15 50ZM50 25L68.5 50L50 75L31.5 50Z"/>',
  fusil: '<path d="M50 2L73 50L50 98L27 50Z"/>',
  billet: '<rect x="29" y="12" width="42" height="76"/>',
  heart: '<path d="M50 92C22 70 7 53 7 34C7 18 19 9 31 9C40 9 47 14 50 22C53 14 60 9 69 9C81 9 93 18 93 34C93 53 78 70 50 92Z"/>',
  escutcheon: '<path d="M14 8H86V48C86 72 71 86 50 94C29 86 14 72 14 48Z"/>',
  gouttes: '<path d="M50 6C56 22 76 44 76 64C76 80 64 93 50 93C36 93 24 80 24 64C24 44 44 22 50 6Z"/>',
  trimount: '<path d="M2 94V80C5 64 15 56 27 60C31 41 41 30 50 30C59 30 69 41 73 60C85 56 95 64 98 80V94Z"/>',
  'mill-wheel': millWheel(),
  'mill-rind':
    '<path fill-rule="evenodd" d="M6 40C6 28 20 25 29 34L38 43H62L71 34C80 25 94 28 94 40C94 46 89 50 83 50C89 50 94 54 94 60C94 72 80 75 71 66L62 57H38L29 66C20 75 6 72 6 60C6 54 11 50 17 50C11 50 6 46 6 40ZM50 44L44 50L50 56L56 50Z"/>',
  'cross-crosslet':
    '<rect x="44" y="6" width="12" height="88"/><rect x="6" y="44" width="88" height="12"/>' + quad('M34 16H66V26H34Z'),
  'cross-moline': quad('M44 50V28C44 20 37 15 27 17C31 7 45 4 50 15C55 4 69 7 73 17C63 15 56 20 56 28V50Z'),
  'cross-patee': '<path d="M43 43L35 5Q50 10 65 5L57 43L95 35Q90 50 95 65L57 57L65 95Q50 90 35 95L43 57L5 65Q10 50 5 35Z"/>',
  'cross-potent': '<rect x="44" y="14" width="12" height="72"/><rect x="14" y="44" width="72" height="12"/>' + quad('M32 6H68V18H32Z'),
  'cross-humetty': '<rect x="40" y="6" width="20" height="88"/><rect x="6" y="40" width="88" height="20"/>',
};

export const CLASSIC_VIEWBOX = '0 0 100 100';
