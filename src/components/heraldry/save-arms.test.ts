// Saving a house from the designer stores its design, so a steward who has saved the arms is no longer shown the
// "Using generated arms" badge, even when the arms are the v1 ones they opened (see Designer's save).
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, after } from 'node:test';
import { createServer } from 'vite';

process.env.KINDRED_DATA_DIR = mkdtempSync(join(tmpdir(), 'kindred-save-arms-'));
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } });
after(() => vite.close());
const convert = await vite.ssrLoadModule('/src/components/heraldry/convert.ts');
const meaning = await vite.ssrLoadModule('/src/lib/house-meaning.ts');

const v1 = { field: 'azure', division: 'plain', charge: 'lion', chargeTincture: 'or' };

test('a v1 house is generated arms until a design is stored', () => {
  assert.equal(meaning.generatedArms(v1), true);
  assert.equal(meaning.reviewBadge({ aiOn: false, researched: true, generated: meaning.generatedArms(v1) }), 'generated-arms');
});

test('saving the arms unchanged stores the design, which clears the generated-arms badge', () => {
  const saved = convert.storeV2(convert.asV2(v1));
  assert.equal(meaning.generatedArms(saved), false);
  assert.equal(meaning.reviewBadge({ aiOn: false, researched: true, generated: meaning.generatedArms(saved) }), null);
  // The v1 summary stays beside the design, so older readers still see the house's arms.
  assert.equal(saved.field, 'azure');
  assert.equal(saved.charge, 'lion');
});
