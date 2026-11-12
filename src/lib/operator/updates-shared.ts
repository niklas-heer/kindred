// "Am I up to date?" for the operator console (docs/hosting-many-families.md, "Updates"): the shapes the console reads and
// how two versions compare. No server imports.

/** The repository Kindred asks for releases unless KINDRED_UPDATE_REPO names a fork. */
export const DEFAULT_UPDATE_REPO = 'niklas-heer/kindred';

/** One release newer than the running one, as GitHub described it. Its notes are untrusted text, rendered safely. */
export interface ReleaseInfo {
  version: string;
  name: string;
  /** When it was published (ISO), or null. */
  date: string | null;
  url: string;
  notes: string;
}

export interface UpdateStatus {
  /** The running version and short commit, or null when the build did not say. */
  version: string | null;
  commit: string | null;
  /** Whether the check runs: not turned off by KINDRED_UPDATE_CHECK=off (`envOff`) or in the console. */
  enabled: boolean;
  envOff: boolean;
  /** Whether an operator answered the question (agreed or declined); until then the console asks before any outside call. */
  asked: boolean;
  repo: string;
  checkedAt: number | null;
  latest: string | null;
  /** Releases newer than the running one, newest first. */
  newer: ReleaseInfo[];
  /** The last check failed: a short reason (never shown as HTML). */
  error: string | null;
  updateAvailable: boolean;
}

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** "2.3.0" from "v2.3.0"; null for anything that is not a version. */
export function cleanVersion(tag: unknown): string | null {
  if (typeof tag !== 'string' || tag.length > 64) return null;
  const m = VERSION.exec(tag.trim());
  return m ? `${m[1]}.${m[2]}.${m[3]}${m[4] ? `-${m[4]}` : ''}` : null;
}

/** Negative when a is older than b, 0 when the same, positive when newer. A pre-release is older than its release. */
export function compareVersions(a: string, b: string): number {
  const pa = VERSION.exec(a), pb = VERSION.exec(b);
  if (!pa || !pb) return 0;
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d) return d;
  }
  if (pa[4] && !pb[4]) return -1;
  if (!pa[4] && pb[4]) return 1;
  return (pa[4] ?? '').localeCompare(pb[4] ?? '');
}
