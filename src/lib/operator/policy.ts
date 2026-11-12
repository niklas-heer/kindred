// The operator's policies for the server's features (docs/hosting-many-families.md, "Policies"): the keys, their scopes,
// the shapes the console and the stewards' pages read, and `decide`, the one rule that turns the facts about a family into
// what it may use. Pure: no server imports, so the browser and the tests read it too. The server reads the facts and calls
// `decide` in ./policy.server.ts (`effective`).
//
// Precedence, and denial wins at every step:
//   1. deployment  what this server can do at all (no VAPID keys: no push; KINDRED_ADDRESS_LOOKUP=off: no address lookup)
//   2. status      a suspended or closed family uses none of these features
//   3. operator    the policy's scope: `off` for every family, `families` (each family as its stewards choose), `selected`
//   4. grant       the operator's word for this family: granted (under `selected`) or withheld (under `families`)
//   5. steward     the family's own switch, where the feature has one
//   6. member      the member's own choice, where the feature has one (push on their device)

export const POLICY_KEYS = ['feature.campaign', 'feature.assistant', 'feature.portraits', 'feature.address_lookup', 'feature.push', 'ai.source'] as const;
export type PolicyKey = (typeof POLICY_KEYS)[number];
export type FeatureKey = Exclude<PolicyKey, 'ai.source'>;
export const isPolicyKey = (k: string): k is PolicyKey => (POLICY_KEYS as readonly string[]).includes(k);

export const POLICY_SCOPES = ['off', 'families', 'selected'] as const;
export type PolicyScope = (typeof POLICY_SCOPES)[number];

/**
 * Where a family's AI key comes from.
 *   none      no AI on this server
 *   byo       each family's own key (the default: today's behaviour)
 *   operator  only the operator's key, for families whose steward opted in
 *   either    the family's own key, or the operator's once its steward opts in
 */
export const AI_SOURCES = ['none', 'byo', 'operator', 'either'] as const;
export type AiSource = (typeof AI_SOURCES)[number];
export const AI_PROVIDERS = ['anthropic', 'openai', 'openrouter'] as const;
export type AiProviderName = (typeof AI_PROVIDERS)[number];

/** The value of `ai.source`: the source, the operator's provider and model, and the operator's monthly budgets (micro-dollars). */
export interface AiSourceValue {
  source: AiSource;
  /** The provider and model operator-funded AI uses; null until the operator picks one. */
  provider: AiProviderName | null;
  model: string;
  /** What one family may spend of the operator's money in a UTC month. */
  familyMicros: number;
  /** What all families together may spend of it in a UTC month. */
  ceilingMicros: number;
}

export const DEFAULT_AI_SOURCE: AiSourceValue = { source: 'byo', provider: null, model: '', familyMicros: 2_000_000, ceilingMicros: 20_000_000 };
/** The most a budget in the console may be: $100,000 a month. */
export const MAX_BUDGET_MICROS = 100_000_000_000;

export type DecidedBy = 'deployment' | 'status' | 'operator' | 'grant' | 'steward' | 'member' | 'default';

/** What a family gets for `ai.source`: the key its calls use (null: no AI), what the operator offers it, and its budget. */
export interface FamilyAi {
  source: 'byo' | 'operator' | null;
  offered: AiSource;
  /** The steward chose the operator's AI. */
  opted: boolean;
  provider: AiProviderName | null;
  model: string;
  familyMicros: number;
  ceilingMicros: number;
}

export interface Effective<V = null> { allowed: boolean; value: V; decidedBy: DecidedBy }

/** The facts `decide` needs about one family and one key. */
export interface PolicyFacts {
  /** Whether this server can offer the feature at all. */
  deployment: boolean;
  status: 'active' | 'suspended' | 'closed';
  /** The operator's row for the key; null: never set (`families`, default value). */
  instance: { scope: PolicyScope; value: string } | null;
  /** The operator's row for this family and key; null: none. */
  family: { granted: boolean } | null;
  /** The steward's switch, where the feature has one; undefined: not asked. */
  steward?: boolean;
  /** The member's own choice, where the feature has one; undefined: not asked. */
  member?: boolean;
  /** `ai.source` only: whether the steward opted in to the operator's AI, and whether the operator has a key for its provider. */
  optedIn?: boolean;
  operatorKey?: boolean;
}

/** `ai.source`'s stored value, with anything missing or malformed read as the default. */
export function parseAiSource(json: string | null | undefined): AiSourceValue {
  let v: Partial<AiSourceValue> = {};
  try {
    v = JSON.parse(json ?? '{}') as Partial<AiSourceValue>;
  } catch {
    // A value that cannot be read is the default.
  }
  const budget = (n: unknown, d: number) => (typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= MAX_BUDGET_MICROS ? n : d);
  return {
    source: (AI_SOURCES as readonly string[]).includes(v.source as string) ? (v.source as AiSource) : DEFAULT_AI_SOURCE.source,
    provider: (AI_PROVIDERS as readonly string[]).includes(v.provider as string) ? (v.provider as AiProviderName) : null,
    model: typeof v.model === 'string' && /^[A-Za-z0-9._:/-]{1,120}$/.test(v.model) ? v.model : '',
    familyMicros: budget(v.familyMicros, DEFAULT_AI_SOURCE.familyMicros),
    ceilingMicros: budget(v.ceilingMicros, DEFAULT_AI_SOURCE.ceilingMicros),
  };
}

/** The operator's level for one family: whether the scope and the family's grant let it have the key. */
function operatorAllows(f: PolicyFacts): { allowed: boolean; decidedBy: DecidedBy } {
  const scope = f.instance?.scope ?? 'families';
  if (scope === 'off') return { allowed: false, decidedBy: 'operator' };
  if (scope === 'selected') return f.family?.granted ? { allowed: true, decidedBy: 'grant' } : { allowed: false, decidedBy: 'grant' };
  if (f.family && !f.family.granted) return { allowed: false, decidedBy: 'grant' };
  return { allowed: true, decidedBy: f.instance ? 'operator' : 'default' };
}

/** A feature key, decided in order; the first step that denies decides. */
export function decideFeature(f: PolicyFacts): Effective {
  if (!f.deployment) return { allowed: false, value: null, decidedBy: 'deployment' };
  if (f.status !== 'active') return { allowed: false, value: null, decidedBy: 'status' };
  const op = operatorAllows(f);
  if (!op.allowed) return { allowed: false, value: null, decidedBy: op.decidedBy };
  if (f.steward === false) return { allowed: false, value: null, decidedBy: 'steward' };
  if (f.member === false) return { allowed: false, value: null, decidedBy: 'member' };
  return { allowed: true, value: null, decidedBy: f.steward === true ? 'steward' : f.member === true ? 'member' : op.decidedBy };
}

/**
 * `ai.source` for one family. Under `off`, no family has AI. Under `families`, every family gets the server's source (a family
 * the operator withheld it from keeps its own key). Under `selected`, the families granted it get the server's source and
 * the rest keep their own key. Then the steward's opt-in decides between the family's key and the operator's: the operator's
 * AI is never on by itself, and it needs a key the operator connected for its provider.
 */
export function decideAiSource(f: PolicyFacts): Effective<FamilyAi> {
  const v = parseAiSource(f.instance?.value);
  const opted = f.optedIn === true;
  const out = (source: FamilyAi['source'], offered: AiSource, decidedBy: DecidedBy): Effective<FamilyAi> => ({
    allowed: source !== null,
    value: { source, offered, opted, provider: v.provider, model: v.model, familyMicros: v.familyMicros, ceilingMicros: v.ceilingMicros },
    decidedBy,
  });
  if (f.status !== 'active') return out(null, 'none', 'status');
  const scope = f.instance?.scope ?? 'families';
  if (scope === 'off') return out(null, 'none', 'operator');
  const granted = scope === 'selected' ? f.family?.granted === true : f.family?.granted !== false;
  const offered: AiSource = granted ? v.source : 'byo';
  const by: DecidedBy = !granted ? 'grant' : f.instance ? 'operator' : 'default';
  if (offered === 'none') return out(null, offered, by);
  if (offered === 'byo') return out('byo', offered, by);
  const operatorReady = f.operatorKey === true && !!v.provider && !!v.model;
  if (offered === 'operator') {
    if (!operatorReady) return out(null, offered, 'deployment');
    return opted ? out('operator', offered, 'steward') : out(null, offered, 'steward');
  }
  // either
  return opted && operatorReady ? out('operator', offered, 'steward') : out('byo', offered, opted ? 'deployment' : 'steward');
}

// ---------- what the console and the stewards' pages read ----------

/** One policy as the console edits it: the families listed are those granted (`selected`) or withheld (`families`). */
export interface PolicyEntry {
  key: PolicyKey;
  scope: PolicyScope;
  /** `ai.source` only; null for a feature. */
  ai: AiSourceValue | null;
  families: string[];
  /** Whether this server can offer it at all (VAPID keys for push, KINDRED_ADDRESS_LOOKUP for address lookup). */
  available: boolean;
  updatedAt: number;
}

/** How many families and accounts a change would affect, before it is saved. */
export interface PolicyImpact {
  /** Families that would lose the feature (or, for `ai.source`, change where their AI comes from). */
  losing: number;
  gaining: number;
  /** The accounts that are members of those families. */
  accounts: number;
  /** The families' names, at most 20. */
  names: string[];
}

/** The operator's own AI keys, as the console shows them: never the key, only its last four characters. */
export interface OperatorKeyState { provider: AiProviderName; saved: boolean; keyTail: string | null; readable: boolean }

/** What a family's stewards are told about one policy: whether it is locked, and why, in one sentence. */
export interface PolicyLock { locked: boolean; reason: 'operator' | 'status' | 'deployment' | null }

/** The stewards' view of the operator's policies for their family. Members are never sent this. */
export interface FamilyPolicies {
  features: Record<FeatureKey, PolicyLock>;
  ai: {
    lock: PolicyLock;
    source: FamilyAi['source'];
    offered: AiSource;
    opted: boolean;
    /** This month's operator-funded spend and the family's budget from the operator (micro-dollars). */
    spentMicros: number;
    budgetMicros: number;
  };
  /** The operator's contact address, named beside a locked control. */
  contact: string | null;
}

/** The lock a steward sees for an effective decision: only the levels above the steward lock a control. */
export const lockOf = (e: Effective<unknown>): PolicyLock => {
  if (e.allowed) return { locked: false, reason: null };
  if (e.decidedBy === 'deployment') return { locked: true, reason: 'deployment' };
  if (e.decidedBy === 'status') return { locked: true, reason: 'status' };
  if (e.decidedBy === 'operator' || e.decidedBy === 'grant') return { locked: true, reason: 'operator' };
  return { locked: false, reason: null };
};

// ---------- announcements ----------

export const ANNOUNCEMENT_AUDIENCES = ['stewards', 'everyone'] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];
export const ANNOUNCEMENT_TITLE_MAX = 120;
export const ANNOUNCEMENT_BODY_MAX = 2000;

/** A banner from the operator. Plain text: it is never read as HTML or Markdown. */
export interface Announcement {
  id: string;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  startsAt: number;
  endsAt: number | null;
  createdAt: number;
}
