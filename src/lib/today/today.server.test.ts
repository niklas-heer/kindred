// node --test src/lib/today/today.server.test.ts — Today on the server: the day's quiz is drawn once and is the same
// for every member, the answer is not in what a reader is sent until they have answered, an answer stands (it cannot
// be changed or given twice), a right answer adds levy to the next Campaign reign that day while the game is on, a steward can switch the
// quiz off, and an answer to the question of the week is an ordinary memory with its week beside it.
// A scratch family and accounts database; never data/. Invented people only.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'kindred-today-test-'));
process.env.KINDRED_DATA_DIR = dir;
process.env.KINDRED_ACCOUNTS_DB = join(dir, 'accounts.db');
after(() => rmSync(dir, { recursive: true, force: true }));

const { openSqlite } = await import('../store/node.ts');
const { db, chronicle, person } = await import('../db.server.ts');
const store = await import('../auth/store.server.ts');
const today = await import('./today.server.ts');
const game = await import('../campaign/campaign.server.ts');
const { removeStory, restoreStory } = await import('../story.server.ts');
const { translate } = await import('../i18n/dictionary.ts');
const { questionOfWeek, weekOf, weeksBefore } = await import('./week.ts');
const { planTables, foreignKeyOrderErrors, COPIED_TABLES } = await import('../../../scripts/lib/d1-transfer.ts');
type Who = import('./today.server.ts').Who;
type QuizView = import('./types.ts').QuizView;

const ARMS = (field: string) => JSON.stringify({ field, division: 'plain', charge: 'lion', chargeTincture: 'or' });
const DAY = 86_400_000;
const T0 = new Date('2026-11-10T09:00:00Z');
const later = (days: number, from = T0) => new Date(from.getTime() + days * DAY);

/** Three houses, three generations: grandparents, their two children with spouses, four grandchildren. */
function family(tree: string) {
  const d = openSqlite(join(dir, `${tree}.db`), 'tree', { create: true });
  d.exec(`INSERT INTO meta (key, value) VALUES ('id', '${tree}'), ('name', 'Testers'), ('tagline', ''), ('theme', 'codex'), ('focus', 'ada')`);
  for (let i = 0; i < 12; i++) d.exec(`INSERT INTO place (name, lat, lng) VALUES ('Town ${i}', ${48 + (i % 4) * 1.3}, ${7 + Math.floor(i / 4) * 2.1})`);
  for (const [h, field] of [['ash', 'azure'], ['birch', 'gules'], ['cedar', 'vert']]) d.exec(`INSERT INTO house (id, name, arms) VALUES ('${h}', 'House ${h}', '${ARMS(field!)}')`);
  const add = (id: string, born: string, house: string, living: number, place: string) =>
    d.exec(`INSERT INTO person (id, given, surname, house, born, born_place, living, sex) VALUES ('${id}', '${id[0]!.toUpperCase()}${id.slice(1)}', 'Tester', '${house}', '${born}', '${place}', ${living}, 'f')`);
  add('gran', '1930-02-03', 'ash', 0, 'Town 0'); add('gramps', '1928-05-06', 'ash', 0, 'Town 1');
  add('mum', '1955-03-04', 'ash', 1, 'Town 2'); add('dad', '1953-07-08', 'birch', 1, 'Town 3');
  add('aunt', '1958-09-10', 'ash', 1, 'Town 4'); add('uncle', '1957-11-12', 'cedar', 1, 'Town 5');
  add('ada', '1980-01-02', 'birch', 1, 'Town 6'); add('bo', '1983-04-05', 'birch', 1, 'Town 7');
  add('cy', '1985-06-07', 'cedar', 1, 'Town 8'); add('di', '1988-08-09', 'cedar', 1, 'Town 9');
  const child = (c: string, a: string, b: string) => d.exec(`INSERT INTO parent (child, parent) VALUES ('${c}', '${a}'), ('${c}', '${b}')`);
  child('mum', 'gran', 'gramps'); child('aunt', 'gran', 'gramps');
  child('ada', 'mum', 'dad'); child('bo', 'mum', 'dad'); child('cy', 'aunt', 'uncle'); child('di', 'aunt', 'uncle');
  for (const [i, [a, b]] of [['gran', 'gramps'], ['mum', 'dad'], ['aunt', 'uncle']].entries()) d.exec(`INSERT INTO partnership (id, a, b, kind) VALUES ('u${i}', '${a}', '${b}', 'marriage')`);
  d.close();
}

async function account(tree: string, name: string, personId: string | null, role: 'viewer' | 'contributor' | 'steward' = 'viewer'): Promise<Who & { name: string }> {
  const { user, insert } = store.newUser(name, null);
  await store.accounts().batch([insert, store.upsertMembership(user.id, tree, role)]);
  if (personId) await store.accounts().run('UPDATE membership SET person = ? WHERE user = ? AND tree = ?', personId, user.id, tree);
  return { account: user.id, person: personId, name };
}

const count = async (tree: string, table: string, where = '1 = 1') => (await db(tree).get<{ n: number }>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`))!.n;
const kept = async (tree: string, day: string) => (await db(tree).get<{ answer: string; about: string; kind: string }>('SELECT answer, about, kind FROM quiz_day WHERE day = ?', day))!;
/** A choice the question allows that is not the right one. */
const wrongFor = (view: QuizView, answer: string) => (view.question!.kind === 'order' ? (answer === '0,1,2' ? '2,1,0' : '0,1,2') : String((Number(answer) + 1) % view.question!.options.length));

// ---------- the daily quiz ----------

test('everyone gets the same question for the day, drawn once, and a new one the next day', async () => {
  family('same');
  const ada = await account('same', 'Ada', 'ada');
  const bo = await account('same', 'Bo', 'bo');
  const a = await today.quizView('same', ada, T0);
  assert.equal(a.enabled, true);
  assert.equal(a.day, '2026-11-10');
  assert.ok(a.question);
  // The family's records change during the day: the question does not.
  await db('same').run("UPDATE person SET born_place = 'Elsewhere', given = 'Renamed' WHERE id IN ('gran', 'mum', 'ada', 'cy')");
  await db('same').run("UPDATE house SET name = 'House of another name'");
  const b = await today.quizView('same', bo, later(0.5));
  assert.deepEqual(b.question, a.question);
  assert.equal(await count('same', 'quiz_day'), 1);
  // Two readers at once on a new day still leave one question.
  const [x, y] = await Promise.all([today.quizView('same', ada, later(1)), today.quizView('same', bo, later(1))]);
  assert.deepEqual(x.question, y.question);
  assert.equal(await count('same', 'quiz_day'), 2);
  const first = await kept('same', '2026-11-10');
  const second = await kept('same', '2026-11-11');
  assert.notEqual(second.about, first.about, 'not about the same person or house two days running');
  assert.notEqual(second.kind, first.kind);
});

test('the answer is not in what a reader is sent until they have answered', async () => {
  family('hidden');
  const ada = await account('hidden', 'Ada', 'ada');
  const bo = await account('hidden', 'Bo', 'bo');
  for (let d = 0; d < 12; d++) {
    const now = later(d);
    const before = await today.quizView('hidden', ada, now);
    const row = await kept('hidden', before.day);
    assert.deepEqual(Object.keys(before).sort(), ['day', 'enabled', 'houses', 'question', 'streak'], 'no answer, nobody it is about, no tally');
    assert.ok(!('answer' in before.question!) && !('about' in before.question!));
    if (row.kind === 'portrait') assert.ok(!JSON.stringify(before).includes(`"subject"`), 'a face is asked without saying whose');
    // Someone else answering changes nothing for a reader who has not.
    await today.answerQuiz('hidden', bo, before.day, row.answer, now);
    // (Only the month's table of houses moves, which says nothing about today's answer.)
    assert.deepEqual({ ...(await today.quizView('hidden', ada, now)), houses: [] }, { ...before, houses: [] });
    const after = await today.answerQuiz('hidden', ada, before.day, wrongFor(before, row.answer), now);
    assert.equal(after.answer, row.answer);
    assert.equal(after.about, row.about);
    assert.deepEqual(after.mine, { choice: wrongFor(before, row.answer), correct: false });
    assert.deepEqual(after.family, { answered: 2, right: 1 });
  }
});

test('an answer stands: it cannot be changed, and it cannot be given twice', async () => {
  family('once');
  const ada = await account('once', 'Ada', 'ada');
  const view = await today.quizView('once', ada, T0);
  const { answer } = await kept('once', view.day);
  const wrong = wrongFor(view, answer);
  const first = await today.answerQuiz('once', ada, view.day, wrong, T0);
  assert.equal(first.mine!.correct, false);
  // Now that the answer is known, sending the right one changes nothing.
  const second = await today.answerQuiz('once', ada, view.day, answer, later(0.1));
  assert.deepEqual(second.mine, { choice: wrong, correct: false });
  assert.equal(second.bonus, undefined);
  assert.equal(await count('once', 'quiz_answer'), 1);
  assert.equal((await db('once').get<{ choice: string }>('SELECT choice FROM quiz_answer'))!.choice, wrong);
  // Two copies of the first answer of another member at once: one row.
  const bo = await account('once', 'Bo', 'bo');
  const both = await Promise.all([today.answerQuiz('once', bo, view.day, answer, T0), today.answerQuiz('once', bo, view.day, wrong, T0)]);
  assert.equal(await count('once', 'quiz_answer', `account = '${bo.account}'`), 1);
  assert.deepEqual(both[0].mine, both[1].mine);
  // The database itself refuses a second row for a member and a day.
  await assert.rejects(db('once').run('INSERT INTO quiz_answer (day, account, choice, correct, at) VALUES (?, ?, ?, 1, ?)', view.day, ada.account, answer, T0.toISOString()));
});

test('only today’s question can be answered, and only with one of its choices', async () => {
  family('rules');
  const ada = await account('rules', 'Ada', 'ada');
  const view = await today.quizView('rules', ada, T0);
  const { answer } = await kept('rules', view.day);
  await assert.rejects(today.answerQuiz('rules', ada, view.day, answer, later(1)), /today\.err\.day_over/);
  await assert.rejects(today.answerQuiz('rules', ada, '2026-11-09', answer, T0), /today\.err\.day_over/);
  for (const bad of ['9', '', '0,0,0', 'x']) await assert.rejects(today.answerQuiz('rules', ada, view.day, bad, T0), /today\.err\.choice/);
  assert.equal(await count('rules', 'quiz_answer'), 0);
});

test('a streak counts the days in a row, and the month’s table counts right answers by house', async () => {
  family('streak');
  const ada = await account('streak', 'Ada', 'ada'); // House birch
  const cy = await account('streak', 'Cy', 'cy'); // House cedar
  const nobody = await account('streak', 'Guest of honour', null);
  const play = async (who: Who, now: Date, right: boolean) => {
    const view = await today.quizView('streak', who, now);
    const { answer } = await kept('streak', view.day);
    return today.answerQuiz('streak', who, view.day, right ? answer : wrongFor(view, answer), now);
  };
  assert.equal((await today.quizView('streak', ada, T0)).streak, 0);
  assert.equal((await play(ada, T0, true)).streak, 1);
  assert.equal((await play(ada, later(1), false)).streak, 2, 'a wrong answer still keeps the streak');
  // The next morning, before answering, yesterday's streak is still shown.
  assert.equal((await today.quizView('streak', ada, later(2))).streak, 2);
  assert.equal((await play(ada, later(2), true)).streak, 3);
  // A day missed: the streak starts again.
  assert.equal((await today.quizView('streak', ada, later(4))).streak, 0);
  assert.equal((await play(ada, later(4), true)).streak, 1);
  await play(cy, later(4), true);
  await play(nobody, later(4), true);
  const { houses } = await today.quizView('streak', ada, later(4));
  assert.deepEqual(houses, [
    { house: 'birch', right: 3, answered: 4, players: 1 },
    { house: 'cedar', right: 1, answered: 1, players: 1 },
  ]);
  // A new month starts a new table.
  assert.deepEqual((await today.quizView('streak', ada, new Date('2026-12-01T09:00:00Z'))).houses, []);
});

test('a right answer adds levy to the next Campaign reign that day while the game is on, and nothing otherwise', async () => {
  family('bonus');
  const steward = await account('bonus', 'Sten', 'gran', 'steward');
  const ada = await account('bonus', 'Ada', 'ada');
  const bo = await account('bonus', 'Bo', 'bo');
  const play = async (who: Who, now: Date, right: boolean) => {
    const view = await today.quizView('bonus', who, now);
    const { answer } = await kept('bonus', view.day);
    return today.answerQuiz('bonus', who, view.day, right ? answer : wrongFor(view, answer), now);
  };
  // Off: a right answer is just a right answer.
  assert.equal((await play(ada, T0, true)).bonus, false);
  await game.setCampaignEnabled('bonus', true, steward.account, later(1));
  const who = { account: ada.account, name: 'Ada', person: 'ada' };
  const won = await play(ada, later(1), true);
  assert.equal(won.bonus, true);
  // The reward is the Campaign's to give: extra levy on the first turn of Ada's next reign that day, once.
  const challenge = (await game.campaignView('bonus', who, later(1))).challenge!;
  const side = challenge.side ?? challenge.field.sides[0].id;
  assert.equal(challenge.grant, 2);
  assert.equal((await game.startRun('bonus', who, side, later(1))).grant, 2);
  assert.equal((await game.startRun('bonus', who, side, later(1))).grant, 0, 'one reign a day gets it');
  // A wrong answer earns nothing, and answering again earns nothing more.
  assert.equal((await play(bo, later(1), false)).bonus, undefined);
  assert.equal((await play(ada, later(1), true)).bonus, undefined);
  const bob = { account: bo.account, name: 'Bo', person: 'bo' };
  assert.equal((await game.startRun('bonus', bob, side, later(1))).grant, 0);
  assert.equal((await game.startRun('bonus', who, side, later(2))).grant, 0, 'a new day needs a new right answer');
});

test('a steward can switch the quiz off: no question is drawn or shown, and nothing can be answered', async () => {
  family('off');
  const steward = await account('off', 'Sten', 'gran', 'steward');
  const ada = await account('off', 'Ada', 'ada');
  assert.deepEqual(await today.todaySettings('off'), { quiz: true }, 'on until a steward turns it off');
  const view = await today.quizView('off', ada, T0);
  const { answer } = await kept('off', view.day);
  await today.setQuizEnabled('off', false, steward.account, T0);
  assert.deepEqual(await today.todaySettings('off'), { quiz: false });
  assert.deepEqual(await today.quizView('off', ada, T0), { enabled: false, day: view.day, streak: 0, houses: [] });
  await assert.rejects(today.answerQuiz('off', ada, view.day, answer, T0), /today\.err\.quiz_off/);
  assert.equal(await today.quizPicture('off', view.day, T0), null);
  assert.equal((await today.quizView('off', ada, later(1))).question, undefined);
  assert.equal(await count('off', 'quiz_day'), 1, 'no question is drawn while it is off');
  await today.setQuizEnabled('off', true, steward.account, later(1));
  assert.ok((await today.quizView('off', ada, later(1))).question);
});

test('the picture of "who is this?" is served by day, only today, and only for a question that shows one', async () => {
  family('face');
  const ada = await account('face', 'Ada', 'ada');
  // Find a day that asks for a face.
  let found: { day: string; now: Date; about: string } | undefined;
  for (let d = 0; d < 60 && !found; d++) {
    const view = await today.quizView('face', ada, later(d));
    const row = await kept('face', view.day);
    if (row.kind === 'portrait') found = { day: view.day, now: later(d), about: row.about };
    else assert.equal(await today.quizPicture('face', view.day, later(d)), null);
  }
  assert.ok(found, 'a face within sixty days');
  const shown = (await today.quizPicture('face', found.day, found.now))!;
  assert.equal(shown.person, found.about);
  assert.equal(shown.photo, false, 'nobody here has a photo: the drawn portrait of someone who has died');
  assert.ok(['gran', 'gramps'].includes(shown.person), 'only the dead are drawn');
  assert.equal(await today.quizPicture('face', found.day, later(1, found.now)), null, 'yesterday’s picture is gone');
});

test('a family too small for any question gets none, without an error', async () => {
  const d = openSqlite(join(dir, 'tiny.db'), 'tree', { create: true });
  d.exec("INSERT INTO meta (key, value) VALUES ('id', 'tiny'), ('name', 'Tiny'), ('tagline', ''), ('theme', 'codex'), ('focus', 'solo')");
  d.exec("INSERT INTO person (id, given, living) VALUES ('solo', 'Solo', 1)");
  d.close();
  const solo = await account('tiny', 'Solo', 'solo');
  const view = await today.quizView('tiny', solo, T0);
  assert.deepEqual(view, { enabled: true, day: '2026-11-10', streak: 0, houses: [] });
  await assert.rejects(today.answerQuiz('tiny', solo, view.day, '0', T0), /today\.err\.no_question/);
  assert.equal(await count('tiny', 'quiz_day'), 0);
});

// ---------- the question of the week ----------

test('an answer to the question of the week is a memory in the Chronicle, tagged with its week', async () => {
  family('week');
  const week = weekOf(T0);
  const view = await today.weekView('week', T0);
  assert.deepEqual(view.current, { week, id: questionOfWeek('week', week), skipped: false });
  assert.deepEqual(view.answers, []);
  assert.equal(view.earlier.length, 8);
  assert.deepEqual(view.earlier.map((w) => w.week), weeksBefore(week, 8));

  const { id } = await today.answerWeek('week', { week, person: 'gran', body: '  Roast chicken, and the good plates.  ', author: 'Ada Tester', locale: 'de' }, { key: 'k-week-answer-1', user: 'u1', payload: { n: 1 } }, T0);
  const stories = await chronicle('week', 10);
  assert.equal(stories.length, 1);
  assert.deepEqual(
    { id: stories[0].id, person: stories[0].person, kind: stories[0].kind, title: stories[0].title, body: stories[0].body, author: stories[0].author, at: stories[0].at },
    { id, person: 'gran', kind: 'memory', title: translate('de', `today.q.${view.current.id}` as never), body: 'Roast chicken, and the good plates.', author: 'Ada Tester', at: T0.toISOString() },
    'an ordinary memory, titled with the question in the writer’s language',
  );
  assert.equal((await person('week', 'gran'))!.stories.length, 1, 'on the person’s own page too');
  // The same request again (a retry) saves nothing twice.
  assert.deepEqual(await today.answerWeek('week', { week, person: 'gran', body: '  Roast chicken, and the good plates.  ', author: 'Ada Tester', locale: 'de' }, { key: 'k-week-answer-1', user: 'u1', payload: { n: 1 } }, T0), { id });
  assert.equal(await count('week', 'story'), 1);

  await today.answerWeek('week', { week, person: 'ada', body: 'Pancakes.', author: 'Bo Tester', locale: 'en' }, undefined, later(1));
  const now = await today.weekView('week', later(1));
  assert.deepEqual(now.answers.map((a) => [a.person, a.author, a.body]), [['ada', 'Bo Tester', 'Pancakes.'], ['gran', 'Ada Tester', 'Roast chicken, and the good plates.']]);

  // Removing the memory takes its tag with it; Undo brings both back.
  await removeStory('week', id, { key: 'k-week-remove-1', user: 'u1', payload: { id } });
  assert.equal((await today.weekView('week', later(1))).answers.length, 1);
  assert.equal(await count('week', 'today_answer'), 1);
  assert.deepEqual(await restoreStory('week', 'k-week-remove-1', 'u1'), { restored: true });
  assert.deepEqual((await today.weekView('week', later(1))).answers.map((a) => a.person), ['ada', 'gran'], 'the answer is back under its week');
  assert.deepEqual({ ...(await db('week').get('SELECT week, question FROM today_answer WHERE story = ?', id)) }, { week, question: view.current.id });
  assert.deepEqual(await restoreStory('week', 'k-week-remove-1', 'u1'), { restored: true }, 'twice changes nothing');
  assert.equal(await count('week', 'today_answer'), 2);
});

test('earlier questions stay answerable; a week to come, a week long gone and an unknown person do not', async () => {
  family('past');
  const week = weekOf(T0);
  const [last] = weeksBefore(week, 1);
  await today.answerWeek('past', { week: last!, person: 'mum', body: 'Late, but here.', author: 'Ada', locale: 'en' }, undefined, T0);
  const view = await today.weekView('past', T0);
  assert.equal(view.earlier[0]!.week, last);
  assert.equal(view.earlier[0]!.answers, 1);
  assert.equal(view.earlier[0]!.id, questionOfWeek('past', last!));
  assert.deepEqual((await today.answersOf('past', last!)).map((a) => a.body), ['Late, but here.']);
  assert.deepEqual(view.answers, [], 'this week’s list has only this week’s answers');

  await assert.rejects(today.answerWeek('past', { week: weekOf(later(7)), person: 'mum', body: 'x', author: 'Ada', locale: 'en' }, undefined, T0), /today\.err\.week/);
  await assert.rejects(today.answerWeek('past', { week: '2020-W01', person: 'mum', body: 'x', author: 'Ada', locale: 'en' }, undefined, T0), /today\.err\.week/);
  await assert.rejects(today.answerWeek('past', { week: 'next week', person: 'mum', body: 'x', author: 'Ada', locale: 'en' }, undefined, T0), /today\.err\.week/);
  await assert.rejects(today.answerWeek('past', { week, person: 'nobody', body: 'x', author: 'Ada', locale: 'en' }, undefined, T0), /Person not found/);
  await assert.rejects(today.answerWeek('past', { week, person: 'mum', body: '   ', author: 'Ada', locale: 'en' }, undefined, T0), /today\.err\.empty/);
  assert.equal(await count('past', 'story'), 1);
});

test('a steward asks their own question, skips the week, or takes the curated one back', async () => {
  family('own');
  const week = weekOf(T0);
  const curated = questionOfWeek('own', week);
  await today.answerWeek('own', { week, person: 'gran', body: 'Before the change.', author: 'Ada', locale: 'en' }, undefined, T0);

  await today.setWeek('own', { mode: 'custom', text: '  What did   Gran’s garden smell like? ' }, T0);
  let view = await today.weekView('own', T0);
  assert.deepEqual(view.current, { week, id: 'custom', text: 'What did Gran’s garden smell like?', skipped: false });
  assert.equal(view.curated, curated);
  assert.equal(view.answers.length, 1, 'answers already given stay with the week');
  const { id } = await today.answerWeek('own', { week, person: 'gran', body: 'Lavender.', author: 'Bo', locale: 'af' }, undefined, T0);
  assert.equal((await db('own').get<{ title: string }>('SELECT title FROM story WHERE id = ?', id))!.title, 'What did Gran’s garden smell like?');
  assert.equal((await db('own').get<{ question: string }>('SELECT question FROM today_answer WHERE story = ?', id))!.question, 'custom');
  await assert.rejects(today.setWeek('own', { mode: 'custom', text: 'Hm?' }, T0), /today\.err\.question_length/);
  await assert.rejects(today.setWeek('own', { mode: 'custom', text: 'x'.repeat(201) }, T0), /today\.err\.question_length/);

  await today.setWeek('own', { mode: 'skip' }, T0);
  view = await today.weekView('own', T0);
  assert.equal(view.current.skipped, true);
  await assert.rejects(today.answerWeek('own', { week, person: 'gran', body: 'x', author: 'Ada', locale: 'en' }, undefined, T0), /today\.err\.skipped/);
  // Next week the skipped one is listed, because it has answers; a skipped week without any is not.
  assert.equal((await today.weekView('own', later(7))).earlier[0]!.week, week);
  await today.setWeek('own', { mode: 'skip' }, later(7));
  assert.ok(!(await today.weekView('own', later(14))).earlier.some((w) => w.week === weekOf(later(7))));

  await today.setWeek('own', { mode: 'curated' }, T0);
  assert.deepEqual((await today.weekView('own', T0)).current, { week, id: curated, skipped: false });
  assert.equal(await count('own', 'today_week', `week = '${week}'`), 0);
});

test('Today never writes to the family’s records beyond the memory itself, and the transfer knows its tables', async () => {
  family('records');
  const ada = await account('records', 'Ada', 'ada');
  const records = async () => JSON.stringify(await Promise.all(['meta', 'house', 'person', 'parent', 'partnership', 'place', 'photo', 'person_field'].map((t) => db('records').all(`SELECT * FROM ${t}`))));
  const before = await records();
  for (let d = 0; d < 5; d++) {
    const view = await today.quizView('records', ada, later(d));
    await today.answerQuiz('records', ada, view.day, (await kept('records', view.day)).answer, later(d));
  }
  await today.answerWeek('records', { week: weekOf(T0), person: 'gran', body: 'A memory.', author: 'Ada', locale: 'en' }, undefined, T0);
  await today.setWeek('records', { mode: 'skip' }, T0);
  assert.equal(await records(), before);
  assert.equal(await count('records', 'story'), 1);

  const names = (await db('records').all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map((r) => r.name);
  const plan = planTables(names);
  for (const table of ['today_settings', 'quiz_day', 'quiz_answer']) { assert.ok(plan.leftOut.includes(table), table); assert.ok(!plan.copy.includes(table)); }
  for (const table of ['today_week', 'today_answer']) assert.ok(plan.copy.includes(table), table);
  assert.deepEqual(foreignKeyOrderErrors(COPIED_TABLES, [{ table: 'today_answer', parent: 'story' }]), []);
});

test('every one of Today’s server functions is for members: none lets a share-link guest in', () => {
  const source = readFileSync(new URL('./today.functions.ts', import.meta.url), 'utf8');
  assert.ok(!source.includes('requireReader'), 'requireReader is the check that admits a guest');
  const handlers = source.split('.handler(').slice(1);
  assert.equal(handlers.length, 8);
  for (const h of handlers) assert.match(h.slice(0, 400), /member\(data\.tree\)|requireCan\(data\.tree, '(add-story|manage-access)'\)/);
  // The quiz's picture, too.
  const picture = readFileSync(new URL('../../routes/api/quiz-picture.$tree.$day.ts', import.meta.url), 'utf8');
  assert.ok(picture.includes('requireMember(params.tree)') && !picture.includes('requireReader'));
});

test('in a demo the quiz is drawn without being kept, and an answer is shown and forgotten', async () => {
  family('demo-quiz');
  const ada = await account('demo-quiz', 'Ada', 'ada');
  process.env.KINDRED_DEMO = '1';
  try {
    let face: { day: string; now: Date } | undefined;
    for (let d = 0; d < 60; d++) {
      const now = later(d);
      const before = await today.quizView('demo-quiz', ada, now);
      assert.ok(before.question, 'a question, though nothing may be stored');
      assert.deepEqual(Object.keys(before).sort(), ['day', 'enabled', 'houses', 'question', 'streak'], 'and still no answer before answering');
      assert.deepEqual((await today.quizView('demo-quiz', ada, later(0.3, now))).question, before.question, 'the same all day');
      const right = await today.answerQuiz('demo-quiz', ada, before.day, before.question!.kind === 'order' ? '0,1,2' : '0', now);
      assert.equal(right.demo, true);
      assert.ok(right.answer && right.mine);
      assert.equal(right.mine.correct, right.mine.choice === right.answer);
      assert.equal(right.family, undefined, 'no tally of the family');
      assert.equal(right.bonus, undefined);
      assert.equal(right.streak, 0);
      if (!face && right.question!.kind === 'portrait') face = { day: before.day, now };
    }
    assert.ok(face, 'a face within sixty days');
    assert.ok(await today.quizPicture('demo-quiz', face.day, face.now), 'its picture is served too');
  } finally {
    delete process.env.KINDRED_DEMO;
  }
  assert.equal(await count('demo-quiz', 'quiz_day'), 0, 'no question kept');
  assert.equal(await count('demo-quiz', 'quiz_answer'), 0, 'no answer kept');
});
