// Server functions for data protection (docs/gdpr.md): a reader's own account (download, delete), a family's stewards
// answering a request about someone in their records (find, report, copy, erase, restrict), the notices of a breach for those
// stewards, and the operator's Privacy tab (breach register, retention, the Art. 30 record). Roles are checked here, on the
// server; the work is in the ./*.server.ts modules beside this file. Every change refuses while nothing may be written (a demo,
// a "View as" preview), and the irreversible ones need a fresh proof under Kindred's own sign-in.
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { AccountExport } from './account.server';
import type { Breach, BreachInput } from './breach.server';
import type { ProcessingRecord } from './record.server';
import type { RetentionMode, RetentionReport } from './retention.server';
import type { PersonHit, SubjectCopy, SubjectReport } from './subject.server';
import type { Subprocessor } from '../operator/shared';

const tree = z.string().regex(/^[a-z0-9-]{1,64}$/);
const person = z.string().min(1).max(200);
const guard = () => import('../auth/guard.server');

async function failed(e: unknown): Promise<unknown> {
  const [{ fail }, { AuthError }] = await Promise.all([guard(), import('../auth/errors')]);
  return e instanceof AuthError ? fail(e) : e;
}

/** Refuses in a demo or a preview, and asks for a fresh proof under Kindred's own sign-in: for what cannot be undone. */
async function irreversible(user: import('../auth/store.server').UserRow) {
  const [{ refuseReadOnly }, { authMethod }, { requireFreshProof }, { getRequest }] = await Promise.all([
    import('../read-only'), import('../auth/method.server'), import('../auth/proof.server'), import('@tanstack/react-start/server'),
  ]);
  refuseReadOnly();
  if (authMethod() === 'kindred') await requireFreshProof(getRequest(), user);
}

// ---------- the reader's own account ----------

/** Everything about the reader's account, as JSON text (Art. 15 and 20), and the day it was made, for the file's name. */
export const fetchMyData = createServerFn({ method: 'GET' }).handler(async (): Promise<{ day: string; text: string }> => {
  const { requireUser } = await guard();
  const user = await requireUser();
  const data: AccountExport = await (await import('./account.server')).exportAccount(user.id);
  return { day: data.exported.slice(0, 10), text: JSON.stringify(data, null, 2) };
});

/** Whether the reader's account may be deleted now, and if not, why (the last steward of a family, the last operator). */
export const fetchDeletionCheck = createServerFn({ method: 'GET' }).handler(async (): Promise<{ blocked: string | null }> => {
  const { requireUser } = await guard();
  const user = await requireUser();
  const blocked = await (await import('./account.server')).deletionBlocked(user);
  return { blocked: blocked?.message ?? null };
});
export const deletionCheckQuery = queryOptions({ queryKey: ['session', 'deletion-check'], queryFn: () => fetchDeletionCheck() });

/** Deletes the reader's account (Art. 17): `confirm` is their name or email, typed. Their sessions and passkeys go with it. */
export const deleteMyAccount = createServerFn({ method: 'POST' })
  .validator(z.object({ confirm: z.string().max(400) }))
  .handler(async ({ data }) => {
    const { requireUser } = await guard();
    const user = await requireUser();
    try {
      await irreversible(user);
      return await (await import('./account.server')).deleteAccount(user, data.confirm);
    } catch (e) {
      throw await failed(e);
    }
  });

// ---------- a family's stewards: a request about someone ----------

async function steward(t: string, read = false) {
  const { requireCan } = await guard();
  return requireCan(t, 'manage-access', { read });
}

export const findSubject = createServerFn({ method: 'GET' })
  .validator(z.object({ tree, text: z.string().max(200) }))
  .handler(async ({ data }): Promise<PersonHit[]> => {
    await steward(data.tree, true);
    return (await import('./subject.server')).findPeople(data.tree, data.text);
  });

export const fetchSubjectReport = createServerFn({ method: 'GET' })
  .validator(z.object({ tree, person }))
  .handler(async ({ data }): Promise<SubjectReport> => {
    await steward(data.tree, true);
    try {
      return await (await import('./subject.server')).subjectReport(data.tree, data.person);
    } catch (e) {
      throw await failed(e);
    }
  });
export const subjectReportQuery = (t: string, p: string) => queryOptions({ queryKey: ['subject', t, p], queryFn: () => fetchSubjectReport({ data: { tree: t, person: p } }) });

/** A copy of what the family keeps about one person, for the steward to send them (Art. 15). */
export const fetchSubjectCopy = createServerFn({ method: 'GET' })
  .validator(z.object({ tree, person }))
  .handler(async ({ data }): Promise<{ text: string }> => {
    await steward(data.tree, true);
    try {
      const copy: SubjectCopy = await (await import('./subject.server')).subjectCopy(data.tree, data.person);
      return { text: JSON.stringify(copy, null, 2) };
    } catch (e) {
      throw await failed(e);
    }
  });

const requestId = z.string().uuid().nullable().optional();

/** Erases a living non-member from the family everywhere Kindred keeps them. `confirm` is the person's name, typed. */
export const eraseSubject = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, person, confirm: z.string().max(400), request: requestId }))
  .handler(async ({ data }) => {
    const m = await steward(data.tree);
    const s = await import('./subject.server');
    try {
      // An erasure that stopped after the family's records went is finished without the name, which is no longer known.
      if (!(await s.pendingErasure(data.tree, data.person))) {
        const report = await s.subjectReport(data.tree, data.person);
        if (data.confirm.trim().toLowerCase() !== report.person.name.trim().toLowerCase()) {
          throw new (await import('../auth/errors')).AuthError('invalid', 'gdpr.err.confirm_person');
        }
      }
      await irreversible(m.user);
      return await s.erasePerson(data.tree, data.person, m.user.id, data.request ?? null);
    } catch (e) {
      throw await failed(e);
    }
  });

export const restrictSubject = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, person, on: z.boolean(), request: requestId }))
  .handler(async ({ data }) => {
    const m = await steward(data.tree);
    const [s, { refuseReadOnly }] = await Promise.all([import('./subject.server'), import('../read-only')]);
    try {
      refuseReadOnly();
      if (data.on) await s.restrictPerson(data.tree, data.person, m.user.id, data.request ?? null);
      else await s.liftRestriction(data.tree, data.person, m.user.id);
    } catch (e) {
      throw await failed(e);
    }
    return { ok: true as const };
  });

/** A breach notice the operator addressed to this family's stewards (none for anyone else). */
export const fetchBreachNotices = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    const { requireMember } = await guard();
    const m = await requireMember(data.tree);
    if (m.role !== 'steward') return [];
    return (await import('./breach.server')).noticesFor(data.tree);
  });
export const breachNoticesQuery = (t: string) => queryOptions({ queryKey: ['breach-notices', t], queryFn: () => fetchBreachNotices({ data: { tree: t } }), staleTime: 10 * 60_000 });

// ---------- the operator ----------

async function operator(change = false) {
  const { requireOperator } = await guard();
  const op = await requireOperator();
  if (change) {
    try {
      (await import('../read-only')).refuseReadOnly();
    } catch (e) {
      throw await failed(e);
    }
  }
  return op;
}

export interface PrivacyConsole {
  breaches: Breach[];
  retention: { mode: RetentionMode; report: RetentionReport | null };
  subprocessors: Subprocessor[];
  now: number;
}

export const fetchPrivacyConsole = createServerFn({ method: 'GET' }).handler(async (): Promise<PrivacyConsole> => {
  await operator();
  const [b, r, s] = await Promise.all([import('./breach.server'), import('./retention.server'), import('./subprocessors')]);
  const [breaches, mode, report, subprocessors] = await Promise.all([b.breaches(), r.retentionMode(), r.lastReport(), s.subprocessors()]);
  return { breaches, retention: { mode, report }, subprocessors, now: Date.now() };
});
export const privacyConsoleQuery = queryOptions({ queryKey: ['operator', 'privacy'], queryFn: () => fetchPrivacyConsole() });

const when = z.number().int().min(0).max(8.64e15).nullable();
const breachInput = z.object({
  title: z.string().max(400), awareAt: z.number().int().min(0).max(8.64e15), occurredAt: when, description: z.string().max(8000), dataCategories: z.string().max(2000),
  subjects: z.string().max(2000), consequences: z.string().max(4000), measures: z.string().max(4000), risk: z.enum(['unknown', 'none', 'risk', 'high']),
  authorityAt: when, authorityRef: z.string().max(400), lateReason: z.string().max(2000), subjectsAt: when, notice: z.string().max(1000), noticeUntil: when, closedAt: when,
  families: z.array(tree).max(500),
});

export const operatorSaveBreach = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().uuid().optional(), breach: breachInput }))
  .handler(async ({ data }) => {
    const op = await operator(true);
    try {
      return { id: await (await import('./breach.server')).saveBreach(op, data.breach as BreachInput, data.id) };
    } catch (e) {
      throw await failed(e);
    }
  });

/** Counts what the retention rules would delete now, without deleting or storing anything. */
export const operatorRetentionPreview = createServerFn({ method: 'POST' }).handler(async (): Promise<RetentionReport> => {
  await operator();
  return (await import('./retention.server')).runRetention(Date.now(), { dryRun: true });
});

export const operatorSetRetention = createServerFn({ method: 'POST' })
  .validator(z.object({ mode: z.enum(['report', 'delete']) }))
  .handler(async ({ data }) => {
    const op = await operator(true);
    await (await import('./retention.server')).setRetentionMode(op, data.mode);
    return { ok: true as const };
  });

/** The record of processing activities (Art. 30), as Markdown or JSON, for the operator to download. */
export const fetchProcessingRecord = createServerFn({ method: 'GET' })
  .validator(z.object({ format: z.enum(['md', 'json']) }))
  .handler(async ({ data }): Promise<{ name: string; type: string; text: string }> => {
    await operator();
    const r = await import('./record.server');
    const record: ProcessingRecord = await r.processingRecord();
    const day = record.generated.slice(0, 10);
    return data.format === 'md'
      ? { name: `processing-record-${day}.md`, type: 'text/markdown', text: r.recordMarkdown(record) }
      : { name: `processing-record-${day}.json`, type: 'application/json', text: JSON.stringify(record, null, 2) };
  });
