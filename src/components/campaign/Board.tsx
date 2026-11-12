// The board of a reign: the map (or the same provinces as a list), the turn's three steps, and the order bar.
//
// A turn has three steps: 1 Reinforce (each press on a province of one's own places one troop of the levy, which costs
// no order), 2 Orders (three marches or attacks), 3 End turn (the regents move, and their attacks are shown one by one).
//
// Choosing an order is a small state machine, the same on the map and in the list:
//   inspect  a press on any province shows what it is; nothing else happens.
//   select   a press on a province of one's own with troops to spare chooses it: a thick gold outline, everything it
//            cannot reach dims, and its neighbours are ringed (footprints for a march, swords and the chance for an
//            attack, a lock for a seat).
//   target   a press on a ringed neighbour draws the arrow and opens the order bar: how many troops, the exact chance
//            with what the ground does to it, and a button that says what will happen ("March 4", "Attack with 4").
//   confirm  only that button moves anything. Escape, Back or a press on the sea goes one step back; a press on another
//            province of one's own only chooses that one instead.
// Marches and placed troops can be undone until the turn ends (back to the last battle).
//
// What moves is shown as a scene: the troops travel as a token, a battle bursts where the armies meet and its dice are
// rolled in a dialog, and the regents' attacks follow one another the same way. While a scene plays the map shows the
// moment before (`hold`), and nothing can be ordered. The reign itself is already decided: the engine plays every move at
// once, and the scene only tells it. With "reduce motion" there are no scenes: the map shows what is, the battle's dice
// are all there, and the regents' attacks are listed.
import { Crown, Flag, List, Map as MapIcon, Minus, Plus, Sailboat, Sunrise, Swords, Undo2, X, Footprints, Lock, Tent, ChevronRight, Waves } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Arms } from '~/components/Heraldry';
import { Segmented } from '~/components/ui';
import { seasonOf } from '~/lib/campaign/chronicle';
import { CampaignError, RULES, capOf, capOn, crossingOf, groundOf, levyOf, neighbours, orderTroops, sendable, terrainOf, winChance, type Crossing, type GameEvent, type GameMap, type Move, type Reign, type Terrain } from '~/lib/campaign/engine';
import { useT, type Key } from '~/lib/i18n';
import { play as sound } from '~/lib/sfx';
import { toast } from '~/lib/toast';
import { errorText } from '~/lib/errortext';
import { BattleDialog } from './BattleDialog';
import { CampaignMap, GlyphIcon, TERRAIN_NAME, TERRAIN_RULE, TerrainIcon, type Flight, type Reach } from './CampaignMap';
import { SEASON_ICON, modifiers, reducedMotion, seasonLine, type BoardSide } from './parts';
import type { ReignGame } from './reign';

export { Laurel, type BoardSide } from './parts';

type Attack = Extract<GameEvent, { t: 'attack' }>;
type March = Extract<GameEvent, { t: 'march' }>;

type Choice =
  | { k: 'none' }
  | { k: 'inspect'; id: number }
  | { k: 'select'; from: number }
  | { k: 'target'; from: number; to: number; troops: number };

/** What is being shown just now: a march, the player's own attack, or the regents' attacks one after another. */
type Scene =
  | { k: 'march'; e: March }
  | { k: 'attack'; e: Attack; phase: 'fly' | 'clash' | 'dice' }
  | { k: 'regents'; events: Attack[]; at: number; phase: 'fly' | 'clash' | 'show'; turn: number };

interface Hold { holder: (string | null)[]; troops: number[] }

export interface BoardProps {
  reign: Reign;
  sides: BoardSide[];
  game: ReignGame;
  /** Where renown comes from: a link to Information needed, shown with the levy. */
  renownLink?: ReactNode;
}

const FLY_MS = 520;
const CLASH_MS = 430;
const SHOW_MS = 780;
const BANNER_MS = 1900;

export function Board({ reign, sides, game, renownLink }: BoardProps) {
  const t = useT();
  const { map, player } = reign;
  const { state } = game;
  const [view, setView] = useState<'map' | 'list'>('map');
  const [pick, setPick] = useState<Choice>({ k: 'none' });
  const [skipped, setSkipped] = useState(-1);
  const [scene, setScene] = useState<Scene | null>(null);
  const [hold, setHold] = useState<Hold | null>(null);
  // The turn's banner: shown for a moment when a turn begins.
  const [banner, setBanner] = useState<number | null>(null);
  const [report, setReport] = useState<{ turn: number; events: Attack[] } | null>(null);
  const seats = useMemo(() => new Set(Object.values(state.seats)), [state.seats]);
  const nameOf = (side: string | null) => (side ? sides.find((s) => s.id === side)?.name ?? side : t('campaign.free'));
  const isMine = (id: number) => state.holder[id] === player;
  const pool = state.pool[player] ?? 0;
  const over = game.over;
  const busy = !!scene;
  // Step 1 while levy waits and the player has not moved on; step 2 after.
  const step: 1 | 2 = !over && pool > 0 && skipped !== state.turn ? 1 : 2;
  const levy = levyOf(state, map, player, reign.renown, state.turn === 0 ? reign.grant : 0);

  /** What a province of one's own can reach, with the chance of an attack sent with all it can spare. */
  const reachOf = (from: number): Map<number, Reach> => {
    const out = new Map<number, Reach>();
    const spare = state.troops[from] - 1;
    for (const to of neighbours(map, from)) {
      const h = state.holder[to];
      const crossing = crossingOf(map, from, to);
      if (h === player) { if (state.troops[to] < capOf(map, to)) out.set(to, { kind: 'march', crossing }); }
      else if (h !== null && seats.has(to)) out.set(to, { kind: 'locked' });
      else out.set(to, { kind: 'attack', chance: winChance(spare, state.troops[to], groundOf(map, from, to)), crossing });
    }
    return out;
  };
  const from = pick.k === 'select' || pick.k === 'target' ? pick.from : null;
  const reach = useMemo(() => (from !== null ? reachOf(from) : new Map<number, Reach>()),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- reachOf reads only the position, the map and the player, listed here
    [from, state, map, player]);
  // Where a troop of the levy can go: one's own provinces with room.
  const placeable = useMemo(() => new Set(step === 1 && !busy ? map.provinces.map((p) => p.id).filter((id) => state.holder[id] === player && state.troops[id] < capOf(map, id)) : []),
    [step, busy, state, map, player]);

  // A new turn starts with nothing chosen.
  const [turnSeen, setTurnSeen] = useState(state.turn);
  if (turnSeen !== state.turn) { setTurnSeen(state.turn); setPick({ k: 'none' }); }

  // The first turn's banner, once the board is on the page.
  useEffect(() => {
    if (!reducedMotion() && state.turn < RULES.TURNS) setBanner(state.turn);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- once, for the turn the board opens on; later turns raise their own banner
  }, []);
  useEffect(() => {
    if (banner === null) return;
    const id = window.setTimeout(() => setBanner(null), BANNER_MS);
    return () => window.clearTimeout(id);
  }, [banner]);

  const refuse = (e: unknown) => {
    if (e instanceof CampaignError) toast({ title: t('campaign.err.title'), body: t(e.message as Key) });
    else toast({ title: t('campaign.err.title'), body: errorText(e, t.locale) });
  };

  const maxFor = (f: number, to: number) => sendable(state, map, player, f, to);
  // Taking a move back changes what a province can spare, so an open order goes with it.
  const undo = () => { game.undo(); setPick({ k: 'none' }); };

  const choose = (id: number) => {
    if (busy) return;
    if (over) { setPick({ k: 'inspect', id }); return; }
    if (step === 1) {
      if (isMine(id)) {
        try { game.move({ t: 'place', to: id }); sound('tick'); } catch (e) { refuse(e); }
      }
      setPick({ k: 'inspect', id });
      return;
    }
    if (from !== null && from !== id) {
      const r = reach.get(id);
      if (r && r.kind !== 'locked') { setPick({ k: 'target', from, to: id, troops: maxFor(from, id) }); return; }
    }
    if (isMine(id) && state.troops[id] >= 2 && state.orders > 0) {
      setPick(pick.k === 'select' && pick.from === id ? { k: 'inspect', id } : { k: 'select', from: id });
      return;
    }
    setPick({ k: 'inspect', id });
  };
  const back = () => setPick(pick.k === 'target' ? { k: 'select', from: pick.from } : { k: 'none' });

  useEffect(() => {
    if (pick.k === 'none') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // A dialog over the board (a battle) handles its own Escape.
      if (document.querySelector('dialog[open]')) return;
      setPick(pick.k === 'target' ? { k: 'select', from: pick.from } : { k: 'none' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pick]);

  const snapshot = (): Hold => ({ holder: [...state.holder], troops: [...state.troops] });

  const confirm = () => {
    if (pick.k !== 'target' || busy) return;
    const kind = isMine(pick.to) ? 'march' : 'attack';
    try {
      const before = snapshot();
      const troops = orderTroops(pick.troops, state, map, player, pick.from, pick.to);
      const e = game.move({ t: kind, from: pick.from, to: pick.to, troops } as Move)[0];
      setPick({ k: 'none' });
      if (!e) return;
      const moving = !reducedMotion();
      if (moving) {
        // The troops have left; where they arrive is shown when the scene is over.
        before.troops[pick.from] -= troops;
        setHold(before);
        if (view === 'map') sound('whoosh');
      }
      if (e.t === 'attack') setScene({ k: 'attack', e, phase: moving && view === 'map' ? 'fly' : 'dice' });
      else if (moving && view === 'map') setScene({ k: 'march', e });
      else { setHold(null); sound('tick'); }
    } catch (err) { refuse(err); }
  };

  const endTurn = () => {
    if (busy) return;
    try {
      const turn = state.turn;
      const before = snapshot();
      const events = game.move({ t: 'end' }).filter((e): e is Attack => e.t === 'attack');
      setPick({ k: 'none' });
      sound('page');
      setReport({ turn, events });
      if (reducedMotion()) return;
      if (events.length && view === 'map') {
        before.troops[events[0].from] = Math.max(1, before.troops[events[0].from] - events[0].committed);
        setHold(before);
        setScene({ k: 'regents', events, at: 0, phase: 'fly', turn });
      } else if (turn + 1 < RULES.TURNS) setBanner(turn + 1);
    } catch (err) { refuse(err); }
  };

  /** The scene is over: the map shows the reign as it stands. */
  const endScene = (turn?: number) => {
    setScene(null);
    setHold(null);
    if (turn !== undefined && turn + 1 < RULES.TURNS) setBanner(turn + 1);
  };

  // A scene plays itself, beat by beat.
  useEffect(() => {
    if (!scene) return;
    let wait = FLY_MS;
    let next: () => void;
    if (scene.k === 'march') next = () => { sound('tick'); endScene(); };
    else if (scene.k === 'attack') {
      if (scene.phase === 'dice') return;
      wait = scene.phase === 'fly' ? FLY_MS : CLASH_MS;
      next = () => { if (scene.phase === 'fly') sound('seal'); setScene({ ...scene, phase: scene.phase === 'fly' ? 'clash' : 'dice' }); };
    } else {
      const e = scene.events[scene.at];
      if (scene.phase === 'fly') next = () => { sound('seal'); setScene({ ...scene, phase: 'clash' }); };
      else if (scene.phase === 'clash') {
        wait = CLASH_MS;
        next = () => {
          // The battle is over: both garrisons as it left them, and the province with whoever holds it now.
          setHold((h) => h && { holder: h.holder.map((s, i) => (i === e.to && e.took ? e.side : s)), troops: h.troops.map((n, i) => (i === e.from ? e.fromLeft : i === e.to ? e.toLeft : n)) });
          setScene({ ...scene, phase: 'show' });
        };
      } else {
        wait = SHOW_MS;
        next = () => {
          const then = scene.events[scene.at + 1];
          if (!then) { endScene(scene.turn); return; }
          setHold((h) => h && { ...h, troops: h.troops.map((n, i) => (i === then.from ? Math.max(1, n - then.committed) : n)) });
          setScene({ ...scene, at: scene.at + 1, phase: 'fly' });
        };
      }
    }
    const id = window.setTimeout(next, wait);
    return () => window.clearTimeout(id);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- endScene only sets state; the scene is what the beat depends on
  }, [scene]);

  const told = scene?.k === 'regents' ? scene.events[scene.at] : null;
  const battle = scene?.k === 'attack' && scene.phase === 'dice' ? scene.e : null;

  const line = (e: Attack) => {
    const vars = { house: nameOf(e.side), province: map.provinces[e.to].name, defender: nameOf(e.defender) };
    if (e.defender === player) return t(e.took ? 'campaign.report.took_yours' : 'campaign.report.held_yours', vars);
    return t(e.took ? (e.defender ? 'campaign.report.took' : 'campaign.report.claimed') : 'campaign.report.repelled', vars);
  };

  const moving = scene?.k === 'march' ? scene.e : scene?.k === 'attack' ? scene.e : told;
  const flights: Flight[] = scene && moving && (scene.k === 'march' || scene.phase === 'fly')
    ? [{ id: `${scene.k}-${moving.from}-${moving.to}-${scene.k === 'regents' ? scene.at : state.attacks}`, from: moving.from, to: moving.to, count: moving.t === 'march' ? moving.troops : moving.committed, side: moving.side, kind: moving.t }]
    : [];
  const clash = scene && scene.k !== 'march' && scene.phase === 'clash' && moving ? { from: moving.from, to: moving.to } : null;
  const arrow = told ? { from: told.from, to: told.to, kind: 'attack' as const }
    : pick.k === 'target' ? { from: pick.from, to: pick.to, kind: isMine(pick.to) ? ('march' as const) : ('attack' as const) } : null;
  const selected = from;
  const marked = told ? told.to : pick.k === 'inspect' ? pick.id : null;
  const shown = hold ? { holder: hold.holder, troops: hold.troops, seats: state.seats } : state;
  const Season = SEASON_ICON[seasonOf(Math.min(state.turn, RULES.TURNS - 1)).season];

  return (
    <div className={`cg-board${pick.k === 'target' ? ' has-bar' : ''}`}>
      <div className="cg-field">
        <div className="cg-field-head">
          <Segmented
            aria-label={t('campaign.view.label')}
            size="sm"
            value={view}
            onChange={setView}
            options={[{ value: 'map', label: t('campaign.view.map'), icon: <MapIcon size={14} /> }, { value: 'list', label: t('campaign.view.list'), icon: <List size={14} /> }]}
          />
          {map.name && <span className="cg-continent">{map.name}</span>}
        </div>
        {view === 'map' ? (
          <CampaignMap
            map={map} state={shown} sides={sides} player={player} selected={selected} reach={reach} placeable={placeable} arrow={arrow} marked={marked}
            flights={flights} clash={clash} onSelect={choose} onClear={() => { if (!busy) setPick({ k: 'none' }); }}
          >
            {banner !== null && !told && (
              <div className="cm-banner" key={banner} aria-hidden>
                <span className="cm-banner-turn">{banner + 1 >= RULES.TURNS ? t('campaign.banner.last') : t('campaign.banner.turn', { turn: banner + 1 })}</span>
                <span className="cm-banner-season">{seasonLine(t, banner)}</span>
              </div>
            )}
            {told && (
              <p className="cm-caption" role="status">
                <Swords size={15} aria-hidden /> <span>{line(told)}</span>
                <button type="button" className="btn sm" onClick={() => endScene(scene?.k === 'regents' ? scene.turn : undefined)}>{t('campaign.report.skip')}</button>
              </p>
            )}
          </CampaignMap>
        ) : (
          <ul className="cg-list" aria-label={t('campaign.map.label')}>
            {[...map.provinces].sort((a, b) => Number(isMine(b.id)) - Number(isMine(a.id)) || a.name.localeCompare(b.name, t.locale)).map((p) => {
              const side = sides.find((s) => s.id === state.holder[p.id]);
              const r = reach.get(p.id);
              const terrain = terrainOf(map, p.id);
              const dim = selected !== null && selected !== p.id && !r;
              return (
                <li key={p.id}>
                  <button type="button" className={`cg-row${selected === p.id ? ' is-selected' : ''}${r ? ` is-${r.kind}` : ''}${dim ? ' is-dim' : ''}`} aria-pressed={selected === p.id} onClick={() => choose(p.id)} data-province={p.name}>
                    {side ? <Arms arms={side.arms} size={24} /> : <Flag size={20} className="cg-row-free" aria-hidden />}
                    <span className="cg-row-text">
                      <b>{p.name}{seats.has(p.id) && <Crown size={13} aria-hidden />}</b>
                      <small><TerrainIcon terrain={terrain} size={14} /> {t(TERRAIN_NAME[terrain])} · {side?.name ?? t('campaign.free')}</small>
                    </span>
                    <span className="cg-row-end">
                      {r && <ReachMark reach={r} />}
                      <span className="cg-row-troops"><span aria-hidden>{state.troops[p.id]}</span><span className="sr-only">{t('campaign.troops', { count: state.troops[p.id] })}. {isMine(p.id) ? t('campaign.map.yours') : ''}</span></span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <MapLegend />
      </div>

      <aside className="ui-card cg-orders" aria-label={t('campaign.orders.title')}>
        <div className="cg-turn-head">
          <div>
            <h2 className="cg-h">{over ? t('campaign.reign.over') : t('campaign.reign.turn', { turn: state.turn + 1, turns: RULES.TURNS })}</h2>
            {!over && <p className="cg-season"><Season size={14} aria-hidden /> {seasonLine(t, state.turn)}</p>}
          </div>
          <span className="cg-score-now" data-testid="score-now">{t('campaign.reign.score_now', { score: game.score.total })}</span>
        </div>
        {!over && <TurnTrack turn={state.turn} />}
        {!over && (
          <ol className="cg-steps" aria-label={t('campaign.steps.label')}>
            <li className={step === 1 ? 'is-on' : 'is-done'} aria-current={step === 1 ? 'step' : undefined}>
              {/* Levy left after "Done placing": the step can be returned to until the turn ends. */}
              {step === 2 && pool > 0 ? (
                <button type="button" className="cg-step-back" onClick={() => { setSkipped(-1); setPick({ k: 'none' }); }} aria-label={t('campaign.steps.reinforce_back', { count: pool })} title={t('campaign.steps.reinforce_back', { count: pool })}>
                  <b>1</b> {t('campaign.steps.reinforce')} <Undo2 size={13} aria-hidden />
                </button>
              ) : <><b>1</b> {t('campaign.steps.reinforce')}</>}
            </li>
            <li className={step === 2 ? 'is-on' : ''} aria-current={step === 2 ? 'step' : undefined}><b>2</b> {t('campaign.steps.orders', { count: state.orders })}</li>
            <li><b>3</b> {t('campaign.steps.end')}</li>
          </ol>
        )}

        {!over && step === 1 && (
          <section className="cg-act" aria-labelledby="cg-step1">
            <h3 id="cg-step1"><Tent size={15} aria-hidden /> {t('campaign.reinforce.title', { count: pool })}</h3>
            <p className="muted cg-note">{t('campaign.reinforce.how')}</p>
            <p className="cg-levy" data-testid="levy">
              {t('campaign.levy.line', { total: levy.total, base: levy.base, towns: levy.towns })}
              {levy.renown > 0 && <> · <b>{t('campaign.levy.renown', { count: levy.renown })}</b></>}
              {levy.grant > 0 && <> · {t('campaign.levy.grant', { count: levy.grant })}</>}
            </p>
            {renownLink}
            <div className="cg-step-actions">
              <button type="button" className="btn" disabled={!game.canUndo || busy} onClick={undo}><Undo2 size={15} /> {t('campaign.undo')}</button>
              <button type="button" className="btn primary" onClick={() => { setSkipped(state.turn); setPick({ k: 'none' }); }}>{t('campaign.reinforce.done')} <ChevronRight size={15} /></button>
            </div>
          </section>
        )}

        {!over && step === 2 && (
          <section className="cg-act" aria-labelledby="cg-step2">
            <h3 id="cg-step2"><Swords size={15} aria-hidden /> {t('campaign.orders.left', { count: state.orders })}</h3>
            <span className="cg-pips" aria-hidden>{Array.from({ length: RULES.ORDERS_PER_TURN }, (_, i) => <i key={i} className={i < state.orders ? 'on' : ''} />)}</span>
            <p className="muted cg-note">{state.orders > 0 ? t('campaign.orders.how') : t('campaign.orders.none')}</p>
            {pool > 0 && <p className="subtle cg-note">{t('campaign.orders.kept', { count: pool })}</p>}
          </section>
        )}

        {pick.k === 'inspect' && <Inspect id={pick.id} map={map} state={state} sides={sides} player={player} step={step} onClose={() => setPick({ k: 'none' })} />}
        {pick.k === 'select' && (
          <div className="cg-sel" role="status">
            <p className="cg-note"><b>{map.provinces[pick.from].name}</b> · {t('campaign.select.text', { count: state.troops[pick.from] - 1 })}</p>
            <button type="button" className="btn ghost" onClick={back}>{t('campaign.cancel')}</button>
          </div>
        )}

        {pick.k === 'target' && (
          <OrderBar
            key={`${pick.from}-${pick.to}`}
            map={map} state={state} from={pick.from} to={pick.to} troops={pick.troops} max={maxFor(pick.from, pick.to)} march={isMine(pick.to)}
            onTroops={(n) => setPick({ ...pick, troops: n })}
            onBack={back}
            onConfirm={confirm}
          />
        )}

        {!over && (
          <div className="cg-turn">
            {step === 2 && <button type="button" className="btn" disabled={!game.canUndo || busy} onClick={undo}><Undo2 size={15} /> {t('campaign.undo')}</button>}
            <button type="button" className={`btn${step === 2 && pick.k !== 'target' ? ' primary' : ''}`} onClick={endTurn} disabled={busy}><Sunrise size={16} /> {state.turn + 1 >= RULES.TURNS ? t('campaign.end.last') : t('campaign.end.turn')}</button>
          </div>
        )}

        {report && scene?.k !== 'regents' && (
          <section className="cg-report" aria-labelledby="cg-report-h">
            <h3 id="cg-report-h">{t('campaign.report.title', { turn: report.turn + 1 })}</h3>
            {report.events.length ? <ul>{report.events.map((e, i) => <li key={i} className={e.defender === player && e.took ? 'is-loss' : ''}>{line(e)}</li>)}</ul> : <p className="muted cg-note">{t('campaign.report.quiet')}</p>}
          </section>
        )}
      </aside>
      {battle && <BattleDialog battle={battle} map={map} sides={sides} mySide={player} onClose={() => endScene()} />}
    </div>
  );
}

/** The reign's twelve turns as a row of beads, four to a year: where the reign stands, at a glance. */
function TurnTrack({ turn }: { turn: number }) {
  return (
    <div className="cg-track" aria-hidden>
      {Array.from({ length: RULES.TURNS }, (_, i) => <i key={i} className={`${i < turn ? 'is-done' : i === turn ? 'is-on' : ''}${i % 4 === 0 && i ? ' is-year' : ''}`} />)}
    </div>
  );
}

function CrossingIcon({ crossing, size = 13 }: { crossing?: Crossing | null; size?: number }) {
  return crossing === 'sea' ? <Sailboat size={size} aria-hidden /> : crossing === 'river' ? <Waves size={size} aria-hidden /> : null;
}

function ReachMark({ reach }: { reach: Reach }) {
  const t = useT();
  const how = reach.kind !== 'locked' && reach.crossing ? ` ${t(reach.crossing === 'sea' ? 'campaign.reach.sea' : 'campaign.reach.river')}` : '';
  if (reach.kind === 'march') return <span className="cg-reach is-march"><Footprints size={13} aria-hidden /><CrossingIcon crossing={reach.crossing} /><span className="sr-only">{t('campaign.reach.march')}{how}</span></span>;
  if (reach.kind === 'locked') return <span className="cg-reach is-locked"><Lock size={13} aria-hidden /><span className="sr-only">{t('campaign.map.seat')}</span></span>;
  return <span className="cg-reach is-attack"><Swords size={13} aria-hidden /><CrossingIcon crossing={reach.crossing} /> {Math.round(reach.chance * 100)}%<span className="sr-only"> {t('campaign.reach.attack')}{how}</span></span>;
}

function Inspect({ id, map, state, sides, player, step, onClose }: { id: number; map: GameMap; state: ReignGame['state']; sides: BoardSide[]; player: string; step: 1 | 2; onClose: () => void }) {
  const t = useT();
  const p = map.provinces[id];
  const held = state.holder[id];
  const side = sides.find((s) => s.id === held);
  const terrain = terrainOf(map, id);
  const seat = held !== null && state.seats[held] === id;
  const mine = held === player;
  const ways = neighbours(map, id).map((n) => {
    const crossing = crossingOf(map, id, n);
    const name = map.provinces[n].name;
    return crossing === 'river' ? t('campaign.sel.by_river', { name }) : crossing === 'sea' ? t('campaign.sel.by_sea', { name }) : name;
  });
  const barred = (map.ridges ?? []).filter((r) => r.between.includes(id)).map((r) => map.provinces[r.between[0] === id ? r.between[1] : r.between[0]].name);
  return (
    <div className="cg-sel">
      <div className="cg-sel-head">
        {side ? <Arms arms={side.arms} size={34} /> : <Flag size={26} className="cg-row-free" aria-hidden />}
        <div>
          <h3>{p.name}{seat && <Crown size={15} aria-label={t('campaign.map.seat')} />}</h3>
          <p className="muted">{side ? t('campaign.sel.held', { house: side.name, count: state.troops[id] }) : t('campaign.sel.free', { count: state.troops[id] })}</p>
        </div>
        <button type="button" className="btn icon ghost" onClick={onClose} aria-label={t('campaign.sel.clear')}><X size={15} /></button>
      </div>
      <p className="cg-terrain-line"><TerrainIcon terrain={terrain} size={18} /> <span><b>{t(TERRAIN_NAME[terrain])}</b> · {t(TERRAIN_RULE[terrain], { cap: capOf(map, id) })}</span></p>
      <p className="cg-ways">{t('campaign.sel.ways', { list: ways.join(', ') })}{barred.length > 0 && <> {t('campaign.sel.ridge', { list: barred.join(', ') })}</>}</p>
      {seat && <p className="subtle cg-note">{mine ? t('campaign.sel.seatYours') : t('campaign.sel.seatTheirs')}</p>}
      {mine && step === 2 && state.troops[id] < 2 && <p className="subtle cg-note">{t('campaign.from.one')}</p>}
      {mine && step === 2 && state.troops[id] >= 2 && state.orders < 1 && <p className="subtle cg-note">{t('campaign.orders.none')}</p>}
    </div>
  );
}

function OrderBar({ map, state, from, to, troops, max, march, onTroops, onBack, onConfirm }: {
  map: GameMap; state: ReignGame['state']; from: number; to: number; troops: number; max: number; march: boolean;
  onTroops: (n: number) => void; onBack: () => void; onConfirm: () => void;
}) {
  const t = useT();
  const n = Math.max(1, Math.min(troops, max));
  const ground = groundOf(map, from, to);
  const chance = winChance(n, state.troops[to], ground);
  const percent = Math.round(chance * 100);
  return (
    <section className="cg-orderbar" aria-labelledby="cg-bar-h">
      <h3 id="cg-bar-h">
        {march ? <Footprints size={15} aria-hidden /> : <Swords size={15} aria-hidden />}{' '}
        {t(march ? 'campaign.march.title' : 'campaign.attack.title', { from: map.provinces[from].name, to: map.provinces[to].name })}
      </h3>
      {max > 0 ? (
        <>
          <div className="cg-troops" role="group" aria-label={t('campaign.orders.howMany')}>
            <button type="button" className="btn icon" onClick={() => onTroops(n - 1)} disabled={n <= 1} aria-label={t('campaign.orders.fewer')}><Minus size={15} /></button>
            <output aria-live="polite" data-testid="troops">{n}</output>
            <button type="button" className="btn icon" onClick={() => onTroops(n + 1)} disabled={n >= max} aria-label={t('campaign.orders.more')}><Plus size={15} /></button>
            <button type="button" className="btn ghost" onClick={() => onTroops(max)} disabled={n >= max}>{t('campaign.orders.all', { count: max })}</button>
          </div>
          {!march && (
            <div className="cg-odds" data-odds={chance >= 0.65 ? 'good' : chance >= 0.4 ? 'fair' : 'poor'}>
              <p className="cg-odds-line" data-testid="chance"><b>{t('campaign.preview.chance', { chance: percent })}</b> <span>{t('campaign.preview.against', { send: n, against: state.troops[to] })}</span></p>
              <span className="cg-odds-bar" aria-hidden><i style={{ width: `${percent}%` }} /></span>
              <ul className="cg-mods" data-testid="modifiers">
                {modifiers(t, ground).map((m) => <li key={m}>{m}</li>)}
              </ul>
            </div>
          )}
          {march && ground.crossing === 'sea' && <p className="subtle cg-note">{t('campaign.march.by_sea')}</p>}
        </>
      ) : (
        <p className="subtle cg-note">{t('campaign.full', { max: capOf(map, to) })}</p>
      )}
      <div className="cg-form-actions">
        <button type="button" className="btn" onClick={onBack}>{t('campaign.orders.back')}</button>
        <button type="button" className="btn primary" disabled={max < 1} onClick={onConfirm}>{t(march ? 'campaign.march.go' : 'campaign.attack.go', { count: n })}</button>
      </div>
    </section>
  );
}

const LAND: readonly Terrain[] = ['plains', 'forest', 'highland', 'marsh', 'town'];

/** How to read the map: each kind of land with its picture, then the seat, the river, the mountains and the sea lane; and, opened, what each does. */
export function MapLegend() {
  const t = useT();
  const numbers = { rounds: RULES.CROSSING_ROUNDS, full: RULES.BATTLE_ROUNDS };
  const features: { key: string; icon: ReactNode; name: Key; rule: string }[] = [
    { key: 'seat', icon: <GlyphIcon kind="castle" size={22} />, name: 'campaign.feature.seat', rule: t('campaign.legend.seat') },
    { key: 'river', icon: <svg className="cm-glyph" width="22" height="22" viewBox="0 0 26 26" aria-hidden><path className="cm-river is-bank" d="M2 18Q8 6 13 13T24 8" /><path className="cm-river" d="M2 18Q8 6 13 13T24 8" /></svg>, name: 'campaign.feature.river', rule: t('campaign.feature.river_rule', numbers) },
    { key: 'ridge', icon: <GlyphIcon kind="peak" size={22} />, name: 'campaign.feature.ridge', rule: t('campaign.feature.ridge_rule') },
    { key: 'lane', icon: <svg className="cm-glyph" width="22" height="22" viewBox="0 0 26 26" aria-hidden><path className="cm-lane" d="M2 20Q13 2 24 20" style={{ strokeWidth: 2.2, strokeDasharray: '1 4.5' }} /></svg>, name: 'campaign.feature.lane', rule: t('campaign.feature.lane_rule', numbers) },
  ];
  return (
    <div className="cg-legend-box">
      <ul className="cg-legend-chips" aria-label={t('campaign.terrain.legend')}>
        {LAND.map((k) => <li key={k} title={t(TERRAIN_RULE[k], { cap: capOn(k) })}><span className={`cg-swatch is-${k}`} aria-hidden><TerrainIcon terrain={k} size={20} /></span> {t(TERRAIN_NAME[k])}</li>)}
        {features.map((f) => <li key={f.key} title={f.rule}><span className="cg-swatch" aria-hidden>{f.icon}</span> {t(f.name)}</li>)}
      </ul>
      <details className="cg-terrain-legend">
        <summary>{t('campaign.legend.rules')}</summary>
        <ul>
          {LAND.map((k) => <li key={k}><span className={`cg-swatch is-${k}`} aria-hidden><TerrainIcon terrain={k} size={20} /></span> <span><b>{t(TERRAIN_NAME[k])}</b> {t(TERRAIN_RULE[k], { cap: capOn(k) })}</span></li>)}
          {features.map((f) => <li key={f.key}><span className="cg-swatch" aria-hidden>{f.icon}</span> <span><b>{t(f.name)}</b> {f.rule}</span></li>)}
        </ul>
        <p className="subtle">{t('campaign.terrain.note')}</p>
      </details>
    </div>
  );
}
