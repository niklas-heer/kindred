// Server functions for the operator console (src/routes/operator.tsx), the public request forms (/request,
// /privacy-request), the legal page (/legal) and the stewards' view of data requests about their family. Every console
// function checks `requireOperator` on the server, and every one that changes something refuses while nothing may be written
// (a demo, a "View as" preview). The work is in ./operator.server.ts and ./requests.server.ts.
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { DATA_REQUEST_KINDS, DATA_REQUEST_STATUSES, FAMILY_CREATION, SETTING_MAX, type AuditEntry, type DataRequest, type FamilyRequest, type InstanceSettings, type LegalTexts, type OperatorAccount, type OperatorFamily, type PublicInstance } from './shared';

const tree = z.string().regex(/^[a-z0-9-]{1,64}$/);
const familyId = z.string().max(80);
const familyName = z.string().max(400);
const theme = z.enum(['codex', 'modern']);
const email = z.string().trim().toLowerCase().email().max(254);
const capBytes = z.number().int().min(0).max(1e15).nullable();

const guard = () => import('../auth/guard.server');
const ops = () => import('./operator.server');
const reqs = () => import('./requests.server');

/** A refusal written for the reader gets its HTTP status; anything else is left to the error middleware. */
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

// ---------- public ----------

/** What anyone may know of this server: its name, who may make a family, which legal texts exist, Turnstile's site key. */
export const fetchPublicInstance = createServerFn({ method: 'GET' }).handler(async (): Promise<PublicInstance> => (await import('./settings.server')).publicInstance());
export const publicInstanceQuery = queryOptions({ queryKey: ['instance', 'public'], queryFn: () => fetchPublicInstance(), staleTime: 5 * 60_000 });

export const fetchLegal = createServerFn({ method: 'GET' }).handler(async (): Promise<LegalTexts> => (await import('./settings.server')).legalTexts());
export const legalQuery = queryOptions({ queryKey: ['instance', 'legal'], queryFn: () => fetchLegal() });

const formGuards = { website: z.string().max(200).optional(), turnstile: z.string().max(2048).optional() };

/** Someone asks for a family on this server (only while it takes requests). */
export const sendFamilyRequest = createServerFn({ method: 'POST' })
  .validator(z.object({ name: z.string().max(400), email: z.string().max(400), familyName: z.string().max(400), message: z.string().max(4000), locale: z.enum(['en', 'de', 'af']).optional(), ...formGuards }))
  .handler(async ({ data }) => {
    const [{ clientIP }, { refuseReadOnly }, r] = await Promise.all([import('../auth/throttle.server'), import('../read-only'), reqs()]);
    try {
      refuseReadOnly();
      return await r.submitFamilyRequest(data, { ip: clientIP(), honeypot: data.website, turnstile: data.turnstile });
    } catch (e) {
      throw await failed(e);
    }
  });

/** Anyone asks for access to, correction or deletion of data about them in a family here. */
export const sendDataRequest = createServerFn({ method: 'POST' })
  .validator(z.object({ name: z.string().max(400), email: z.string().max(400), family: z.string().max(400), kind: z.enum(DATA_REQUEST_KINDS), message: z.string().max(8000), ...formGuards }))
  .handler(async ({ data }) => {
    const [{ clientIP }, { refuseReadOnly }, r] = await Promise.all([import('../auth/throttle.server'), import('../read-only'), reqs()]);
    try {
      refuseReadOnly();
      return await r.submitDataRequest(data, { ip: clientIP(), honeypot: data.website, turnstile: data.turnstile });
    } catch (e) {
      throw await failed(e);
    }
  });

// ---------- the console ----------

export interface OperatorConsole {
  families: OperatorFamily[];
  settings: InstanceSettings;
  operators: OperatorAccount[];
  familyRequests: FamilyRequest[];
  dataRequests: DataRequest[];
  /** Whether the server can make a family here without a redeploy (Node), as the families page says. */
  workers: boolean;
  now: number;
}

export const fetchOperatorConsole = createServerFn({ method: 'GET' }).handler(async (): Promise<OperatorConsole> => {
  const { requireOperator } = await guard();
  const op = await requireOperator();
  const [o, r, { instanceSettings }, { onWorkers }] = await Promise.all([ops(), reqs(), import('./settings.server'), import('../store/index')]);
  const [families, settings, operators, familyRequests, dataRequests] = await Promise.all([
    o.operatorFamilies(), instanceSettings(), o.operators(op.id), r.familyRequests(), r.dataRequests(),
  ]);
  return { families, settings, operators, familyRequests, dataRequests, workers: onWorkers, now: Date.now() };
});
export const operatorQuery = queryOptions({ queryKey: ['operator'], queryFn: () => fetchOperatorConsole() });

export const fetchAudit = createServerFn({ method: 'GET' })
  .validator(z.object({ before: z.number().int().positive().optional() }))
  .handler(async ({ data }): Promise<AuditEntry[]> => {
    const { requireOperator } = await guard();
    await requireOperator();
    return (await import('./settings.server')).auditLog(200, data.before);
  });
export const auditQuery = queryOptions({ queryKey: ['operator', 'audit'], queryFn: () => fetchAudit({ data: {} }) });

/** Makes a family for someone else and the one-time link that makes them its first steward. The operator is not a member. */
export const operatorCreateFamily = createServerFn({ method: 'POST' })
  .validator(z.object({ id: familyId, name: familyName, theme, stewardName: z.string().max(400), stewardEmail: email.optional().or(z.literal('')) }))
  .handler(async ({ data }) => {
    const op = await operatorForChange();
    try {
      return await (await ops()).makeFamilyFor(op, { id: data.id, name: data.name, theme: data.theme, stewardName: data.stewardName, stewardEmail: data.stewardEmail || null });
    } catch (e) {
      throw await failed(e);
    }
  });

export const operatorRenewLink = createServerFn({ method: 'POST' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    const op = await operatorForChange();
    try {
      return await (await ops()).renewStewardLink(op, data.tree);
    } catch (e) {
      throw await failed(e);
    }
  });

export const operatorSetStatus = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, status: z.enum(['active', 'suspended']) }))
  .handler(async ({ data }) => {
    const op = await operatorForChange();
    try {
      await (await ops()).setFamilyStatus(op, data.tree, data.status);
    } catch (e) {
      throw await failed(e);
    }
    return { ok: true as const };
  });

export const operatorSetCap = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, capBytes }))
  .handler(async ({ data }) => {
    const op = await operatorForChange();
    try {
      await (await ops()).setFamilyCap(op, data.tree, data.capBytes);
    } catch (e) {
      throw await failed(e);
    }
    return { ok: true as const };
  });

export const operatorRecount = createServerFn({ method: 'POST' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    const op = await operatorForChange();
    try {
      return { usedBytes: await (await ops()).recountFamily(op, data.tree) };
    } catch (e) {
      throw await failed(e);
    }
  });

/** Deletes a family: its id typed as `confirm`, and (under Kindred's own sign-in) a fresh passkey proof, as for its stewards. */
export const operatorDeleteFamily = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, confirm: z.string().max(80) }))
  .handler(async ({ data }) => {
    const op = await operatorForChange();
    const [{ authMethod }, { requireFreshProof }, { getRequest }] = await Promise.all([import('../auth/method.server'), import('../auth/proof.server'), import('@tanstack/react-start/server')]);
    try {
      if (authMethod() === 'kindred') await requireFreshProof(getRequest(), op);
      await (await ops()).deleteFamilyAsOperator(op, data.tree, data.confirm);
    } catch (e) {
      throw await failed(e);
    }
    return { ok: true as const };
  });

const text = (max: number) => z.string().max(max);
export const operatorSaveSettings = createServerFn({ method: 'POST' })
  .validator(z.object({
    instanceName: text(SETTING_MAX.instanceName), contactEmail: text(SETTING_MAX.contactEmail), impressum: text(SETTING_MAX.impressum),
    privacy: text(SETTING_MAX.privacy), terms: text(SETTING_MAX.terms), reportContact: text(SETTING_MAX.reportContact),
    defaultCapBytes: capBytes, familyCreation: z.enum(FAMILY_CREATION),
  }))
  .handler(async ({ data }) => {
    const op = await operatorForChange();
    try {
      await (await ops()).updateSettings(op, data);
    } catch (e) {
      throw await failed(e);
    }
    return { ok: true as const };
  });

export const operatorAdd = createServerFn({ method: 'POST' })
  .validator(z.object({ email }))
  .handler(async ({ data }) => {
    const op = await operatorForChange();
    try {
      await (await ops()).addOperator(op, data.email);
    } catch (e) {
      throw await failed(e);
    }
    return { ok: true as const };
  });

/** Ends an operator's role; with the reader's own account, they step down. Never the last operator. */
export const operatorRemove = createServerFn({ method: 'POST' })
  .validator(z.object({ account: z.string().uuid() }))
  .handler(async ({ data }) => {
    const op = await operatorForChange();
    try {
      await (await ops()).removeOperator(op, data.account);
    } catch (e) {
      throw await failed(e);
    }
    return { ok: true as const };
  });

export const operatorApproveRequest = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().uuid(), familyId, familyName, theme }))
  .handler(async ({ data }) => {
    const op = await operatorForChange();
    try {
      return await (await reqs()).approveFamilyRequest(op, data.id, { id: data.familyId, name: data.familyName, theme: data.theme });
    } catch (e) {
      throw await failed(e);
    }
  });

export const operatorDeclineRequest = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const op = await operatorForChange();
    try {
      await (await reqs()).declineFamilyRequest(op, data.id);
    } catch (e) {
      throw await failed(e);
    }
    return { ok: true as const };
  });

export const operatorDataRequestStatus = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().uuid(), status: z.enum(DATA_REQUEST_STATUSES) }))
  .handler(async ({ data }) => {
    const op = await operatorForChange();
    try {
      await (await reqs()).setDataRequestStatus(op, data.id, data.status);
    } catch (e) {
      throw await failed(e);
    }
    return { ok: true as const };
  });

// ---------- the family's stewards ----------

/** The data requests that name this family, for its stewards (the Access page). */
export const fetchFamilyDataRequests = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }): Promise<DataRequest[]> => {
    const { requireCan } = await guard();
    await requireCan(data.tree, 'manage-access');
    return (await reqs()).dataRequests(data.tree);
  });
export const familyDataRequestsQuery = (t: string) => queryOptions({ queryKey: ['data-requests', t], queryFn: () => fetchFamilyDataRequests({ data: { tree: t } }) });

export const stewardDataRequestDone = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const [{ requireCan }, { refuseReadOnly }] = await Promise.all([guard(), import('../read-only')]);
    const m = await requireCan(data.tree, 'manage-access');
    try {
      refuseReadOnly();
      await (await reqs()).stewardMarksDone(data.tree, m.user.id, data.id);
    } catch (e) {
      throw await failed(e);
    }
    return { ok: true as const };
  });
