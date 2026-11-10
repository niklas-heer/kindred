// Saving a form on its own: after a short pause, or at once when the reader leaves a field. One write at a time, and only
// when what would be written differs from what the server has, so D1 and the person's revision see a change per pause and
// not one per keystroke. A failed write is tried again and nothing the reader typed is touched. A conflict stops the
// writing until the reader has chosen. No React here, so the test runner loads it.
import { CHANGED_SINCE_OPENED } from './model.ts';
import { rebaseDraft, type Conflict, type RebaseField } from './rebase.ts';

export type SaveState =
  /** Everything is written. */
  | 'saved'
  /** A change is waiting for the pause. */
  | 'waiting'
  | 'saving'
  /** The last write failed; another is scheduled. */
  | 'retrying'
  /** The write was refused, or the retries ran out. Waits for a change or a Retry. */
  | 'failed'
  /** A conflict is open: nothing is written. */
  | 'paused';

/** What became of one write. A write that could be tried again rejects instead. */
export type Outcome =
  | 'saved'
  /** The draft was rebased on someone else's version without a clash: write it again now. */
  | 'again'
  /** The draft was rebased and the reader has to choose: stop writing. */
  | 'conflict'
  /** The server will never take this version as it stands. */
  | 'refused';

export interface Timers { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void }
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

/** The pause after the last keystroke before a change is written. */
export const AUTOSAVE_DELAY = 900;
/** The waits between the tries of a failed write. Going offline for longer ends in `failed`, and coming back tries again. */
export const RETRY_DELAYS: readonly number[] = [2_000, 5_000, 15_000, 30_000];
/** A rebase that keeps being overtaken is treated as a failed write after this many rounds, so it cannot spin. */
const MAX_AGAIN = 3;

export interface AutosaveOptions<V> {
  initial: V;
  /** What would be written, as text. Two values with the same signature need no write between them. */
  signature: (v: V) => string;
  send: (v: V) => Promise<Outcome>;
  onState?: (s: SaveState) => void;
  delay?: number;
  retryDelays?: readonly number[];
  timers?: Timers;
}

export type Autosaver<V> = ReturnType<typeof createAutosaver<V>>;

export function createAutosaver<V>(o: AutosaveOptions<V>) {
  const timers = o.timers ?? realTimers;
  const delay = o.delay ?? AUTOSAVE_DELAY;
  const retryDelays = o.retryDelays ?? RETRY_DELAYS;
  let latest = o.initial;
  let savedSig = o.signature(o.initial);
  let refusedSig: string | null = null;
  let state: SaveState = 'saved';
  let paused = false;
  let closed = false;
  let debounce: unknown = null;
  let retryTimer: unknown = null;
  let attempt = 0;
  let again = 0;
  let running: Promise<boolean> | null = null;

  const set = (s: SaveState) => { if (s !== state) { state = s; o.onState?.(s); } };
  const stopDebounce = () => { if (debounce !== null) { timers.clear(debounce); debounce = null; } };
  const stopRetry = () => { if (retryTimer !== null) { timers.clear(retryTimer); retryTimer = null; } };

  function failed(): false {
    attempt += 1;
    if (!closed && attempt <= retryDelays.length) {
      set('retrying');
      retryTimer = timers.set(() => { retryTimer = null; void drain(); }, retryDelays[attempt - 1]!);
    } else {
      set('failed');
    }
    return false;
  }

  async function loop(): Promise<boolean> {
    for (;;) {
      if (paused) { set('paused'); return false; }
      // The reader is still typing: the pause's timer starts the next write.
      if (debounce !== null) { set('waiting'); return false; }
      const value = latest;
      const sig = o.signature(value);
      if (sig === savedSig) { attempt = 0; again = 0; refusedSig = null; set('saved'); return true; }
      if (sig === refusedSig) { set('failed'); return false; }
      set('saving');
      let out: Outcome;
      try {
        out = await o.send(value);
      } catch {
        return failed();
      }
      if (out === 'saved') { savedSig = sig; attempt = 0; again = 0; continue; }
      if (out === 'again') {
        again += 1;
        if (again > MAX_AGAIN) { again = 0; return failed(); }
        continue;
      }
      if (out === 'conflict') { paused = true; set('paused'); return false; }
      refusedSig = sig;
      set('failed');
      return false;
    }
  }

  function drain(): Promise<boolean> {
    if (!running) running = loop().finally(() => { running = null; });
    return running;
  }

  /** Writes what is waiting now. True once everything is written. */
  function flush(): Promise<boolean> {
    stopDebounce();
    stopRetry();
    return drain();
  }

  return {
    get state() { return state; },
    /** The reader changed something: it is written after the pause. */
    change(v: V) {
      latest = v;
      if (paused) return;
      if (o.signature(v) === savedSig) {
        stopDebounce();
        if (running) return;
        stopRetry();
        attempt = 0;
        refusedSig = null;
        set('saved');
        return;
      }
      attempt = 0;
      stopRetry();
      stopDebounce();
      debounce = timers.set(() => { debounce = null; void drain(); }, delay);
      if (!running) set('waiting');
    },
    flush,
    /** A manual retry: also takes back a refusal, in case what refused it has changed. */
    retry() { refusedSig = null; attempt = 0; return flush(); },
    /** The connection or the page came back: if a write is owed, try now rather than wait out the backoff. */
    wake() { if (state === 'retrying' || state === 'failed') { attempt = 0; void flush(); } },
    /** Stops writing until `resume`. What the reader types meanwhile is kept and written then. */
    pause() { paused = true; stopDebounce(); stopRetry(); set('paused'); },
    resume() {
      paused = false;
      if (o.signature(latest) === savedSig) { set('saved'); return; }
      void flush();
    },
    /** The server now holds `v` (a rebase has just read it): only differences from `v` need writing. */
    baseline(v: V) { savedSig = o.signature(v); refusedSig = null; },
    /** The form is going away: one last try, and no retries after it. */
    close() { closed = true; return flush(); },
    /** The form is back (React's effects run twice in development). */
    open() { closed = false; },
  };
}

/** What a failed write means: someone else got there first, the server will never take it, or it is worth trying again. */
export function classifyFailure(message: string, isKnown: (m: string) => boolean): 'stale' | 'refused' | 'transient' {
  if (message === CHANGED_SINCE_OPENED) return 'stale';
  // The one known message that says "not this time", from `once` in db.server.ts.
  if (/changed while this was being saved/.test(message)) return 'transient';
  // A validator's JSON, or a sentence written for the reader: the same version would get the same answer.
  if (message.startsWith('[') || isKnown(message)) return 'refused';
  return 'transient';
}

/** One saved change: the draft before it and after it, as the server held them. */
export interface UndoStep<V> { before: V; after: V }
/** The most changes the Undo can walk back. */
export const MAX_UNDO = 20;

/**
 * The current draft with one saved change taken back. A three-way rebase with the sides turned round: what the change
 * touched goes back, and everything else (someone's merged edit, the reader's later ones) stays as it is now.
 */
export function undoStep<V extends { fields: F[] }, F extends RebaseField>(step: UndoStep<V>, current: V): { values: V; conflicts: Conflict<F>[] } {
  return rebaseDraft<V, F>(step.after, step.before, current);
}

/**
 * The draft on this device, while the server does not have it yet: a sleeping phone or a killed page can end any write,
 * so what was typed is kept until a write is confirmed. It holds the base as well, so opening it again rebases it like any
 * other stale draft and never overwrites what someone else did in the meantime.
 */
export interface Journal<V> { at: number; revision: number; base: V; draft: V }
export interface JournalStore { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; removeItem: (k: string) => void }

/** A draft older than this is not brought back: it would surprise more than it helps. */
export const JOURNAL_KEEP_MS = 14 * 86_400_000;

export { JOURNAL_PREFIX, journalKey } from './journal-key.ts';

/** Storage can be missing, full or blocked (a private window): the form works without it. */
export function readJournal<V>(store: JournalStore | undefined, key: string, now: number): Journal<V> | null {
  try {
    const raw = store?.getItem(key);
    if (!raw) return null;
    const j = JSON.parse(raw) as Journal<V>;
    if (typeof j.revision !== 'number' || !j.base || !j.draft) return null;
    if (now - j.at > JOURNAL_KEEP_MS) { store?.removeItem(key); return null; }
    return j;
  } catch {
    return null;
  }
}

export function writeJournal<V>(store: JournalStore | undefined, key: string, j: Journal<V>): void {
  try { store?.setItem(key, JSON.stringify(j)); } catch { /* see readJournal */ }
}

export function clearJournal(store: JournalStore | undefined, key: string): void {
  try { store?.removeItem(key); } catch { /* see readJournal */ }
}

/** The element Next moves to from `from`, in the order of `all`; null at the end. */
export function nextAfter<T>(all: readonly T[], from: T): T | null {
  const i = all.indexOf(from);
  return i >= 0 ? all[i + 1] ?? null : null;
}
