// Background AI tasks for a family: the steward's settings, the spending cap for background work, the run log and the
// daily scheduler (src/lib/jobs/ai-tasks.ts). What each task does is in background-tasks.server.ts; this file decides
// whether a task may run now, how much it may spend, and what is recorded.
//
// Off by default: a task runs only when its steward switched it on, the family's AI is set up (a key, a budget above 0),
// and the family's own switch for its feature (arms, or the assistant) is on. Every call is booked twice before it is
// sent: against the background share of the monthly budget (ai_background_spend), and against the whole budget (ai_spend,
// through the same path the assistant uses). Whichever runs out first stops the work.
import { accounts } from '../auth/store.server';
import { db } from '../db.server';
import { readReviews } from '../house-meaning.server';
import { needsAttention } from '../house-meaning.ts';
import { AiError, callRounds, outputCap, type AiAdapter, type AiReply, type AiRequest } from './adapters';
import { itemKey, pending, perform, recordFailure, type Pending } from './background-tasks.server';
import { tr, type Tr } from './labels';
import { budgeted, estimateMicros, failureMicros, monthNow, readSettings, replyMicros, resetsOn, routeAdapter, spentThisMonth, type Settings } from './settings.server';
import { resolveRoute } from './providers.server';
import type { Price } from './prices';
import type { Locale } from '../i18n/types';
import { TASK_ROUTE } from './types';
import {
  BATCH, CALLS_PER_DAILY_RUN, CALLS_PER_NAME, TASK_FEATURE, TASKS, capMicros, defaultSettings, isDue, lastLooked,
  type Activity, type ActivityTask, type BackgroundSettings, type Readiness, type SaveInput, type Task, type TaskRun, type TaskSetting, type WaitingReview,
} from './background';

/** Runs kept per family for the activity page; older ones are dropped when a new one is written. */
const RUNS_KEPT = 200;

interface BgRow { tree: string; cap_share: number; languages: string; locale: string; updated: number; updated_by: string }
interface TaskRow { tree: string; task: string; enabled: number; schedule: string; last_started: number | null; last_checked: number | null }

const isTask = (t: string): t is Task => (TASKS as readonly string[]).includes(t);
const LOCALES_OK: readonly Locale[] = ['en', 'de', 'af'];
const localeOf = (s: string): Locale => (LOCALES_OK as readonly string[]).includes(s) ? (s as Locale) : 'en';

function parseLanguages(s: string): Locale[] {
  try {
    const list = JSON.parse(s) as unknown;
    return Array.isArray(list) ? [...new Set(list.filter((l): l is Locale => (LOCALES_OK as readonly string[]).includes(l as string)))] : [];
  } catch {
    return [];
  }
}

// ---------- settings ----------

/** A family's background settings. Without a saved row every task is off. The switches are read here; they are saved with the routes. */
export async function readBackground(tree: string): Promise<BackgroundSettings> {
  const row = await accounts().get<BgRow>('SELECT * FROM ai_background WHERE tree = ?', tree);
  const s = defaultSettings();
  if (row) {
    s.capShare = row.cap_share;
    s.languages = parseLanguages(row.languages);
    s.locale = localeOf(row.locale);
    s.updated = row.updated;
  }
  const tasks = await accounts().all<TaskRow>('SELECT * FROM ai_background_task WHERE tree = ?', tree);
  for (const r of tasks) {
    if (!isTask(r.task)) continue;
    s.tasks[r.task] = { enabled: r.enabled === 1, schedule: r.schedule === 'weekly' ? 'weekly' : 'daily', lastStarted: r.last_started, lastChecked: r.last_checked };
  }
  return s;
}

/**
 * Saves what the steward chose: the cap, the languages, the locale and each task's schedule. Nothing else is touched: a
 * task's switch is saved with the routes (setTaskEnabled), and the last-run times stay.
 */
export async function saveBackground(tree: string, by: string, input: SaveInput): Promise<BackgroundSettings> {
  const now = Date.now();
  await accounts().run(
    `INSERT INTO ai_background (tree, cap_share, languages, locale, updated, updated_by) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (tree) DO UPDATE SET cap_share = excluded.cap_share, languages = excluded.languages, locale = excluded.locale,
       updated = excluded.updated, updated_by = excluded.updated_by`,
    tree, input.capShare, JSON.stringify([...new Set(input.languages)]), input.locale, now, by,
  );
  for (const task of TASKS) {
    await accounts().run(
      `INSERT INTO ai_background_task (tree, task, enabled, schedule) VALUES (?, ?, 0, ?)
       ON CONFLICT (tree, task) DO UPDATE SET schedule = excluded.schedule`,
      tree, task, input.tasks[task].schedule,
    );
  }
  return readBackground(tree);
}

/** Switches a background task on or off. Its schedule and last run stay as they are. */
export async function setTaskEnabled(tree: string, task: Task, enabled: boolean): Promise<void> {
  await accounts().run(
    `INSERT INTO ai_background_task (tree, task, enabled, schedule) VALUES (?, ?, ?, 'daily')
     ON CONFLICT (tree, task) DO UPDATE SET enabled = excluded.enabled`,
    tree, task, enabled ? 1 : 0,
  );
}

// ---------- readiness ----------


/**
 * Whether a task may run now, and why not. `off` is the steward's switch; the rest are its route having no connected provider
 * (`no-key`), the budget being 0, or the task's own feature switched off. Reads only.
 */
export async function readiness(tree: string, task: Task, bg?: BackgroundSettings): Promise<{ state: Readiness; settings: Settings }> {
  const settings = await readSettings(tree);
  const current = bg ?? (await readBackground(tree));
  if (!current.tasks[task].enabled) return { state: 'off', settings };
  if (!(await resolveRoute(tree, TASK_ROUTE[task])).connected) return { state: 'no-key', settings };
  if (settings.monthlyMicros <= 0) return { state: 'budget-off', settings };
  if (!settings.features[TASK_FEATURE[task]]) return { state: 'feature-off', settings };
  return { state: 'ready', settings };
}

// ---------- the background share of the budget ----------

interface Booking { month: string; amount: number }

/** Books `amount` against the background share, or throws `budget` when that would take it past `limit`. One statement decides. */
async function reserveBackground(tree: string, limit: number, amount: number, c: Tr): Promise<Booking> {
  const month = monthNow();
  await accounts().run('INSERT INTO ai_background_spend (tree, month, micros) VALUES (?, ?, 0) ON CONFLICT (tree, month) DO NOTHING', tree, month);
  const r = await accounts().run(
    'UPDATE ai_background_spend SET micros = micros + ? WHERE tree = ? AND month = ? AND micros + ? <= ?',
    amount, tree, month, amount, limit,
  );
  if (r.changes !== 1) throw new AiError('budget', c('aitasks.errCap'));
  return { month, amount };
}

async function settleBackground(tree: string, booked: Booking, actual: number): Promise<void> {
  await accounts().run(
    'UPDATE ai_background_spend SET micros = MAX(0, micros - ? + ?) WHERE tree = ? AND month = ?',
    booked.amount, Math.max(0, Math.round(actual)), tree, booked.month,
  );
}

export async function backgroundSpentThisMonth(tree: string): Promise<number> {
  return (await accounts().get<{ micros: number }>('SELECT micros FROM ai_background_spend WHERE tree = ? AND month = ?', tree, monthNow()))?.micros ?? 0;
}

/**
 * The provider calls a daily run may still make, shared by every task of the run. `owed` is the first attempts the current
 * task still owes its later items, and `item` the calls the current item has made: an item's first call needs only room,
 * but a further call (a retry) needs room beyond `owed`, so a retry never takes the call a later item has not had yet.
 */
export interface CallRoom { left: number; owed: number; item: number }

/**
 * The adapter a background task calls through: refuses a web search unless `allowSearch` says otherwise (only the name research, when the family has web search on), books each
 * call against the background cap and then against the whole budget, and settles both to what the call really cost. `meter`
 * collects what the run spent, for the run log.
 */
export function backgroundAdapter(tree: string, inner: AiAdapter, o: { monthlyMicros: number; capMicros: number; price: Price; c: Tr; meter: { micros: number; calls?: number }; allowSearch?: boolean; room?: CallRoom }): AiAdapter {
  const total = budgeted(tree, o.monthlyMicros, inner, o.price, o.c);
  return {
    provider: inner.provider,
    model: inner.model,
    reasoning: inner.reasoning,
    async complete(req: AiRequest): Promise<AiReply> {
      if (req.webSearch && !o.allowSearch) throw new AiError('bad-input', o.c('aitasks.errSearch'));
      const room = o.room;
      if (room && (room.left <= 0 || (room.item > 0 && room.left <= room.owed))) throw new AiError('budget', o.c('aitasks.errCalls'));
      const cap = outputCap(inner.provider, inner.model, req.maxTokens, inner.reasoning);
      const estimate = estimateMicros(req, o.price, cap, callRounds(inner.provider, req));
      const booked = await reserveBackground(tree, o.capMicros, estimate, o.c);
      if (room) {
        // Counted once the call is going out, failed or not: it may have billed.
        room.left--;
        room.item++;
      }
      let actual = booked.amount;
      try {
        const reply = await total.complete(req);
        actual = replyMicros(reply, o.price);
        o.meter.calls = (o.meter.calls ?? 0) + 1;
        return reply;
      } catch (e) {
        if (!(e instanceof AiError && e.code === 'budget')) o.meter.calls = (o.meter.calls ?? 0) + 1;
        // The same rule the budget applies to a failed call: what its completed requests billed, plus a request in flight
        // that may have billed, else nothing when the provider did not bill it.
        actual = e instanceof AiError && e.billed
          ? replyMicros(e.billed, o.price) + (e.inFlight && (e.code === 'timeout' || e.code === 'bad-output') ? estimateMicros(req, o.price, cap, 1) : 0)
          : failureMicros(e, booked.amount);
        throw e;
      } finally {
        await settleBackground(tree, booked, actual);
        o.meter.micros += actual;
      }
    },
  };
}

// ---------- runs ----------

export interface TaskOutcome {
  status: TaskRun['status'];
  done: number;
  failed: number;
  waiting: number;
  micros: number;
  /** Provider calls made: what the daily run's limit counts. */
  calls: number;
  note: string;
}

export interface RunOptions {
  /** Who asked: the schedule, or a steward's "Run now". */
  source?: 'schedule' | 'manual';
  now?: Date;
  /** Items to do in this run at most (defaults to BATCH). */
  limit?: number;
  /** The daily run's shared call room: every provider call of this run is counted in it, retries included. */
  room?: CallRoom;
  /** Tests: the provider adapter, and its price, instead of the family's own key. Never set in the app. */
  adapter?: AiAdapter;
  price?: Price;
}

/** Runs in progress in this process, so a steward's "Run now" never doubles a scheduled run of the same task. */
const running = new Set<string>();

const skipped = (note: string): TaskOutcome => ({ status: 'skipped', done: 0, failed: 0, waiting: 0, micros: 0, calls: 0, note });

/**
 * Runs one task for a family, one batch at most. Never throws: a failure is recorded as a `failed` run. Writes the run log
 * for a run that did something, failed or stopped at the cap. With nothing to do it returns `idle` and writes nothing.
 */
export async function runTask(tree: string, task: Task, o: RunOptions = {}): Promise<TaskOutcome> {
  const key = `${tree}\u0000${task}`;
  if (running.has(key)) return skipped('busy');
  running.add(key);
  const source = o.source ?? 'manual';
  const now = o.now ?? new Date();
  try {
    const bg = await readBackground(tree);
    // First, from the database alone: is there anything to do? If not, nothing else happens: no key is opened, nothing is
    // reserved, no run is written. A scheduled check only notes that it looked, so the schedule counts from now.
    const items: Pending[] = await pending(tree, task, bg.languages);
    if (items.length === 0) {
      if (source === 'schedule') await accounts().run('UPDATE ai_background_task SET last_checked = ? WHERE tree = ? AND task = ?', now.getTime(), tree, task);
      return { status: 'idle', done: 0, failed: 0, waiting: 0, micros: 0, calls: 0, note: '' };
    }
    const ready = await readiness(tree, task, bg);
    if (ready.state !== 'ready') {
      const out = skipped(ready.state);
      if (source === 'manual') await logRun(tree, task, source, now, out);
      return out;
    }
    const c = tr(bg.locale);
    const meter = { micros: 0, calls: 0 };
    // The task's own route: its provider's key and model. Nothing falls back to another provider.
    const routed = await routeAdapter(tree, TASK_ROUTE[task], bg.locale);
    const inner = o.adapter ?? routed.inner;
    const price = o.price ?? routed.price;
    const adapter = backgroundAdapter(tree, inner, { monthlyMicros: ready.settings.monthlyMicros, capMicros: capMicros(ready.settings.monthlyMicros, bg.capShare), price, c, meter, allowSearch: task === 'names' && ready.settings.webSearch, room: o.room });
    let done = 0;
    let failed = 0;
    let stopped = false;
    let note = '';
    const batch = items.slice(0, o.limit ?? BATCH);
    for (const [at, item] of batch.entries()) {
      if (o.room) {
        o.room.owed = batch.length - at - 1;
        o.room.item = 0;
      }
      try {
        await perform(tree, item, { adapter, locale: bg.locale, now, webSearch: ready.settings.webSearch });
        await accounts().run('DELETE FROM ai_task_giveup WHERE tree = ? AND task = ? AND item = ?', tree, task, itemKey(item));
        done++;
      } catch (e) {
        if (e instanceof AiError && e.code === 'budget') {
          stopped = true;
          note = e.message;
          break;
        }
        failed++;
        await recordFailure(tree, item, e);
        note = e instanceof AiError ? e.message : c('aitasks.errFailed');
      }
    }
    const waiting = items.length - done;
    const status: TaskRun['status'] = stopped ? 'stopped' : done === 0 && failed > 0 ? 'failed' : 'done';
    const out: TaskOutcome = { status, done, failed, waiting, micros: meter.micros, calls: meter.calls, note };
    await accounts().run('UPDATE ai_background_task SET last_started = ? WHERE tree = ? AND task = ?', now.getTime(), tree, task);
    await logRun(tree, task, source, now, out);
    return out;
  } catch (e) {
    const out: TaskOutcome = { status: 'failed', done: 0, failed: 1, waiting: 0, micros: 0, calls: 0, note: e instanceof AiError ? e.message : tr('en')('aitasks.errFailed') };
    await logRun(tree, task, source, now, out);
    return out;
  } finally {
    running.delete(key);
  }
}

async function logRun(tree: string, task: Task, source: 'schedule' | 'manual', now: Date, out: TaskOutcome): Promise<void> {
  const a = accounts();
  await a.run(
    'INSERT INTO ai_task_run (tree, task, source, started, status, done, failed, waiting, micros, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    tree, task, source, now.getTime(), out.status, out.done, out.failed, out.waiting, out.micros, out.note.slice(0, 300),
  );
  await a.run(
    'DELETE FROM ai_task_run WHERE tree = ? AND id NOT IN (SELECT id FROM ai_task_run WHERE tree = ? ORDER BY id DESC LIMIT ?)',
    tree, tree, RUNS_KEPT,
  );
}

/**
 * The daily run, for every family the deployment serves: each switched-on task that is due runs one batch, and the whole run
 * makes at most CALLS_PER_DAILY_RUN provider calls. Work left over waits for the next day: the lists are recomputed, so nothing
 * is lost and nothing is done twice.
 */
export async function runScheduled(trees: string[], now: Date, log: (message: string) => void): Promise<void> {
  const room: CallRoom = { left: CALLS_PER_DAILY_RUN, owed: 0, item: 0 };
  for (const tree of trees) {
    const bg = await readBackground(tree);
    for (const task of TASKS) {
      const t: TaskSetting = bg.tasks[task];
      if (!t.enabled || !isDue(lastLooked(t), t.schedule, now.getTime())) continue;
      const limit = Math.min(BATCH, task === 'names' ? Math.floor(room.left / CALLS_PER_NAME) : room.left);
      if (limit <= 0) {
        log(`${tree}: ${task} waits for the next run (today's ${CALLS_PER_DAILY_RUN} calls are used)`);
        continue;
      }
      const out = await runTask(tree, task, { source: 'schedule', now, limit, room });
      if (out.status !== 'skipped') log(`${tree}: ${task} ${out.status}: ${out.done} done, ${out.failed} failed, ${out.waiting} waiting`);
    }
  }
}

// ---------- what the steward sees ----------

/**
 * What the AI activity page shows: each task's state, what is still waiting, the recent runs, what is waiting for a steward
 * (arms reviews that suggest a change and are not kept), and the spending. Reads only.
 */
export async function activity(tree: string, now = new Date()): Promise<Activity> {
  const bg = await readBackground(tree);
  const settings = await readSettings(tree);
  const tasks: ActivityTask[] = [];
  for (const task of TASKS) {
    const t = bg.tasks[task];
    const state = (await readiness(tree, task, bg)).state;
    // What it still has to do: the list is recomputed, so this is the number a run would work through.
    const waiting = (await pending(tree, task, bg.languages)).length;
    tasks.push({ task, enabled: t.enabled, schedule: t.schedule, lastStarted: t.lastStarted, waiting, state });
  }
  const runs = await accounts().all<{ id: number; task: string; source: string; started: number; status: string; done: number; failed: number; waiting: number; micros: number; note: string }>(
    'SELECT * FROM ai_task_run WHERE tree = ? ORDER BY id DESC LIMIT 60',
    tree,
  );
  const names = new Map((await db(tree).all<{ id: string; name: string }>('SELECT id, name FROM house')).map((h) => [h.id, h.name]));
  const waiting: WaitingReview[] = [];
  for (const [house, r] of Object.entries(await readReviews(tree))) {
    if (!needsAttention(r)) continue;
    waiting.push({ house, name: names.get(house) ?? house, verdict: r.verdict as 'partly' | 'reconsider', reason: r.reason, advice: r.advice, checkedAt: r.checkedAt });
  }
  const weekAgo = now.getTime() - 7 * 86_400_000;
  const failedRecently = (await accounts().get<{ n: number }>("SELECT COUNT(*) AS n FROM ai_task_run WHERE tree = ? AND status = 'failed' AND started > ?", tree, weekAgo))?.n ?? 0;
  return {
    settings: bg,
    tasks,
    runs: runs.map((r) => ({
      id: r.id,
      task: isTask(r.task) ? r.task : 'arms',
      source: r.source === 'schedule' ? 'schedule' : 'manual',
      started: r.started,
      status: r.status as TaskRun['status'],
      done: r.done,
      failed: r.failed,
      waiting: r.waiting,
      micros: r.micros,
      note: r.note,
    })),
    waiting,
    failedRecently,
    capMicros: capMicros(settings.monthlyMicros, bg.capShare),
    backgroundSpentMicros: await backgroundSpentThisMonth(tree),
    monthlyMicros: settings.monthlyMicros,
    spentMicros: await spentThisMonth(tree),
    resetsOn: resetsOn(now),
  };
}

/** The number on the quiet badge: arms suggestions waiting for a steward, and failed runs in the last week. Reads only. */
export async function attention(tree: string, now = new Date()): Promise<number> {
  let n = 0;
  for (const r of Object.values(await readReviews(tree))) if (needsAttention(r)) n++;
  const weekAgo = now.getTime() - 7 * 86_400_000;
  n += (await accounts().get<{ n: number }>("SELECT COUNT(*) AS n FROM ai_task_run WHERE tree = ? AND status = 'failed' AND started > ?", tree, weekAgo))?.n ?? 0;
  return n;
}
