// The Campaign: a game one plays alone, as one's own house, on an invented continent that is new each week, with a weekly
// table for the family (docs/campaign.md). Members only. While a steward has it on, the page shows this week's challenge, the
// tables and a way to begin a reign; a reign is played in the browser and its moves are sent at the end, where the
// server plays them again and keeps the score. A practice reign (any house, a fresh field) is always there and stores
// nothing. A demo and a steward's preview play the week's field but never send it. A week's reign is kept in the tab while
// it is played (src/lib/campaign/saved.ts), so a reload or a visit elsewhere comes back to it; and its moves are reported
// to the server after every battle and turn, so the day's counted reign (fixed when it begins) can be gone on with from
// this page, in another tab or on another device.
import { useMutation, useQuery, useQueryClient, type QueryClient, type UseMutationResult } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Check, CircleHelp, Crown, ExternalLink, Hourglass, Play as PlayIcon, RotateCcw, Sunrise, Swords, TrendingUp, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Board } from '~/components/campaign/Board';
import { CampaignMap } from '~/components/campaign/CampaignMap';
import { ReignChronicle } from '~/components/campaign/Chronicle';
import { Laurel, type BoardSide } from '~/components/campaign/parts';
import { HowItWorks, LeaderboardPanel, RenownCard, SeasonsOfOld } from '~/components/campaign/panels';
import { useReign } from '~/components/campaign/reign';
import { isTourRunning } from '~/components/tour/store';
import '~/components/campaign/campaign.css';
import { Arms } from '~/components/Heraldry';
import { ConfirmDialog, EmptyState, ErrorState, PageHeader, Select, Skeleton, useIsClient } from '~/components/ui';
import { newOpKey } from '~/lib/api';
import { PolicyLockNote } from '~/components/operator/PolicyLock';
import { campaignQuery, campaignSettingsQuery, campaignStatusQuery, finishCampaignRun, keepCampaignRun, setCampaignOn, startCampaignRun } from '~/lib/campaign/campaign.functions';
import { RULES, setupField, type Move, type Reign, type State } from '~/lib/campaign/engine';
import { goesOnFrom, settled, turnOf } from '~/lib/campaign/progress';
import { forgetReigns, loadReign, saveReign, tabStore, type SavedReign } from '~/lib/campaign/saved';
import type { CampaignView, DaySlot, FinishResult, Resume, RunStart } from '~/lib/campaign/types';
import { errorText } from '~/lib/errortext';
import { useTreeId } from '~/lib/family';
import { formatDate, ordinal, translate, useT, type Locale } from '~/lib/i18n';
import { useCan, useSession } from '~/lib/session';
import { play as sound } from '~/lib/sfx';
import { toast } from '~/lib/toast';
import { treeTitle } from '~/lib/title';

export const Route = createFileRoute('/$tree/campaign')({
  validateSearch: (search: Record<string, unknown>): { practice?: boolean } => (search.practice === true || search.practice === 'true' || search.practice === 1 ? { practice: true } : {}),
  head: (ctx) => ({ meta: [{ title: treeTitle(ctx, translate((ctx.match.context as { locale?: Locale }).locale ?? 'en', 'campaign.title')) }] }),
  component: CampaignPage,
});

const INTRO_KEY = 'kindred:campaign:intro:2';

/**
 * Says at once where today's counted reign stands, before the page has asked the server again: under way with the moves
 * kept of it, or played. So the week's page never offers to begin a counted reign that has begun.
 */
function setToday(qc: QueryClient, tree: string, today: DaySlot, resume?: Resume) {
  qc.setQueryData<CampaignView>(campaignQuery(tree).queryKey, (old) => (old?.challenge && old.board
    ? { ...old, challenge: { ...old.challenge, today, counts: today === 'open', grant: today === 'open' ? old.challenge.grant : 0, resume }, board: { ...old.board, me: { ...old.board.me, today } } }
    : old));
  void qc.invalidateQueries({ queryKey: campaignStatusQuery(tree).queryKey });
}

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
  const kept = q.data?.challenge?.resume;
  useEffect(() => {
    if (!thisWeek || week || practice) return;
    const { saved, outdated } = loadReign(tabStore(), tree, account, thisWeek);
    // The same reign played on somewhere else meanwhile goes on from what the server has kept of it.
    const elsewhere = saved && kept && kept.run.id === saved.run.id && !goesOnFrom(saved.moves, kept.moves);
    if (saved) setWeek({ run: saved.run, submit: saved.submit, round: 0, saved: elsewhere ? { ...saved, moves: kept.moves } : saved });
    // A reign kept from before the rules changed cannot be played on: it has been let go, and this says so once.
    else if (outdated) toast({ title: t('campaign.reign.outdated_title'), body: t('campaign.reign.outdated') });
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `t` changes with the language only, and the kept reign is read once per week shown; what the server has kept is read when that happens, not followed
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
          : view.enabled ? <Week view={view} tree={tree} help={help} begin={(run, submit, moves) => setWeek({ run, submit, round: 0, saved: moves && { run, submit, moves, opKey: newOpKey() } })} startPractice={() => setPractice(true)} />
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
        <p>{steward && !view.locked ? t('campaign.off.steward') : t('campaign.off.member')}</p>
        <div className="cg-banner-actions">
          <button type="button" className="btn primary" data-tour="campaign-practice" onClick={startPractice}><Swords size={16} /> {t('campaign.practice.try')}</button>
          {steward && !view.locked && <button type="button" className="btn" disabled={turnOn.isPending} onClick={() => turnOn.mutate()}>{t('campaign.turn_on')}</button>}
          {steward && <Link className="btn ghost" to="/$tree/settings/games" params={{ tree }}>{t('campaign.off.settings')}</Link>}
        </div>
        {steward && (view.locked ? <PolicyLockNote reason="operator" /> : <p className="subtle">{t('campaign.turn_on_text')}</p>)}
        {turnOn.isError && <p role="alert">{errorText(turnOn.error, t.locale)}</p>}
      </section>
      <SeasonsOfOld fame={view.fame} />
    </>
  );
}

// ---------- the week ----------

function Week({ view, tree, help, begin, startPractice }: { view: CampaignView; tree: string; help: ReactNode; begin: (run: RunStart, submit: boolean, moves?: Move[]) => void; startPractice: () => void }) {
  const t = useT();
  const qc = useQueryClient();
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
      begin({ id: 'local', week: challenge.week, seed: challenge.seed, field: challenge.field, side, renown: challenge.renown[side] ?? 0, grant: 0, counts: false }, false);
      return;
    }
    try {
      const run = await start.mutateAsync();
      // The day's counted reign is fixed from here on: the page says so at once. A reign that turned out extra (the
      // counted one was begun elsewhere meanwhile) asks the server how things stand.
      if (run.counts) setToday(qc, tree, 'begun', { run, moves: [], turn: 0 });
      else void qc.invalidateQueries({ queryKey: campaignQuery(tree).queryKey });
      begin(run, true);
    } catch { /* the error is shown under the button */ }
  };
  // Today's counted reign under way: the way on is to go on with it. A demo and a preview have none of their own.
  const resume = !localOnly && challenge.today === 'begun' ? challenge.resume : undefined;
  const today = resume ? 'begun' : challenge.today === 'begun' ? 'played' : challenge.today;
  const me = board.me;
  const { map } = challenge.field;
  return (
    <>
      <PageHeader
        title={t('campaign.title')}
        subtitle={t('campaign.week.line', { date: formatDate(challenge.ends, t.locale) })}
        icon={<Swords size={26} />}
        actions={<>{help}<button type="button" className="btn" data-tour="campaign-practice" onClick={startPractice}><Swords size={16} /> {t('campaign.practice.button')}</button></>}
      />
      <section className="ui-card cg-banner cg-week" aria-labelledby="cg-week-h">
        <div className="cg-week-cols">
        <div className="cg-week-main">
        <div className="cg-week-top">
          {mine && <Arms arms={mine.arms} size={64} />}
          <div>
            <h2 id="cg-week-h">{t('campaign.week.title')}</h2>
            <p>{t('campaign.week.text', { turns: RULES.TURNS, house: mine?.name ?? '' })}</p>
            <p className="cg-week-me" data-testid="week-me">
              {me.best === null ? t('campaign.week.none') : <>
                {t('campaign.week.best', { score: me.best, count: me.runs })}{' '}
                {me.of < 2 ? t('campaign.week.place_alone') : t(me.tied ? 'campaign.week.place_shared' : 'campaign.week.place', { rank: ordinal(me.rank ?? 1, t.locale), of: me.of })}
              </>}
            </p>
            {me.record !== null && <p className="cg-week-record"><Laurel size={14} /> {t('campaign.week.record', { score: me.record })}</p>}
            {/* One reign a day counts: whether today's is still to play, which is the reason to come back tomorrow. */}
            <p className={`cg-week-today${today === 'played' ? '' : ' is-open'}`} data-testid="week-today" data-today={today}>
              {today === 'open' ? <Sunrise size={15} aria-hidden /> : today === 'begun' ? <Hourglass size={15} aria-hidden /> : <Check size={15} aria-hidden />}{' '}
              {today === 'open' ? t('campaign.week.today_open') : today === 'begun' ? t('campaign.week.today_begun', { turn: (resume?.turn ?? 0) + 1, turns: RULES.TURNS }) : t('campaign.week.today_done')}
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
          {resume
            ? <button type="button" className="btn primary lg" onClick={() => begin(resume.run, true, resume.moves)}><PlayIcon size={16} /> {t('campaign.week.continue')}</button>
            : <button type="button" className="btn primary lg" disabled={start.isPending || !side} onClick={() => void go()}><PlayIcon size={16} /> {localOnly ? t('campaign.week.play_local') : t('campaign.week.begin')}</button>}
          <button type="button" className="btn" onClick={startPractice}>{t('campaign.practice.button')}</button>
        </div>
        {localOnly && <p className="subtle">{t('campaign.week.local')}</p>}
        {start.isError && <p role="alert">{errorText(start.error, t.locale)}</p>}
        </div>
        {/* This week's continent at its opening: a picture to look at before the reign begins. */}
        <figure className="cg-week-map">
          <CampaignMap map={map} state={challenge.field.start} sides={challenge.field.sides} player={side || null} picture={t('campaign.week.map_label', { name: map.name ?? '' })} />
          <figcaption>{t('campaign.week.continent', { name: map.name ?? '' })}</figcaption>
        </figure>
        </div>
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
  /** When the reign is over: where it stands (the server's answer, or that it was not counted), and what to do next. */
  over: (moves: ReturnType<typeof useReign>['moves']) => { status: ReactNode; actions: ReactNode };
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
      {game.over && <ReignChronicle reign={reign} start={start} moves={game.moves} sides={sides} {...over(game.moves)} />}
      <Board reign={reign} sides={sides} game={game} renownLink={renownLink} />
    </>
  );
}

function WeekReign({ tree, account, run, submit, saved, help, leave, again }: { tree: string; account: string; run: RunStart; submit: boolean; saved?: SavedReign; help: ReactNode; leave: () => void; again: (run: RunStart, submit: boolean) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const reign = useMemo<Reign>(() => ({ map: run.field.map, sides: run.field.sides.map((s) => s.id), player: run.side, seed: run.seed, renown: run.renown, grant: run.grant }), [run]);
  const side = run.field.sides.find((s) => s.id === run.side);
  // The day's counted reign, fixed when it began: it stays the day's whether it is finished, left or lost.
  const counted = submit && run.counts === true;
  // The same retry key as before a reload, so a finish sent twice is kept once.
  const [key] = useState(() => saved?.opKey ?? newOpKey());
  const [initial] = useState(() => (saved?.run.id === run.id ? saved.moves : []));
  const finish = useMutation({
    mutationFn: (moves: Moves) => finishCampaignRun({ data: { tree, opKey: key, id: run.id, moves } }),
    onSuccess: (r) => { forgetReigns(tabStore(), tree, account); if (counted) setToday(qc, tree, 'played'); if (r.personalBest) sound('fanfare'); },
    // The reign went on, or ended, in another tab or on another device: trying again here can never succeed, so this copy
    // is let go and the page asks again, as when a report meets the same answer.
    onError: (e) => {
      const why = e instanceof Error ? e.message : '';
      if (why !== 'campaign.err.elsewhere' && why !== 'campaign.err.finished') return;
      live.current.done = true;
      toast({ title: t('campaign.reign.elsewhere_title'), body: t('campaign.err.elsewhere') });
      void qc.invalidateQueries({ queryKey: campaignQuery(tree).queryKey }).then(() => { forgetReigns(tabStore(), tree, account); leave(); });
    },
    onSettled: () => Promise.all([campaignQuery(tree), campaignStatusQuery(tree)].map((o) => qc.invalidateQueries({ queryKey: o.queryKey }))),
  });
  const goAway = () => { forgetReigns(tabStore(), tree, account); leave(); };

  // The reign's moves are reported to the server as they are settled (after a battle, at the end of a turn), one report
  // after another, so the reign can be gone on with elsewhere. `now` is the moves as they stand; `sent` how many of them
  // have been reported and `kept` how many the server has said it keeps; `done` that the reign is over or left, when a
  // late answer no longer matters.
  const live = useRef({ now: initial, sent: 0, kept: 0, done: false, last: Promise.resolve() });
  const report = useCallback((moves: Move[]) => {
    const at = live.current;
    const list = settled(moves);
    if (!submit || list.length <= at.sent) return;
    at.sent = list.length;
    at.last = at.last.then(() => keepCampaignRun({ data: { tree, id: run.id, moves: list } })).then((r) => { at.kept = Math.max(at.kept, r.kept); }, (e: unknown) => {
      // Not kept this time (the network, say): the next report carries these moves again.
      at.sent = at.kept;
      const why = e instanceof Error ? e.message : '';
      if (at.done || (why !== 'campaign.err.elsewhere' && why !== 'campaign.err.finished')) return;
      // The reign went on, or ended, in another tab or on another device: this copy is let go, and the page asks again.
      at.done = true;
      toast({ title: t('campaign.reign.elsewhere_title'), body: t('campaign.err.elsewhere') });
      void qc.invalidateQueries({ queryKey: campaignQuery(tree).queryKey }).then(() => { forgetReigns(tabStore(), tree, account); leave(); });
    });
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `t` changes with the language only; `leave` is the page's own and does the same each time
  }, [submit, tree, run.id, account, qc]);

  // Kept while it is played; a reign that is over and sent nowhere has nothing left to keep.
  const [played, setPlayed] = useState({ count: 0, over: false });
  const keep = useCallback((moves: Move[], over: boolean) => {
    setPlayed({ count: moves.length, over });
    live.current.now = moves;
    if (over) live.current.done = true;
    if (over && !submit) forgetReigns(tabStore(), tree, account);
    else saveReign(tabStore(), tree, account, { run, submit, moves, opKey: key });
    // The finish carries every move, so a reign that is over reports nothing more.
    if (!over) report(moves);
  }, [run, submit, tree, account, key, report]);

  const [asking, setAsking] = useState(false);
  const [leaving, setLeaving] = useState(false);
  /** Leaves the counted reign for now: what is settled is with the server, and the week's page offers to go on with it. */
  const pause = async () => {
    const at = live.current;
    setLeaving(true);
    report(at.now);
    await at.last;
    if (at.done) return;
    at.done = true;
    const moves = at.now.slice(0, at.kept);
    setToday(qc, tree, 'begun', { run, moves, turn: Math.min(RULES.TURNS - 1, turnOf(moves)) });
    goAway();
  };
  // A counted reign always says what leaving means; another only once there is something to lose.
  const askLeave = () => { if (!played.over && (counted || played.count > 0)) setAsking(true); else goAway(); };
  const restart = useMutation({ mutationFn: () => startCampaignRun({ data: { tree, side: run.side } }) });
  const playAgain = async () => {
    if (!submit) { again(run, false); return; }
    try { again(await restart.mutateAsync(), true); } catch { /* shown below */ }
  };
  return (
    <>
    <ConfirmDialog
      open={asking}
      onClose={() => setAsking(false)}
      onConfirm={() => { setAsking(false); if (counted) void pause(); else goAway(); }}
      title={t(counted ? 'campaign.reign.pause_title' : 'campaign.reign.leave_title')}
      confirmLabel={t(counted ? 'campaign.reign.pause_go' : 'campaign.reign.leave_go')}
    >
      <p>{t(counted ? 'campaign.reign.pause_text' : 'campaign.reign.leave_text')}</p>
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
          actions={<>{help}<button type="button" className="btn" disabled={leaving} onClick={askLeave}><Undo2 size={16} /> {t('campaign.reign.leave')}</button></>}
        />
      }
      note={!submit ? <p className="cg-local" role="note">{t('campaign.week.local')}</p>
        : !counted ? <p className="cg-local" role="note">{t('campaign.reign.extra')}</p>
        : <p className="cg-local" role="note" data-testid="reign-counted">{t('campaign.reign.counted')}{run.grant > 0 && <> {t('campaign.week.grant', { count: run.grant })}</>}</p>}
      over={(moves) => ({
        status: !submit ? <p className="subtle">{t('campaign.result.local')}</p> : <Submit finish={finish} moves={moves} />,
        actions: <>
          <button type="button" className="btn primary" disabled={restart.isPending || (submit && !finish.isSuccess)} onClick={() => void playAgain()}><RotateCcw size={16} /> {t('campaign.result.again')}</button>
          <button type="button" className="btn" onClick={goAway}>{t('campaign.result.table')}</button>
          {restart.isError && <p role="alert">{errorText(restart.error, t.locale)}</p>}
        </>,
      })}
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
  const house = r.house && r.house.of > 1 ? r.house : null;
  // A best is said only of a reign that beat something; a first reign is called that, and nothing more.
  const praise = r.record ? 'campaign.result.record' : r.personalBest ? 'campaign.result.best' : null;
  const stands = r.rank === null || r.best === null ? null
    : r.of < 2 ? t('campaign.result.alone', { best: r.best })
    : t(r.tied ? 'campaign.result.rank_shared' : 'campaign.result.rank', { rank: ordinal(r.rank, t.locale), of: r.of, best: r.best });
  return (
    <div aria-live="polite">
      {!r.counted && <p className="cg-extra" data-testid="result-extra">{t('campaign.result.extra')}</p>}
      <p data-testid="result-rank">
        {praise ? <><b className="cg-best"><Laurel size={15} /> {t(praise)}</b>{' '}</> : r.first ? <><b>{t('campaign.result.first')}</b>{' '}</> : null}
        {stands}
      </p>
      {house && (
        <p className={house.rose ? 'cg-rose' : 'subtle'} data-testid="result-house">
          {house.rose && <TrendingUp size={15} aria-hidden />} {t(house.rose ? 'campaign.result.house_rose' : 'campaign.result.house_stands', { house: house.name, rank: ordinal(house.rank, t.locale), of: house.of })}
        </p>
      )}
    </div>
  );
}

// ---------- practice ----------

function Practice(props: { view: CampaignView; tree: string; help: ReactNode; leave: () => void }) {
  // A practice continent is dealt by the browser's own randomness, so it is drawn only once the page runs here.
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
    const field = setupField(kit.sides.map((s) => s.id), seed);
    const reign: Reign = { map: field.map, sides: kit.sides.map((s) => s.id), player: side, seed, renown: kit.sides.find((s) => s.id === side)?.renown.bonus ?? 0, grant: 0 };
    return { field, reign };
  }, [kit, side, round]);
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
      over={() => ({
        status: <p className="subtle">{t('campaign.practice.unranked')}</p>,
        actions: <>
          <button type="button" className="btn primary" onClick={() => setRound((r) => r + 1)}><RotateCcw size={16} /> {t('campaign.practice.again')}</button>
          <button type="button" className="btn" onClick={leave}>{view.enabled ? t('campaign.practice.back') : t('campaign.practice.leave')}</button>
        </>,
      })}
    />
  );
}
