// The operator's policies on the server (docs/hosting-many-families.md, "Policies"). `effective(tree, key)` is the one
// resolver: the guard's callers, the server functions, the daily jobs and the AI adapters ask it, never only the browser.
// It reads the facts from the accounts database and decides with `decideFeature` / `decideAiSource` (./policy.ts).
//
// Turning something off deletes nothing: the family's settings, games, conversations and subscriptions stay, and come back
// as they were when the operator turns it on again. Background work for a feature that is off stops (it is skipped).
import { families } from '../auth/trees.server.ts';
import type { UserRow } from '../auth/store.server.ts';
import { AuthError } from '../auth/errors.ts';
import { translate } from '../i18n/dictionary.ts';
import { q, store, type Query } from '../store/index.ts';
import { audit, instanceSettings } from './settings.server.ts';
import {
  POLICY_KEYS, decideAiSource, decideFeature, lockOf, parseAiSource, type AiSourceValue, type Effective, type FamilyAi, type FamilyPolicies,
  type FeatureKey, type PolicyEntry, type PolicyFacts, type PolicyImpact, type PolicyKey, type PolicyScope,
} from './policy.ts';

const accounts = () => store.accounts();

/** The key under which the operator's own AI keys are sealed: no family id can be this (ids are `[a-z0-9-]`). */
export const OPERATOR_SEAL = '*operator';

/** Whether this server can offer a feature at all, from its configuration. */
export async function deploymentAllows(key: PolicyKey): Promise<boolean> {
  if (key === 'feature.push') {
    const { vapidFrom, envSetting } = await import('../reminders.server.ts');
    return vapidFrom(envSetting) !== null;
  }
  if (key === 'feature.address_lookup') return (await import('../address-lookup.server.ts')).addressLookupOn();
  return true;
}

interface InstanceRow { key: string; scope: PolicyScope; value: string; updated_at: number }
interface FamilyRow { tree: string; key: string; granted: number }
interface AdminRow { tree: string; status: 'active' | 'suspended'; closed: number }

const statusOf = (r: AdminRow | undefined): PolicyFacts['status'] => (r?.status === 'suspended' ? (r.closed === 1 ? 'closed' : 'suspended') : 'active');

/** The facts for one family and one key, in one round trip. */
async function factsFor(tree: string, key: PolicyKey): Promise<PolicyFacts> {
  const reads = [
    q('SELECT key, scope, value, updated_at FROM instance_policy WHERE key = ?', key),
    q('SELECT tree, key, granted FROM family_policy WHERE tree = ? AND key = ?', tree, key),
    q('SELECT tree, status, closed FROM family_admin WHERE tree = ?', tree),
  ];
  if (key === 'ai.source') {
    reads.push(q('SELECT funding FROM ai_settings WHERE tree = ?', tree), q('SELECT provider FROM operator_ai_provider'));
  }
  const [inst, fam, admin, funding, keys] = (await accounts().readBatch(reads)) as unknown as [InstanceRow[], FamilyRow[], AdminRow[], { funding: string }[]?, { provider: string }[]?];
  const facts: PolicyFacts = {
    deployment: await deploymentAllows(key),
    status: statusOf(admin[0]),
    instance: inst[0] ? { scope: inst[0].scope, value: inst[0].value } : null,
    family: fam[0] ? { granted: fam[0].granted === 1 } : null,
  };
  if (key === 'ai.source') {
    const v = parseAiSource(facts.instance?.value);
    facts.optedIn = funding?.[0]?.funding === 'operator';
    facts.operatorKey = !!v.provider && !!keys?.some((k) => k.provider === v.provider);
  }
  return facts;
}

/**
 * What one family may use of one feature, and which level decided it. `choice` carries the steward's switch and the member's
 * own choice where the feature has them; leave them out to ask only the server and the operator.
 */
export async function effective(tree: string, key: FeatureKey, choice?: { steward?: boolean; member?: boolean }): Promise<Effective>;
export async function effective(tree: string, key: 'ai.source'): Promise<Effective<FamilyAi>>;
export async function effective(tree: string, key: PolicyKey, choice: { steward?: boolean; member?: boolean } = {}): Promise<Effective<FamilyAi | null>> {
  const facts = await factsFor(tree, key);
  if (key === 'ai.source') return decideAiSource(facts);
  return decideFeature({ ...facts, ...choice });
}

/**
 * The operator's and the family's levels only, for a caller that has already shown the server can do it (a push sender
 * holding the VAPID keys it was given). Everything else asks `effective` or `allowed`.
 */
export async function familyAllows(tree: string, key: FeatureKey): Promise<boolean> {
  return decideFeature({ ...(await factsFor(tree, key)), deployment: true }).allowed;
}

/** Shorthand for a feature that is simply on or off for the family. */
export const allowed = async (tree: string, key: FeatureKey): Promise<boolean> => (await effective(tree, key)).allowed;

/** The sentence a refusal carries, in English (the browser translates it: translateMessage). */
export const policyOff = () => new AuthError('forbidden', translate('en', 'policy.err.off'));

/** Refuses with `policyOff` unless the family may use the feature. */
export async function requireAllowed(tree: string, key: FeatureKey): Promise<void> {
  if (!(await allowed(tree, key))) throw policyOff();
}

// ---------- the stewards' view ----------

/** What a family's stewards are told: each feature's lock, the AI's source and the operator-funded month. */
export async function familyPolicies(tree: string): Promise<FamilyPolicies> {
  const features = Object.fromEntries(await Promise.all(
    POLICY_KEYS.filter((k): k is FeatureKey => k !== 'ai.source').map(async (k) => [k, lockOf(await effective(tree, k))] as const),
  )) as FamilyPolicies['features'];
  const [ai, settings, spent] = await Promise.all([
    effective(tree, 'ai.source'), instanceSettings(),
    accounts().get<{ micros: number }>('SELECT micros FROM ai_operator_spend WHERE tree = ? AND month = ?', tree, new Date().toISOString().slice(0, 7)),
  ]);
  return {
    features,
    ai: {
      lock: lockOf(ai), source: ai.value.source, offered: ai.value.offered, opted: ai.value.opted,
      spentMicros: spent?.micros ?? 0, budgetMicros: ai.value.familyMicros,
    },
    contact: settings.contactEmail.trim() || null,
  };
}

// ---------- the console ----------

/** Every policy as the console edits it, with the families named for it. */
export async function policyEntries(): Promise<PolicyEntry[]> {
  const [inst, fam] = (await accounts().readBatch([
    q('SELECT key, scope, value, updated_at FROM instance_policy'),
    q('SELECT tree, key, granted FROM family_policy'),
  ])) as unknown as [InstanceRow[], FamilyRow[]];
  return Promise.all(POLICY_KEYS.map(async (key): Promise<PolicyEntry> => {
    const row = inst.find((r) => r.key === key);
    const scope = row?.scope ?? 'families';
    // Under `selected` the console lists the families granted it; under `families`, those withheld from it.
    const listed = fam.filter((f) => f.key === key && f.granted === (scope === 'selected' ? 1 : 0)).map((f) => f.tree);
    return { key, scope, ai: key === 'ai.source' ? parseAiSource(row?.value) : null, families: listed, available: await deploymentAllows(key), updatedAt: row?.updated_at ?? 0 };
  }));
}

export interface PolicyInput { scope: PolicyScope; ai?: AiSourceValue | null; families: string[] }

const invalid = (key: Parameters<typeof translate>[1]) => new AuthError('invalid', translate('en', key));

/** The rows that would be stored for `next`: the operator's row and one family row per family named. */
function rowsFor(key: PolicyKey, next: PolicyInput) {
  const value = key === 'ai.source' ? JSON.stringify(parseAiSource(JSON.stringify(next.ai ?? {}))) : '{}';
  const granted = next.scope === 'selected' ? 1 : 0;
  // Under `off` the list means nothing; it is kept out, so turning the scope back starts from no exceptions.
  const families = next.scope === 'off' ? [] : [...new Set(next.families)];
  return { value, granted, families };
}

/** The operator-level decision for every family, now and with `next` (no steward or member level: that is theirs). */
async function decisions(key: PolicyKey, next: PolicyInput) {
  const all = await families();
  const [inst, fam, admin, keys] = (await accounts().readBatch([
    q('SELECT key, scope, value, updated_at FROM instance_policy WHERE key = ?', key),
    q('SELECT tree, key, granted FROM family_policy WHERE key = ?', key),
    q('SELECT tree, status, closed FROM family_admin'),
    q('SELECT provider FROM operator_ai_provider'),
  ])) as unknown as [InstanceRow[], FamilyRow[], AdminRow[], { provider: string }[]];
  const deployment = await deploymentAllows(key);
  const rows = rowsFor(key, next);
  const decide = (facts: PolicyFacts) => {
    if (key !== 'ai.source') return decideFeature(facts).allowed ? 'on' : 'off';
    // For the AI, what changes is where a family's calls may go: compare what is offered to it.
    const d = decideAiSource({ ...facts, optedIn: true, operatorKey: true });
    return d.value.offered;
  };
  return all.map((f) => {
    const status = statusOf(admin.find((a) => a.tree === f.id));
    const famRow = fam.find((r) => r.tree === f.id);
    const before = decide({
      deployment, status, instance: inst[0] ? { scope: inst[0].scope, value: inst[0].value } : null, family: famRow ? { granted: famRow.granted === 1 } : null,
      operatorKey: !!keys.length,
    });
    const after = decide({
      deployment, status, instance: { scope: next.scope, value: rows.value },
      family: rows.families.includes(f.id) ? { granted: rows.granted === 1 } : null, operatorKey: !!keys.length,
    });
    return { id: f.id, name: f.name, before, after };
  });
}

const RANK: Record<string, number> = { off: 0, none: 0, byo: 1, operator: 2, either: 3, on: 1 };

/** How many families and accounts saving `next` would change, before anything is saved. */
export async function policyImpact(key: PolicyKey, next: PolicyInput): Promise<PolicyImpact> {
  const changed = (await decisions(key, next)).filter((d) => d.before !== d.after);
  const ids = changed.map((d) => d.id);
  let accountsN = 0;
  if (ids.length) {
    // In chunks, within D1's bound-parameter limit.
    const seen = new Set<string>();
    for (let i = 0; i < ids.length; i += 90) {
      const part = ids.slice(i, i + 90);
      const rows = await accounts().all<{ user: string }>(`SELECT DISTINCT user FROM membership WHERE tree IN (${part.map(() => '?').join(',')})`, ...part);
      for (const r of rows) seen.add(r.user);
    }
    accountsN = seen.size;
  }
  return {
    losing: changed.filter((d) => RANK[d.after]! < RANK[d.before]!).length,
    gaining: changed.filter((d) => RANK[d.after]! > RANK[d.before]!).length,
    accounts: accountsN,
    names: changed.slice(0, 20).map((d) => d.name),
  };
}

/** Saves one policy, with its families, in one batch with the audit entry. Nothing a family made is deleted. */
export async function savePolicy(op: UserRow, key: PolicyKey, next: PolicyInput, now = Date.now()): Promise<void> {
  const known = new Set((await families()).map((f) => f.id));
  if (next.families.some((f) => !known.has(f))) throw invalid('operator.err_no_family');
  if (key === 'ai.source' && next.ai) {
    const v = next.ai;
    if ((v.source === 'operator' || v.source === 'either') && (!v.provider || !v.model)) throw invalid('policy.err.operator_model');
    const { searchesOnItsOwn, chatModelId } = await import('../ai/adapters.ts');
    if (v.provider && v.model && searchesOnItsOwn(v.provider, chatModelId(v.provider, v.model))) throw invalid('policy.err.operator_model');
    // A model whose price Kindred does not know cannot be budgeted exactly: the operator's money is never spent on a guess.
    if (v.provider && v.model && !(await (await import('../ai/operator-funding.server.ts')).priceKnown(v.provider, chatModelId(v.provider, v.model)))) throw invalid('policy.err.no_price');
  }
  const rows = rowsFor(key, next);
  const grants: Query[] = rows.families.map((tree) =>
    q('INSERT INTO family_policy (tree, key, granted, value, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)', tree, key, rows.granted, '{}', now, op.id));
  const writes: Query[] = [
    q(`INSERT INTO instance_policy (key, scope, value, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET scope = excluded.scope, value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      key, next.scope, rows.value, now, op.id),
    q('DELETE FROM family_policy WHERE key = ?', key),
    ...grants,
    audit({ id: op.id, name: op.name }, 'policy', null, { key, scope: next.scope, families: rows.families.length, ...(key === 'ai.source' ? { ai: JSON.parse(rows.value) as unknown } : {}) }, now),
  ];
  // One batch is atomic. A server with very many families named sends the grants in batches of their own after it: a save
  // that stops part-way is saved again with the same rows.
  if (grants.length <= GRANTS_PER_BATCH) return void (await accounts().batch(writes));
  await accounts().batch([writes[0]!, writes[1]!, ...grants.slice(0, GRANTS_PER_BATCH), writes.at(-1)!]);
  for (let i = GRANTS_PER_BATCH; i < grants.length; i += GRANTS_PER_BATCH) await accounts().batch(grants.slice(i, i + GRANTS_PER_BATCH));
}

const GRANTS_PER_BATCH = 400;
