// The Campaign: a game one plays alone, as one's own house, on a map made from the family's places, with a weekly table
// for the family (docs/campaign.md). Members only. While a steward has it on, the page shows this week's challenge, the
// tables and a way to begin a reign; a reign is played in the browser and its moves are sent at the end, where the
// server plays them again and keeps the score. A practice reign (any house, a fresh field) is always there and stores
// nothing. A demo and a steward's preview play the week's field but never send it. A week's reign is kept in the tab while
// it is played (src/lib/campaign/saved.ts), so a reload or a visit elsewhere comes back to it.
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { CircleHelp, Crown, ExternalLink, Play as PlayIcon, RotateCcw, Swords, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BattleDialog, type Battle } from '~/components/campaign/BattleDialog';
import { Board, Laurel, type BoardSide } from '~/components/campaign/Board';
import { HowItWorks, LeaderboardPanel, RenownCard, SeasonsOfOld } from '~/components/campaign/panels';
import { useReign } from '~/components/campaign/reign';
import { isTourRunning } from '~/components/tour/store';
import '~/components/campaign/campaign.css';
import { Arms } from '~/components/Heraldry';
import { ConfirmDialog, EmptyState, ErrorState, PageHeader, Select, Skeleton, useIsClient } from '~/components/ui';
import { newOpKey } from '~/lib/api';
import { campaignQuery, campaignSettingsQuery, campaignStatusQuery, finishCampaignRun, setCampaignOn, startCampaignRun } from '~/lib/campaign/campaign.functions';
import { RULES, setupField, type Move, type Reign, type State } from '~/lib/campaign/engine';
import { forgetReigns, loadReign, saveReign, tabStore, type SavedReign } from '~/lib/campaign/saved';
import type { CampaignView, FinishResult, RunStart } from '~/lib/campaign/types';
import { errorText } from '~/lib/errortext';
import { useTreeId } from '~/lib/family';
import { formatDate, ordinal, translate, useT, type Locale } from '~/lib/i18n';
import { useCan, useSession } from '~/lib/session';
import { play as sound } from '~/lib/sfx';
import { treeTitle } from '~/lib/title';

export const Route = createFileRoute('/$tree/campaign')({
  validateSearch: (search: Record<string, unknown>): { practice?: boolean } => (search.practice === true || search.practice === 'true' || search.practice === 1 ? { practice: true } : {}),
  head: (ctx) => ({ meta: [{ title: treeTitle(ctx, translate((ctx.match.context as { locale?: Locale }).locale ?? 'en', 'campaign.title')) }] }),
  component: CampaignPage,
});

const INTRO_KEY = 'kindred:campaign:intro:2';

/** A reign being played: this week's (begun on the server, or played only here in a demo or preview) or a practice. */
type Playing =
  | { kind: 'week'; run: RunStart; submit: boolean }
  | { kind: 'practice' };

function CampaignPage() {
  const t = useT();
  const tree = useTreeId();
  const session = useSession();
  const guest = session?.guest?.tree === tree;
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const q = useQuery({ ...campaignQuery(tree), enabled: !guest });
  const [how, setHow] = useState(false);
  const [week, setWeek] = useState<{ run: RunStart; submit: boolean; round: number; saved?: SavedReign } | null>(null);
  const practice = !!search.practice;
  const setPractice = (on: boolean) => { setWeek(null); void navigate({ search: on ? { practice: true } : {}, replace: true }); };
  const account = session?.user?.id ?? 'anon';

  // A week's reign this tab was playing comes back where it was left.
  const thisWeek = q.data?.challenge?.week;
  useEffect(() => {
    if (!thisWeek || week || practice) return;
    const saved = loadReign(tabStore(), tree, account, thisWeek);
    if (saved) setWeek({ run: saved.run, submit: saved.submit, round: 0, saved });
  }, [thisWeek, week, practice, tree, account]);

  // The first visit opens "how it works" once; after that it is behind its button.
  const ready = !!q.data;
  useEffect(() => {
    // Not while a tour is showing the page: its card is a dialog too, and this one would open over it. The next visit opens it.
    if (!ready || isTourRunning()) return;
    try {
      if (localStorage.getItem(INTRO_KEY)) return;
      localStorage.setItem(INTRO_KEY, '1');
    } catch { /* storage can be off: then it opens each time, which is better than never */ }
    setHow(true);
  }, [ready]);

  if (guest) return <div className="page"><div className="page-inner"><EmptyState icon={<Swords size={30} />} title={t('campaign.guest_title')} text={t('campaign.guest_text')} /></div></div>;

  const help = <button type="button" className="btn" onClick={() => setHow(true)}><CircleHelp size={16} /> {t('campaign.how.button')}</button>;
  const view = q.data;
  const playing: Playing | null = week ? { kind: 'week', run: week.run, submit: week.submit } : practice ? { kind: 'practice' } : null;
  return (
    <div className="page cg-page">
      <div className="page-inner">
        {q.isError ? <ErrorState title={t('campaign.load_failed')} error={q.error} onRetry={() => void q.refetch()} />
          : !view ? <Skeleton height={520} />
          : playing?.kind === 'practice' ? <Practice view={view} tree={tree} help={help} leave={() => setPractice(false)} />
          : playing?.kind === 'week' ? <WeekReign key={`${week!.run.id}:${week!.round}`} tree={tree} account={account} run={playing.run} submit={playing.submit} saved={week!.saved} help={help} leave={() => setWeek(null)} again={(run, submit) => setWeek({ run, submit, round: (week?.round ?? 0) + 1 })} />
          : view.enabled ? <Week view={view} tree={tree} help={help} begin={(run, submit) => setWeek({ run, submit, round: 0 })} startPractice={() => setPractice(true)} />
          : <Off view={view} tree={tree} help={help} startPractice={() => setPractice(true)} />}
      </div>
      <HowItWorks
        open={how}
        onClose={() => setHow(false)}
        onPlay={!playing && view && !view.enabled ? () => { setHow(false); setPractice(true); } : undefined}
        playLabel={t('campaign.practice.try')}
      />
    </div>
  );
}

/** Whether nothing is sent from here: a demo, or a steward's preview of someone else. */
function useLocalOnly() {
  const session = useSession();
  return !!session?.demo || !!session?.viewAs;
}

// ---------- while the game is off ----------

function Off({ view, tree, help, startPractice }: { view: CampaignView; tree: string; help: ReactNode; startPractice: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const steward = useCan('manage-access');
  // The same switch as the Games page: the server checks the steward's role, and a demo or a preview refuses it.
  const turnOn = useMutation({
    mutationFn: () => setCampaignOn({ data: { tree, on: true } }),
    onSettled: () => Promise.all([campaignQuery(tree), campaignStatusQuery(tree), campaignSettingsQuery(tree)].map((o) => qc.invalidateQueries({ queryKey: o.queryKey }))),
  });
  return (
    <>
      <PageHeader title={t('campaign.title')} subtitle={t('campaign.subtitle')} icon={<Swords size={26} />} actions={help} />
      <section className="ui-card cg-banner">
        <h2>{t('campaign.off.title')}</h2>
        <p>{steward ? t('campaign.off.steward') : t('campaign.off.member')}</p>
        <div className="cg-banner-actions">
          <button type="button" className="btn primary" data-tour="campaign-practice" onClick={startPractice}><Swords size={16} /> {t('campaign.practice.try')}</button>
          {steward && <button type="button" className="btn" disabled={turnOn.isPending} onClick={() => turnOn.mutate()}>{t('campaign.turn_on')}</button>}
          {steward && <Link className="btn ghost" to="/$tree/settings/games" params={{ tree }}>{t('campaign.off.settings')}</Link>}
        </div>
        {steward && <p className="subtle">{t('campaign.turn_on_text')}</p>}
        {turnOn.isError && <p role="alert">{errorText(turnOn.error, t.locale)}</p>}
      </section>
      <SeasonsOfOld fame={view.fame} />
    </>
  );
}

// ---------- the week ----------

function Week({ view, tree, help, begin, startPractice }: { view: CampaignView; tree: string; help: ReactNode; begin: (run: RunStart, submit: boolean) => void; startPractice: () => void }) {
  const t = useT();
  const challenge = view.challenge!;
  const board = view.board!;
  const localOnly = useLocalOnly();
  const houses = challenge.field.sides.filter((s) => !s.rival);
  const choices = houses.length ? houses : challenge.field.sides;
  const [chosen, setChosen] = useState<string>(challenge.side ?? choices[0]?.id ?? '');
  const side = challenge.side ?? chosen;
  const mine = challenge.field.sides.find((s) => s.id === side);
  const renownSide = view.kit.sides.find((s) => s.id === side);
  const start = useMutation({ mutationFn: () => startCampaignRun({ data: { tree, side: challenge.chooses ? side : null } }) });
  const go = async () => {
    if (localOnly) {
      // Played here only: the week's field and seed, as the server would have begun it, and nothing is sent.
      begin({ id: 'local', week: challenge.week, seed: challenge.seed, field: challenge.field, side, renown: challenge.renown[side] ?? 0, grant: 0 }, false);
      return;
    }
    try {
      begin(await start.mutateAsync(), true);
    } catch { /* the error is shown under the button */ }
  };
  const me = board.me;
  return (
    <>
      <PageHeader
        title={t('campaign.title')}
        subtitle={t('campaign.week.line', { date: formatDate(challenge.ends, t.locale) })}
        icon={<Swords size={26} />}
        actions={<>{help}<button type="button" className="btn" data-tour="campaign-practice" onClick={startPractice}><Swords size={16} /> {t('campaign.practice.button')}</button></>}
      />
      <section className="ui-card cg-banner cg-week" aria-labelledby="cg-week-h">
        <div className="cg-week-top">
          {mine && <Arms arms={mine.arms} size={64} />}
          <div>
            <h2 id="cg-week-h">{t('campaign.week.title')}</h2>
            <p>{t('campaign.week.text', { turns: RULES.TURNS, house: mine?.name ?? '' })}</p>
            <p className="cg-week-me" data-testid="week-me">
              {me.best === null ? t('campaign.week.none') : t('campaign.week.best', { score: me.best, count: me.runs, rank: ordinal(me.rank ?? 1, t.locale), of: me.of })}
            </p>
          </div>
        </div>
        {challenge.chooses && (
          <label className="cg-cry">
            <span id="cg-side-h">{t('campaign.week.choose')}</span>
            <Select aria-labelledby="cg-side-h" value={chosen} onChange={setChosen} options={choices.map((s) => ({ value: s.id, label: s.name }))} />
          </label>
        )}
        <p className="cg-levy">
          {t('campaign.week.levy', { count: challenge.renown[side] ?? 0 })}
          {challenge.grant > 0 && <> · {t('campaign.week.grant', { count: challenge.grant })}</>}
        </p>
        <div className="cg-banner-actions">
          <button type="button" className="btn primary lg" disabled={start.isPending || !side} onClick={() => void go()}><PlayIcon size={16} /> {localOnly ? t('campaign.week.play_local') : t('campaign.week.begin')}</button>
          <button type="button" className="btn" onClick={startPractice}>{t('campaign.practice.button')}</button>
        </div>
        {localOnly && <p className="subtle">{t('campaign.week.local')}</p>}
        {start.isError && <p role="alert">{errorText(start.error, t.locale)}</p>}
      </section>
      <div className="cg-lower">
        <LeaderboardPanel board={board} sides={challenge.field.sides} />
        {renownSide && <RenownCard side={renownSide} tree={tree} />}
        <SeasonsOfOld fame={view.fame} />
      </div>
    </>
  );
}

// ---------- playing a reign ----------

interface PlayProps {
  reign: Reign;
  start: State;
  sides: BoardSide[];
  tree: string;
  /** Shown when the reign is over: the score as the server kept it, or a practice's. */
  over: (score: ReturnType<typeof useReign>['score'], moves: ReturnType<typeof useReign>['moves']) => ReactNode;
  head: ReactNode;
  note?: ReactNode;
  /** Moves already played (a reign kept in the tab), played again before the board shows. */
  initial?: Move[];
  /** Hears each change to the moves, so the page can keep them. */
  onMoves?: (moves: Move[], over: boolean) => void;
}

function Play({ reign, start, sides, tree, over, head, note, initial, onMoves }: PlayProps) {
  const t = useT();
  const game = useReign(reign, start, initial);
  const [battle, setBattle] = useState<Battle | null>(null);
  useEffect(() => { onMoves?.(game.moves, game.over); }, [onMoves, game.moves, game.over]);
  // A new tab, so the game stays where it is.
  const renownLink = (
    <Link className="cg-renown-link" to="/$tree/needed" params={{ tree }} target="_blank" rel="noopener">
      {t('campaign.levy.raise')} <ExternalLink size={13} aria-hidden /> <span className="subtle">{t('campaign.levy.new_tab')}</span>
    </Link>
  );
  return (
    <>
      {head}
      {note}
      {game.over && over(game.score, game.moves)}
      <Board reign={reign} sides={sides} game={game} onAttack={setBattle} renownLink={renownLink} />
      {battle && <BattleDialog battle={battle} map={reign.map} sides={sides} mySide={reign.player} onClose={() => setBattle(null)} />}
    </>
  );
}

function ScoreLine({ score }: { score: ReturnType<typeof useReign>['score'] }) {
  const t = useT();
  return <p className="cg-score-parts">{t('campaign.result.parts', { provinces: score.provinces, towns: score.towns, won: score.won, lost: score.lost })}</p>;
}

function WeekReign({ tree, account, run, submit, saved, help, leave, again }: { tree: string; account: string; run: RunStart; submit: boolean; saved?: SavedReign; help: ReactNode; leave: () => void; again: (run: RunStart, submit: boolean) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const reign = useMemo<Reign>(() => ({ map: run.field.map, sides: run.field.sides.map((s) => s.id), player: run.side, seed: run.seed, renown: run.renown, grant: run.grant }), [run]);
  const side = run.field.sides.find((s) => s.id === run.side);
  // The same retry key as before a reload, so a finish sent twice is kept once.
  const [key] = useState(() => saved?.opKey ?? newOpKey());
  const [initial] = useState(() => (saved?.run.id === run.id ? saved.moves : []));
  const finish = useMutation({
    mutationFn: (moves: Moves) => finishCampaignRun({ data: { tree, opKey: key, id: run.id, moves } }),
    onSuccess: (r) => { forgetReigns(tabStore(), tree, account); if (r.personalBest) sound('fanfare'); },
    onSettled: () => Promise.all([campaignQuery(tree), campaignStatusQuery(tree)].map((o) => qc.invalidateQueries({ queryKey: o.queryKey }))),
  });
  // Kept while it is played; a reign that is over and sent nowhere has nothing left to keep.
  const [played, setPlayed] = useState({ count: 0, over: false });
  const keep = useCallback((moves: Move[], over: boolean) => {
    setPlayed({ count: moves.length, over });
    if (over && !submit) forgetReigns(tabStore(), tree, account);
    else saveReign(tabStore(), tree, account, { run, submit, moves, opKey: key });
  }, [run, submit, tree, account, key]);
  const [asking, setAsking] = useState(false);
  const goAway = () => { forgetReigns(tabStore(), tree, account); leave(); };
  const askLeave = () => { if (played.count > 0 && !played.over) setAsking(true); else goAway(); };
  const restart = useMutation({ mutationFn: () => startCampaignRun({ data: { tree, side: run.side } }) });
  const playAgain = async () => {
    if (!submit) { again(run, false); return; }
    try { again(await restart.mutateAsync(), true); } catch { /* shown below */ }
  };
  return (
    <>
    <ConfirmDialog open={asking} onClose={() => setAsking(false)} onConfirm={() => { setAsking(false); goAway(); }} title={t('campaign.reign.leave_title')} confirmLabel={t('campaign.reign.leave_go')}>
      <p>{t('campaign.reign.leave_text')}</p>
    </ConfirmDialog>
    <Play
      reign={reign}
      start={run.field.start}
      sides={run.field.sides}
      tree={tree}
      initial={initial}
      onMoves={keep}
      head={
        <PageHeader
          title={t('campaign.reign.title', { house: side?.name ?? '' })}
          subtitle={t('campaign.reign.line', { turns: RULES.TURNS })}
          icon={<Crown size={26} />}
          actions={<>{help}<button type="button" className="btn" onClick={askLeave}><Undo2 size={16} /> {t('campaign.reign.leave')}</button></>}
        />
      }
      note={!submit ? <p className="cg-local" role="note">{t('campaign.week.local')}</p> : run.grant > 0 ? <p className="cg-local">{t('campaign.week.grant', { count: run.grant })}</p> : null}
      over={(score, moves) => (
        <ResultBanner
          title={t('campaign.result.title', { score: score.total })}
          arms={side?.arms}
          parts={<ScoreLine score={score} />}
          status={!submit ? <p className="subtle">{t('campaign.result.local')}</p> : <Submit finish={finish} moves={moves} />}
          actions={<>
            <button type="button" className="btn primary" disabled={restart.isPending || (submit && !finish.isSuccess)} onClick={() => void playAgain()}><RotateCcw size={16} /> {t('campaign.result.again')}</button>
            <button type="button" className="btn" onClick={goAway}>{t('campaign.result.table')}</button>
            {restart.isError && <p role="alert">{errorText(restart.error, t.locale)}</p>}
          </>}
        />
      )}
    />
    </>
  );
}

/** Sends a finished reign once and says how it stands. */
type Moves = Parameters<typeof finishCampaignRun>[0]['data']['moves'];

function Submit({ finish, moves }: { finish: UseMutationResult<FinishResult, Error, Moves>; moves: Moves }) {
  const t = useT();
  const { mutate, isIdle } = finish;
  useEffect(() => { if (isIdle) mutate(moves); }, [isIdle, mutate, moves]);
  if (finish.isError) return <p role="alert">{errorText(finish.error, t.locale)} <button type="button" className="btn sm" onClick={() => mutate(moves)}>{t('campaign.result.retry')}</button></p>;
  if (!finish.data) return <p className="subtle" aria-live="polite">{t('campaign.result.sending')}</p>;
  const r = finish.data;
  return (
    <p aria-live="polite" data-testid="result-rank">
      {r.personalBest && <b className="cg-best"><Laurel size={15} /> {t('campaign.result.best')} </b>}
      {t('campaign.result.rank', { rank: ordinal(r.rank, t.locale), of: r.of, best: r.best })}
    </p>
  );
}

function ResultBanner({ title, arms, parts, status, actions }: { title: string; arms?: BoardSide['arms']; parts: ReactNode; status: ReactNode; actions: ReactNode }) {
  return (
    <section className="ui-card cg-banner cg-result" aria-live="polite">
      {arms && <Arms arms={arms} size={64} />}
      <h2>{title}</h2>
      {parts}
      {status}
      <div className="cg-banner-actions">{actions}</div>
    </section>
  );
}

// ---------- practice ----------

function Practice(props: { view: CampaignView; tree: string; help: ReactNode; leave: () => void }) {
  // A practice field is dealt by the browser's own randomness, so it is drawn only once the page runs here.
  return useIsClient() ? <PracticeReign {...props} /> : <Skeleton height={520} />;
}

function PracticeReign({ view, tree, help, leave }: { view: CampaignView; tree: string; help: ReactNode; leave: () => void }) {
  const t = useT();
  const { kit } = view;
  const playable = kit.sides.filter((s) => !s.rival).length ? kit.sides.filter((s) => !s.rival) : kit.sides;
  const [side, setSide] = useState(() => playable.find((s) => s.id === view.mySide)?.id ?? playable[0]?.id ?? '');
  const [round, setRound] = useState(0);
  // A fresh field for every round: only for a reign nobody else sees, so the browser's own randomness is enough.
  const setup = useMemo(() => {
    const seed = `practice:${Math.random().toString(36).slice(2)}:${round}`;
    const field = setupField(kit.places, kit.sides.map((s) => s.id), seed);
    const reign: Reign = { map: field.map, sides: kit.sides.map((s) => s.id), player: side, seed, renown: kit.sides.find((s) => s.id === side)?.renown.bonus ?? 0, grant: 0 };
    return { field, reign };
  }, [kit, side, round]);
  const me = kit.sides.find((s) => s.id === side);
  return (
    <Play
      key={`${side}:${round}`}
      reign={setup.reign}
      start={setup.field.start}
      sides={kit.sides}
      tree={tree}
      head={
        <PageHeader
          title={t('campaign.practice.title')}
          subtitle={t('campaign.practice.line', { turns: RULES.TURNS })}
          icon={<Swords size={26} />}
          actions={<>{help}<button type="button" className="btn" onClick={leave}><Undo2 size={16} /> {view.enabled ? t('campaign.practice.back') : t('campaign.practice.leave')}</button></>}
        />
      }
      note={
        <div className="cg-practice-bar">
          {playable.length > 1 && (
            <label className="cg-cry">
              <span id="cg-playas">{t('campaign.practice.playAs')}</span>
              <Select aria-labelledby="cg-playas" value={side} onChange={(s) => { setSide(s); setRound((r) => r + 1); }} options={playable.map((s) => ({ value: s.id, label: s.name }))} />
            </label>
          )}
          <button type="button" className="btn ghost" onClick={() => setRound((r) => r + 1)}><RotateCcw size={15} /> {t('campaign.practice.restart')}</button>
          <p className="subtle cg-note">{t('campaign.practice.note')}</p>
        </div>
      }
      over={(score) => (
        <ResultBanner
          title={t('campaign.result.title', { score: score.total })}
          arms={me?.arms}
          parts={<ScoreLine score={score} />}
          status={<p className="subtle">{t('campaign.practice.unranked')}</p>}
          actions={<>
            <button type="button" className="btn primary" onClick={() => setRound((r) => r + 1)}><RotateCcw size={16} /> {t('campaign.practice.again')}</button>
            <button type="button" className="btn" onClick={leave}>{view.enabled ? t('campaign.practice.back') : t('campaign.practice.leave')}</button>
          </>}
        />
      )}
    />
  );
}
