// node --test src/lib/feed/text.test.ts — a post's text as plain pieces and safe links: only http and https addresses
// become links, the sentence's punctuation is not the address's, and nothing typed is lost or turned into markup.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linkify, safeHref } from './text.ts';

const links = (text: string) => linkify(text).filter((p) => p.href).map((p) => p.href);
const joined = (text: string) => linkify(text).map((p) => p.text).join('');

test('the pieces give the text back, whatever is in it', () => {
  for (const text of ['', 'Just words.', 'See https://example.org/a?b=1&c=2#d now', '<b>bold</b> <script>alert(1)</script>', 'two\n\nlines www.example.org.', 'a (https://example.org/x_(y)) b']) {
    assert.equal(joined(text), text);
  }
});

test('http, https and www addresses become links; the sentence keeps its punctuation', () => {
  assert.deepEqual(links('Photos are at https://example.org/sunday. Come and look!'), ['https://example.org/sunday']);
  assert.deepEqual(links('Read www.example.org/path, then call.'), ['https://www.example.org/path']);
  assert.deepEqual(links('(see http://example.org/a_(b))'), ['http://example.org/a_(b)']);
  assert.deepEqual(links('one https://a.example/1 two https://b.example/2'), ['https://a.example/1', 'https://b.example/2']);
  assert.deepEqual(linkify('Look: https://example.org!'), [{ text: 'Look: ' }, { text: 'https://example.org', href: 'https://example.org/' }, { text: '!' }]);
});

test('nothing else becomes a link', () => {
  for (const text of ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'file:///etc/passwd', 'mailto:someone@example.org', 'ftp://example.org/x', 'vbscript:x', 'example.org', 'https://', 'http://localhost/admin', 'https://user:secret@example.org/']) {
    assert.deepEqual(links(text), [], text);
  }
  assert.equal(safeHref('JAVASCRIPT:alert(1)'), null);
  assert.equal(safeHref('https://example.org/a b'), 'https://example.org/a%20b');
  // An address cannot smuggle markup: it is an attribute value and a text node, both escaped by the page.
  assert.deepEqual(links('https://example.org/"onmouseover="x'), ['https://example.org/']);
});
