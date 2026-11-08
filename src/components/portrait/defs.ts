// The mourning filters, added to the document once and referred to from CSS (art.css), so
// hundreds of portraits cost no more markup than one. They live in the document rather than in
// each drawing because their colours are theme tokens: --portrait-mourn-ink and -paper.
//
// kd-mourn:       a duotone in the theme's mourning ink and paper (sepia in Codex) for drawings.
// kd-photo-mourn: the same duotone, untinted, for uploaded photos.

export const DEFS_ID = 'kd-portrait-defs';

// Luminance into alpha. Photos keep their full range; flat illustrated colour needs a gentler curve,
// or deep skin and pale hair end up as a black mask under a white wig.
const PHOTO_LUMA = '.36 1.12 .12 0 -.34';
const DRAWN_LUMA = '.16 .44 .07 0 .3';

function mourning(id: string, tint: number, luma: string): string {
  // Luminance into alpha, paper laid over ink through it, then clipped back to the image. A drawing
  // keeps a little of its colour, like a hand-tinted print, so the house still shows.
  const keep = tint ? `<feComposite in="tone" in2="SourceGraphic" operator="arithmetic" k2="${1 - tint}" k3="${tint}" result="tone"/>` : '';
  return (
    `<filter id="${id}" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB">` +
    `<feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${luma}" result="lum"/>` +
    `<feFlood style="flood-color:var(--portrait-mourn-paper)" result="paper"/>` +
    `<feComposite in="paper" in2="lum" operator="in" result="lit"/>` +
    `<feFlood style="flood-color:var(--portrait-mourn-ink)" result="ink"/>` +
    `<feComposite in="lit" in2="ink" operator="over" result="tone"/>` +
    keep +
    `<feComposite in="tone" in2="SourceGraphic" operator="in"/>` +
    `</filter>`
  );
}

const SVG =
  `<svg id="${DEFS_ID}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" ` +
  `style="position:absolute;width:0;height:0;overflow:hidden;pointer-events:none">` +
  mourning('kd-mourn', 0.2, DRAWN_LUMA) +
  mourning('kd-photo-mourn', 0.2, PHOTO_LUMA) +
  `</svg>`;

/** Adds the filters to <body> once. Runs after hydration, so React never sees the extra node. */
export function ensurePortraitDefs(): void {
  if (typeof document === 'undefined' || document.getElementById(DEFS_ID)) return;
  const holder = document.createElement('div');
  holder.innerHTML = SVG;
  document.body.appendChild(holder.firstChild!);
}
