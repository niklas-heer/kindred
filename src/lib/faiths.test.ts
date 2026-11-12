import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FAITH_TRADITIONS, faithSuggestions } from './faiths.ts';
import { foldText } from './address.ts';
import { defaultVisibility, storedValue } from './fields/model.ts';
import { tableOf, translate, type Key } from './i18n/dictionary.ts';

const L = ['en', 'de', 'af'] as const;
const ROWS = FAITH_TRADITIONS.flatMap((t) => t.faiths);
const nameOf = (id: string, l: (typeof L)[number]) => translate(l, `faith.name.${id}` as Key);

test('every tradition has a source and names in the three complete languages', () => {
  for (const t of FAITH_TRADITIONS) {
    for (const l of L) assert.ok(tableOf(l)[`faith.tradition.${t.id}`] ?? tableOf('en')[`faith.tradition.${t.id}`], `${t.id} ${l}`);
    for (const l of L.filter((x) => x !== 'en')) assert.ok(tableOf(l)[`faith.tradition.${t.id}`], `${t.id} ${l}`);
    assert.ok(t.source.trim(), `${t.id} source`);
    assert.ok(t.faiths.length > 0, t.id);
  }
});

test('every entry is named in all three languages, within what the field may hold', () => {
  for (const [id] of ROWS) {
    for (const name of L.map((l) => nameOf(id, l))) {
      assert.ok(name.trim(), id);
      assert.ok(name.length <= 120, id);
      assert.equal(name, name.trim(), id);
    }
  }
});

test('no duplicates: an id once, and a name once within each language', () => {
  const ids = ROWS.map((r) => r[0]);
  assert.deepEqual(ids.filter((x, i) => ids.indexOf(x) !== i), []);
  const trad = FAITH_TRADITIONS.map((t) => t.id);
  assert.deepEqual(trad.filter((x, i) => trad.indexOf(x) !== i), []);
  for (const l of L) {
    const names = ROWS.map((r) => foldText(nameOf(r[0], l)));
    assert.deepEqual(names.filter((x, j) => names.indexOf(x) !== j), [], l);
  }
});

test('the traditions the owner named are all there', () => {
  const have = new Set(ROWS.map((r) => r[0]));
  for (const id of ['evangelisch', 'free-church', 'lutheran', 'reformed', 'anglican', 'methodist', 'baptist', 'pentecostal', 'sda', 'mennonite', 'amish', 'quaker', 'catholic', 'greek-catholic', 'eastern-orthodox', 'coptic', 'lds', 'jw', 'new-apostolic', 'aic', 'zcc', 'shembe', 'ng', 'orthodox-jewish', 'reform', 'sunni', 'shia', 'ibadi', 'ahmadi', 'sufi', 'vaishnava', 'theravada', 'zen'.replace('zen', 'chan-zen'), 'sikh', 'jain', 'bahai', 'zoroastrian', 'yazidi', 'druze', 'mandaean', 'shinto', 'taoist', 'confucian', 'caodai', 'tenrikyo', 'yoruba', 'zulu', 'xhosa', 'khoisan', 'native-american', 'rastafari', 'vodou', 'santeria', 'candomble', 'wicca', 'pagan', 'agnostic', 'atheist', 'humanist', 'spiritual', 'no-religion', 'prefer-not', 'unknown']) {
    assert.ok(have.has(id), id);
  }
});

test('the list ranks no faith: traditions come alphabetically in the reader\'s language', () => {
  for (const l of L) {
    const groups = [...new Set(faithSuggestions('', l).map((s) => s.group))] as string[];
    assert.deepEqual(groups, [...groups].sort(new Intl.Collator(l).compare), l);
    assert.equal(groups.length, FAITH_TRADITIONS.length, l);
  }
});

test('the family\'s own come first, as the reader says them, once', () => {
  const list = faithSuggestions('', 'de', [{ value: 'Lutheran', n: 2 }, { value: 'Familienglaube', n: 5 }]);
  assert.equal(list[0].label, 'Evangelisch-lutherisch');
  assert.equal(list[1].label, 'Familienglaube');
  assert.equal(list.filter((s) => s.label === 'Evangelisch-lutherisch').length, 1);
});

test('searches every language and spelling; what is typed never reorders', () => {
  const hit = faithSuggestions('evangelical', 'de').find((s) => s.value === 'Evangelisch (Landeskirche, EKD)');
  assert.equal(hit?.hint?.toLowerCase().startsWith('evangelical'), true);
  assert.ok(faithSuggestions('Mormon', 'en').some((s) => s.value.startsWith('The Church of Jesus Christ')));
  assert.ok(faithSuggestions('Buddh', 'en').length >= 9, 'the tradition\'s name finds its branches');
  const groups = [...new Set(faithSuggestions('orth', 'en').map((s) => s.group))] as string[];
  assert.deepEqual(groups, [...groups].sort(new Intl.Collator('en').compare));
  assert.deepEqual(faithSuggestions('Klingon', 'en'), []);
});

test('leaving a faith is stored with an optional partial date, and faith starts restricted', () => {
  assert.deepEqual(storedValue('religion', { name: 'Katholisch', left: '1', leftOn: '1998-05' }), { name: 'Katholisch', left: '1', leftOn: '1998-05' });
  assert.equal(storedValue('religion', { name: 'Katholisch' }).left, '');
  assert.throws(() => storedValue('religion', { name: 'Katholisch', left: '1', leftOn: 'soon' }));
  assert.equal(defaultVisibility('religion'), 'editors');
});
