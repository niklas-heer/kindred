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
import { kinshipLabel, yourKinship, yourKinshipParts } from './i18n/kinship.ts';
import type { Kinship } from './graph.ts';
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
  assert.equal(de("great-uncle's wife"), 'angeheiratete Großtante');
  assert.equal(de("wife's first cousin"), 'Cousin oder Cousine deiner Ehefrau');
  assert.equal(af('stepmother'), 'stiefma');
  assert.equal(af('stepbrother'), 'stiefbroer');
  assert.equal(af('foster sister'), 'pleegsuster');
  assert.equal(af('adoptive mother'), 'aanneemma');
  assert.equal(af("great-uncle's wife"), 'grootoom se vrou');
  assert.equal(af("wife's first cousin"), 'vrou se neef/niggie');
});

// A second invented family for cousins: Gustav's sons Georg and Gerd. Georg + Gisela have Paul and Petra;
// Paul's son is Max (the reader), Petra's daughter Clara, whose son is Carl. Gerd's daughter Hanna has Hugo.
const g = buildFamily({
  tree: {} as never, houses: [], places: [],
  people: [
    ...['gustav', 'georg', 'gerd', 'paul', 'max', 'carl', 'hugo'].map((id) => person(id, 'm')),
    ...['gisela', 'petra', 'clara', 'hanna'].map((id) => person(id, 'f')),
  ],
  parents: [
    link('georg', 'gustav'), link('gerd', 'gustav'), link('paul', 'georg'), link('paul', 'gisela'),
    link('petra', 'georg'), link('petra', 'gisela'), link('max', 'paul'), link('clara', 'petra'), link('carl', 'clara'),
    link('hanna', 'gerd'), link('hugo', 'hanna'),
  ],
  unions: [union('georg', 'gisela')],
} as never);
const kin = (fam: typeof f, me: string, other: string) => kinship(fam, me, other)!;
const de = (k: Kinship) => kinshipLabel(k, 'de');

test('German cousins keep their sex, and a cousin a generation away is an uncle or a nephew of the next degree', () => {
  assert.equal(de(kin(g, 'max', 'clara')), 'Cousine');
  assert.equal(de(kin(g, 'clara', 'max')), 'Cousin');
  assert.equal(de(kin(g, 'max', 'carl')), 'Neffe 2. Grades');
  assert.equal(de(kin(g, 'carl', 'max')), 'Onkel 2. Grades');
  assert.equal(de(kin(g, 'max', 'hanna')), 'Tante 2. Grades');
  assert.equal(de(kin(g, 'max', 'hugo')), 'Cousin 2. Grades');
  assert.equal(de(kin(g, 'carl', 'paul')), 'Großonkel');
  assert.equal(de(kin(g, 'carl', 'hanna')), 'Großtante 2. Grades');
  assert.equal(de({ label: 'second cousin once removed', via: [] }), 'Cousin oder Cousine 2. Grades, eine Generation versetzt');
  assert.equal(de({ label: 'half-cousin', via: [], cousin: { sex: 'f', up: 0 } }), 'Halbcousine');
  assert.equal(kinshipLabel(kin(g, 'max', 'clara'), 'af'), 'niggie');
  assert.equal(kinshipLabel(kin(g, 'max', 'hugo'), 'af'), 'tweede neef');
});

test('German names ties through a marriage the way people say them', () => {
  assert.equal(de(kin(f, 'otto', 'ulla')), 'angeheiratete Tante');
  assert.equal(de(kin(f, 'otto', 'erna')), 'angeheiratete Großtante');
  assert.equal(de(kin(f, 'otto', 'cora')), 'Cousine deiner Ehefrau');
  assert.equal(de(kin(f, 'otto', 'wim')), 'Großvater deiner Ehefrau');
  assert.equal(de(kin(f, 'otto', 'vera')), 'Tante deiner Ehefrau');
  assert.equal(kinshipLabel(kin(f, 'otto', 'cora'), 'de', 'them'), 'Cousine der Ehefrau');
  assert.equal(kinshipLabel(kin(f, 'otto', 'wim'), 'af'), 'vrou se oupa');
  const label = (l: string) => de({ label: l, via: [] });
  assert.equal(label("first cousin's wife"), 'Ehefrau deines Cousins oder deiner Cousine');
  assert.equal(de({ label: "first cousin's wife", via: [], cousin: { sex: 'm', up: 0 } }), 'Ehefrau deines Cousins');
  assert.equal(label("nephew's husband"), 'Ehemann deines Neffen');
  assert.equal(label("grandmother's husband"), 'Stiefgroßvater');
  assert.equal(label("great-grandfather's wife"), 'Stiefurgroßmutter');
  assert.equal(label("aunt's partner"), 'angeheirateter Onkel oder angeheiratete Tante');
  assert.equal(label('brother-in-law'), 'Schwager');
  assert.equal(label('sibling-in-law'), 'Schwager oder Schwägerin');
  assert.equal(label('stepsister'), 'Stiefschwester');
  assert.equal(label('foster child'), 'Pflegekind');
});

test('German words for greats, halves and an open sex', () => {
  const label = (l: string) => de({ label: l, via: [] });
  assert.equal(label('great-grandmother'), 'Urgroßmutter');
  assert.equal(label('2× great-grandfather'), 'Ururgroßvater');
  assert.equal(label('great-uncle'), 'Großonkel');
  assert.equal(label('2× great-aunt'), 'Urgroßtante');
  assert.equal(label('great-pibling'), 'Großonkel oder Großtante');
  assert.equal(label('great-half-aunt'), 'Halbgroßtante');
  assert.equal(label('great-grandson'), 'Urenkel');
  assert.equal(label('great-nephew'), 'Großneffe');
  assert.equal(label('half-brother'), 'Halbbruder');
  assert.equal(label('half-sibling'), 'Halbbruder oder Halbschwester');
  assert.equal(label('sibling'), 'Bruder oder Schwester');
  assert.equal(label('partner'), 'Partner oder Partnerin');
});

test('Afrikaans keeps every generation of greats apart', () => {
  const af = (l: string) => kinshipLabel({ label: l, via: [] }, 'af');
  assert.equal(af('great-grandfather'), 'oupagrootjie');
  assert.equal(af('great-grandmother'), 'oumagrootjie');
  assert.equal(af('2× great-grandfather'), 'oor-oupagrootjie');
  assert.equal(af('3× great-grandmother'), 'oor-oor-oumagrootjie');
  assert.equal(af('great-aunt'), 'groottante');
  assert.equal(af('2× great-uncle'), 'oor-grootoom');
  assert.equal(af('great-niece'), 'kleinniggie');
  assert.equal(af('great-grandson'), 'agterkleinseun');
  assert.equal(af('2× great-granddaughter'), 'agter-agterkleindogter');
  assert.equal(af('great-grandchild'), 'agterkleinkind');
});

test('"your" agrees with each kinship word', () => {
  const k = (label: string, extra: Partial<Kinship> = {}): Kinship => ({ label, via: [], ...extra });
  assert.equal(yourKinship(k('father'), 'de'), 'dein Vater');
  assert.equal(yourKinship(k('grandmother'), 'de'), 'deine Großmutter');
  assert.equal(yourKinship(k('grandchild'), 'de'), 'dein Enkelkind');
  assert.equal(yourKinship(k('great-uncle'), 'de'), 'dein Großonkel');
  assert.equal(yourKinship(k('cousin', { cousin: { sex: 'f', up: 0 } }), 'de'), 'deine Cousine');
  assert.equal(yourKinship(k('second cousin', { cousin: { sex: 'm', up: 0 } }), 'de'), 'dein Cousin 2. Grades');
  assert.equal(yourKinship(k('pibling'), 'de'), 'dein Onkel oder deine Tante');
  assert.equal(yourKinship(k("uncle's wife"), 'de'), 'deine angeheiratete Tante');
  assert.equal(yourKinship(k("aunt's husband"), 'de'), 'dein angeheirateter Onkel');
  assert.equal(yourKinship(k("nephew's wife"), 'de'), 'die Ehefrau deines Neffen');
  assert.equal(yourKinship(k("wife's great-aunt"), 'de', { capital: true }), 'Die Großtante deiner Ehefrau');
  assert.equal(yourKinship(k('grandmother'), 'de', { capital: true }), 'Deine Großmutter');
  assert.equal(yourKinship([k('grandmother'), k('grandfather')], 'de'), 'deine Großmutter & dein Großvater');
  assert.equal(yourKinship([k('grandmother'), k('grandfather')], 'en'), 'your grandmother & grandfather');
  assert.equal(yourKinship(k('great-grandfather'), 'af', { capital: true }), 'Jou oupagrootjie');
  assert.equal(yourKinship(k('father'), 'en', { capital: true }), 'Your father');
  assert.deepEqual(yourKinshipParts(k('pibling'), 'de'), [
    { text: 'Dein ' }, { text: 'Onkel', kin: true }, { text: ' oder deine ' }, { text: 'Tante', kin: true },
  ]);
  assert.deepEqual(yourKinshipParts(k("first cousin's husband", { cousin: { sex: 'f', up: 0 } }), 'de'), [
    { text: 'Der ' }, { text: 'Ehemann', kin: true }, { text: ' deiner Cousine', kin: true },
  ]);
  assert.deepEqual(yourKinshipParts(k('aunt'), 'en'), [{ text: 'Your ' }, { text: 'aunt', kin: true }]);
});
