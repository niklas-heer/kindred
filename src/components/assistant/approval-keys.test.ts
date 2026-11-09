// node --test src/components/assistant/approval-keys.test.ts — an approval's retry keys come from the stored card, so every tab, device and reload agrees on them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { approvalKeys } from './approval-keys.ts';

const ID = '7f1c9f0e-3a54-4b6e-9d21-0a1b2c3d4e5f';
const RULE = /^[A-Za-z0-9_-]{8,80}$/;

test('two mounted cards for one proposal get the same key', () => {
  assert.equal(approvalKeys(ID).for('add-story', { person: 'ada', body: 'Mill' }), approvalKeys(ID).for('add-story', { person: 'ada', body: 'Mill' }));
});

test('the order of the args does not matter, and a left-out optional is the same as absent', () => {
  assert.equal(approvalKeys(ID).for('s', { a: 1, b: { c: 2, d: 3 } }), approvalKeys(ID).for('s', { b: { d: 3, c: 2 }, a: 1, e: undefined }));
});

test('another proposal, step or edited args is another key', () => {
  const base = approvalKeys(ID).for('s', { a: 1 });
  assert.notEqual(approvalKeys(crypto.randomUUID()).for('s', { a: 1 }), base);
  assert.notEqual(approvalKeys(ID).for('t', { a: 1 }), base);
  assert.notEqual(approvalKeys(ID).for('s', { a: 2 }), base);
});

test('a key always fits the server’s rule, whatever the card’s id looks like', () => {
  for (const id of [ID, 'p', 'odd id/with:chars', 'x'.repeat(200), '']) assert.match(approvalKeys(id).for('step', { a: 1 }), RULE);
});
