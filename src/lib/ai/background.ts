// Background AI tasks: which tasks there are, how often each runs, and the settings a steward chooses. Pure: the
// browser imports this file too, so nothing here touches a provider, a key or the database (see background.server.ts).
import { z } from 'zod';
import { LOCALES, type Locale } from '../i18n/types.ts';

/** The tasks, in the order they are listed. Adding one means a new entry here, its work in background-tasks.server.ts. */
export const TASKS = ['arms', 'occupations', 'chronicle'] as const;
export type Task = (typeof TASKS)[number];

export const SCHEDULES = ['daily', 'weekly'] as const;
export type Schedule = (typeof SCHEDULES)[number];

/** The family's own AI switch a task needs: the arms review uses the arms feature; the two translations use the assistant's. */
export const TASK_FEATURE: Record<Task, 'arms' | 'assistant'> = { arms: 'arms', occupations: 'assistant', chronicle: 'assistant' };

/**
 * The least time since a task last started before its schedule runs it again. A little under a day or a week, so a daily
 * job that runs at a fixed hour is never a whole day late.
 */
export const SCHEDULE_GAP_MS: Record<Schedule, number> = { daily: 20 * 3_600_000, weekly: 6.5 * 86_400_000 };

/** The share of the monthly budget that background work may use, as a fraction. The default is a fifth. */
export const DEFAULT_CAP_SHARE = 0.2;
export const CAP_SHARE_MIN = 0.05;
export const CAP_SHARE_MAX = 1;

/** Items a task works on per run: at most this many provider calls for one task in one run (Run now and the schedule alike). */
export const BATCH = 4;
/** All tasks of all families in one daily run: a cap that keeps a Cloudflare Free plan's subrequest limit safe. Work left over waits for the next run. */
export const CALLS_PER_DAILY_RUN = 8;

export interface TaskSetting {
  enabled: boolean;
  schedule: Schedule;
  /** When the task last started (ms since the epoch), or null before its first run. */
  lastStarted: number | null;
}

export interface BackgroundSettings {
  tasks: Record<Task, TaskSetting>;
  /** A fraction of the family's monthly budget. */
  capShare: number;
  /** The languages the translations go into (the chronicle and occupations). */
  languages: Locale[];
  /** The steward's language, for the text the arms reviews write. */
  locale: Locale;
  updated: number;
}

export const defaultTask = (): TaskSetting => ({ enabled: false, schedule: 'daily', lastStarted: null });

export function defaultSettings(): BackgroundSettings {
  return {
    tasks: { arms: defaultTask(), occupations: defaultTask(), chronicle: defaultTask() },
    capShare: DEFAULT_CAP_SHARE,
    languages: [...LOCALES],
    locale: 'en',
    updated: 0,
  };
}

/** Whether a task that last started at `lastStarted` is due again at `now` (ms). A task never run is due. */
export const isDue = (lastStarted: number | null, schedule: Schedule, now: number): boolean =>
  lastStarted === null || now - lastStarted >= SCHEDULE_GAP_MS[schedule];

/** The budget a background cap allows, in micro-dollars: a share of the monthly budget, rounded down. */
export const capMicros = (monthlyMicros: number, capShare: number): number => Math.max(0, Math.floor(monthlyMicros * capShare));

const taskSave = z.object({ enabled: z.boolean(), schedule: z.enum(SCHEDULES) });

/** What the settings page sends. Checked on the server; nothing else is written. */
export const saveSchema = z.object({
  tasks: z.object({ arms: taskSave, occupations: taskSave, chronicle: taskSave }),
  capShare: z.number().min(CAP_SHARE_MIN).max(CAP_SHARE_MAX),
  languages: z.array(z.enum(LOCALES)).max(LOCALES.length),
  locale: z.enum(LOCALES),
});
export type SaveInput = z.infer<typeof saveSchema>;

/** The statuses a run can end with (see ai_task_run in migrations/accounts/0009). */
export const RUN_STATUSES = ['done', 'idle', 'stopped', 'failed', 'skipped'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Why a task may or may not run now: the steward's switch, then the family's AI, then the task's own feature switch. */
export type Readiness = 'ready' | 'off' | 'no-key' | 'budget-off' | 'feature-off';

/** One task as the settings and activity pages show it. `waiting` counts the items still to do (houses, texts, translations). */
export interface ActivityTask {
  task: Task;
  enabled: boolean;
  schedule: Schedule;
  lastStarted: number | null;
  waiting: number;
  state: Readiness;
}

/** An arms review that suggests a change and has not been kept: it waits for a steward. */
export interface WaitingReview {
  house: string;
  name: string;
  verdict: 'partly' | 'reconsider';
  reason: string;
  advice: string;
  checkedAt: number;
}

/** What the AI activity page and the background section read. Money is in micro-dollars. */
export interface Activity {
  settings: BackgroundSettings;
  tasks: ActivityTask[];
  runs: TaskRun[];
  waiting: WaitingReview[];
  failedRecently: number;
  /** The background cap this month, what background work spent this month, the whole monthly budget, and what it all spent. */
  capMicros: number;
  backgroundSpentMicros: number;
  monthlyMicros: number;
  spentMicros: number;
  /** The first day of next month (UTC, YYYY-MM-DD): when the budget starts again. */
  resetsOn: string;
}

/** One run as the activity page shows it. `note` is a short reason (never family text). */
export interface TaskRun {
  id: number;
  task: Task;
  source: 'schedule' | 'manual';
  started: number;
  status: RunStatus;
  done: number;
  failed: number;
  waiting: number;
  micros: number;
  note: string;
}
