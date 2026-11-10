// node --test src/components/tree/birthday-notices.test.ts — the tree page's birthday notice is built from the page as it is
// when shown, and its "Open" selects through the page's select of the moment it is pressed, not the first render's.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFamily, type Kinship } from '../../lib/graph.ts';
import { translate, type Key, type Locale, type Vars } from '../../lib/i18n/dictionary.ts';
import type { GPerson, Graph } from '../../lib/types.ts';
import { birthdayNotices, type NoticePage } from './birthday-notices.ts';

const ada: GPerson = { id: 'ada', given: 'Ada', living: true, born: '1990-11-10', stories: 0, contacts: 0 };
const family = (given: string) => buildFamily({ tree: { id: 't', name: 'T', tagline: '', theme: 'codex', focus: 'ada', people: 1 }, houses: [], places: [], people: [{ ...ada, given }], parents: [], unions: [] } as Graph);
const t = (locale: Locale) => Object.assign((key: Key, vars?: Vars) => translate(locale, key, vars), { locale });

test('the notice reads the page when shown, and "Open" selects through the page of the moment it is pressed', () => {
  const picked: string[] = [];
  let page: NoticePage = { f: family('Ada'), kinFor: () => undefined, select: (id) => picked.push(`first:${id}`), t: t('en') };
  // The page renders again before the notice is shown: a new family, kinship and language.
  const sister: Kinship = { label: 'sister', via: [] };
  page = { f: family('Adelheid'), kinFor: () => sister, select: (id) => picked.push(`second:${id}`), t: t('de') };
  const [notice] = birthdayNotices([{ person: ada, age: 36 }], () => page);
  assert.match(notice.title, /Adelheid/);
  assert.match(notice.body!, /Schwester/);
  // And once more before "Open" is pressed.
  page = { ...page, select: (id) => picked.push(`third:${id}`) };
  notice.action!.run();
  assert.deepEqual(picked, ['third:ada']);
});

test('at most two notices, each naming its person', () => {
  const page: NoticePage = { f: family('Ada'), kinFor: () => undefined, select: () => {}, t: t('en') };
  const who = [1, 2, 3].map((n) => ({ person: { ...ada, id: `p${n}`, given: `P${n}` }, age: n }));
  assert.deepEqual(birthdayNotices(who, () => page).map((n) => n.person), ['p1', 'p2']);
});
