// node --test src/lib/ai/chat-turns.test.ts — which answers can be asked again, and which sources are links.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hostOf, retryable, webUrl } from './chat-turns.ts';
import type { ChatItem } from './types.ts';

const item = (id: string, role: ChatItem['role'], extra: Partial<ChatItem> = {}): ChatItem => ({ id, role, text: id, at: 0, ...extra });

test('an answer to a message in words can be asked again', () => {
  const items = [item('q', 'user'), item('a', 'assistant')];
  assert.equal(retryable(items, 1), true);
  // The reader's own message is not an answer.
  assert.equal(retryable(items, 0), false);
});

test('answers to decisions, family sessions and pictures cannot', () => {
  assert.equal(retryable([item('q', 'user'), item('a', 'assistant', { continuation: true })], 1), false);
  assert.equal(retryable([item('q', 'user', { session: true }), item('a', 'assistant')], 1), false);
  assert.equal(retryable([item('q', 'user', { images: { count: 1, kept: [] } }), item('a', 'assistant')], 1), false);
  // An answer with nothing before it answers nobody.
  assert.equal(retryable([item('a', 'assistant')], 0), false);
});

test('an alternate answer is judged by the question its first answer replied to', () => {
  const items = [item('q', 'user'), item('a', 'assistant'), item('b', 'assistant', { alternateOf: 'a' })];
  assert.equal(retryable(items, 2), true);
  const pictures = [item('q', 'user', { images: { count: 2, kept: ['x'] } }), item('a', 'assistant'), item('b', 'assistant', { alternateOf: 'a' })];
  assert.equal(retryable(pictures, 2), false);
  // An alternate of an answer no longer in the thread is judged by the nearest message before it that is no alternate.
  const orphan = [item('q', 'user'), item('b', 'assistant', { alternateOf: 'gone' })];
  assert.equal(retryable(orphan, 1), true);
  assert.equal(retryable([item('q', 'user', { session: true }), item('b', 'assistant', { alternateOf: 'gone' })], 1), false);
});

test('only http(s) sources are links, named by their host without www', () => {
  assert.equal(webUrl('https://example.org/a'), true);
  assert.equal(webUrl('http://example.org'), true);
  assert.equal(webUrl('javascript:alert(1)'), false);
  assert.equal(webUrl('not a url'), false);
  assert.equal(hostOf('https://www.example.org/page'), 'example.org');
  assert.equal(hostOf('https://archive.example.org'), 'archive.example.org');
  assert.equal(hostOf('nonsense'), 'nonsense');
});
