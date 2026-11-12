// The instance's own settings (accounts table `instance_setting`, migration 0034) and the operator's audit log
// (`operator_audit`). A missing setting is its default, so an install that never opened the console behaves as before:
// any steward may make a family, and no legal page is shown.
import { q, store, type Query } from '../store/index.ts';
import {
  DEFAULT_FAMILY_CREATION, FAMILY_CREATION, OPEN_REQUESTS_MAX, TEXT_SETTINGS, type AuditEntry, type FamilyCreation, type InstanceSettings, type LegalTexts, type PublicInstance,
} from './shared.ts';

const accounts = () => store.accounts();

type Key = (typeof TEXT_SETTINGS)[number] | 'defaultCapBytes' | 'familyCreation' | 'familiesPerAccount';
const COLUMN: Record<Key, string> = {
  instanceName: 'instance_name', contactEmail: 'contact_email', impressum: 'impressum', privacy: 'privacy', terms: 'terms',
  reportContact: 'report_contact', defaultCapBytes: 'default_cap_bytes', familyCreation: 'family_creation', familiesPerAccount: 'families_per_account',
};

/** A stored whole number of at least 0, or null when the row is missing or holds anything else. */
const count = (v: string | undefined) => {
  const n = Number(v);
  return v && Number.isInteger(n) && n >= 0 ? n : null;
};

/** Every setting, with the defaults for those never set. */
export async function instanceSettings(): Promise<InstanceSettings> {
  const rows = await accounts().all<{ key: string; value: string }>('SELECT key, value FROM instance_setting');
  const v = new Map(rows.map((r) => [r.key, r.value]));
  const text = (k: (typeof TEXT_SETTINGS)[number]) => v.get(COLUMN[k]) ?? '';
  const creation = v.get(COLUMN.familyCreation);
  return {
    instanceName: text('instanceName'), contactEmail: text('contactEmail'), impressum: text('impressum'), privacy: text('privacy'),
    terms: text('terms'), reportContact: text('reportContact'),
    defaultCapBytes: count(v.get(COLUMN.defaultCapBytes)),
    familyCreation: (FAMILY_CREATION as readonly string[]).includes(creation ?? '') ? (creation as FamilyCreation) : DEFAULT_FAMILY_CREATION,
    familiesPerAccount: count(v.get(COLUMN.familiesPerAccount)),
  };
}

export const familyCreation = async (): Promise<FamilyCreation> => (await instanceSettings()).familyCreation;

/** The statements that store `next` (a setting left empty is deleted, so it is its default again). */
export function saveSettings(next: InstanceSettings, by: string, at = Date.now()): Query[] {
  const value = (k: Key): string | null => {
    if (k === 'defaultCapBytes') return next.defaultCapBytes === null ? null : String(next.defaultCapBytes);
    if (k === 'familiesPerAccount') return next.familiesPerAccount === null ? null : String(next.familiesPerAccount);
    if (k === 'familyCreation') return next.familyCreation === DEFAULT_FAMILY_CREATION ? null : next.familyCreation;
    return next[k].trim() || null;
  };
  return (Object.keys(COLUMN) as Key[]).map((k) => {
    const v = value(k);
    return v === null
      ? q('DELETE FROM instance_setting WHERE key = ?', COLUMN[k])
      : q('INSERT INTO instance_setting (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by', COLUMN[k], v, at, by);
  });
}

/** Cloudflare Turnstile is on only with both its site key and its secret. */
export function turnstileKeys(env: Record<string, string | undefined> = process.env): { site: string; secret: string } | undefined {
  const site = env.KINDRED_TURNSTILE_SITE_KEY?.trim();
  const secret = env.KINDRED_TURNSTILE_SECRET?.trim();
  return site && secret ? { site, secret } : undefined;
}

/** Whether each form's list is full: OPEN_REQUESTS_MAX requests wait (requests.server.ts refuses the next one in its batch). */
export async function formsFull(): Promise<PublicInstance['full']> {
  const row = await accounts().get<{ family: number; data: number }>(
    "SELECT (SELECT count(*) FROM family_request WHERE status = 'open') AS family, (SELECT count(*) FROM data_request WHERE status = 'open') AS data");
  return { family: (row?.family ?? 0) >= OPEN_REQUESTS_MAX, data: (row?.data ?? 0) >= OPEN_REQUESTS_MAX };
}

export async function publicInstance(): Promise<PublicInstance> {
  const [s, full] = await Promise.all([instanceSettings(), formsFull()]);
  const site = turnstileKeys()?.site;
  const contact = s.contactEmail.trim();
  return {
    instanceName: s.instanceName,
    familyCreation: s.familyCreation,
    legal: { impressum: !!s.impressum.trim(), privacy: !!s.privacy.trim(), terms: !!s.terms.trim(), report: !!s.reportContact.trim() },
    ...(site ? { turnstileSiteKey: site } : {}),
    ...(contact ? { contactEmail: contact } : {}),
    full,
  };
}

export async function legalTexts(): Promise<LegalTexts> {
  const { instanceName, contactEmail, impressum, privacy, terms, reportContact } = await instanceSettings();
  return { instanceName, contactEmail, impressum, privacy, terms, reportContact };
}

// ---------- the audit log ----------

/** Who did something, as the log keeps them: the account (no foreign key) and the name it had then. */
export interface AuditActor { id: string; name: string }

/** The statement that logs one operator action; it goes in the same batch as the action when it can. */
export const audit = (by: AuditActor, action: string, family: string | null, detail?: Record<string, unknown>, at = Date.now()): Query =>
  q('INSERT INTO operator_audit (at, account, name, action, family, detail) VALUES (?, ?, ?, ?, ?, ?)', at, by.id, by.name, action, family, detail ? JSON.stringify(detail) : null);

export async function auditLog(limit = 200, before?: number): Promise<AuditEntry[]> {
  const rows = await accounts().all<{ id: number; at: number; name: string; action: string; family: string | null; detail: string | null }>(
    `SELECT id, at, name, action, family, detail FROM operator_audit ${before ? 'WHERE id < ?' : ''} ORDER BY id DESC LIMIT ?`, ...(before ? [before, limit] : [limit]));
  return rows;
}
