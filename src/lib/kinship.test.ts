// node --test src/lib/kinship.test.ts — how two people are related respects the kind of each parent link, and ties
// through a marriage reach as far as blood does. An invented family:
//
//   Adam ── his sons Albert (married Berta) and Emil (married Erna).
//   Albert + Berta ── Karl and Uwe (Uwe married Ulla).
//   Karl + Greta ── Otto, and Ben, whom they adopted. Karl later married Nora, whose son Finn is by Fritz.
//   Jonas ── Lea, whose stepmother Greta is recorded as a step link; Pia is Greta's foster daughter.
//   Otto married Wilma, daughter of Walter; Walter's father Wim also had Vera, mother of Cora.
//   Xena has no tie to anyone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BY_MARRIAGE, buildFamily, kinPath, kinship } from './graph.ts';
import { kinshipLabel, yourKinship, yourKinshipParts } from './i18n/kinship.ts';
import type { Kinship } from './graph.ts';
import type { GParent, GPerson, GUnion } from './types.ts';

const M = ['adam', 'albert', 'emil', 'karl', 'uwe', 'otto', 'ben', 'finn', 'fritz', 'jonas', 'walter', 'wim'];
const F = ['berta', 'erna', 'ulla', 'greta', 'nora', 'lea', 'pia', 'wilma', 'vera', 'cora', 'xena'];
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

test('someone with no tie at all is still unrelated; a far tie is a relative by marriage, never a closer word', () => {
  assert.equal(label('otto', 'xena'), undefined);
  assert.deepEqual(kinPath(f, 'otto', 'xena'), []);
  // Fritz is the father of Otto's stepbrother Finn: tied, but no word reaches that far.
  assert.equal(label('otto', 'fritz'), BY_MARRIAGE);
  assert.equal(label('fritz', 'otto'), BY_MARRIAGE);
  assert.deepEqual(kinPath(f, 'otto', 'fritz'), ['otto', 'karl', 'nora', 'finn', 'fritz']);
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
  assert.equal(label("grandmother's husband"), 'Ehemann deiner Großmutter');
  assert.equal(label("great-grandfather's wife"), 'Ehefrau deines Urgroßvaters');
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

// A third invented family, for ties through marriages at both ends and through a parent's partner:
//
//   Opa + Oma ── Pa. Opa later married Gerti. Pa + Ma ── Mia and Tom. Ma later married Rolf, son of Hedi; Rolf's brother
//   is Udo, and Rolf's son Kai is by Eva. Mia married Nils, whose sister Ruth married Sven; Sven's brother Lars married
//   Wanda. Tom married Ines, whose sister is Jana. Nils, Sven and Ines each have a father on record (nils-father…).
const h = buildFamily({
  tree: {} as never, houses: [], places: [],
  people: [
    ...['opa', 'pa', 'tom', 'rolf', 'udo', 'kai', 'nils', 'sven', 'lars', 'nils-father', 'sven-father', 'ines-father'].map((id) => person(id, 'm')),
    ...['oma', 'gerti', 'ma', 'mia', 'hedi', 'eva', 'ruth', 'wanda', 'ines', 'jana'].map((id) => person(id, 'f')),
  ],
  parents: [
    link('pa', 'opa'), link('pa', 'oma'), link('mia', 'pa'), link('mia', 'ma'), link('tom', 'pa'), link('tom', 'ma'),
    link('rolf', 'hedi'), link('udo', 'hedi'), link('kai', 'rolf'), link('kai', 'eva'),
    link('nils', 'nils-father'), link('ruth', 'nils-father'), link('sven', 'sven-father'), link('lars', 'sven-father'),
    link('ines', 'ines-father'), link('jana', 'ines-father'),
  ],
  unions: [union('opa', 'oma'), union('opa', 'gerti'), union('pa', 'ma'), union('ma', 'rolf'), union('mia', 'nils'), union('ruth', 'sven'), union('lars', 'wanda'), union('tom', 'ines')],
} as never);
const hl = (me: string, other: string) => kinship(h, me, other)?.label;
const hde = (me: string, other: string) => kinshipLabel(kinship(h, me, other), 'de');
const haf = (me: string, other: string) => kinshipLabel(kinship(h, me, other), 'af');

test('a spouse’s sibling’s spouse and a sibling’s spouse’s sibling: Schwippschwager and Schwippschwägerin', () => {
  assert.equal(hl('mia', 'sven'), "husband's sister's husband");
  assert.equal(hl('sven', 'mia'), "wife's brother's wife");
  assert.deepEqual(kinPath(h, 'mia', 'sven'), ['mia', 'nils', 'nils-father', 'ruth', 'sven']);
  assert.equal(hde('mia', 'sven'), 'Schwippschwager');
  assert.equal(hde('sven', 'mia'), 'Schwippschwägerin');
  assert.equal(yourKinship(kinship(h, 'mia', 'sven')!, 'de'), 'dein Schwippschwager');
  assert.equal(haf('mia', 'sven'), 'man se suster se man');
  assert.equal(hl('mia', 'jana'), "brother's wife's sister");
  assert.equal(hl('jana', 'mia'), "sister's husband's sister");
  assert.equal(hde('mia', 'jana'), 'Schwippschwägerin');
  assert.equal(haf('mia', 'jana'), 'broer se vrou se suster');
  assert.equal(kinshipLabel({ label: "wife's sibling's partner", via: [] }, 'de'), 'Schwippschwager oder Schwippschwägerin');
});

test('a step-parent’s relatives and a grandparent’s second spouse are step relations', () => {
  assert.equal(hl('mia', 'rolf'), 'stepfather');
  assert.equal(hl('mia', 'hedi'), 'step-grandmother');
  assert.equal(hl('hedi', 'mia'), 'step-granddaughter');
  assert.deepEqual(kinPath(h, 'mia', 'hedi'), ['mia', 'ma', 'rolf', 'hedi']);
  assert.equal(hl('mia', 'gerti'), 'step-grandmother');
  assert.equal(hl('gerti', 'mia'), 'step-granddaughter');
  assert.equal(hl('mia', 'udo'), "stepfather's brother");
  assert.equal(hl('udo', 'mia'), "brother's stepdaughter");
  assert.equal(hl('mia', 'kai'), 'stepbrother');
  assert.equal(hde('mia', 'hedi'), 'Stiefgroßmutter');
  assert.equal(hde('hedi', 'mia'), 'Stiefenkelin');
  assert.equal(hde('mia', 'udo'), 'Bruder deines Stiefvaters');
  assert.equal(yourKinship(kinship(h, 'mia', 'udo')!, 'de'), 'der Bruder deines Stiefvaters');
  assert.equal(hde('udo', 'mia'), 'Stieftochter deines Bruders');
  assert.equal(haf('mia', 'hedi'), 'stiefouma');
  assert.equal(haf('mia', 'udo'), 'stiefpa se broer');
  assert.equal(kinshipLabel({ label: 'step-great-grandson', via: [] }, 'de'), 'Stiefurenkel');
});

test('beyond those words, a relative by marriage, with German agreeing with the person', () => {
  assert.equal(hl('mia', 'lars'), BY_MARRIAGE);
  assert.equal(hl('mia', 'wanda'), BY_MARRIAGE);
  assert.equal(hl('mia', 'eva'), BY_MARRIAGE, 'the mother of a stepbrother');
  assert.equal(hde('mia', 'lars'), 'angeheirateter Verwandter');
  assert.equal(hde('mia', 'wanda'), 'angeheiratete Verwandte');
  assert.equal(yourKinship(kinship(h, 'mia', 'wanda')!, 'de'), 'deine angeheiratete Verwandte');
  assert.equal(yourKinship(kinship(h, 'mia', 'lars')!, 'en'), 'your relative by marriage');
  assert.equal(haf('mia', 'lars'), 'aangetroude familielid');
  assert.equal(kinshipLabel({ label: BY_MARRIAGE, via: [] }, 'de'), 'angeheirateter Verwandter oder angeheiratete Verwandte');
  assert.deepEqual(kinPath(h, 'mia', 'wanda'), ['mia', 'nils', 'nils-father', 'ruth', 'sven', 'sven-father', 'lars', 'wanda']);
});

// Partnerships that ended before the line's child was born. Opa married Erste first (divorced 1950), then Oma; their son
// Vati was born in 1955. Vati married Ex first (divorced 1975), then Mutti; their daughter Ich was born in 1980. Ex's
// brother is Exbruder, and Ex's son Exsohn was born to her and Neu in 1978. Opa's third wife Dritte has no dates.
const D = ['opa', 'vati', 'exbruder', 'exsohn', 'neu', 'exvater'];
const W = ['erste', 'oma', 'ex', 'mutti', 'ich', 'dritte', 'erste-mutter'];
const dated = (id: string, sex: 'm' | 'f', born?: string): GPerson => ({ ...person(id, sex), ...(born && { born }) });
const birth: Record<string, string> = { vati: '1955-04-02', ich: '1980-06-01', exsohn: '1978', ex: '1952' };
const d = buildFamily({
  tree: {} as never, houses: [], places: [],
  people: [...D.map((id) => dated(id, 'm', birth[id])), ...W.map((id) => dated(id, 'f', birth[id]))],
  parents: [
    link('vati', 'opa'), link('vati', 'oma'), link('ich', 'vati'), link('ich', 'mutti'),
    link('ex', 'exvater'), link('exbruder', 'exvater'), link('exsohn', 'ex'), link('exsohn', 'neu'), link('erste', 'erste-mutter'),
  ],
  unions: [
    { ...union('opa', 'erste'), end: '1950' }, union('opa', 'oma'), union('opa', 'dritte'),
    { ...union('vati', 'ex'), start: '1972', end: '1975-09' }, union('vati', 'mutti'), union('ex', 'neu'),
  ],
} as never);
const dl = (me: string, other: string) => kinship(d, me, other)?.label;
const dde = (me: string, other: string) => kinshipLabel(kinship(d, me, other), 'de');

test('a grandparent’s or parent’s partner from before the line’s child was born is no step relation', () => {
  assert.equal(dl('vati', 'erste'), "father's wife", 'divorced before Vati was born');
  assert.equal(dl('erste', 'vati'), "husband's son");
  assert.equal(dl('ich', 'erste'), "grandfather's wife");
  assert.equal(dl('erste', 'ich'), "husband's granddaughter");
  assert.equal(dl('ich', 'ex'), "father's wife", 'divorced before Ich was born');
  assert.equal(dl('ex', 'ich'), "husband's daughter");
  assert.equal(dl('ich', 'exbruder'), "father's wife's brother");
  assert.equal(dl('exbruder', 'ich'), "sister's husband's daughter");
  assert.equal(dl('ich', 'exsohn'), "father's wife's son");
  assert.equal(dl('vati', 'erste-mutter'), "father's wife's mother");
  assert.equal(dl('erste-mutter', 'vati'), "daughter's husband's son");
  // Where the dates say nothing, the step words stay.
  assert.equal(dl('ich', 'dritte'), 'step-grandmother');
  assert.equal(dl('vati', 'dritte'), 'stepmother');
  assert.equal(dl('ich', 'mutti'), 'mother');
  assert.equal(dde('ich', 'erste'), 'Ehefrau deines Großvaters');
  assert.equal(dde('erste', 'ich'), 'Enkelin deines Ehemanns');
  assert.equal(dde('ich', 'ex'), 'Ehefrau deines Vaters');
  assert.equal(dde('ex', 'ich'), 'Tochter deines Ehemanns');
  assert.equal(dde('ich', 'exbruder'), 'Bruder der Ehefrau deines Vaters');
  assert.equal(dde('exbruder', 'ich'), 'Tochter des Ehemanns deiner Schwester');
  assert.equal(dde('ich', 'dritte'), 'Stiefgroßmutter');
  assert.equal(kinshipLabel(kinship(d, 'ich', 'erste'), 'af'), 'oupa se vrou');
});

// ---------- properties over every pair ----------

/** A label in sex-free parts, one per person along the way: "wife's first cousin" → ["SPOUSE", "first cousin"]. */
const SEXLESS: [RegExp, string][] = [
  [/(father|mother|parent)/, 'PARENT'], [/(son|daughter|child)/, 'CHILD'], [/(brother|sister|sibling)/, 'SIB'],
  [/(uncle|aunt|pibling)/, 'PIB'], [/(nephew|niece|nibling)/, 'NIB'], [/(husband|wife|partner)/, 'SPOUSE'],
];
const sexless = (part: string) => SEXLESS.reduce((x, [re, to]) => x.replace(re, to), part);
const invert = (part: string) =>
  part.replace(/PARENT|CHILD|PIB|NIB|adoptive|adopted/g, (w) => ({ PARENT: 'CHILD', CHILD: 'PARENT', PIB: 'NIB', NIB: 'PIB', adoptive: 'adopted', adopted: 'adoptive' })[w]!);
/** Every reading of a label as a chain of parts: an "-in-law" is a spouse's relative or a relative's spouse. */
function chains(label: string): string[][] {
  const parts = label.split("'s ").map(sexless);
  const out: string[][] = [[]];
  for (const part of parts) {
    const inLaw = part.match(/^(.+)-in-law$/);
    const options = inLaw ? [['SPOUSE', inLaw[1]], [inLaw[1], 'SPOUSE']] : [[part]];
    out.splice(0, out.length, ...out.flatMap((c) => options.map((o) => [...c, ...o])));
  }
  return out;
}
const inverseOf = (label: string) => chains(label).map((c) => [...c].reverse().map(invert).join(' / '));

for (const [name, fam] of [['first', f], ['cousins', g], ['marriages', h], ['dated', d]] as const) {
  test(`every relation in the ${name} family is named both ways, as each other's inverse, and has a word in German and Afrikaans`, () => {
    const ids = fam.graph.people.map((p) => p.id);
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        const ab = kinship(fam, a, b), ba = kinship(fam, b, a);
        assert.equal(!!ab, !!ba, `${a}→${b} ${ab?.label} but ${b}→${a} ${ba?.label}`);
        if (!ab || !ba) continue;
        const back = new Set(chains(ba.label).map((c) => c.join(' / ')));
        assert.ok(inverseOf(ab.label).some((c) => back.has(c)), `${a}→${b} “${ab.label}” is not the inverse of ${b}→${a} “${ba.label}”`);
        for (const locale of ['de', 'af'] as const) {
          const text = kinshipLabel(ab, locale);
          assert.doesNotMatch(text, /'s |step|great|in-law|husband|wife|cousin|relative|half-|parent|sibling|grand|son\b/, `${locale} for “${ab.label}”: ${text}`);
        }
        const path = kinPath(fam, a, b);
        if (path.length) assert.deepEqual([path[0], path.at(-1)], [a, b], `${a}→${b} path`);
      }
    }
  });
}
