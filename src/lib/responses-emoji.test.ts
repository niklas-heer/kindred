// node --test src/lib/responses-emoji.test.ts — emoji reactions without a server: what counts as one emoji (and what does
// not), the order they are shown in, tree migration 0030 turning the five named reactions into emoji on a database that
// held them, and the palette's own data and search in English, German and Afrikaans.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
// The store refuses to run without a data folder of its own (the test command gives it one).
import { migrate, migrationFiles } from './store/node.ts';
import { emojiFrom, GROUPS, searchEmoji, type EmojiRows } from './emoji/index.ts';
import { LOCALES, type Locale } from './i18n/languages.ts';
import { EVENT_TARGET, LEGACY_REACTIONS, MAX_REACTIONS, QUICK_REACTIONS, reactionOf, reactionOrder } from './responses.ts';

test('a reaction is exactly one RGI emoji, stored one way', () => {
  for (const e of ['❤️', '😂', '🕯️', '🙏', '💭', '👍🏽', '👨‍👩‍👧', '🇩🇪', '🏴󠁧󠁢󠁷󠁬󠁳󠁿', '#️⃣', '🫶']) assert.equal(reactionOf(e), e, e);
  // Sent without the presentation selector, as some keyboards do: given it, so "❤" and "❤️" are one reaction.
  assert.equal(reactionOf('❤'), '❤️');
  assert.equal(reactionOf('🕯'), '🕯️');
  for (const bad of ['', 'heart', 'a', '1', '❤️❤️', '❤️ ', ' ❤️', '😂😂', '🇦', '<b>', '❤️a', 'ab', '‍', '️', null, undefined, 3, {}, '😀'.repeat(30)]) {
    assert.equal(reactionOf(bad), null, JSON.stringify(bad));
  }
  // Every emoji the app offers on its own is one the server takes.
  for (const e of [...QUICK_REACTIONS, ...Object.values(LEGACY_REACTIONS)]) assert.equal(reactionOf(e), e);
  assert.equal(MAX_REACTIONS, 12);
});

test('the quick row comes first in its order, then the others by how many gave them', () => {
  assert.deepEqual(reactionOrder({ '🎉': 1, '🕯️': 2, '❤️': 1, '🌻': 4, '😂': 0 }), ['❤️', '🕯️', '🌻', '🎉']);
});

test('an event key is one the feed makes, and nothing else', () => {
  for (const ok of ['updates:2026-11-03|0123456789abcdef', 'people:2026-11-03|-1z.2a', 'b:ada:2026', 'a:ada__ben:2026']) assert.ok(EVENT_TARGET.test(ok), ok);
  for (const bad of ['updates:2026-11-03', 'updates:x|y', 'post:abc', 'b:ada', 'b:a b:2026', 'b:ada:20266', 'updates:2026-11-03|ABC', '']) assert.ok(!EVENT_TARGET.test(bad), bad);
});

test('migration 0030 turns the named reactions into emoji, keeps every row, and takes events as targets', () => {
  // A family's database as it was before 0030: every earlier migration applied, then the rows, then 0030 itself.
  const d = new DatabaseSync(':memory:');
  d.exec("CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)");
  const later = migrationFiles('tree').filter((f) => f >= '0030');
  for (const f of later) d.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(f);
  migrate(d, 'tree');
  const add = d.prepare('INSERT INTO reaction (target_kind, target, account, kind, created_at) VALUES (?, ?, ?, ?, ?)');
  for (const [i, kind] of (['heart', 'remember', 'laugh', 'candle', 'thanks'] as const).entries()) add.run('story', 's1', 'u1', kind, `2026-01-0${i + 1}`);
  add.run('post', 'p1', 'u2', 'heart', '2026-01-09');
  d.prepare("INSERT INTO comment (id, target_kind, target, account, body, created_at) VALUES ('c1', 'post', 'p1', 'u1', 'Lovely', '2026-01-09')").run();
  const sql = readFileSync(join(process.cwd(), 'migrations', 'tree', '0030_emoji_reactions.sql'), 'utf8');
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ''), /\b(PRAGMA|COMMIT|ROLLBACK)\b|^\s*BEGIN\s*;/im, 'plain SQL that D1 runs too');
  d.exec(sql);
  const rows = d.prepare('SELECT target_kind, target, account, kind, created_at FROM reaction ORDER BY created_at').all();
  assert.deepEqual(rows.map((r) => r.kind), ['❤️', '💭', '😂', '🕯️', '🙏', '❤️']);
  assert.deepEqual(rows.map((r) => r.created_at), ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-09']);
  assert.deepEqual(Object.fromEntries(Object.entries(LEGACY_REACTIONS)), { heart: '❤️', laugh: '😂', candle: '🕯️', thanks: '🙏', remember: '💭' }, 'the browser and the migration agree');
  assert.equal((d.prepare('SELECT count(*) AS n FROM comment').get() as { n: number }).n, 1);
  // An event takes reactions and comments; a kind the app does not know is still refused.
  add.run('event', 'updates:2026-01-09|0123456789abcdef', 'u1', '🎉', '2026-01-10');
  d.prepare("INSERT INTO comment (id, target_kind, target, account, body, created_at) VALUES ('c2', 'event', 'b:ada:2026', 'u1', 'Happy birthday!', '2026-01-10')").run();
  assert.throws(() => add.run('house', 'x', 'u1', '❤️', '2026-01-10'), /CHECK/);
  // The triggers are back: a story takes its answers with it.
  d.exec("INSERT INTO person (id, given) VALUES ('ada', 'Ada'); INSERT INTO story (id, person, kind, body, author, at) VALUES ('s1', 'ada', 'memory', 'x', 'A', '2026')");
  d.prepare("DELETE FROM story WHERE id = 's1'").run();
  assert.equal((d.prepare("SELECT count(*) AS n FROM reaction WHERE target = 's1'").get() as { n: number }).n, 0);
  d.close();
});

const json = <T>(name: string) => JSON.parse(readFileSync(join(process.cwd(), 'src', 'lib', 'emoji', name), 'utf8')) as T;
const rows = json<EmojiRows>('emoji.json');
const names = Object.fromEntries(LOCALES.map((l) => [l, json<string[]>(`names.${l}.json`)])) as Record<Locale, string[]>;

test('the palette has its own data: every emoji named in each language, in a known group, and one the server takes', () => {
  assert.ok(rows.length > 1500, `${rows.length} emoji`);
  for (const list of Object.values(names)) assert.equal(list.length, rows.length);
  for (const [e, g] of rows) {
    assert.ok(g >= 0 && g < GROUPS.length, `${e} in group ${g}`);
    assert.equal(reactionOf(e), e, `${e} is accepted as it is`);
  }
  assert.equal(new Set(rows.map(([e]) => e)).size, rows.length, 'each emoji once');
  for (const e of QUICK_REACTIONS) assert.ok(rows.some(([x]) => x === e), `${e} is in the palette`);
  for (const [lang, list] of Object.entries(names)) assert.equal(list.filter((s) => !s).length, 0, `${lang} names them all`);
});

test('the search finds an emoji by its name or a keyword, in the reader’s language and in English', () => {
  const en = emojiFrom(rows, names.en, names.en);
  const de = emojiFrom(rows, names.de, names.en);
  const af = emojiFrom(rows, names.af, names.en);
  const first = (all: typeof en, q: string) => searchEmoji(all, q).slice(0, 8).map((e) => e.emoji);
  assert.ok(first(en, 'red heart').includes('❤️'));
  assert.ok(first(en, 'candle').includes('🕯️'));
  assert.ok(first(en, 'cake').includes('🎂'));
  assert.ok(first(de, 'herz').includes('❤️'), 'German');
  assert.ok(first(de, 'Kerze').includes('🕯️'), 'German, as typed');
  assert.ok(first(de, 'heart').includes('❤️'), 'English for a German reader too');
  assert.ok(first(af, 'kers').includes('🕯️'), 'Afrikaans');
  assert.ok(first(af, 'hart').length > 0);
  assert.ok(first(de, 'gluck').length > 0 || first(de, 'glück').length > 0, 'accents are optional');
  // Every language finds its own word, and Japanese and Chinese find a word inside a longer name, which has no spaces.
  const own = (locale: Locale, q: string) => first(emojiFrom(rows, names[locale], names.en), q);
  for (const [locale, word] of [['es', 'vela'], ['fr', 'bougie'], ['it', 'candela'], ['nl', 'kaars'], ['pl', 'świeczka'], ['pt-BR', 'vela'], ['ja', 'ろうそく'], ['zh-Hans', '蜡烛']] as const) {
    assert.ok(own(locale, word).includes('🕯️'), `${locale}: ${word}`);
  }
  assert.ok(own('ja', '猫').length > 0 && own('zh-Hans', '猫').length > 0);
  assert.deepEqual(searchEmoji(en, '   '), []);
  assert.deepEqual(searchEmoji(en, 'zzzqqq'), []);
  assert.ok(searchEmoji(en, 'face', 10).length === 10, 'at most the limit');
});
