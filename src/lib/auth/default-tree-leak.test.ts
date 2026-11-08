import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultTreeFor } from './guest-host.ts';

test('an anonymous visitor gets no family id in the session payload', () => {
  assert.equal(defaultTreeFor(false, 'hofmann'), undefined);
});

test('a member or a guest with a valid visit still gets the default family (the sign-in redirect needs it)', () => {
  assert.equal(defaultTreeFor(true, ' hofmann '), 'hofmann');
  assert.equal(defaultTreeFor(true, ''), undefined);
});
