// node --test src/lib/kinship.test.ts — how two people are related respects the kind of each parent link, and ties
// through a marriage reach as far as blood does. An invented family:
//
//   Adam ── his sons Albert (married Berta) and Emil (married Erna).
//   Albert + Berta ── Karl and Uwe (Uwe married Ulla).
//   Karl + Greta ── Otto, and Ben, whom they adopted. Karl later married Nora, whose son Finn is by Fritz.
//   Jonas ── Lea, whose stepmother Greta is recorded as a step link; Pia is Greta's foster daughter.
//   Otto married Wilma, daughter of Walter; Walter's father Wim also had Vera, mother of Cora.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFamily, kinPath, kinship } from './graph.ts';
import { kinshipLabel } from './i18n/kinship.ts';
import type { GParent, GPerson, GUnion } from './types.ts';

const M = ['adam', 'albert', 'emil', 'karl', 'uwe', 'otto', 'ben', 'finn', 'fritz', 'jonas', 'walter', 'wim'];
const F = ['berta', 'erna', 'ulla', 'greta', 'nora', 'lea', 'pia', 'wilma', 'vera', 'cora'];
const person = (id: string, sex: 'm' | 'f'): GPerson => ({ id, given: id, sex, living: true, stories: 0, contacts: 0 });
const link = (child: string, parent: string, kind: GParent['kind'] = 'biological'): GParent => ({ child, parent, kind, confidence: 'certain' });
const union = (a: string, b: string): GUnion => ({ id: `${a}-${b}`, a, b, kind: 'marriage' });

const f = buildFamily({
  tree: {} as never, houses: [], places: [],
  people: [...M.map((id) => person(id, 'm')), ...F.map((id) => person(id, 'f'))],
  parents: [
    link('albert', 'adam'), link('emil', 'adam'),
    link('karl', 'albert'), link('karl', 'berta'), link('uwe', 'albert'), link('uwe', 'berta'),
    link('otto', 'karl'), link('otto', 'greta'), link('ben', 'karl', 'adoptive'), link('ben', 'greta', 'adoptive'),
    link('finn', 'nora'), link('finn', 'fritz'),
    link('lea', 'jonas'), link('lea', 'greta', 'step'), link('pia', 'greta', 'foster'),
    link('wilma', 'walter'), link('walter', 'wim'), link('vera', 'wim'), link('cora', 'vera'),
  ],
  unions: [union('albert', 'berta'), union('emil', 'erna'), union('uwe', 'ulla'), union('karl', 'greta'), union('karl', 'nora'), union('otto', 'wilma')],
} as never);
const label = (me: string, other: string) => kinship(f, me, other)?.label;

test('a step link makes a step relation, never a blood one', () => {
  assert.equal(label('lea', 'greta'), 'stepmother');
  assert.equal(label('greta', 'lea'), 'stepdaughter');
  assert.equal(label('otto', 'lea'), 'stepsister');
  assert.equal(label('lea', 'otto'), 'stepbrother');
});

test('a parent’s spouse who is not your parent is a step-parent, and their children step-siblings', () => {
  assert.equal(label('otto', 'nora'), 'stepmother');
  assert.equal(label('nora', 'otto'), 'stepson');
  assert.equal(label('otto', 'finn'), 'stepbrother');
  assert.deepEqual(kinPath(f, 'otto', 'nora'), ['otto', 'karl', 'nora']);
});

test('foster links read as foster relations', () => {
  assert.equal(label('pia', 'greta'), 'foster mother');
  assert.equal(label('greta', 'pia'), 'foster daughter');
  assert.equal(label('otto', 'pia'), 'foster sister');
});

test('an adoptive link is a full tie: an adoptive parent, and a brother', () => {
  assert.equal(label('ben', 'karl'), 'adoptive father');
  assert.equal(label('karl', 'ben'), 'adopted son');
  assert.equal(label('otto', 'ben'), 'brother');
  assert.equal(label('ben', 'albert'), 'grandfather');
});

test('the spouse of any blood relative is named, and the path runs through the marriage', () => {
  assert.equal(label('otto', 'ulla'), "uncle's wife");
  assert.equal(label('otto', 'erna'), "great-uncle's wife");
  assert.deepEqual(kinPath(f, 'otto', 'erna'), ['otto', 'karl', 'albert', 'adam', 'emil', 'erna']);
});

test('a blood relative of your spouse is named, and the path runs through the marriage', () => {
  assert.equal(label('otto', 'walter'), 'father-in-law');
  assert.equal(label('otto', 'cora'), "wife's first cousin");
  assert.deepEqual(kinPath(f, 'otto', 'cora'), ['otto', 'wilma', 'walter', 'wim', 'vera', 'cora']);
});

test('someone with no tie at all is still unrelated', () => {
  assert.equal(label('otto', 'fritz'), undefined);
  assert.deepEqual(kinPath(f, 'otto', 'fritz'), []);
});

test('the new relations have words in German and Afrikaans', () => {
  const de = (l: string) => kinshipLabel({ label: l, via: [] }, 'de');
  const af = (l: string) => kinshipLabel({ label: l, via: [] }, 'af');
  assert.equal(de('stepmother'), 'Stiefmutter');
  assert.equal(de('stepbrother'), 'Stiefbruder');
  assert.equal(de('foster daughter'), 'Pflegetochter');
  assert.equal(de('adoptive father'), 'Adoptivvater');
  assert.equal(de('adopted son'), 'Adoptivsohn');
  assert.equal(de("great-uncle's wife"), 'Ehefrau von Großonkel');
  assert.equal(de("wife's first cousin"), 'Cousin/Cousine von Ehefrau');
  assert.equal(af('stepmother'), 'stiefma');
  assert.equal(af('stepbrother'), 'stiefbroer');
  assert.equal(af('foster sister'), 'pleegsuster');
  assert.equal(af('adoptive mother'), 'aanneemma');
  assert.equal(af("great-uncle's wife"), 'grootoom se vrou');
  assert.equal(af("wife's first cousin"), 'vrou se neef/niggie');
});
