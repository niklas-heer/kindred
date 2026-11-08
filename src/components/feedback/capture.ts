// Takes the picture of the screen for a feedback report, in the browser, and draws the mark and the blurred parts on it.
// modern-screenshot redraws the live page through the browser's own engine (an SVG foreignObject), so themes, color-mix,
// the inline SVG shields, and <canvas> elements render as they are on screen; it inlines the web fonts and same-origin pictures
// itself. It is imported only when a steward opens the panel. A picture it cannot read draws as nothing, never an error.
export interface Box { x: number; y: number; w: number; h: number }

/** What is never in the picture: the feedback panel and the picker. */
export const SKIP_ATTR = 'data-feedback-skip';
const skipped = (node: Node) => node instanceof Element && (node.hasAttribute(SKIP_ATTR) || (node.tagName === 'DIALOG' && !!node.querySelector(':scope > .fb-panel')));

const MAX_SIDE = 2000;
const TRANSPARENT = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

// Two corrections to the copy the library makes. It writes computed widths rounded to three decimals, so a flex row that
// exactly fits its contents can wrap and lose its last item: one extra pixel keeps it on one line. And the paper-grain
// background (an SVG turbulence filter) renders as a dark veil inside the copy, so it is left out.
const GRAIN = /url\("data:image\/svg\+xml[^"]*feTurbulence[^"]*"\)(,\s*)?/g;
const adjustCopy = (n: Node) => {
  if (!(n instanceof HTMLElement)) return;
  if (n.style.flexWrap.startsWith('wrap')) {
    const width = parseFloat(n.style.width);
    if (width) n.style.setProperty('width', `${width + 1}px`);
  }
  if (n.style.backgroundImage.includes('feTurbulence')) {
    n.style.backgroundImage = n.style.backgroundImage.replace(GRAIN, '').replace(/,\s*$/, '') || 'none';
    // The grain was one 260px tile; the layers left must not keep its size, or a page-wide gradient repeats as bands.
    n.style.backgroundSize = 'auto';
  }
};

/** The visible window, at up to 2x, its longest side at most MAX_SIDE. */
export async function captureScreen(): Promise<HTMLCanvasElement> {
  // Whatever closed to open the panel (a menu, the palette) has gone before the picture is taken.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  await document.fonts?.ready;
  const { domToCanvas } = await import('modern-screenshot');
  const width = window.innerWidth;
  const height = window.innerHeight;
  const scale = Math.min(window.devicePixelRatio || 1, 2, MAX_SIDE / Math.max(width, height));
  const background = getComputedStyle(document.body).backgroundColor;
  return domToCanvas(document.body, {
    width, height, scale, backgroundColor: background, style: { margin: '0' }, filter: (n) => !skipped(n), timeout: 15000, onCloneEachNode: adjustCopy, features: { restoreScrollPosition: true },
    fetch: { placeholderImage: TRANSPARENT, requestInit: { credentials: 'same-origin' } },
  });
}

/** Coarse blocks of colour, drawn over a box. Text under them cannot be read back. */
function pixelate(ctx: CanvasRenderingContext2D, source: HTMLCanvasElement, b: Box) {
  const x = Math.max(0, Math.round(b.x)), y = Math.max(0, Math.round(b.y));
  const w = Math.min(source.width - x, Math.round(b.w)), h = Math.min(source.height - y, Math.round(b.h));
  if (w < 1 || h < 1) return;
  const block = Math.max(18, Math.round(source.width / 60));
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(w / block));
  small.height = Math.max(1, Math.round(h / block));
  small.getContext('2d')!.drawImage(source, x, y, w, h, 0, 0, small.width, small.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, small.width, small.height, x, y, w, h);
  ctx.imageSmoothingEnabled = true;
}

/** Draws the picture as it will be sent: the screen, the blurred parts, then the mark around the chosen element. */
export function drawReport(target: HTMLCanvasElement, base: HTMLCanvasElement, blurs: Box[], mark: Box | null) {
  target.width = base.width;
  target.height = base.height;
  const ctx = target.getContext('2d')!;
  ctx.drawImage(base, 0, 0);
  for (const b of blurs) pixelate(ctx, base, b);
  if (mark) {
    const unit = Math.max(1, base.width / window.innerWidth);
    const pad = 3 * unit;
    const r = { x: mark.x - pad, y: mark.y - pad, w: mark.w + pad * 2, h: mark.h + pad * 2 };
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 6 * unit;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = '#e8481c';
    ctx.lineWidth = 3 * unit;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
  }
}

/** The canvas as a JPEG of at most `maxBytes`, lowering the quality as needed. */
export async function canvasJpeg(canvas: HTMLCanvasElement, maxBytes: number): Promise<Blob> {
  for (const quality of [0.82, 0.65, 0.45, 0.3]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= maxBytes) return blob;
  }
  throw new Error('feedback.err_picture_big');
}
