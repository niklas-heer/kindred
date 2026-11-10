// node --test src/lib/svg-data-uri.test.ts — the portrait's data: URI decodes back to the same drawing, and is shorter.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { svgDataUri } from './svg-data-uri.ts';

const PREFIX = 'data:image/svg+xml;utf8,';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><clipPath id="c"><circle cx="50" cy="50" r="40"/></clipPath></defs>
\t<g clip-path="url(#c)" style="opacity:50%"><path d="M0 0 L10,10 Z" fill="#a1b2c3"/><text font-family='EB Garamond'>Ä &amp; ö ? + = / ; ,</text></g></svg>`;

test('the URI decodes to the drawing, with its line breaks as spaces', () => {
  const uri = svgDataUri(svg);
  assert.ok(uri.startsWith(PREFIX));
  assert.equal(decodeURIComponent(uri.slice(PREFIX.length)), svg.replace(/[\t\n\r]+/g, ' '));
});

test('the URL parser keeps it whole: no fragment, no stripped characters, nothing left to escape for HTML', () => {
  const uri = svgDataUri(svg);
  const url = new URL(uri);
  assert.equal(url.hash, '');
  assert.equal(decodeURIComponent(url.href.slice(PREFIX.length)), svg.replace(/[\t\n\r]+/g, ' '));
  assert.doesNotMatch(uri, /[#<>"'&\t\n\r]/);
});

test('it is shorter than encodeURIComponent', () => {
  assert.ok(svgDataUri(svg).length < (PREFIX + encodeURIComponent(svg)).length * 0.8);
});
