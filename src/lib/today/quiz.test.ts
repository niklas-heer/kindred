// node --test src/lib/today/quiz.test.ts — the pure halves of Today: which question a week asks, and the day's quiz
// question. Both are seeded: the same family and the same week or day always give the same one. The quiz reads only
// the graph it is handed, never carries its answer in what a reader is sent, rests the people it asked about, and
// gives way gracefully in a family too small for a kind of question. Invented people only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { protectGraph } from '../protect-living.ts';
import type { GPerson, Graph } from '../types.ts';
import { drawQuiz, QUIZ_KINDS, validChoice, type DrawnQuiz, type QuizInput } from './quiz.ts';
import { dayOf, questionOfWeek, QUESTION_COUNT, QUESTION_IDS, weekNumber, weekOf, weeksBefore, weekStart } from './week.ts';

const ARMS = (field: string) => ({ field, division: 'plain', charge: 'lion', chargeTincture: 'or' }) as unknown as Graph['houses'][number]['arms'];
const DAY = 86_400_000;
const dayAt = (n: number) => dayOf(new Date(Date.UTC(2026, 0, 1) + n * DAY));

/** A family of `generations` generations: each couple has two children, each child marries in. Houses by surname. */
function family(generations: number, opts: { places?: boolean; houses?: number } = {}): Graph {
  const people: GPerson[] = [];
  const parents: Graph['parents'] = [];
  const unions: Graph['unions'] = [];
  const houseCount = opts.houses ?? 4;
  const houses = Array.from({ length: houseCount }, (_, i) => ({ id: `h${i}`, name: `House ${'ABCDEFGH'[i]}`, arms: ARMS(['azure', 'gules', 'vert', 'sable', 'purpure', 'or', 'argent', 'tenne'][i]!) })) as Graph['houses'];
  let n = 0;
  const add = (gen: number, extra: Partial<GPerson> = {}): GPerson => {
    const i = n++;
    const born = 1870 + gen * 28 + (i % 9);
    const p: GPerson = {
      id: `p${i}`, given: `Given${i}`, surname: `Sur${i % 5}`, sex: i % 2 ? 'f' : 'm', living: born > 1945, stories: 0, contacts: 0,
      born: `${born}-0${(i % 9) + 1}-1${i % 9}`, died: born > 1945 ? undefined : `${born + 70}`,
      ...(opts.places === false ? {} : { bornPlace: `Town ${i % 7}` }),
      ...(houseCount ? { house: `h${i % houseCount}` } : {}),
      ...extra,
    };
    people.push(p);
    return p;
  };
  let couples: [GPerson, GPerson][] = [[add(0), add(0)]];
  unions.push({ id: 'u0', a: couples[0]![0].id, b: couples[0]![1].id, kind: 'marriage' });
  for (let gen = 1; gen < generations; gen++) {
    const next: [GPerson, GPerson][] = [];
    for (const [a, b] of couples) {
      for (let k = 0; k < 2; k++) {
        const child = add(gen);
        parents.push({ child: child.id, parent: a.id, kind: 'biological', confidence: 'certain' }, { child: child.id, parent: b.id, kind: 'biological', confidence: 'certain' });
        const spouse = add(gen);
        unions.push({ id: `u${unions.length}`, a: child.id, b: spouse.id, kind: 'marriage' });
        next.push([child, spouse]);
      }
    }
    couples = next;
  }
  return { tree: { id: 'testers', name: 'Testers', tagline: '', theme: 'codex', focus: 'p0', people: people.length }, houses, people, parents, unions, places: [] };
}

const input = (graph: Graph, day: string, more: Partial<QuizInput> = {}): QuizInput => ({ graph, tree: 'testers', day, ...more });

/** Every id, house and place a drawn question names. */
function named(q: DrawnQuiz): { people: string[]; houses: string[]; places: string[] } {
  const people = q.question.options.flatMap((o) => o.people ?? []);
  if (q.question.subject) people.push(q.question.subject);
  return { people, houses: q.question.options.flatMap((o) => (o.house ? [o.house] : [])), places: q.question.options.flatMap((o) => (o.place ? [o.place] : [])) };
}

// ---------- the question of the week ----------

test('a week is an ISO week, in UTC, across the turn of a year', () => {
  assert.equal(weekOf(new Date('2026-11-10T12:00:00Z')), '2026-W46');
  assert.equal(weekOf(new Date('2026-11-15T23:59:59Z')), '2026-W46');
  assert.equal(weekOf(new Date('2026-11-16T00:00:00Z')), '2026-W47');
  assert.equal(weekOf(new Date('2027-01-01T08:00:00Z')), '2026-W53');
  assert.equal(weekOf(new Date('2024-12-30T08:00:00Z')), '2025-W01');
  assert.equal(weekStart('2026-W46').toISOString().slice(0, 10), '2026-11-09');
  assert.equal(weekNumber('2027-W01') - weekNumber('2026-W53'), 1);
  assert.deepEqual(weeksBefore('2027-W01', 3), ['2026-W53', '2026-W52', '2026-W51']);
});

test('the question of the week is the same for a family every time, and differs between families', () => {
  for (const week of ['2026-W46', '2027-W01', '2030-W20']) {
    assert.equal(questionOfWeek('ashby', week), questionOfWeek('ashby', week));
    assert.ok(QUESTION_IDS.includes(questionOfWeek('ashby', week)));
  }
  const weeks = [...weeksBefore('2027-W20', 30), '2027-W20'];
  assert.ok(weeks.some((w) => questionOfWeek('ashby', w) !== questionOfWeek('birchwood', w)), 'two families are not asked the same thing every week');
});

test('every question is asked once before any comes round again, and never two weeks running', () => {
  // A whole round: sixty consecutive weeks that start where the count divides evenly.
  let week = '2026-W01';
  while (weekNumber(week) % QUESTION_COUNT !== 0) week = weekOf(new Date(weekStart(week).getTime() + 7 * DAY));
  const asked: string[] = [];
  for (let i = 0; i < QUESTION_COUNT * 3; i++) {
    asked.push(questionOfWeek('ashby', week));
    week = weekOf(new Date(weekStart(week).getTime() + 7 * DAY));
  }
  for (let round = 0; round < 3; round++) assert.equal(new Set(asked.slice(round * QUESTION_COUNT, (round + 1) * QUESTION_COUNT)).size, QUESTION_COUNT, `round ${round}`);
  for (let i = 1; i < asked.length; i++) assert.notEqual(asked[i], asked[i - 1]);
});

// ---------- the daily quiz ----------

test('the quiz is the same for a family and a day, whatever order the records arrive in', () => {
  const g = family(4);
  const shuffledRows: Graph = { ...g, people: [...g.people].reverse(), houses: [...g.houses].reverse() };
  for (let d = 0; d < 40; d++) {
    const a = drawQuiz(input(g, dayAt(d)));
    assert.deepEqual(a, drawQuiz(input(g, dayAt(d))));
    assert.deepEqual(a, drawQuiz(input(shuffledRows, dayAt(d))));
  }
  const days = Array.from({ length: 40 }, (_, d) => JSON.stringify(drawQuiz(input(g, dayAt(d)))));
  assert.ok(new Set(days).size > 30, 'a different question on most days');
  assert.notDeepEqual(drawQuiz({ graph: g, tree: 'testers', day: dayAt(3) }), drawQuiz({ graph: g, tree: 'others', day: dayAt(3) }));
});

test('what a reader is sent never holds the answer, and the answer is one of the choices', () => {
  const g = family(4);
  const seen = new Set<string>();
  for (let d = 0; d < 200; d++) {
    const q = drawQuiz(input(g, dayAt(d)))!;
    seen.add(q.kind);
    assert.ok(validChoice(q.question, q.answer), `${q.kind}: ${q.answer}`);
    assert.ok(!('answer' in q.question) && !('about' in q.question));
    if (q.kind === 'portrait') {
      // "Who is this?" names nobody: the picture has its own address, and the subject is only one of the options.
      assert.equal(q.question.subject, undefined);
      assert.ok(q.question.options.some((o) => o.people?.[0] === q.about));
    }
    if (q.kind === 'shield') assert.deepEqual(q.question.arms, g.houses.find((h) => h.id === q.about)!.arms);
    assert.ok(q.question.options.length >= 3 && q.question.options.length <= 4);
    assert.equal(new Set(q.question.options.map((o) => JSON.stringify(o))).size, q.question.options.length, 'no choice twice');
  }
  assert.deepEqual([...seen].sort(), [...QUIZ_KINDS].sort(), 'a family with enough records gets every kind');
});

test('the answers are right', () => {
  const g = family(4);
  const byId = new Map(g.people.map((p) => [p.id, p]));
  const parentsOf = (id: string) => g.parents.filter((l) => l.child === id).map((l) => l.parent).sort();
  for (let d = 0; d < 200; d++) {
    const q = drawQuiz(input(g, dayAt(d)))!;
    const right = q.question.options[Number(q.answer.split(',')[0])]!;
    if (q.kind === 'parents') assert.deepEqual([...right.people!].sort(), parentsOf(q.question.subject!));
    if (q.kind === 'birthplace') assert.equal(right.place, byId.get(q.question.subject!)!.bornPlace);
    if (q.kind === 'grandchild') {
      assert.ok(parentsOf(right.people![0]!).some((p) => parentsOf(p).includes(q.question.subject!)));
      // And no other choice is a grandchild too.
      for (const o of q.question.options) if (o !== right) assert.ok(!parentsOf(o.people![0]!).some((p) => parentsOf(p).includes(q.question.subject!)));
    }
    if (q.kind === 'order') {
      const years = q.answer.split(',').map((i) => parseInt(byId.get(q.question.options[Number(i)]!.people![0]!)!.born!, 10));
      assert.ok(years[0]! < years[1]! && years[1]! < years[2]!, years.join(' < '));
    }
    if (q.kind === 'shield') assert.equal(right.house, q.about);
  }
});

test('the quiz asks only what is in the graph it is given: nothing withheld from the reader can be a question', () => {
  // The graph a guest gets when living people are protected has no dates or places for the living. The quiz is for
  // members, who get the whole graph; this shows it invents nothing beyond what it is handed.
  const whole = family(5);
  const g = protectGraph(whole);
  const living = new Set(whole.people.filter((p) => p.living).map((p) => p.id));
  assert.ok(living.size > 10);
  const known = new Set(g.people.map((p) => p.id));
  const places = new Set(g.people.map((p) => p.bornPlace).filter(Boolean));
  for (let d = 0; d < 300; d++) {
    const q = drawQuiz(input(g, dayAt(d)));
    if (!q) continue;
    const n = named(q);
    for (const id of n.people) assert.ok(known.has(id));
    for (const place of n.places) assert.ok(places.has(place), place);
    if (q.kind === 'birthplace') assert.ok(!living.has(q.question.subject!), 'no living person’s birthplace');
    if (q.kind === 'order') for (const id of n.people) assert.ok(!living.has(id), 'no living person’s birth year');
    if (q.kind === 'portrait') assert.ok(!living.has(q.about), 'a living person without a photo is never shown');
  }
});

test('a face is asked only of the dead, or of someone whose photo the family shows', () => {
  const g = family(4);
  const pictured = g.people.find((p) => p.living)!;
  const hidden = g.people.filter((p) => p.living)[1]!;
  pictured.photo = '2026-01-01T00:00:00Z';
  // A photo kept, with the drawn portrait chosen instead: not shown, so not asked.
  hidden.photo = '2026-01-01T00:00:00Z';
  hidden.preferAvatar = true;
  const byId = new Map(g.people.map((p) => [p.id, p]));
  let faces = 0;
  for (let d = 0; d < 400; d++) {
    const q = drawQuiz(input(g, dayAt(d)))!;
    if (q.kind !== 'portrait') continue;
    faces++;
    const p = byId.get(q.about)!;
    assert.ok(!p.living || p.id === pictured.id, `${p.id} is living and has no shown photo`);
  }
  assert.ok(faces > 20);
});

test('nobody is asked about again while they rest, and yesterday’s kind is tried last', () => {
  const g = family(4);
  const recent: string[] = [];
  const kinds: string[] = [];
  for (let d = 0; d < 60; d++) {
    const q = drawQuiz(input(g, dayAt(d), { recent, recentKinds: kinds }))!;
    assert.ok(!recent.slice(0, 21).includes(q.about), `day ${d}: ${q.about} again`);
    assert.notEqual(q.kind, kinds[0], `day ${d}: ${q.kind} two days running`);
    recent.unshift(q.about);
    kinds.unshift(q.kind);
  }
});

test('near days ask about people the living knew, far days about ancestors', () => {
  const g = family(6);
  const byId = new Map(g.people.map((p) => [p.id, p]));
  let near = 0, far = 0;
  for (let d = 0; d < 300; d++) {
    const q = drawQuiz(input(g, dayAt(d)))!;
    const p = byId.get(q.about);
    if (!p) continue;
    if (p.living || parseInt(p.born!, 10) >= 1926) near++; else far++;
  }
  assert.ok(near > 60 && far > 60, `near ${near}, far ${far}`);
});

test('a small family gets the kinds it can carry, and a family with nothing to ask gets none', () => {
  // Fifteen people in three generations, no houses and no birthplaces: parents, grandchildren, faces and birth order remain.
  const small = family(3, { places: false, houses: 0 });
  assert.ok(small.people.length <= 15);
  const kinds = new Set<string>();
  for (let d = 0; d < 120; d++) {
    const q = drawQuiz(input(small, dayAt(d)));
    assert.ok(q, `day ${d}`);
    kinds.add(q.kind);
    assert.ok(q.question.options.length >= 3);
  }
  assert.ok(!kinds.has('shield') && !kinds.has('birthplace'));
  assert.ok(kinds.size >= 2);

  const couple = family(1, { places: false, houses: 0 });
  for (const p of couple.people) { p.born = undefined; p.living = true; }
  assert.equal(drawQuiz(input(couple, dayAt(1))), null);
  assert.equal(drawQuiz(input({ ...couple, people: [], unions: [] }, dayAt(1))), null);
});

test('a large family is drawn quickly', () => {
  const big = family(10);
  assert.ok(big.people.length > 1000);
  const t0 = performance.now();
  for (let d = 0; d < 20; d++) assert.ok(drawQuiz(input(big, dayAt(d))));
  assert.ok(performance.now() - t0 < 4000, 'twenty days for a thousand people in a few seconds');
});

test('a choice is an option’s number, or for the order every option once', () => {
  const four = { kind: 'birthplace' as const, options: [{ place: 'a' }, { place: 'b' }, { place: 'c' }, { place: 'd' }] };
  assert.ok(validChoice(four, '3'));
  for (const bad of ['4', '-1', '', '1,2', 'x', '01']) assert.ok(!validChoice(four, bad), bad);
  const order = { kind: 'order' as const, options: [{ people: ['a'] }, { people: ['b'] }, { people: ['c'] }] };
  assert.ok(validChoice(order, '2,0,1'));
  for (const bad of ['0,1', '0,0,1', '0,1,3', '1', '0,1,2,0']) assert.ok(!validChoice(order, bad), bad);
});
