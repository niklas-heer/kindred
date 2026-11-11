// node --test src/lib/campaign/saved.test.ts — a week's reign kept in the tab: one per family and account, only for its
// week, and played again to the same position; a refused move ends the replay there.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RULES, play, regentMoves, setupField, type Move, type PlaceIn, type Reign, type State } from './engine.ts';
import { forgetReigns, loadReign, restore, saveReign, savedKey, type SavedReign } from './saved.ts';
import { rng } from './rng.ts';

const fakeStore = () => {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    map: m,
  };
};

const SIDES = ['ash', 'birch', 'cedar', 'dale'];
const places = (n: number): PlaceIn[] => { const r = rng('pl'); return Array.from({ length: n }, (_, i) => ({ name: `Place ${i}`, lat: 44 + r() * 8, lng: r() * 12, people: 100 - i })); };
const field = setupField(places(30), SIDES, 'week-seed');
const reign: Reign = { map: field.map, sides: SIDES, player: 'ash', seed: 'week-seed', renown: 0, grant: 0 };
const run = (id: string, week = '2026-W46') => ({ id, week, seed: 'week-seed', field: { map: field.map, sides: [], start: field.start }, side: 'ash', renown: 0, grant: 0 });
const saved = (id: string, moves: Move[] = [], week?: string): SavedReign => ({ run: run(id, week), submit: true, moves, opKey: `op-${id}` });

test('a kept reign comes back for its family, account and week only, and beginning another forgets it', () => {
  const s = fakeStore();
  saveReign(s, 'fam', 'acc1', saved('r1', [{ t: 'end' }]));
  assert.ok(s.map.has(savedKey('fam', 'acc1', 'r1')));
  assert.deepEqual(loadReign(s, 'fam', 'acc1', '2026-W46')?.moves, [{ t: 'end' }]);
  assert.equal(loadReign(s, 'fam', 'acc2', '2026-W46'), null, 'another account');
  assert.equal(loadReign(s, 'other', 'acc1', '2026-W46'), null, 'another family');
  saveReign(s, 'fam', 'acc1', saved('r2'));
  assert.equal(s.map.size, 1);
  assert.equal(loadReign(s, 'fam', 'acc1', '2026-W46')?.run.id, 'r2');
  assert.equal(loadReign(s, 'fam', 'acc1', '2026-W47'), null, 'a reign of last week is not resumed');
  assert.equal(s.map.size, 0, 'and is forgotten');
  saveReign(s, 'fam', 'acc1', saved('r3'));
  forgetReigns(s, 'fam', 'acc1');
  assert.equal(s.map.size, 0);
  assert.equal(loadReign(null, 'fam', 'acc1', '2026-W46'), null, 'no storage, nothing to resume');
});

test('kept moves play again to the same position, and a refused move ends the replay there', () => {
  let s: State = restore(reign, field.start, []).states[0];
  const moves: Move[] = [];
  for (let turn = 0; turn < 2; turn++) for (const m of regentMoves(s, reign)) { s = play(s, reign, m).state; moves.push(m); }
  const back = restore(reign, field.start, moves);
  assert.equal(back.states.length, moves.length + 1);
  assert.deepEqual(back.states.at(-1), s);
  assert.deepEqual(back.moves, moves);
  const cut = restore(reign, field.start, [...moves, { t: 'march', from: 0, to: 0, troops: 99 }, { t: 'end' }]);
  assert.deepEqual(cut.moves, moves);
  assert.equal(cut.states.at(-1)!.turn, 2);
  assert.ok(cut.states.at(-1)!.turn < RULES.TURNS);
});
