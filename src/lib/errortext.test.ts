// A request that never got an answer reads as a connection problem, in the reader's language, not as the browser's words.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } });
after(() => vite.close());
const { errorText } = await vite.ssrLoadModule('/src/lib/errortext.ts');

test('each browser\'s network failure is translated', () => {
  for (const m of ['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.']) {
    assert.match(errorText(new TypeError(m), 'de'), /nicht erreichbar/);
  }
});

test('an English sentence the dictionary knows is translated, with its name', () => {
  assert.equal(errorText(new Error('Kerstin already has two parents.'), 'de'), 'Kerstin hat schon zwei Elternteile.');
  assert.match(errorText(new Error('This would create a loop in the ancestry.'), 'af'), /lus in die afkoms/);
  assert.equal(errorText(new Error('Something nobody wrote down'), 'de'), 'Something nobody wrote down');
});

test('another error keeps its own message', () => {
  assert.equal(errorText(new Error('Failed to fetch'), 'en'), 'Failed to fetch');
  assert.equal(errorText(new TypeError('x is not a function'), 'en'), 'x is not a function');
});
