// Updating this install from the operator console (docs/hosting-many-families.md, "Updates"): the shapes the console reads
// and the rules the server and the console share. No server imports.
import { RELEASES } from '../releases/index.ts';
import { compareVersions, type ReleaseInfo } from './updates-shared.ts';

/**
 * How this install is updated, from KINDRED_UPDATE_VIA (else guessed from where it runs):
 *   github-actions  a copy made by the Deploy to Cloudflare button, deployed by Workers Builds: the console's Update button
 *                   runs the copy's `.github/workflows/update.yml`
 *   docker          the published image: pull the new tag
 *   cloudflare      deployed by hand with wrangler (Durable Objects or D1): the steps in docs/deploy-cloudflare.md
 *   node            Node from a checkout: the steps in docs/self-host.md
 */
export const INSTALL_KINDS = ['github-actions', 'docker', 'cloudflare', 'node'] as const;
export type InstallKind = (typeof INSTALL_KINDS)[number];

/** The update the console last started: GitHub's run, as last asked. */
export interface UpdateRun {
  tag: string;
  startedAt: number;
  /** GitHub's run id and address once found (a run appears a few seconds after it is asked for). */
  id: number | null;
  url: string | null;
  /** `queued`, `in_progress`, `completed` (and GitHub's other words), or null before the run is found. */
  status: string | null;
  /** Once completed: `success`, `failure`, `cancelled`… */
  conclusion: string | null;
}

export interface SelfUpdate {
  install: InstallKind;
  /** The install's own repository and branch the workflow runs on, once the operator stored a token. Never the token. */
  repo: string | null;
  branch: string | null;
  /** The token's last four characters, and when it was stored. */
  tokenTail: string | null;
  setAt: number | null;
  run: UpdateRun | null;
  /** The published image without a tag, for Docker's steps. */
  image: string;
}

/** A run still going, so another is not started. A run never found is given up after this long. */
export const RUN_LOST_MS = 10 * 60_000;
export const runActive = (run: UpdateRun | null, now = Date.now()): boolean =>
  !!run && run.status !== 'completed' && (run.id !== null || now - run.startedAt < RUN_LOST_MS);

/** `owner/name` as GitHub allows it. */
export const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
/** A release tag the workflow accepts. */
export const TAG = /^v\d+\.\d+\.\d+$/;

/**
 * Whether a release fixes a security problem or needs a step by hand: Kindred's own word for a release this build knows
 * (src/lib/releases), or a marker in the release's notes for one that came later (docs/releases/README.md):
 * `<!-- kindred:manual -->` and `<!-- kindred:security -->`.
 */
export function releaseFlags(r: Pick<ReleaseInfo, 'version' | 'notes'>): { manual: boolean; security: boolean } {
  const known = RELEASES.find((x) => x.version === r.version);
  const marked = (word: string) => new RegExp(`<!--\\s*kindred:\\s*${word}\\s*-->`, 'i').test(r.notes);
  return { manual: !!known?.manual || marked('manual'), security: !!known?.security || marked('security') };
}

/** The notes without the flag markers, which the safe Markdown renderer would otherwise show as text. */
export const stripFlagMarkers = (notes: string) => notes.replace(/<!--\s*kindred:\s*(?:manual|security)\s*-->/gi, '');

/** The releases from the running one (not included) up to `target` (included), oldest first, from the release check. */
export const releasesUpTo = (newer: readonly ReleaseInfo[], target: string): ReleaseInfo[] =>
  newer.filter((r) => compareVersions(r.version, target) <= 0).sort((a, b) => compareVersions(a.version, b.version));

/** The commands that update an install by hand to `version` ("2.4.0", or null when no newer one is known). Shell, not words. */
export function updateCommands(how: 'docker-image' | 'docker-built' | 'cloudflare' | 'node', version: string | null): string {
  const checkout = `git fetch --tags && git checkout v${version ?? '<version>'}`;
  if (how === 'docker-image') return 'docker compose pull && docker compose up -d';
  if (how === 'docker-built') return `${checkout}\nKINDRED_COMMIT=$(git rev-parse --short HEAD) docker compose up -d --build`;
  if (how === 'cloudflare') return `${checkout}\nnpm install && mise run deploy`;
  return `${checkout}\nmise install && npm install && mise run build:node\nmise run start`;
}
