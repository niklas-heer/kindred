// Today on the server: the question of the week and the daily quiz (migrations/tree/0028_today.sql).
//
// What it promises:
// - The quiz is drawn from the graph every member may read (PLAIN_MEMBER) and kept for the day, so everyone gets the
//   same question and nobody is asked about something only an editor may see.
// - A reader is sent the question without its answer. The answer, who it was about and how the family did come only
//   with the reader's own answer, and a member answers a day once: the first answer stands.
// - An answer to the question of the week is an ordinary memory (a `story` row) with a tag beside it, so the
//   Chronicle, the person's page and the exports show it like any other.
// - Members are named by their account ids, and only in the quiz's tables.
// - In a demo (src/lib/demo.ts) nothing is kept: the day's question is drawn on every read (the draw is the same all day),
//   and an answer is checked and shown with its result, but counts for no streak and no table.
import { isDemo } from '../demo.ts';
import { added, db, graph, guard, NOT_A_RECORD, once, personExists, q, type Db } from '../db.server.ts';
import { translate, type Key, type Locale } from '../i18n/dictionary.ts';
import { PLAIN_MEMBER } from '../visibility.ts';
import { drawQuiz, facePictured, REST_DAYS, validChoice, type QuizQuestion } from './quiz.ts';
import type { QuizHouseRow, QuizView, WeekAnswer, WeekQuestion, WeekView } from './types.ts';
import { CUSTOM, dayOf, questionOfWeek, weekNumber, weekOf, weeksBefore, WEEK_PATTERN } from './week.ts';

const DAY_MS = 86_400_000;

/** Who is asking: an account, and the person it stands for in this family (null for nobody). */
export interface Who { account: string; person: string | null }

// ---------- the stewards' switch ----------

const quizOn = async (d: Db) => (await d.get<{ quiz: number }>('SELECT quiz FROM today_settings WHERE id = 1'))?.quiz !== 0;

export async function todaySettings(tree: string): Promise<{ quiz: boolean }> {
  return { quiz: await quizOn(db(tree)) };
}

export async function setQuizEnabled(tree: string, on: boolean, by: string, now: Date = new Date()): Promise<void> {
  await once(tree, undefined, 'todayQuizSwitch', () => ({
    writes: [
      q('INSERT INTO today_settings (id, quiz, updated_at, updated_by) VALUES (1, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET quiz = excluded.quiz, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
        on ? 1 : 0, now.toISOString(), by),
    ],
    history: NOT_A_RECORD,
    result: null,
  }));
}

// ---------- the daily quiz ----------

interface QuizDayRow { day: string; kind: string; about: string | null; question: string; answer: string }
interface QuizAnswerRow { choice: string; correct: number }

/** The day's question, drawn and kept the first time anyone asks for it. Undefined while the records carry none. */
async function questionOf(tree: string, day: string): Promise<QuizDayRow | undefined> {
  const d = db(tree);
  const read = () => d.get<QuizDayRow>('SELECT day, kind, about, question, answer FROM quiz_day WHERE day = ?', day);
  const kept = await read();
  if (kept) return kept;
  const before = await d.all<{ kind: string; about: string | null }>('SELECT kind, about FROM quiz_day WHERE day < ? ORDER BY day DESC LIMIT ?', day, REST_DAYS);
  const drawn = drawQuiz({
    graph: await graph(tree, PLAIN_MEMBER),
    tree,
    day,
    recent: before.map((r) => r.about).filter((a): a is string => !!a),
    recentKinds: before.map((r) => r.kind),
  });
  if (!drawn) return undefined;
  // A demo stores nothing, and with nothing stored the draw is the same all day.
  if (isDemo()) return { day, kind: drawn.kind, about: drawn.about, question: JSON.stringify(drawn.question), answer: drawn.answer };
  // Two readers at once draw the same question; whichever row lands first is the day's.
  await once(tree, undefined, 'quizDay', () => ({
    writes: [q('INSERT OR IGNORE INTO quiz_day (day, kind, about, question, answer) VALUES (?, ?, ?, ?, ?)', day, drawn.kind, drawn.about, JSON.stringify(drawn.question), drawn.answer)],
    history: NOT_A_RECORD,
    result: null,
  }));
  return read();
}

/** Days in a row with an answer, counted back from today, or from yesterday while today's is still open. */
async function streakOf(d: Db, account: string, day: string): Promise<number> {
  const rows = await d.all<{ day: string }>('SELECT day FROM quiz_answer WHERE account = ? AND day <= ? ORDER BY day DESC LIMIT 400', account, day);
  const days = new Set(rows.map((r) => r.day));
  const at = (back: number) => dayOf(new Date(Date.parse(`${day}T00:00:00Z`) - back * DAY_MS));
  let from = days.has(day) ? 0 : 1;
  let n = 0;
  while (days.has(at(from))) { n++; from++; }
  return n;
}

/** This month's table: right answers by the house each member stood for when they answered. */
async function housesOf(d: Db, day: string): Promise<QuizHouseRow[]> {
  const month = day.slice(0, 7);
  const rows = await d.all<QuizHouseRow>(
    `SELECT a.house AS house, sum(a.correct) AS right, count(*) AS answered, count(DISTINCT a.account) AS players
     FROM quiz_answer a JOIN house h ON h.id = a.house
     WHERE a.day >= ? AND a.day <= ? GROUP BY a.house ORDER BY right DESC, answered ASC, a.house LIMIT 6`,
    `${month}-01`, `${month}-31`,
  );
  return rows.map((r) => ({ house: r.house, right: r.right, answered: r.answered, players: r.players }));
}

async function viewOf(tree: string, who: Who, day: string): Promise<QuizView> {
  const d = db(tree);
  if (!(await quizOn(d))) return { enabled: false, day, streak: 0, houses: [] };
  const row = await questionOf(tree, day);
  const [streak, houses] = await Promise.all([streakOf(d, who.account, day), housesOf(d, day)]);
  if (!row) return { enabled: true, day, streak, houses };
  const question = JSON.parse(row.question) as QuizQuestion;
  const mine = await d.get<QuizAnswerRow>('SELECT choice, correct FROM quiz_answer WHERE day = ? AND account = ?', day, who.account);
  // Until the reader has answered: the question, and nothing that gives it away.
  if (!mine) return { enabled: true, day, question, streak, houses };
  const family = (await d.get<{ answered: number; right: number }>('SELECT count(*) AS answered, coalesce(sum(correct), 0) AS right FROM quiz_answer WHERE day = ?', day))!;

  return {
    enabled: true, day, question, streak, houses,
    mine: { choice: mine.choice, correct: mine.correct === 1 },
    answer: row.answer,
    about: row.about ?? undefined,
    family: { answered: family.answered, right: family.right },
  };
}

/** Today's quiz as one member sees it. */
export const quizView = (tree: string, who: Who, now: Date = new Date()): Promise<QuizView> => viewOf(tree, who, dayOf(now));

/**
 * A member's answer to today's question. One for each member and day: a second one changes nothing and gets the
 * first one's result back. A right answer earns an extra order in the Campaign while it is on (once a day).
 */
export async function answerQuiz(tree: string, who: Who, day: string, choice: string, now: Date = new Date()): Promise<QuizView> {
  const d = db(tree);
  if (!(await quizOn(d))) throw new Error('today.err.quiz_off');
  if (day !== dayOf(now)) throw new Error('today.err.day_over');
  const row = await questionOf(tree, day);
  if (!row) throw new Error('today.err.no_question');
  if (!validChoice(JSON.parse(row.question) as QuizQuestion, choice)) throw new Error('today.err.choice');
  const correct = choice === row.answer;
  if (isDemo()) {
    // The result, shown and forgotten: no streak, no table, no order in the Campaign.
    const view = await viewOf(tree, who, day);
    return { ...view, mine: { choice, correct }, answer: row.answer, about: row.about ?? undefined, demo: true };
  }
  const house = who.person ? (await d.get<{ house: string | null }>('SELECT house FROM person WHERE id = ?', who.person))?.house ?? null : null;
  const fresh = await once<boolean>(tree, undefined, 'quizAnswer', async (dd) => {
    if (await dd.get('SELECT 1 FROM quiz_answer WHERE day = ? AND account = ?', day, who.account)) return { writes: [], history: NOT_A_RECORD, result: false };
    return {
      writes: [
        guard('NOT EXISTS (SELECT 1 FROM quiz_answer WHERE day = ? AND account = ?)', day, who.account),
        q('INSERT INTO quiz_answer (day, account, choice, correct, house, at) VALUES (?, ?, ?, ?, ?, ?)', day, who.account, choice, correct ? 1 : 0, house, now.toISOString()),
      ],
      history: NOT_A_RECORD,
      result: true,
    };
  });
  const view = await viewOf(tree, who, day);
  if (!fresh || !correct) return view;
  // The Campaign's own rule decides (off, or already given today): the quiz never fails because of the game.
  const bonus = await (await import('../campaign/campaign.server.ts')).grantOrder(tree, who.account, 'quiz', now).then((r) => r.granted, () => false);
  return { ...view, bonus };
}

/**
 * Whose face today's question shows, for the picture's own address: the person, and whether the family's photo of them
 * is what is shown (else their drawn portrait). Null when today's question shows no picture.
 */
export async function quizPicture(tree: string, day: string, now: Date = new Date()): Promise<{ person: string; photo: boolean } | null> {
  if (day !== dayOf(now)) return null;
  const d = db(tree);
  if (!(await quizOn(d))) return null;
  // A demo keeps no day's question; the draw is the same all day, so it is drawn again.
  const row = isDemo() ? await questionOf(tree, day) : await d.get<QuizDayRow>('SELECT day, kind, about, question, answer FROM quiz_day WHERE day = ?', day);
  if (!row || row.kind !== 'portrait' || !row.about) return null;
  const person = (await graph(tree, PLAIN_MEMBER)).people.find((p) => p.id === row.about);
  return person ? { person: person.id, photo: facePictured(person) } : null;
}

// ---------- the question of the week ----------

interface WeekRow { week: string; skipped: number; question: string | null }

/** How far back a question stays answerable: two years of weeks. */
const WEEKS_OPEN = 104;
/** How many earlier weeks the page lists. */
const WEEKS_LISTED = 8;

const asked = (tree: string, week: string, row: WeekRow | undefined): WeekQuestion =>
  row?.question ? { week, id: CUSTOM, text: row.question, skipped: false } : { week, id: questionOfWeek(tree, week), skipped: !!row?.skipped };

const weekRow = (d: Db, week: string) => d.get<WeekRow>('SELECT week, skipped, question FROM today_week WHERE week = ?', week);

/** The answers a week has, the latest first. */
export async function answersOf(tree: string, week: string): Promise<WeekAnswer[]> {
  if (!WEEK_PATTERN.test(week)) throw new Error('today.err.week');
  const rows = await db(tree).all<WeekAnswer>(
    'SELECT s.id AS id, s.person AS person, s.author AS author, s.at AS at, s.body AS body FROM today_answer a JOIN story s ON s.id = a.story WHERE a.week = ? ORDER BY s.at DESC LIMIT 200',
    week,
  );
  return rows.map((r) => ({ id: r.id, person: r.person, author: r.author, at: r.at, body: r.body }));
}

/** This week's question with its answers, and the weeks before. */
export async function weekView(tree: string, now: Date = new Date()): Promise<WeekView> {
  const d = db(tree);
  const week = weekOf(now);
  const before = weeksBefore(week, WEEKS_LISTED);
  const marks = before.map(() => '?').join(', ');
  const [rows, counts, answers] = await Promise.all([
    d.all<WeekRow>(`SELECT week, skipped, question FROM today_week WHERE week IN (?, ${marks})`, week, ...before),
    d.all<{ week: string; n: number }>(`SELECT week, count(*) AS n FROM today_answer WHERE week IN (${marks}) GROUP BY week`, ...before),
    answersOf(tree, week),
  ]);
  const rowOf = new Map(rows.map((r) => [r.week, r]));
  const countOf = new Map(counts.map((c) => [c.week, c.n]));
  return {
    current: asked(tree, week, rowOf.get(week)),
    curated: questionOfWeek(tree, week),
    answers,
    // A week that asked nothing is not listed, unless somebody answered before it was skipped.
    earlier: before.map((w) => ({ ...asked(tree, w, rowOf.get(w)), answers: countOf.get(w) ?? 0 })).filter((w) => !w.skipped || w.answers > 0),
  };
}

/**
 * Saves an answer as a memory of `person`, signed with the writer's account name, titled with the question in the
 * writer's language, and tagged with the week. This week's question and every earlier one can be answered; a week a
 * steward skipped cannot.
 */
export async function answerWeek(
  tree: string,
  input: { week: string; person: string; body: string; author: string; locale: Locale },
  op: import('../db.server.ts').OpKey | undefined,
  now: Date = new Date(),
): Promise<{ id: string }> {
  const { week } = input;
  if (!WEEK_PATTERN.test(week)) throw new Error('today.err.week');
  const ahead = weekNumber(week) - weekNumber(weekOf(now));
  if (ahead > 0 || ahead < -WEEKS_OPEN) throw new Error('today.err.week');
  const body = input.body.trim();
  if (!body) throw new Error('today.err.empty');
  return once<{ id: string }>(tree, op, 'answerWeek', async (d) => {
    if (!(await d.get('SELECT id FROM person WHERE id = ?', input.person))) throw new Error('Person not found.');
    const question = asked(tree, week, await weekRow(d, week));
    if (question.skipped) throw new Error('today.err.skipped');
    const title = question.text ?? translate(input.locale, `today.q.${question.id}` as Key);
    const id = crypto.randomUUID();
    return {
      writes: [
        personExists(input.person),
        q('INSERT INTO story (id, person, kind, title, body, author, at, context, author_account) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', id, input.person, 'memory', title, body, input.author, now.toISOString(), null, op?.user ?? null),
        q('INSERT INTO today_answer (story, week, question) VALUES (?, ?, ?)', id, week, question.id),
      ],
      // An answer is a memory like any other: it is in the family's history, and its writer hears of replies to it.
      history: [added('story', id, { person: input.person, label: title })],
      result: { id },
    };
  });
}

/**
 * A steward changes this week's question: their own words (`custom`), no question (`skip`), or the curated one back
 * (`curated`). Answers already given stay where they are.
 */
export async function setWeek(tree: string, change: { mode: 'custom'; text: string } | { mode: 'skip' | 'curated' }, now: Date = new Date()): Promise<void> {
  const week = weekOf(now);
  const text = change.mode === 'custom' ? change.text.replace(/\s+/g, ' ').trim() : null;
  if (change.mode === 'custom' && (text!.length < 5 || text!.length > 200)) throw new Error('today.err.question_length');
  await once(tree, undefined, 'todayWeek', () => ({
    writes: [
      change.mode === 'curated'
        ? q('DELETE FROM today_week WHERE week = ?', week)
        : q('INSERT INTO today_week (week, skipped, question, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (week) DO UPDATE SET skipped = excluded.skipped, question = excluded.question, updated_at = excluded.updated_at',
          week, change.mode === 'skip' ? 1 : 0, text, now.toISOString()),
    ],
    history: NOT_A_RECORD,
    result: null,
  }));
}

