import assert from 'node:assert/strict';
import { test } from 'node:test';
import { socialLink } from './social.ts';

test('a full URL, an @handle and a bare username all open the same profile', () => {
  for (const value of ['https://www.instagram.com/jo.example/', '@jo.example', 'jo.example']) {
    const l = socialLink(value, 'Instagram');
    assert.equal(l?.network, 'Instagram');
    assert.match(l!.href, /^https:\/\/www\.instagram\.com\/jo\.example\/?$/);
    assert.equal(l?.handle, '@jo.example');
  }
});

test('each network builds its own profile address', () => {
  const cases: [string, string, string][] = [
    ['Facebook', 'jo.example', 'https://www.facebook.com/jo.example'],
    ['LinkedIn', 'jo-example', 'https://www.linkedin.com/in/jo-example'],
    ['X', '@jo_example', 'https://x.com/jo_example'],
    ['Twitter', '@jo_example', 'https://x.com/jo_example'],
    ['TikTok', 'jo.example', 'https://www.tiktok.com/@jo.example'],
    ['YouTube', '@joexample', 'https://www.youtube.com/@joexample'],
    ['Bluesky', 'jo', 'https://bsky.app/profile/jo.bsky.social'],
    ['Bluesky', '@jo.example.org', 'https://bsky.app/profile/jo.example.org'],
    ['Threads', 'jo.example', 'https://www.threads.com/@jo.example'],
    ['Mastodon', '@jo@mastodon.social', 'https://mastodon.social/@jo'],
    ['WhatsApp', '+49 170 0000000', 'https://wa.me/491700000000'],
  ];
  for (const [label, value, href] of cases) assert.equal(socialLink(value, label)?.href, href, `${label} ${value}`);
});

test('a URL names its own network, whatever the label says', () => {
  assert.equal(socialLink('https://www.tiktok.com/@jo', 'Other')?.network, 'TikTok');
  assert.equal(socialLink('instagram.com/jo', '')?.href, 'https://instagram.com/jo');
});

test('http is upgraded: a link is always https', () => {
  assert.equal(socialLink('http://instagram.com/jo', 'Instagram')?.href, 'https://instagram.com/jo');
});

test('nothing but https on the network\'s own domain ever becomes a link', () => {
  const hostile = [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'javascript://instagram.com/%0aalert(1)',
    'data:text/html,hi', 'vbscript:x', 'file:///etc/passwd', 'mailto:jo@example.org',
    'https://evil.example/jo', 'https://instagram.com.evil.example/jo', 'https://notinstagram.com/jo',
    'https://instagram.com@evil.example/jo', 'https://user:pw@instagram.com/jo', 'https://instagram.com:8443/jo',
    'evil.example/jo', '//evil.example/jo', 'https://instagram.com/',
  ];
  for (const value of hostile) assert.equal(socialLink(value, 'Instagram'), null, value);
});

test('a handle that does not look like one, or no known network, stays plain text', () => {
  assert.equal(socialLink('two words', 'Instagram'), null);
  assert.equal(socialLink('<script>', 'Instagram'), null);
  assert.equal(socialLink('a/../../evil', 'X'), null);
  assert.equal(socialLink('jo', 'Other'), null);
  assert.equal(socialLink('jo', 'Signal'), null);
  assert.equal(socialLink('jo', ''), null);
  assert.equal(socialLink('', 'Instagram'), null);
  assert.equal(socialLink(undefined, undefined), null);
});

test('a Mastodon account on another server stays plain text: only the known domain is linked', () => {
  assert.equal(socialLink('@jo@evil.example', 'Mastodon'), null);
});
