// Contact cards: a child under 18 is never put on a parent's card unless that is asked for.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFamily } from './graph.ts';
import { buildHouseholds, type Row } from './contact-households.ts';
import type { GPerson, Graph } from './types.ts';

const year = new Date().getFullYear();
const person = (id: string, more: Partial<GPerson> = {}) => ({ id, given: id, surname: 'T', living: true, stories: 0, ...more }) as GPerson;
const family = () =>
  buildFamily({
    people: [person('mum', { born: '1980-01-01' }), person('dad', { born: '1980-01-01' }), person('kid', { born: `${year - 4}-03-01` })],
    unions: [],
    parents: [
      { child: 'kid', parent: 'mum', kind: 'biological', confidence: 'certain' },
      { child: 'kid', parent: 'dad', kind: 'biological', confidence: 'certain' },
    ],
    houses: [],
    places: [],
  } as unknown as Graph);
const row = (person: string): Row => ({ id: 1, person, kind: 'phone', label: null, value: '+1', visibility: 'family' });

test('by default a young child stands alone, on no parent\'s card', () => {
  const r = buildHouseholds(family(), [row('mum'), row('dad')]);
  assert.deepEqual(r.households.map((h) => h.members.map((m) => m.id)).sort(), [['dad'], ['mum']]);
  assert.deepEqual(r.noDetails.map((p) => p.id), ['kid']);
});

test('a child with details of their own gets their own card by default', () => {
  const r = buildHouseholds(family(), [row('mum'), row('kid')]);
  assert.deepEqual(r.households.map((h) => h.members.map((m) => m.id)).sort(), [['kid'], ['mum']]);
});

test('on request a child under 18 joins a parent who has details', () => {
  const r = buildHouseholds(family(), [row('mum')], { childrenWithParent: true });
  assert.deepEqual(r.households.map((h) => h.members.map((m) => m.id)), [['mum', 'kid']]);
  assert.deepEqual(r.noDetails.map((p) => p.id), ['dad']);
});
