// "New in Kindred": the highlights of each release for the people who use it, translatable and filtered by who reads them
// (docs/releases/README.md says how to write them). Distinct from the family's own "What's new" (src/lib/history), which is
// about the family's records. Plain data and small rules, no server imports: the page, the card and the server share it.
import type { Key } from '../i18n/dictionary.ts';

/** Who a highlight is for: everyone (guests included), stewards (and operators), or operators only. */
export type Audience = 'everyone' | 'stewards' | 'operators';
export type Reader = Audience;

export interface Highlight {
  title: Key;
  /** One line saying what it means for the reader. */
  text: Key;
  audience: Audience;
}

export interface Release {
  version: string;
  /** The release day (YYYY-MM-DD), or null for one not out yet. */
  date: string | null;
  highlights: Highlight[];
  /** It fixes a security problem: an operator should update soon. */
  security?: boolean;
  /** Updating needs a step by hand (a setting, a migration to run): operators read the release notes first. */
  manual?: boolean;
}

const h = (title: Key, text: Key, audience: Audience = 'everyone'): Highlight => ({ title, text, audience });

/** Newest first. A release with no highlights yet is skipped everywhere. */
export const RELEASES: readonly Release[] = [
  // Filled in by the release: 3 to 8 highlights.
  {
    version: '2.4.0', date: '2026-11-12',
    highlights: [
      h('ops.r240.languages_title', 'ops.r240.languages_text'),
      h('ops.r240.signin_title', 'ops.r240.signin_text'),
      h('ops.r240.data_title', 'ops.r240.data_text'),
      h('ops.r240.requests_title', 'ops.r240.requests_text', 'stewards'),
      h('ops.r240.hosting_title', 'ops.r240.hosting_text', 'operators'),
      h('ops.r240.health_title', 'ops.r240.health_text', 'operators'),
    ],
  },
  {
    version: '2.3.0', date: '2026-11-12',
    highlights: [
      h('ops.r230.feed_title', 'ops.r230.feed_text'),
      h('ops.r230.campaign_title', 'ops.r230.campaign_text'),
      h('ops.r230.reign_title', 'ops.r230.reign_text'),
      h('ops.r230.legal_title', 'ops.r230.legal_text', 'stewards'),
      h('ops.r230.operator_title', 'ops.r230.operator_text', 'operators'),
      h('ops.r230.creation_title', 'ops.r230.creation_text', 'operators'),
    ],
  },
  {
    version: '2.2.0', date: '2026-11-11',
    highlights: [
      h('ops.r220.recipes_title', 'ops.r220.recipes_text'),
      h('ops.r220.campaign_title', 'ops.r220.campaign_text'),
      h('ops.r220.emoji_title', 'ops.r220.emoji_text'),
      h('ops.r220.here_title', 'ops.r220.here_text'),
      h('ops.r220.whois_title', 'ops.r220.whois_text'),
      h('ops.r220.tours_title', 'ops.r220.tours_text'),
    ],
  },
  {
    version: '2.1.0', date: '2026-11-11',
    highlights: [
      h('ops.r210.today_title', 'ops.r210.today_text'),
      h('ops.r210.reactions_title', 'ops.r210.reactions_text'),
      h('ops.r210.events_title', 'ops.r210.events_text'),
      h('ops.r210.history_title', 'ops.r210.history_text'),
      h('ops.r210.print_title', 'ops.r210.print_text'),
      h('ops.r210.join_title', 'ops.r210.join_text', 'stewards'),
      h('ops.r210.viewas_title', 'ops.r210.viewas_text', 'stewards'),
    ],
  },
  {
    version: '2.0.0', date: '2026-11-09', manual: true,
    highlights: [
      h('ops.r200.trees_title', 'ops.r200.trees_text'),
      h('ops.r200.houses_title', 'ops.r200.houses_text'),
      h('ops.r200.research_title', 'ops.r200.research_text'),
      h('ops.r200.privacy_title', 'ops.r200.privacy_text'),
      h('ops.r200.access_title', 'ops.r200.access_text', 'stewards'),
      h('ops.r200.ai_title', 'ops.r200.ai_text', 'stewards'),
    ],
  },
];

const RANK: Record<Audience, number> = { everyone: 0, stewards: 1, operators: 2 };

/** Whether `reader` sees a highlight for `audience`: an operator everything, a steward all but the operator's. */
export const sees = (reader: Reader, audience: Audience) => RANK[audience] <= RANK[reader];

/** "2.4" of "2.4.1": the card shows once per minor version. */
export const minorOf = (version: string) => version.split('.').slice(0, 2).join('.');

const parts = (v: string) => v.split(/[.-]/).slice(0, 3).map((n) => Number(n) || 0);
/** Whether release `a` is at most version `b` (patch releases of a minor share its highlights). */
const notAfter = (a: string, b: string) => {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! < y[i]!;
  return true;
};

/**
 * The releases a reader sees, newest first: those out by `running` (all when it is unknown), each with only the highlights
 * for them, and none left empty.
 */
export function releasesFor(reader: Reader, running: string | null, all: readonly Release[] = RELEASES): Release[] {
  return all
    .filter((r) => !running || notAfter(r.version, running))
    .map((r) => ({ ...r, highlights: r.highlights.filter((x) => sees(reader, x.audience)) }))
    .filter((r) => r.highlights.length > 0);
}

/** The newest release a reader has highlights of, for the card: null when there is none. */
export const newestFor = (reader: Reader, running: string | null, all: readonly Release[] = RELEASES) => releasesFor(reader, running, all)[0] ?? null;
