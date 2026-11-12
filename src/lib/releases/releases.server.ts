// The "New in Kindred" card (src/components/releases/ReleaseCard.tsx): shown to a signed-in account once per minor version,
// and only to accounts made before this server first ran that version (accounts tables `release_running` and
// `release_seen`, migration 0038). Never in a demo or a steward's "View as" preview: there is nothing to keep it dismissed in.
import { q, store } from '../store/index.ts';
import { readOnly } from '../read-only.ts';
import { appVersion } from '../version.ts';
import { minorOf, newestFor, type Reader, type Release } from './index.ts';

const accounts = () => store.accounts();

/** Notes the first time this server runs a minor version (skipped while nothing may be written). Returns when that was. */
export async function runningSince(version: string, now = Date.now()): Promise<number | null> {
  const minor = minorOf(version);
  const row = await accounts().get<{ at: number }>('SELECT at FROM release_running WHERE version = ?', minor);
  if (row) return row.at;
  if (readOnly()) return null;
  await accounts().batch([q('INSERT INTO release_running (version, at) VALUES (?, ?) ON CONFLICT(version) DO NOTHING', minor, now)]);
  return (await accounts().get<{ at: number }>('SELECT at FROM release_running WHERE version = ?', minor))?.at ?? now;
}

// Once per process (or Worker isolate): a later request needs no second look.
const g = globalThis as unknown as { __kindredReleaseNoted?: string };

/**
 * Called with every session read (src/lib/auth/functions.ts), so the version's first run is noted before a new install's first
 * account is made: those accounts were never on an older version and get no card. Never fails the request.
 */
export async function noteRunning(version = appVersion(), now = Date.now()): Promise<void> {
  if (!version || g.__kindredReleaseNoted === version || readOnly()) return;
  try {
    if ((await runningSince(version, now)) !== null) g.__kindredReleaseNoted = version;
  } catch {
    // The card is a nicety: a failure here must not stop anyone from signing in. The next request tries again.
  }
}

/** The release to show `user` a card for, or null: the newest with highlights for them, not yet seen, made after their account. */
export async function cardFor(user: { id: string; created: number }, reader: Reader, running: string | null, now = Date.now()): Promise<Release | null> {
  if (!running || readOnly()) return null;
  const release = newestFor(reader, running);
  if (!release) return null;
  const since = await runningSince(running, now);
  // The release whose highlights we would show must have arrived while this account already existed.
  const arrived = minorOf(release.version) === minorOf(running) ? since : (await accounts().get<{ at: number }>('SELECT at FROM release_running WHERE version = ?', minorOf(release.version)))?.at ?? null;
  if (arrived === null || user.created >= arrived) return null;
  const seen = await accounts().get<{ version: string }>('SELECT version FROM release_seen WHERE user = ?', user.id);
  if (seen && !newerMinor(minorOf(release.version), seen.version)) return null;
  return release;
}

const newerMinor = (a: string, b: string) => {
  const [x, y] = [a.split('.').map(Number), b.split('.').map(Number)];
  return x[0]! !== y[0]! ? x[0]! > y[0]! : (x[1] ?? 0) > (y[1] ?? 0);
};

/** The card is dismissed (or followed) for this minor version. */
export async function markSeen(userId: string, version: string, now = Date.now()): Promise<void> {
  await accounts().batch([q(
    'INSERT INTO release_seen (user, version, at) VALUES (?, ?, ?) ON CONFLICT(user) DO UPDATE SET version = excluded.version, at = excluded.at',
    userId, minorOf(version), now,
  )]);
}
