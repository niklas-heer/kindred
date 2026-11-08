// The AI design answer: `symbolism` is optional. An older or sparse reply still parses, a malformed list is dropped
// instead of failing the answer, and the schema the providers receive does not require the field.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { cantingResponseSchema } from './canting-schema.ts';

const suggestion = {
  explanation: 'Heer: a lion, for a lord\'s courage',
  field: ['azure'],
  charges: [{ charge: 'lion', tincture: 'or', count: 1 }],
};

test('a reply without symbolism still parses, and yields none', () => {
  const r = cantingResponseSchema.safeParse({ suggestions: [suggestion] });
  assert.ok(r.success);
  assert.equal(r.data.suggestions[0].symbolism, undefined);
});

test('a valid symbolism list is kept', () => {
  const symbolism = [
    { element: 'argent', why: 'Argent for the honour your family names' },
    { element: 'a tower', why: 'a tower for the army, Heer' },
  ];
  const r = cantingResponseSchema.safeParse({ suggestions: [{ ...suggestion, symbolism }] });
  assert.ok(r.success);
  assert.deepEqual(r.data.suggestions[0].symbolism, symbolism);
});

test('a malformed symbolism list is dropped rather than failing the whole answer', () => {
  for (const bad of [[{ element: '', why: 'no element' }], 'argent', [{ element: 'x' }]]) {
    const r = cantingResponseSchema.safeParse({ suggestions: [{ ...suggestion, symbolism: bad }] });
    assert.ok(r.success, `refused ${JSON.stringify(bad)}`);
    assert.equal(r.data.suggestions[0].symbolism, undefined);
  }
});

test('the rest of the answer is still checked: a suggestion without an explanation is refused', () => {
  assert.equal(cantingResponseSchema.safeParse({ suggestions: [{ ...suggestion, explanation: '' }] }).success, false);
});

test('the schema the providers receive does not require symbolism', () => {
  const json = z.toJSONSchema(cantingResponseSchema) as unknown as {
    properties: { suggestions: { items: { required?: string[]; properties: Record<string, unknown> } } };
  };
  const item = json.properties.suggestions.items;
  assert.ok('symbolism' in item.properties, 'symbolism is described to the model');
  assert.ok(!(item.required ?? []).includes('symbolism'), 'symbolism is optional');
});

test('an over-long answer is cut to its limits instead of refused', () => {
  const long = { ...suggestion, explanation: 'x'.repeat(300), field: ['azure', 'or', 'gules', 'vert'], symbolism: Array(9).fill({ element: 'e'.repeat(90), why: 'w'.repeat(300) }), charges: Array(5).fill({ charge: 'lion', count: 12 }) };
  const r = cantingResponseSchema.safeParse({ suggestions: Array(10).fill(long) });
  assert.ok(r.success);
  assert.equal(r.data.suggestions.length, 8);
  const s = r.data.suggestions[0];
  assert.equal(s.explanation.length, 200);
  assert.equal(s.field?.length, 3);
  assert.equal(s.charges?.length, 3);
  assert.equal(s.charges?.[0].count, 9);
  assert.equal(s.symbolism?.length, 6);
  assert.equal(s.symbolism?.[0].element.length, 60);
  assert.equal(s.symbolism?.[0].why.length, 200);
});
