// node --test src/lib/i18n/kinship/kinship.test.ts — every written kinship module against the shared table (cases.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCALES, LANGUAGES } from '../languages.ts';
import { kinshipLabel, kinshipIsStub, yourKinship } from '../kinship.ts';
import { CASES } from './cases.ts';

const written = LOCALES.filter((l) => !kinshipIsStub(l));

test('every written kinship module answers every case in the table', () => {
  const problems: string[] = [];
  for (const locale of written) {
    for (const c of CASES) {
      const k = { ...c.kin, via: [] };
      const want = c[locale];
      if (!want) {
        problems.push(`${locale}: no answer for ${c.kin.label}${c.view ? ` (${c.view})` : ''}`);
        continue;
      }
      assert.equal(kinshipLabel(k, locale, c.view ?? 'you'), want[0], `${locale} ${c.kin.label}: the relation`);
      assert.equal(yourKinship(k, locale), want[1], `${locale} ${c.kin.label}: with "your"`);
    }
  }
  assert.deepEqual(problems, []);
});

test('a complete language has written kinship words, and a stub falls back to the English word without a possessive', () => {
  for (const locale of LOCALES) if (LANGUAGES[locale].complete) assert.ok(!kinshipIsStub(locale), `${locale} is complete, so its kinship module is written`);
  const stub = LOCALES.find((l) => kinshipIsStub(l));
  if (stub) {
    assert.equal(kinshipLabel({ label: 'great-aunt', via: [] }, stub), 'great-aunt');
    assert.equal(yourKinship({ label: 'great-aunt', via: [] }, stub, { capital: true }), 'Great-aunt');
  }
});
