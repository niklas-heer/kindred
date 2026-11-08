import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { translateMessage } from './i18n/dictionary.ts';
import { publicError } from './server-errors.ts';

const where = { fn: 'saveThing', data: { tree: 'modern' } };

function logged(t: TestContext) {
  const lines: string[] = [];
  t.mock.method(console, 'error', (line: string) => { lines.push(line); });
  return lines;
}

for (const message of [
  'UNIQUE constraint failed: person.id',
  'no such table: person',
  'D1_ERROR: too many SQL variables at offset 12: SQLITE_ERROR',
  'database is locked',
  "Cannot read properties of undefined (reading 'given')",
  'no person p-123',
  '[\n  {\n    "code": "too_small",\n    "path": ["tree"]\n  }\n]',
  'common.not_a_real_key',
]) {
  test(`an internal failure is logged and hidden: ${message.slice(0, 40)}`, (t) => {
    const lines = logged(t);
    const shown = publicError(new Error(message), where);
    assert.ok(shown instanceof Error);
    assert.ok(!shown.message.includes(message), 'the reader does not see the raw message');
    const reference = /reference ([0-9a-f]{8})/.exec(lines[0] ?? '')?.[1];
    assert.ok(reference, 'the log line carries a reference');
    assert.ok(shown.message.includes(reference), 'the reader is given the same reference');
    assert.ok(lines[0].includes(message.split('\n')[0]), 'the log line carries the real error');
    assert.match(lines[0], /saveThing/);
    assert.match(lines[0], /family modern/);
  });
}

test('the generic message translates in the reader’s language and keeps the reference', (t) => {
  logged(t);
  const shown = publicError(new TypeError('boom'), where) as Error;
  const reference = /[0-9a-f]{8}/.exec(shown.message)![0];
  for (const locale of ['de', 'af'] as const) {
    const text = translateMessage(shown.message, locale);
    assert.notEqual(text, shown.message);
    assert.ok(text.includes(reference));
  }
});

test('a cause is logged, and a family name that is not a plain id is left out', (t) => {
  const lines = logged(t);
  publicError(new Error('outer', { cause: new Error('the real D1 reason') }), { fn: 'f', data: { tree: 'x\nFORGED LINE' } });
  assert.match(lines[0], /the real D1 reason/);
  assert.doesNotMatch(lines[0], /FORGED/);
});

test('something thrown that is not an Error is hidden too', (t) => {
  const lines = logged(t);
  assert.ok(publicError('raw string', { fn: 'f' }) instanceof Error);
  assert.match(lines[0], /raw string/);
});

test('messages written for readers pass through, unlogged', (t) => {
  const lines = logged(t);
  const redirect = new Response(null, { status: 307 });
  const notFound = { isNotFound: true };
  assert.equal(publicError(redirect, where), redirect);
  assert.equal(publicError(notFound, where), notFound);
  const auth = Object.assign(new Error('Anything an auth guard says.'), { name: 'AuthError' });
  const ai = Object.assign(new Error('Anthropic answered 500.'), { name: 'AiError' });
  const aborted = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
  for (const e of [auth, ai, aborted, new Error('houses.err.not_found'), new Error('Kerstin already has two parents.'), new Error('A person can have up to 40 fields.')]) {
    assert.equal(publicError(e, where), e, e.message);
  }
  assert.deepEqual(lines, []);
});
