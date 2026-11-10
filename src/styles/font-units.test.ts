// node --test src/styles/font-units.test.ts — text sizes are in rem, so a reader's larger default text size in the browser
// reaches the page. The tree's cards (card.css) are drawn in the canvas's own pixels and zoomed as a whole, and print.css
// is for paper; both keep px.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

const src = join(import.meta.dirname, '..');
const css = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? css(join(dir, e.name)) : e.name.endsWith('.css') ? [join(dir, e.name)] : []));
const EXEMPT = ['components/card.css', 'components/print/print.css'];

test('font sizes in the stylesheets are not in px', () => {
  const found: string[] = [];
  for (const file of css(src)) {
    const rel = relative(src, file);
    if (EXEMPT.includes(rel)) continue;
    for (const m of readFileSync(file, 'utf8').matchAll(/(?<![\w-])(font-size|font|--fs-\d|--glance-fs)\s*:\s*([^;{}]+)/g)) {
      const value = m[2].replace(/\/\s*[\d.]+px/g, ''); // a px line-height after the slash in `font:` is not a font size
      if (/(?<![\w.-])\d*\.?\d+px\b/.test(value)) found.push(`${rel}: ${m[0].trim()}`);
    }
  }
  assert.deepEqual(found, []);
});
