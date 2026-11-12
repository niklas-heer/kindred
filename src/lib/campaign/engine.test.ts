// node --test src/lib/campaign/engine.test.ts — the Campaign's rules: the continent is one piece of land and the same for
// the same seed, every province can be reached, every name is invented and none is a real place's, the terrain is dealt
// by the lie of the land and each kind keeps its one rule, a river or the sea shortens a battle and a ridge stops it, the
// odds an attack shows are exact, moves are refused when the rules say so and never change the position they were given,
// regents play only by the rules, a reign's moves replay to the same score and a forged list is refused, a reign has a
// chronicle and a title, and a reign between regents stays open to the end.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TITLES, chronicleOf, highlights, seasonOf } from './chronicle.ts';
import {
  CampaignError, MAP_H, MAP_W, RULES, RULESET, adjacent, battle, capOf, crossingOf, groundOf, levyOf, neighbours, openReign, orderTroops, play, provincesOf, regentMoves,
  roundsOn, rulesetOf, sendable,
  regentTurn, replay, scoreOf, setupField, standings, terrainOf, troopsOf, winChance,
  type GameMap, type Ground, type Move, type Reign, type State, type Terrain,
} from './engine.ts';
import { allowed } from './names.ts';
import { RENOWN_STEPS, renownOf } from './renown.ts';

const SIDES = ['ash', 'birch', 'cedar', 'dale'];
const SEEDS = Array.from({ length: 40 }, (_, i) => `land${i}`);
const on = (terrain: Terrain, crossing: Ground['crossing'] = null): Ground => ({ terrain, crossing });
const reignOf = (seed = 's1', extra: Partial<Reign> = {}) => {
  const field = setupField(SIDES, seed);
  const reign: Reign = { map: field.map, sides: SIDES, player: 'ash', seed, renown: 0, grant: 0, ...extra };
  return { field, reign, state: openReign(field.start, reign) };
};
const refused = (code: string) => (e: unknown) => e instanceof CampaignError && e.code === code && e.message === `campaign.err.${code}`;
/** How many provinces can be reached from the first over these pairs. */
const reached = (count: number, pairs: [number, number][]) => {
  const seen = new Set([0]);
  const queue = [0];
  while (queue.length) {
    const at = queue.pop()!;
    for (const [a, b] of pairs) {
      const next = a === at ? b : b === at ? a : -1;
      if (next >= 0 && !seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return count === 0 ? 0 : seen.size;
};
/** The pairs of provinces whose land touches along an edge: both outlines walk the same two corners, in opposite ways. */
const touching = (map: GameMap): [number, number][] => {
  const edges = new Map<string, number>();
  for (const p of map.provinces) p.cell.forEach((c, i) => edges.set(`${c}>${p.cell[(i + 1) % p.cell.length]}`, p.id));
  const pairs = new Set<string>();
  for (const [edge, id] of edges) {
    const [from, to] = edge.split('>');
    const other = edges.get(`${to}>${from}`);
    if (other !== undefined && other > id) pairs.add(`${id}:${other}`);
  }
  return [...pairs].map((k) => k.split(':').map(Number) as [number, number]);
};
/** A position nobody could have reached by a move is a bug: every province held with at least one troop, none over its cap. */
const sound = (state: State, map: GameMap) => state.holder.length === map.provinces.length && state.troops.every((t, i) => Number.isInteger(t) && t >= 1 && t <= capOf(map, i));
/** A whole reign with a regent playing the player's side too. */
const regentReign = (seed: string, extra: Partial<Reign> = {}) => {
  const { field, reign, state } = reignOf(seed, extra);
  let s = state;
  const moves: Move[] = [];
  const leaders: string[] = [];
  while (s.turn < RULES.TURNS) {
    for (const m of regentMoves(s, reign)) { s = play(s, reign, m).state; moves.push(m); }
    leaders.push(standings(s, SIDES)[0].side);
  }
  return { field, reign, state: s, moves, leaders };
};

test('a field is an invented continent of sixteen provinces under today’s rules, and the same seed gives the same field', () => {
  const a = setupField(SIDES, 'seed');
  assert.deepEqual(a, setupField(SIDES, 'seed'));
  assert.notDeepEqual(a.map.provinces.map((p) => p.cell), setupField(SIDES, 'other').map.provinces.map((p) => p.cell));
  assert.notEqual(a.map.name, setupField(SIDES, 'other').map.name);
  assert.equal(a.map.provinces.length, RULES.PROVINCES);
  assert.equal(a.map.v, RULESET);
  assert.equal(rulesetOf(a.map), RULESET);
  assert.equal(rulesetOf({ provinces: [], borders: [] } as GameMap), 1, 'a map from before there were versions');
  // The field is the week's and nobody's own: it holds a house only as the id it was given, and nothing else of a family.
  assert.deepEqual(setupField(['w', 'x', 'y', 'z'], 'seed').map, a.map, 'the continent comes from the seed alone');
});

test('the land is one piece, every province can be reached, and every banner and border lies inside the sheet', () => {
  for (const seed of SEEDS) {
    const { map } = setupField(SIDES, seed);
    const n = map.provinces.length;
    assert.equal(reached(n, touching(map)), n, `${seed}: the land is one piece`);
    assert.equal(reached(n, map.borders), n, `${seed}: every province can be reached`);
    for (const p of map.provinces) {
      assert.ok(p.x > 30 && p.x < MAP_W - 30 && p.y > 30 && p.y < MAP_H - 30, `${seed}: ${p.name}'s banner is on the sheet`);
      assert.ok(p.cell.length >= 12, 'every province has land to stand on');
      for (const [x, y] of p.cell) assert.ok(Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x <= MAP_W && y >= 0 && y <= MAP_H);
      assert.ok(neighbours(map, p.id).length >= 2, `${seed}: ${p.name} has two ways out`);
    }
    for (const [x, y] of map.borders) assert.ok(x < y && adjacent(map, x, y) && adjacent(map, y, x));
    assert.equal(new Set(map.borders.map(([x, y]) => `${x}:${y}`)).size, map.borders.length, 'no border twice');
  }
});

test('rivers run along borders one can cross, ridges close a border, and a sea lane joins harbours the land keeps apart', () => {
  let rivers = 0, ridges = 0, lanes = 0;
  for (const seed of SEEDS) {
    const { map } = setupField(SIDES, seed);
    const land = touching(map);
    const lands = (a: number, b: number) => land.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
    for (const river of map.rivers ?? []) {
      rivers++;
      assert.ok(river.between.length >= 1 && river.line.length >= 2);
      for (const [a, b] of river.between) {
        assert.ok(lands(a, b) && adjacent(map, a, b), 'a river runs between two neighbours');
        assert.equal(crossingOf(map, a, b), 'river');
        assert.equal(crossingOf(map, b, a), 'river');
      }
    }
    for (const ridge of map.ridges ?? []) {
      ridges++;
      const [a, b] = ridge.between;
      assert.ok(lands(a, b), 'a ridge stands on a border');
      assert.ok(!adjacent(map, a, b), 'and nobody crosses it');
      assert.ok(ridge.line.length >= 3);
    }
    for (const lane of map.lanes ?? []) {
      lanes++;
      const [a, b] = lane.between;
      assert.ok(!lands(a, b) && adjacent(map, a, b), 'a lane joins two provinces that do not touch');
      assert.ok(map.provinces[a].coast && map.provinces[b].coast, 'both are on the sea');
      assert.equal(crossingOf(map, a, b), 'sea');
      assert.equal(lane.line.length, 3);
    }
    assert.ok((map.rivers ?? []).length >= 1, `${seed} has a river`);
  }
  assert.ok(rivers >= SEEDS.length && ridges >= SEEDS.length && lanes >= SEEDS.length * 0.8, `rivers ${rivers}, ridges ${ridges}, lanes ${lanes}`);
});

test('every name on a map is invented: unique, of the generator’s making, and no two provinces begin alike', () => {
  // The names themselves are compared with known names, real places and rude words in ./names.test.ts.
  const dealt = new Set<string>();
  for (const seed of SEEDS) {
    const { map } = setupField(SIDES, seed);
    const names = [map.name!, ...map.provinces.map((p) => p.name), ...(map.seas ?? []).map((s) => s.name)];
    assert.equal(new Set(names).size, names.length, `${seed}: every name once`);
    for (const name of names) {
      assert.ok(name.length >= 7 && name.length <= 16, name);
      assert.ok(allowed(name), `${name} may be dealt`);
      dealt.add(name);
    }
    assert.match(map.name!, /^[A-Z][a-z]+$/);
    // A province carries what it is after a hyphen, and no two of a map begin alike.
    for (const p of map.provinces) assert.match(p.name, /^[A-Z][a-z]+-[a-z]+$/);
    const heads = map.provinces.map((p) => p.name.slice(0, 5));
    assert.equal(new Set(heads).size, heads.length, `${seed}: ${heads.join(' ')}`);
  }
  assert.ok(dealt.size > SEEDS.length * 10, 'the maps differ in their names');
});

test('renown is a share of the house’s own people, so a small house recorded with care outshines a large one that is not', () => {
  const none = renownOf({ people: 0, portraits: 0, dated: 0, placed: 0, memories: 0, events: 0, sources: 0 });
  assert.equal(none.score, 0);
  assert.equal(none.bonus, 0);
  const small = renownOf({ people: 5, portraits: 5, dated: 5, placed: 5, memories: 5, events: 5, sources: 5 });
  assert.equal(small.score, 100);
  assert.equal(small.bonus, RULES.RENOWN_MAX_BONUS);
  assert.equal(small.toNext, null);
  assert.deepEqual(small.tips, []);
  const large = renownOf({ people: 50, portraits: 2, dated: 30, placed: 10, memories: 4, events: 0, sources: 0 });
  assert.ok(large.score < small.score);
  assert.equal(large.bonus, large.score >= RENOWN_STEPS[1] ? 2 : large.score >= RENOWN_STEPS[0] ? 1 : 0);
  assert.equal(large.tips[0], 'portraits', 'the first tip is where the most points are still to be had');
  assert.equal(large.toNext, RENOWN_STEPS[large.bonus] - large.score);
  // More than one memory each does not count twice.
  assert.equal(renownOf({ people: 2, portraits: 0, dated: 0, placed: 0, memories: 40, events: 0, sources: 0 }).score, 20);
});

test('every side opens with a seat and a neighbouring province; the player’s first levy waits with three orders', () => {
  const { field, reign, state } = reignOf();
  assert.equal(new Set(Object.values(state.seats)).size, SIDES.length);
  for (const side of SIDES) {
    assert.equal(state.holder[state.seats[side]], side);
    assert.ok(provincesOf(state, side) >= 1 && provincesOf(state, side) <= 2);
  }
  assert.equal(state.turn, 0);
  assert.equal(state.orders, RULES.ORDERS_PER_TURN);
  assert.equal(state.pool.ash, levyOf(state, field.map, 'ash').total);
  assert.equal(state.pool.birch, undefined, 'a regent’s levy arrives in its own turn');
  assert.ok(sound(state, field.map));
  assert.deepEqual(field.start.pool, {}, 'the opening itself is shared by every player and holds no levy');
  // The quiz's reward comes once, on the first turn.
  assert.equal(openReign(field.start, { ...reign, grant: RULES.QUIZ_LEVY }).pool.ash, state.pool.ash + RULES.QUIZ_LEVY);
  // The seats stand apart: no two houses begin as neighbours' capitals on most fields.
  let apart = 0;
  for (const seed of SEEDS) {
    const { map, start } = setupField(SIDES, seed);
    const seats = Object.values(start.seats);
    assert.equal(new Set(seats).size, SIDES.length);
    assert.ok(sound(start, map), `${seed}: the opening fits every garrison`);
    if (seats.every((a) => seats.every((b) => a === b || !adjacent(map, a, b)))) apart++;
  }
  assert.ok(apart >= SEEDS.length * 0.8, `${apart} of ${SEEDS.length} fields keep the seats apart`);
});

test('terrain: every seat is a town with two free towns beside them, and highland, marsh and forest are dealt by the lie of the land', () => {
  for (const seed of SEEDS) {
    const { map, start } = setupField(SIDES, seed);
    const seats = Object.values(start.seats);
    for (const seat of seats) assert.equal(terrainOf(map, seat), 'town');
    const count = (kind: Terrain) => map.provinces.filter((p) => p.terrain === kind).length;
    assert.equal(count('town'), SIDES.length + RULES.FREE_TOWNS);
    assert.equal(count('highland'), RULES.HIGHLANDS);
    assert.equal(count('marsh'), RULES.MARSHES);
    assert.equal(count('forest'), RULES.FORESTS);
    assert.equal(count('plains'), RULES.PROVINCES - SIDES.length - RULES.FREE_TOWNS - RULES.HIGHLANDS - RULES.MARSHES - RULES.FORESTS);
    // A marsh lies by the water: on the coast or on a river.
    for (const p of map.provinces.filter((q) => q.terrain === 'marsh')) {
      assert.ok(p.coast || (map.rivers ?? []).some((r) => r.between.some((b) => b.includes(p.id))), `${seed}: ${p.name} is by the water`);
      assert.equal(capOf(map, p.id), RULES.MARSH_GARRISON_MAX);
    }
    // A free town is nobody's at the opening, and no seat's neighbour where the land allows.
    for (const p of map.provinces.filter((q) => q.terrain === 'town' && !seats.includes(q.id))) assert.equal(start.holder[p.id] === null || provincesOf(start, start.holder[p.id]!) === 2, true);
  }
  // A map stored before there was terrain reads as plains everywhere.
  const old = setupField(SIDES, 'old').map;
  for (const p of old.provinces) delete p.terrain;
  assert.equal(terrainOf(old, 3), 'plains');
  assert.equal(capOf(old, 3), RULES.GARRISON_MAX);
});

test('the dice follow Risk: three against two at most, the highest compared, ties to the defender, three rounds at most', () => {
  for (let i = 0; i < 200; i++) {
    const b = battle(6, 5, `dice${i}`);
    assert.deepEqual(b, battle(6, 5, `dice${i}`), 'the same seed rolls the same dice');
    assert.ok(b.rounds.length >= 1 && b.rounds.length <= RULES.BATTLE_ROUNDS);
    for (const r of b.rounds) {
      assert.ok(r.a.length <= 3 && r.d.length <= 2);
      assert.equal(r.aLost + r.dLost, Math.min(r.a.length, r.d.length));
      const pairs = Math.min(r.a.length, r.d.length);
      let dLost = 0;
      for (let k = 0; k < pairs; k++) if (r.a[k] > r.d[k]) dLost++;
      assert.equal(r.dLost, dLost, 'the highest are compared, and a tie goes to the defender');
    }
    assert.equal(b.aLost, b.rounds.reduce((n, r) => n + r.aLost, 0));
  }
});

test('forest raises the defender’s highest die by one, highland lets the attacker roll two dice at most', () => {
  for (let i = 0; i < 200; i++) {
    const plain = battle(5, 3, `t${i}`);
    const forest = battle(5, 3, `t${i}`, on('forest'));
    // The first round is rolled from the same numbers: only the defender's best die differs.
    assert.deepEqual(forest.rounds[0].a, plain.rounds[0].a);
    assert.equal(forest.rounds[0].d[0], Math.min(6, plain.rounds[0].d[0] + 1));
    assert.equal(forest.rounds[0].d[1], plain.rounds[0].d[1]);
    for (const r of battle(6, 4, `h${i}`, on('highland')).rounds) assert.ok(r.a.length <= 2);
    for (const r of battle(2, 4, `h${i}`, on('town')).rounds) assert.ok(r.a.length <= 2 && r.d.length <= 2);
  }
});

test('winChance is exact: one die against one, and the terrain’s rule in the odds', () => {
  assert.equal(winChance(1, 1), 15 / 36);
  assert.equal(winChance(1, 1, on('highland')), 15 / 36, 'one die is one die');
  assert.equal(winChance(1, 1, on('forest')), 10 / 36);
  assert.equal(winChance(0, 3), 0);
  assert.equal(winChance(3, 0), 1);
  // Three rounds remove at most six defenders.
  assert.equal(winChance(12, 7), 0);
  for (const terrain of ['plains', 'forest', 'highland', 'marsh', 'town'] as const) {
    for (let d = 1; d <= 5; d++) {
      for (let a = 1; a < 10; a++) assert.ok(winChance(a + 1, d, on(terrain)) >= winChance(a, d, on(terrain)) - 1e-12, 'more attackers never lower the chance');
    }
  }
  assert.ok(winChance(4, 2, on('forest')) < winChance(4, 2));
  assert.ok(winChance(4, 2, on('highland')) < winChance(4, 2));
  assert.equal(winChance(4, 2, on('town')), winChance(4, 2), 'a town has no battle rule');
  assert.equal(winChance(4, 2, on('marsh')), winChance(4, 2), 'nor has a marsh: it only holds fewer');
  // The exact number agrees with the dice themselves.
  for (const [a, d, terrain] of [[4, 2, 'forest'], [5, 3, 'highland'], [3, 2, 'plains']] as const) {
    let took = 0;
    const n = 6000;
    for (let i = 0; i < n; i++) if (battle(a, d, `mc${i}`, on(terrain)).dLost >= d) took++;
    assert.ok(Math.abs(took / n - winChance(a, d, on(terrain))) < 0.025, `${a} against ${d} in ${terrain}: ${took / n} vs ${winChance(a, d, on(terrain))}`);
  }
});

test('a river or the sea shortens the battle to two rounds, and the odds say so', () => {
  assert.equal(roundsOn(on('plains')), RULES.BATTLE_ROUNDS);
  assert.equal(roundsOn(on('plains', 'river')), RULES.CROSSING_ROUNDS);
  assert.equal(roundsOn(on('forest', 'sea')), RULES.CROSSING_ROUNDS);
  for (let i = 0; i < 200; i++) {
    const across = battle(9, 6, `x${i}`, on('plains', 'river'));
    assert.ok(across.rounds.length <= RULES.CROSSING_ROUNDS);
    // The rounds that are fought are the same dice as on open ground.
    assert.deepEqual(across.rounds, battle(9, 6, `x${i}`).rounds.slice(0, across.rounds.length));
  }
  assert.ok(winChance(5, 3, on('plains', 'river')) < winChance(5, 3));
  assert.equal(winChance(5, 3, on('plains', 'river')), winChance(5, 3, on('plains', 'sea')), 'the river and the sea cost the same round');
  assert.equal(winChance(9, 5, on('plains', 'river')), 0, 'two rounds remove at most four defenders');
  assert.ok(winChance(9, 4, on('forest', 'river')) < winChance(9, 4, on('plains', 'river')), 'the terrain’s own rule still counts');
  let took = 0;
  const n = 6000;
  for (let i = 0; i < n; i++) if (battle(5, 3, `rv${i}`, on('highland', 'river')).dLost >= 3) took++;
  assert.ok(Math.abs(took / n - winChance(5, 3, on('highland', 'river'))) < 0.025);
});

test('a march and an attack go only where there is a way: over a border, across a river or by a sea lane, never over a ridge', () => {
  let ridged = 0, sailed = 0;
  for (const seed of SEEDS.slice(0, 20)) {
    const { reign, state } = reignOf(seed);
    const { map } = reign;
    const rich = (from: number, to: number): State => ({ ...state, holder: state.holder.map((h, i) => (i === from ? 'ash' : i === to ? null : h)), troops: state.troops.map((t, i) => (i === from ? 6 : i === to ? 1 : t)), seats: { ash: from } });
    for (const ridge of map.ridges ?? []) {
      const [a, b] = ridge.between;
      assert.throws(() => play(rich(a, b), reign, { t: 'attack', from: a, to: b, troops: 3 }), refused('not_adjacent'));
      ridged++;
    }
    for (const lane of map.lanes ?? []) {
      const [a, b] = lane.between;
      const e = play(rich(a, b), reign, { t: 'attack', from: a, to: b, troops: 5 }).events[0];
      assert.ok(e.t === 'attack' && e.crossing === 'sea' && e.rounds.length <= RULES.CROSSING_ROUNDS);
      // One's own harbour across the water can be marched to.
      const own = rich(a, b);
      own.holder[b] = 'ash';
      assert.equal(play(own, reign, { t: 'march', from: a, to: b, troops: 2 }).state.troops[b], 3);
      sailed++;
    }
    for (const river of map.rivers ?? []) {
      const [a, b] = river.between[0];
      const e = play(rich(a, b), reign, { t: 'attack', from: a, to: b, troops: 5 }).events[0];
      assert.ok(e.t === 'attack' && e.crossing === 'river');
    }
  }
  assert.ok(ridged > 0 && sailed > 0);
});

test('placing the levy costs no order, needs levy, a province of one’s own and room in it; a town holds more', () => {
  const { reign, state } = reignOf('place');
  const seat = state.seats.ash;
  const placed = play(state, reign, { t: 'place', to: seat }).state;
  assert.equal(placed.troops[seat], state.troops[seat] + 1);
  assert.equal(placed.pool.ash, state.pool.ash - 1);
  assert.equal(placed.orders, RULES.ORDERS_PER_TURN);
  assert.equal(capOf(reign.map, seat), RULES.TOWN_GARRISON_MAX);
  const other = state.holder.findIndex((h) => h !== 'ash');
  assert.throws(() => play(state, reign, { t: 'place', to: other }), refused('not_yours'));
  assert.throws(() => play({ ...state, pool: { ash: 0 } }, reign, { t: 'place', to: seat }), refused('no_levy'));
  assert.throws(() => play({ ...state, troops: state.troops.map((t, i) => (i === seat ? RULES.TOWN_GARRISON_MAX : t)) }, reign, { t: 'place', to: seat }), refused('full'));
  assert.throws(() => play(state, reign, { t: 'place', to: 99 }), refused('no_province'));
});

test('marches and attacks take one of three orders a turn; one troop stays behind; seats and far provinces are refused', () => {
  const { reign, state } = reignOf('orders');
  const map = reign.map;
  const seat = state.seats.ash;
  const own = neighbours(map, seat).find((n) => state.holder[n] === 'ash')!;
  const rich = { ...state, troops: state.troops.map((t, i) => (i === seat ? 9 : t)) };
  let s = rich;
  for (let k = 0; k < RULES.ORDERS_PER_TURN; k++) s = play(s, reign, { t: 'march', from: seat, to: own, troops: 1 }).state;
  assert.equal(s.orders, 0);
  assert.equal(s.troops[own], rich.troops[own] + 3);
  assert.throws(() => play(s, reign, { t: 'march', from: seat, to: own, troops: 1 }), refused('no_orders'));
  assert.throws(() => play(rich, reign, { t: 'march', from: seat, to: own, troops: 9 }), refused('stay_one'));
  assert.throws(() => play(rich, reign, { t: 'attack', from: seat, to: own, troops: 2 }), refused('own_province'));
  const far = map.provinces.find((p) => p.id !== seat && !adjacent(map, seat, p.id))!.id;
  assert.throws(() => play(rich, reign, { t: 'attack', from: seat, to: far, troops: 2 }), refused('not_adjacent'));
  // Another house's seat next door is locked.
  const next = neighbours(map, seat).find((n) => n !== own)!;
  const beside = { ...rich, holder: rich.holder.map((h, i) => (i === next ? 'birch' : h)), seats: { ...rich.seats, birch: next } };
  assert.throws(() => play(beside, reign, { t: 'attack', from: seat, to: next, troops: 2 }), refused('seat'));
  // A refused move changes nothing it was given.
  assert.deepEqual(rich, { ...state, troops: state.troops.map((t, i) => (i === seat ? 9 : t)) });
  assert.throws(() => play({ ...state, turn: RULES.TURNS }, reign, { t: 'end' }), refused('over'));
});

test('an attack is fought with the troops sent and counted: survivors move in, losses and wins are kept for the score', () => {
  const { reign, state } = reignOf('attack');
  const map = reign.map;
  const seat = state.seats.ash;
  const free = neighbours(map, seat).find((n) => state.holder[n] === null)!;
  let won = 0, held = 0;
  for (let i = 0; i < 60; i++) {
    const strong = { ...state, attacks: i, troops: state.troops.map((t, k) => (k === seat ? 8 : t)) };
    const { state: after, events } = play(strong, reign, { t: 'attack', from: seat, to: free, troops: 5 });
    const e = events[0];
    assert.ok(e.t === 'attack');
    if (e.t !== 'attack') continue;
    assert.equal(e.terrain, terrainOf(map, free));
    assert.deepEqual({ rounds: e.rounds, aLost: e.aLost, dLost: e.dLost }, battle(5, strong.troops[free], `${reign.seed}:t0:p${i}`, groundOf(map, seat, free)), 'the dice are the reign’s, numbered by attack');
    assert.equal(e.chance, winChance(5, strong.troops[free], groundOf(map, seat, free)), 'the event says what the chance was');
    assert.deepEqual([e.fromLeft, e.toLeft], [after.troops[seat], after.troops[free]], 'and what is left on both sides');
    assert.equal(after.attacks, i + 1);
    assert.equal(after.lost.ash ?? 0, e.aLost);
    if (e.took) {
      won++;
      assert.equal(after.holder[free], 'ash');
      assert.equal(after.troops[free], 5 - e.aLost);
      assert.equal(after.won.ash, 1);
    } else {
      held++;
      assert.equal(after.holder[free], null);
      assert.equal(after.troops[seat], 8 - e.aLost);
      assert.equal(after.won.ash ?? 0, 0);
    }
    assert.ok(sound(after, map));
  }
  assert.ok(won > 0 && held > 0, 'both outcomes happen');
});

test('the levy is the base, one for each town held, and renown up to two', () => {
  const { reign, state } = reignOf('levy');
  const map = reign.map;
  const towns = state.holder.filter((h, i) => h === 'ash' && terrainOf(map, i) === 'town').length;
  assert.deepEqual(levyOf(state, map, 'ash', 0), { base: RULES.BASE_LEVY, towns, renown: 0, grant: 0, total: RULES.BASE_LEVY + towns });
  assert.equal(levyOf(state, map, 'ash', 9).renown, RULES.RENOWN_MAX_BONUS);
  const town = map.provinces.find((p) => p.terrain === 'town' && state.holder[p.id] === null);
  if (town) assert.equal(levyOf({ ...state, holder: state.holder.map((h, i) => (i === town.id ? 'ash' : h)) }, map, 'ash').towns, towns + 1);
});

test('ending the turn lets every regent play by the rules, then the next turn’s levy and orders arrive', () => {
  const { reign, state } = reignOf('end', { renown: 2 });
  const after = play(state, reign, { t: 'end' });
  assert.deepEqual(after, play(state, reign, { t: 'end' }), 'the same turn ends the same way');
  assert.equal(after.state.turn, 1);
  assert.equal(after.state.orders, RULES.ORDERS_PER_TURN);
  assert.ok(after.events.every((e) => e.side !== 'ash'), 'the regents play only their own sides');
  assert.ok(after.state.pool.ash >= state.pool.ash + RULES.BASE_LEVY + 2, 'unplaced levy is kept, and renown adds to the next');
  assert.ok(sound(after.state, reign.map));
  for (const side of ['birch', 'cedar', 'dale']) {
    const r = regentTurn(state, reign, side);
    assert.deepEqual(r, regentTurn(state, reign, side));
    assert.ok(r.events.length <= RULES.ORDERS_PER_TURN);
    assert.ok(r.events.filter((e) => e.t === 'attack').length <= RULES.REGENT_ATTACKS);
  }
});

test('the score: ten a province, twenty a town, two a battle won, one off for each troop lost', () => {
  const { reign, state } = reignOf('score');
  const map = reign.map;
  const s = { ...state, holder: state.holder.map((h, i) => (i < 6 ? 'ash' : h === 'ash' ? 'birch' : h)), won: { ash: 4 }, lost: { ash: 7 } };
  const towns = s.holder.filter((h, i) => h === 'ash' && terrainOf(map, i) === 'town').length;
  assert.deepEqual(scoreOf(s, map, 'ash'), { provinces: 6, towns, won: 4, lost: 7, total: (6 - towns) * 10 + towns * 20 + 8 - 7 });
  assert.equal(scoreOf({ ...s, lost: { ash: 999 } }, map, 'ash').total, 0, 'never below nothing');
});

test('a reign replays to the same position and score; the moves after its end, a forged move and an unfinished list are refused', () => {
  const { field, reign, state, moves } = regentReign('replay');
  assert.equal(state.turn, RULES.TURNS);
  assert.equal(moves.filter((m) => m.t === 'end').length, RULES.TURNS);
  const once = replay(field.start, reign, moves);
  assert.deepEqual(once.state, state);
  assert.deepEqual(once, replay(field.start, reign, moves), 'the same moves, the same score');
  assert.deepEqual(once.score, scoreOf(state, reign.map, 'ash'));
  assert.throws(() => replay(field.start, reign, [...moves, { t: 'end' }]), refused('over'));
  assert.throws(() => replay(field.start, reign, moves.slice(0, -1)), refused('unfinished'));
  assert.throws(() => replay(field.start, reign, Array.from({ length: RULES.MAX_MOVES + 1 }, () => ({ t: 'end' }) as Move)), refused('too_long'));
  // A fourth order in the first turn, a troop placed on a province of another house, or a march to nowhere.
  const seat = field.start.seats.ash;
  const own = neighbours(reign.map, seat).find((n) => field.start.holder[n] === 'ash')!;
  assert.throws(() => replay(field.start, reign, [...Array.from({ length: 4 }, () => ({ t: 'march', from: seat, to: own, troops: 1 }) as Move), ...moves]), (e: unknown) => e instanceof CampaignError);
  assert.throws(() => replay(field.start, reign, [{ t: 'place', to: field.start.seats.birch }, ...moves]), refused('not_yours'));
  assert.throws(() => replay(field.start, reign, [{ t: 'march', from: seat, to: 999, troops: 1 }, ...moves]), refused('no_province'));
  assert.throws(() => replay(field.start, reign, [{ t: 'fly' } as unknown as Move, ...moves]), refused('no_province'));
  // Renown is part of the reign: the same moves with more of it end elsewhere, so the server replays with what it stored.
  const idle = Array.from({ length: RULES.TURNS }, () => ({ t: 'end' }) as Move);
  assert.notDeepEqual(replay(field.start, { ...reign, renown: 2 }, idle).state.pool, replay(field.start, reign, idle).state.pool);
});

test('a reign has a chronicle: the provinces held turn by turn, what is worth telling, and a title; the same moves tell the same', () => {
  const titles = new Set<string>();
  for (let i = 0; i < 30; i++) {
    const { field, reign, state, moves } = regentReign(`tale${i}`, { player: SIDES[i % 4], renown: i % 3 });
    const told = chronicleOf(field.start, reign, moves);
    assert.deepEqual(told, chronicleOf(field.start, reign, moves));
    assert.deepEqual(told.score, replay(field.start, reign, moves).score, 'the chronicle’s score is the reign’s');
    assert.deepEqual(told.state, state);
    assert.equal(told.held.length, RULES.TURNS + 1);
    assert.equal(told.held[0], provincesOf(field.start, reign.player));
    assert.equal(told.held.at(-1), told.score.provinces);
    assert.ok((TITLES as readonly string[]).includes(told.title));
    titles.add(told.title);
    assert.equal(told.deeds.taken, told.tellings.filter((t) => t.kind === 'took').length);
    assert.equal(told.deeds.lost, told.tellings.filter((t) => t.kind === 'lost').length);
    assert.ok(told.deeds.taken <= told.deeds.attacks);
    const few = highlights(told, 5);
    assert.ok(few.length <= 5 && few.every((t) => told.tellings.includes(t)));
    assert.deepEqual(few.map((t) => told.tellings.indexOf(t)), few.map((t) => told.tellings.indexOf(t)).sort((x, y) => x - y), 'in the order they happened');
  }
  assert.ok(titles.size >= 3, `the titles differ: ${[...titles].join(', ')}`);
  // A reign in which nothing is ordered is a peaceable one, told as far as it goes.
  const { field, reign } = reignOf('quiet');
  const idle = chronicleOf(field.start, reign, Array.from({ length: 5 }, () => ({ t: 'end' }) as Move));
  assert.equal(idle.held.length, 6);
  assert.equal(idle.deeds.attacks, 0);
  assert.deepEqual([seasonOf(0), seasonOf(3), seasonOf(4), seasonOf(11)], [{ season: 'spring', year: 1 }, { season: 'winter', year: 1 }, { season: 'spring', year: 2 }, { season: 'winter', year: 3 }]);
});

test('a reign between regents: no seat falls, scores spread, and the lead can still change on the last turn', () => {
  const scores: number[] = [];
  const bySide = new Map<string, number[]>();
  let lastTurnChanges = 0, changes = 0;
  const runs = 80;
  for (let i = 0; i < runs; i++) {
    const { state, reign, leaders } = regentReign(`season${i}`, { player: SIDES[i % 4], renown: 1 });
    for (const side of SIDES) assert.equal(state.holder[state.seats[side]], side, 'a seat never falls');
    assert.ok(sound(state, reign.map));
    const table = standings(state, SIDES);
    assert.ok(table.at(-1)!.provinces >= 1, 'nobody is out');
    assert.ok(table[0].provinces <= 12, 'nobody runs away with the whole map');
    const total = scoreOf(state, reign.map, reign.player).total;
    scores.push(total);
    bySide.set(reign.player, [...(bySide.get(reign.player) ?? []), total]);
    if (leaders.at(-1) !== leaders.at(-2)) lastTurnChanges++;
    for (let k = 1; k < leaders.length; k++) if (leaders[k] !== leaders[k - 1]) changes++;
    assert.ok(troopsOf(state, reign.player) >= 1);
  }
  scores.sort((a, b) => a - b);
  const at = (f: number) => scores[Math.floor(f * (scores.length - 1))];
  assert.ok(at(0.9) - at(0.1) >= 30, `scores spread from ${at(0.1)} to ${at(0.9)}`);
  assert.ok(lastTurnChanges > 0, 'some reigns are decided only on the last turn');
  assert.ok(changes / runs >= 1.5, `the lead changes ${(changes / runs).toFixed(1)} times a reign`);
  // No place at the table is the lucky one: every side's mean is within reach of the others'.
  const means = [...bySide.values()].map((list) => list.reduce((n, v) => n + v, 0) / list.length);
  assert.ok(Math.max(...means) - Math.min(...means) < 30, `the sides' means are ${means.map((m) => m.toFixed(0)).join(', ')}`);
  if (process.env.CAMPAIGN_STATS) console.log({ median: at(0.5), p10: at(0.1), p90: at(0.9), lastTurnChanges: lastTurnChanges / runs, changes: changes / runs, means });
});

test('an order chosen before an undo is clamped to what the position now spares, so it is never refused', () => {
  const { reign, state } = reignOf('undo-clamp');
  const p = reign.player;
  // A province of one's own next to one that can be attacked (not a seat), and room for two more troops.
  const from = state.holder.findIndex((h, i) => h === p && state.troops[i] + 2 <= capOf(reign.map, i)
    && neighbours(reign.map, i).some((n) => state.holder[n] !== p && !Object.values(state.seats).includes(n)));
  assert.ok(from >= 0, 'the field has such a province');
  const to = neighbours(reign.map, from).find((n) => state.holder[n] !== p && !Object.values(state.seats).includes(n))!;
  assert.ok((state.pool[p] ?? 0) >= 2, 'levy to place');
  // At least two troops before, one more placed after: "All" is chosen on the larger garrison, then that troop is taken back.
  let before = state;
  while (before.troops[from] < 2) before = play(before, reign, { t: 'place', to: from }).state;
  const after = play(before, reign, { t: 'place', to: from }).state;
  const all = sendable(after, reign.map, p, from, to);
  assert.equal(all, after.troops[from] - 1);
  assert.throws(() => play(before, reign, { t: 'attack', from, to, troops: all }), refused('stay_one'));
  const sent = orderTroops(all, before, reign.map, p, from, to);
  assert.equal(sent, before.troops[from] - 1);
  assert.doesNotThrow(() => play(before, reign, { t: 'attack', from, to, troops: sent }));
  assert.equal(orderTroops(0, after, reign.map, p, from, to), 1, 'never fewer than one');
});
