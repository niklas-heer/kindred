// node --test src/lib/markdown.test.ts — the one Markdown renderer. A model's text shows an image as its alt text only, so
// nothing is fetched from an address the model chose; a story keeps its image. Pure: no server, no network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderMarkdown } from './markdown.ts';

const ADDRESS = 'https://evil.example/p.png?d=0821234567';

test('an assistant reply shows an external image as its alt text only: no image element, no request', () => {
  const html = renderMarkdown(`Here it is ![a map of Heer](${ADDRESS}) and a [link](https://en.wikipedia.org/wiki/Heer).`, { images: 'text' });
  assert.ok(!/<img\b/i.test(html), 'no <img> is rendered');
  assert.ok(!html.includes('evil.example'), 'the image address appears nowhere in the markup');
  assert.ok(html.includes('a map of Heer'), 'the alt text is shown');
  assert.ok(html.includes('href="https://en.wikipedia.org/wiki/Heer"'), 'an ordinary link is still a link: it loads only on a click');
});

test('the alt text of an image is shown escaped, never as markup', () => {
  const html = renderMarkdown('![<b>x</b> & "y"](https://example.org/a.png)', { images: 'text' });
  assert.ok(!/<img\b|<b>/i.test(html));
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;'));
});

test('stories and biographies keep their images, loaded from the address', () => {
  const html = renderMarkdown(`![Grandmother](${ADDRESS})`);
  assert.match(html, /<img src="https:\/\/evil\.example\/p\.png\?d=0821234567" alt="Grandmother"/);
  assert.match(html, /loading="lazy"/);
});

test('an image with a refused scheme is never shown, in either mode', () => {
  for (const opts of [{}, { images: 'text' as const }]) {
    const html = renderMarkdown('![x](javascript:alert(1))', opts);
    assert.ok(!/<img\b|javascript:/i.test(html), JSON.stringify(opts));
  }
});
