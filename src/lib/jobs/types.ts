// Daily background jobs: run once a day on Cloudflare (a cron trigger on the Worker) and on Node (a timer in
// server/node.ts). Each job does its own work for every family; the runner calls them in turn and logs failures,
// so one job's error never stops another.

/** What a job gets: the families to work on and the time the run started. */
export interface JobContext {
  /** Family ids the deployment serves (the same list as listTrees()). */
  trees: string[];
  /** When the run started; jobs use it instead of reading the clock, so a run is consistent and testable. */
  now: Date;
  /** Read a setting: a Worker var or secret on Cloudflare, process.env on Node. Undefined when unset or empty. */
  env: (name: string) => string | undefined;
  /** Log a line with the job's name in front. Never pass secrets or private family data. */
  log: (message: string) => void;
}

export interface DailyJob {
  /** Short and stable, for logs: "reminders", "archive". */
  name: string;
  run: (ctx: JobContext) => Promise<void>;
}
