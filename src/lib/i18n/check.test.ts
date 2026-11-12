// node --test src/lib/i18n/check.test.ts — each translation check finds what it is for, on a few invented entries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLocale, type CheckName } from './check.ts';
import type { Key } from './dictionary.ts';

const found = (locale: Parameters<typeof checkLocale>[0], table: Record<string, unknown>, opts: { buttons?: string[]; glossary?: object } = {}) =>
  checkLocale(locale, new Set(opts.buttons ?? []), { table: table as never, keys: Object.keys(table) as Key[], glossary: opts.glossary ?? {} })
    .map((f) => `${f.check}:${f.key ?? ''}`);
const has = (list: string[], check: CheckName, key: string) => assert.ok(list.includes(`${check}:${key}`), `${check} for ${key} in ${list.join(', ')}`);

test('Polish needs one, few and many in a plural; Japanese may give one sentence', () => {
  // English: { one: "{count} person", other: "{count} people" }
  const pl = found('pl', { 'common.people': { one: '{count} osoba', other: '{count} osób' } });
  has(pl, 'plurals', 'common.people');
  assert.deepEqual(found('pl', { 'common.people': { one: '{count} osoba', few: '{count} osoby', many: '{count} osób', other: '{count} osoby' } }), []);
  assert.deepEqual(found('ja', { 'common.people': '{count}人' }), []);
  has(found('ja', { 'common.people': { one: '{count}人', other: '{count}人' } }), 'plurals', 'common.people');
});

test('placeholders, English left in place, the formal address and keys English lacks are errors', () => {
  has(found('fr', { 'account.signedIn': 'Connecté en tant que {mail}' }), 'placeholders', 'account.signedIn');
  has(found('es', { 'ui.close': 'Close' }), 'english', 'ui.close');
  has(found('fr', { 'account.signedIn': 'Vous êtes connecté en tant que {email}' }), 'address', 'account.signedIn');
  has(found('zh-Hans', { 'account.signedIn': '您已登录：{email}' }), 'address', 'account.signedIn');
  has(found('nl', { 'no.such.key': 'x' }), 'extra', 'no.such.key');
});

test('a long button, an English word left behind and a glossary term rendered another way are warnings', () => {
  has(found('de', { 'ui.close': 'Dieses Fenster jetzt schließen' }, { buttons: ['ui.close'] }), 'length', 'ui.close');
  // "Add the first person from the family tree.": "the" stayed behind.
  has(found('nl', { 'people.addFirst': 'Voeg the eerste persoon uit de stamboom toe.' }), 'leftover', 'people.addFirst');
  const glossary = { terms: { steward: { use: 'beheerder', accept: ['beheerder'] } } };
  has(found('nl', { 'role.steward': 'Rentmeester' }, { glossary }), 'glossary', 'role.steward');
  assert.deepEqual(found('nl', { 'role.steward': 'Beheerder' }, { glossary }), []);
});
