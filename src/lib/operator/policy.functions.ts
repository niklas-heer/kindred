// Server functions for the operator's policies and announcements (docs/hosting-many-families.md, "Policies" and
// "Announcements"): the console's Policies and Announcements tabs, the stewards' opt-in to the operator's AI (what is locked
// for their family reaches them with their AI settings and the Games page), and the banner every signed-in reader may get. Every console function checks
// `requireOperator` on the server; every change is refused while nothing may be written (a demo, a "View as" preview).
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import {
  AI_PROVIDERS, AI_SOURCES, ANNOUNCEMENT_AUDIENCES, ANNOUNCEMENT_BODY_MAX, ANNOUNCEMENT_TITLE_MAX, MAX_BUDGET_MICROS, POLICY_KEYS, POLICY_SCOPES,
  type Announcement, type OperatorKeyState, type PolicyEntry, type PolicyImpact,
} from './policy';

const tree = z.string().regex(/^[a-z0-9-]{1,64}$/);
const budget = z.number().int().min(0).max(MAX_BUDGET_MICROS);
const policyInput = z.object({
  key: z.enum(POLICY_KEYS),
  scope: z.enum(POLICY_SCOPES),
  ai: z.object({ source: z.enum(AI_SOURCES), provider: z.enum(AI_PROVIDERS).nullable(), model: z.string().trim().max(120), familyMicros: budget, ceilingMicros: budget }).nullable(),
  families: z.array(tree).max(10_000),
});

const guard = () => import('../auth/guard.server');
const policy = () => import('./policy.server');

async function failed(e: unknown): Promise<unknown> {
  const [{ fail }, { AuthError }] = await Promise.all([guard(), import('../auth/errors')]);
  return e instanceof AuthError ? fail(e) : e;
}

/** The operator, for a change: refused in a demo and in a preview, before anything is done. */
async function operatorForChange() {
  const [{ requireOperator }, { refuseReadOnly }] = await Promise.all([guard(), import('../read-only')]);
  const op = await requireOperator();
  try {
    refuseReadOnly();
  } catch (e) {
    throw await failed(e);
  }
  return op;
}

// ---------- the console ----------

export interface PoliciesData {
  entries: PolicyEntry[];
  keys: OperatorKeyState[];
  /** What operator-funded AI has booked this UTC month across all families (micro-dollars). */
  spentMicros: number;
  /** The operator's contact address, which the stewards' locked controls name; empty when not set. */
  contact: string;
}

export const fetchPolicies = createServerFn({ method: 'GET' }).handler(async (): Promise<PoliciesData> => {
  await (await guard()).requireOperator();
  const [p, f, { instanceSettings }] = await Promise.all([policy(), import('../ai/operator-funding.server'), import('./settings.server')]);
  const [entries, keys, spent, settings] = await Promise.all([p.policyEntries(), f.operatorKeyStates(), f.operatorSpent(), instanceSettings()]);
  return { entries, keys, spentMicros: spent.total, contact: settings.contactEmail };
});
export const policiesQuery = queryOptions({ queryKey: ['operator', 'policies'], queryFn: () => fetchPolicies() });

/** How many families and accounts a change would affect, before it is saved. Reads only. */
export const previewPolicy = createServerFn({ method: 'POST' })
  .validator(policyInput)
  .handler(async ({ data }): Promise<PolicyImpact> => {
    await (await guard()).requireOperator();
    return (await policy()).policyImpact(data.key, { scope: data.scope, ai: data.ai, families: data.families });
  });

export const savePolicy = createServerFn({ method: 'POST' })
  .validator(policyInput)
  .handler(async ({ data }) => {
    const op = await operatorForChange();
    try {
      await (await policy()).savePolicy(op, data.key, { scope: data.scope, ai: data.ai, families: data.families });
    } catch (e) {
      throw await failed(e);
    }
    return { ok: true as const };
  });

/** Saves the operator's own key for one provider (sealed; only its last four characters come back), or removes it. */
export const saveOperatorAiKey = createServerFn({ method: 'POST' })
  .validator(z.object({ provider: z.enum(AI_PROVIDERS), apiKey: z.string().max(400).nullable() }))
  .handler(async ({ data }) => {
    const op = await operatorForChange();
    const f = await import('../ai/operator-funding.server');
    if (data.apiKey === null) await f.removeOperatorKey(op, data.provider);
    else await f.saveOperatorKey(op, data.provider, data.apiKey);
    return { ok: true as const };
  });

export const fetchAnnouncementsAdmin = createServerFn({ method: 'GET' }).handler(async (): Promise<Announcement[]> => {
  await (await guard()).requireOperator();
  return (await import('./announcements.server')).allAnnouncements();
});
export const announcementsAdminQuery = queryOptions({ queryKey: ['operator', 'announcements'], queryFn: () => fetchAnnouncementsAdmin() });

export const createAnnouncement = createServerFn({ method: 'POST' })
  .validator(z.object({
    title: z.string().max(ANNOUNCEMENT_TITLE_MAX * 2), body: z.string().max(ANNOUNCEMENT_BODY_MAX * 2), audience: z.enum(ANNOUNCEMENT_AUDIENCES),
    startsAt: z.number().int().min(0), endsAt: z.number().int().min(0).nullable(),
  }))
  .handler(async ({ data }) => {
    const op = await operatorForChange();
    try {
      return await (await import('./announcements.server')).createAnnouncement(op, data);
    } catch (e) {
      throw await failed(e);
    }
  });

export const endAnnouncement = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const op = await operatorForChange();
    await (await import('./announcements.server')).endAnnouncement(op, data.id);
    return { ok: true as const };
  });

// ---------- everyone signed in ----------

/**
 * The announcements for the reader now. Nobody signed in gets none, nor does a demo. Stewards' announcements go to a steward
 * of any family here or an operator; during a "View as" preview the reader is the one previewed, so only theirs show.
 */
export const fetchMyAnnouncements = createServerFn({ method: 'GET' }).handler(async (): Promise<Announcement[]> => {
  const [{ currentSession, myMemberships, previewOf }, { isDemo }] = await Promise.all([guard(), import('../demo')]);
  const session = await currentSession();
  if (!session.user || isDemo() || session.via === 'demo') return [];
  const preview = previewOf();
  const steward = (await myMemberships()).some((m) => m.role === 'steward') || (!preview && session.user.operator === 1);
  return (await import('./announcements.server')).visibleAnnouncements({ steward });
});
export const myAnnouncementsQuery = queryOptions({ queryKey: ['announcements'], queryFn: () => fetchMyAnnouncements(), staleTime: 10 * 60_000 });

// ---------- a family's stewards ----------

/** The steward opts in to the operator's AI, or back to the family's own keys. */
export const setAiFunding = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, operator: z.boolean() }))
  .handler(async ({ data }) => {
    const [{ requireCan }, { refuseReadOnly }] = await Promise.all([guard(), import('../read-only')]);
    const m = await requireCan(data.tree, 'manage-access');
    try {
      refuseReadOnly();
    } catch (e) {
      throw await failed(e);
    }
    await (await import('../ai/operator-funding.server')).setFunding(data.tree, m.user.id, data.operator ? 'operator' : 'own');
    return { ok: true as const };
  });
