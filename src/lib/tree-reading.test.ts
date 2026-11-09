// node --test src/lib/tree-reading.test.ts — the tree page's small decisions: which view a family opens in, who
// counts as a member of a house, whom a search lists first, and what a card says to a screen reader.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFamily, stepsFrom, type Family } from './graph.ts';
import { searchPeople } from './search.ts';
import type { GParent, GPerson, GUnion, Graph, House } from './types.ts';

const person = (id: string, given: string, surname: string, extra: Partial<GPerson> = {}): GPerson => ({
  id, given, surname, living: true, stories: 0, contacts: 0, ...extra,
});

// Ida is the reader. Her mother Greta Ashworth and her great-grandmother Maud Ashworth are family; Thomas
// Ashworth shares the surname and nothing else, and has the stories and the title that used to put him first.
function family(): Family {
  const people: GPerson[] = [
    person('thomas', 'Thomas', 'Ashworth', { stories: 5, title: 'Mayor' }),
    person('maud', 'Maud', 'Ashworth', { living: false, house: 'ash' }),
    person('edith', 'Edith', 'Ashworth', { living: false, house: 'ash' }),
    person('greta', 'Greta', 'Ashworth', { house: 'ash' }),
    person('ida', 'Ida', 'Holm', { house: 'holm' }),
    person('karl', 'Karl', 'Holm', { house: 'holm' }),
    person('ashley', 'Ashley', 'Brandt'),
  ];
  const parents: GParent[] = [['edith', 'maud'], ['greta', 'edith'], ['ida', 'greta'], ['ida', 'karl']]
    .map(([child, parent]) => ({ child, parent, kind: 'biological', confidence: 'certain' }) as GParent);
  const unions: GUnion[] = [{ id: 'u1', a: 'karl', b: 'greta', kind: 'marriage', start: '1980' }];
  const houses = [{ id: 'ash', name: 'House Ashworth' }, { id: 'holm', name: 'House Holm' }] as House[];
  const graph: Graph = { tree: { id: 't', name: 'T', tagline: '', theme: 'codex', focus: 'ida', people: people.length }, houses, places: [], people, parents, unions };
  return buildFamily(graph);
}

test('steps from a person count parents, children and partners alike', () => {
  const steps = stepsFrom(family(), 'ida');
  assert.equal(steps.get('ida'), 0);
  assert.equal(steps.get('greta'), 1);
  assert.equal(steps.get('edith'), 2);
  assert.equal(steps.get('maud'), 3);
  assert.equal(steps.has('thomas'), false);
});

test('among equal matches, a search lists the reader\'s nearest relatives first', () => {
  const f = family();
  const near = stepsFrom(f, 'ida');
  const ids = (q: string, n?: ReadonlyMap<string, number>) => searchPeople(f, q, 40, n).map((r) => r.id);
  assert.deepEqual(ids('ashw', near), ['greta', 'edith', 'maud', 'thomas']);
  // Without a reader the old order holds: the living, the storied and the titled.
  assert.deepEqual(ids('ashw'), ['thomas', 'greta', 'maud', 'edith']);
  // Closeness never outranks a better match: "ash" starts Ashley's given name and the Ashworths' surname alike, but
  // a house name alone ("holm" finds Karl by name, nobody by house only) stays below a name.
  assert.equal(ids('thomas ashworth', near)[0], 'thomas');
  assert.deepEqual(ids('ash', near), ['greta', 'edith', 'maud', 'thomas', 'ashley']);
});

test('a search still finds people by title, and keeps names above such matches', () => {
  const f = family();
  assert.deepEqual(searchPeople(f, 'mayor').map((r) => r.id), ['thomas']);
  assert.deepEqual(searchPeople(f, '   '), []);
});

